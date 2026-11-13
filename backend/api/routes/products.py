"""
Products API routes with filtering, sorting, and pagination.
"""
from typing import Optional
import shutil
import os
import traceback
import logging
from fastapi import APIRouter, Depends, HTTPException, Query, UploadFile, File, Body
from fastapi.responses import JSONResponse
from pydantic import BaseModel
import base64
import uuid
from pathlib import Path
from ..excel_processor import process_excel_import
from sqlalchemy import select, func, or_
from sqlalchemy.ext.asyncio import AsyncSession

from ..database import get_db
from sqlalchemy.orm import selectinload
from ..models import Product, ProductImage
from ..schemas import (
    ProductResponse, ProductCreate, ProductUpdate,
    ProductListResponse, MessageResponse
)

router = APIRouter(prefix="/api/products", tags=["products"])

class Base64FileRequest(BaseModel):
    filename: str
    base64_data: str

class Base64ChunkRequest(BaseModel):
    session_id: str
    filename: str
    chunk_index: int
    total_chunks: int
    base64_data: str

CHUNK_STORAGE = {}


@router.get("", response_model=ProductListResponse)
async def get_products(
    category: Optional[int] = Query(None, description="Filter by category ID"),
    subcategory: Optional[int] = Query(None, description="Filter by subcategory ID"),
    is_new: Optional[bool] = Query(None, description="Filter by new products"),
    active: Optional[bool] = Query(None, description="Filter by active status (admin only)"),
    in_stock_zero: Optional[bool] = Query(None, description="Filter products with in_stock=0 (admin only)"),
    q: Optional[str] = Query(None, description="Search by name"),
    sort: Optional[str] = Query("name_asc", description="Sort: price_asc, price_desc, name_asc, name_desc, newest, oldest"),
    page: int = Query(1, ge=1, description="Page number"),
    limit: int = Query(20, ge=1, le=10000, description="Items per page"),
    admin_view: bool = Query(False, description="Admin mode to bypass active and in_stock filters"),
    db: AsyncSession = Depends(get_db)
):
    """
    Get products with filtering, sorting, and pagination.
    """
    try:
        # Base query WITHOUT eager loading of images for count calculation
        if admin_view:
            base_query = select(Product)
        else:
            base_query = select(Product).where(Product.active == True)
        
        # Apply filters
        if category:
            base_query = base_query.where(Product.category_id == category)
        
        if subcategory:
            base_query = base_query.where(Product.subcategory_id == subcategory)
        
        if is_new:
            base_query = base_query.where(Product.is_new == True)
        
        # Admin-only filters
        if admin_view and active is not None:
            base_query = base_query.where(Product.active == active)
        
        if admin_view and in_stock_zero:
            base_query = base_query.where(Product.in_stock == 0)
        
        if q:
            search_term = f"%{q}%"
            base_query = base_query.where(
                or_(
                    Product.name.ilike(search_term),
                    Product.description.ilike(search_term)
                )
            )
        
        if not admin_view:
            # HIDE OUT OF STOCK ITEMS (in_stock=0)
            base_query = base_query.where((Product.in_stock == None) | (Product.in_stock > 0)) # noqa: E711
        
        # Count total (using the clean base_query without selectinload)
        count_query = select(func.count()).select_from(base_query.subquery())
        total_result = await db.execute(count_query)
        total = total_result.scalar() or 0

        # Now define the actual data query with eager loading
        query = base_query.options(selectinload(Product.images))
        
        # Apply sorting
        sort_mapping = {
            "price_asc": Product.price_per_unit.asc(),
            "price_desc": Product.price_per_unit.desc(),
            "name_asc": func.lower(Product.name).asc(),
            "name_desc": func.lower(Product.name).desc(),
            "newest": Product.created_at.desc(),
            "oldest": Product.created_at.asc(),
        }
        order_clause = sort_mapping.get(sort, Product.created_at.desc())
        query = query.order_by(order_clause)
        
        # Apply pagination
        offset = (page - 1) * limit
        query = query.offset(offset).limit(limit)
        
        # Execute
        result = await db.execute(query)
        products = result.scalars().all()
        
        # Calculate pages
        pages = (total + limit - 1) // limit if total > 0 else 1
        
        return ProductListResponse(
            items=products,
            total=total,
            page=page,
            limit=limit,
            pages=pages
        )
    except Exception as e:
        logging.error(f"get_products error: {e}")
        logging.error(traceback.format_exc())
        return JSONResponse(
            status_code=500,
            content={"error": str(e), "traceback": traceback.format_exc()}
        )


@router.get("/{product_id}", response_model=ProductResponse)
async def get_product(
    product_id: int,
    admin_view: bool = Query(False, description="Admin mode to bypass active filter"),
    db: AsyncSession = Depends(get_db)
):
    """Get a single product by ID."""
    query = select(Product).options(selectinload(Product.images)).where(Product.id == product_id)
    if not admin_view:
        query = query.where(Product.active == True)
        
    result = await db.execute(query)
    product = result.scalar_one_or_none()
    
    if not product:
        raise HTTPException(status_code=404, detail="Товар не найден")
    
    return product


@router.post("", response_model=ProductResponse)
async def create_product(
    product: ProductCreate,
    db: AsyncSession = Depends(get_db)
):
    """Create a new product."""
    product_data = product.model_dump()
    images_ids = product_data.pop("images", []) or [] # Remove images from dict
    
    # Use first image as main for backward compatibility fields
    if images_ids:
        product_data["image_file_id"] = images_ids[0]

    db_product = Product(**product_data)
    db.add(db_product)
    await db.commit()
    await db.refresh(db_product)
    
    # Create images
    if images_ids:
        for idx, file_id in enumerate(images_ids):
            img = ProductImage(
                product_id=db_product.id,
                file_id=file_id,
                is_main=(idx == 0)
            )
            db.add(img)
        await db.commit()
        
    # Always reload to ensure images relationship is loaded
    result = await db.execute(
        select(Product).options(selectinload(Product.images)).where(Product.id == db_product.id)
    )
    db_product = result.scalar_one()

    return db_product


@router.post("/import", response_model=MessageResponse)
async def import_products(
    file: UploadFile = File(...)
):
    """Import products from spreadsheet file (Excel, CSV, ODS)."""
    allowed = ('.xlsx', '.xls', '.xlsm', '.xlsb', '.ods', '.csv', '.tsv')
    if not file.filename.lower().endswith(allowed):
        raise HTTPException(
            status_code=400,
            detail=f"Поддерживаемые форматы: {', '.join(allowed)}"
        )

    # Save to temp file
    temp_file = f"temp_{file.filename}"
    try:
        with open(temp_file, "wb") as buffer:
            shutil.copyfileobj(file.file, buffer)
        
        result_msg = await process_excel_import(temp_file)
        return MessageResponse(message=result_msg)
        
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Import failed: {str(e)}")
    finally:
        if os.path.exists(temp_file):
            os.remove(temp_file)


@router.post("/import_b64", response_model=MessageResponse)
async def import_products_b64(request: Base64FileRequest):
    """Import products from base64 string (workaround for Telegram Android)."""
    allowed = ('.xlsx', '.xls', '.xlsm', '.xlsb', '.ods', '.csv', '.tsv')
    if not request.filename.lower().endswith(allowed):
        raise HTTPException(
            status_code=400,
            detail=f"Поддерживаемые форматы: {', '.join(allowed)}"
        )

    # Save to temp file
    temp_file = f"temp_{uuid.uuid4()}_{request.filename}"
    try:
        # Extract base64 data (remove data:application/vnd...;base64, prefix if present)
        b64_data = request.base64_data
        if "," in b64_data:
            b64_data = b64_data.split(",")[1]
            
        file_bytes = base64.b64decode(b64_data)
        with open(temp_file, "wb") as buffer:
            buffer.write(file_bytes)
        
        result_msg = await process_excel_import(temp_file)
        return MessageResponse(message=result_msg)
        
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Import failed: {str(e)}")
    finally:
        if os.path.exists(temp_file):
            os.remove(temp_file)

@router.post("/import_b64_chunk", response_model=MessageResponse)
async def import_products_b64_chunk(request: Base64ChunkRequest):
    """Import large products from base64 string in chunks."""
    session = request.session_id
    
    if session not in CHUNK_STORAGE:
        CHUNK_STORAGE[session] = {
            "filename": request.filename,
            "chunks": {},
            "total_chunks": request.total_chunks
        }
        
    storage = CHUNK_STORAGE[session]
    storage["chunks"][request.chunk_index] = request.base64_data
    
    # Check if all chunks are received
    if len(storage["chunks"]) == storage["total_chunks"]:
        print(f"[Import] Reassembling {request.total_chunks} chunks for {request.filename}")
        
        # Reassemble base64 string
        full_b64 = ""
        for i in range(storage["total_chunks"]):
            full_b64 += storage["chunks"].get(i, "")
            
        # Clean up memory
        del CHUNK_STORAGE[session]
        
        if not full_b64:
            return MessageResponse(message="❌ Ошибка: Получен пустой файл (0 байт). На Android это часто бывает при выборе файла из 'Недавних' или из облака. Пожалуйста, сохраните файл на устройство и выберите его через системное приложение 'Файлы'.")
        
        # Process the full base64 string
        temp_dir = Path("temp")
        temp_dir.mkdir(parents=True, exist_ok=True)
        temp_file = temp_dir / f"import_{uuid.uuid4().hex}_{request.filename}"
        
        try:
            file_bytes = base64.b64decode(full_b64)
            with open(temp_file, "wb") as buffer:
                buffer.write(file_bytes)
            
            result_msg = await process_excel_import(temp_file)
            
            if os.path.exists(temp_file):
                os.remove(temp_file)
                
            return MessageResponse(message=result_msg)
        except Exception as e:
            if os.path.exists(temp_file):
                os.remove(temp_file)
            raise HTTPException(status_code=500, detail=str(e))
            
    return MessageResponse(message=f"Получена часть {request.chunk_index + 1} из {request.total_chunks}")

@router.put("/{product_id}", response_model=ProductResponse)
async def update_product(
    product_id: int,
    product: ProductUpdate,
    db: AsyncSession = Depends(get_db)
):
    """Update a product."""
    result = await db.execute(select(Product).where(Product.id == product_id))
    db_product = result.scalar_one_or_none()
    
    if not db_product:
        raise HTTPException(status_code=404, detail="Товар не найден")
    
    update_data = product.model_dump(exclude_unset=True)
    
    # Handle images update if provided
    if "images" in update_data:
        new_images = update_data.pop("images")
        
        # Delete existing images from disk first
        existing_images_result = await db.execute(select(ProductImage).where(ProductImage.product_id == product_id))
        existing_images = existing_images_result.scalars().all()
        
        current_file = Path(__file__).resolve()
        backend_root = current_file.parent.parent.parent
        upload_dir = backend_root / "static" / "uploads"
        is_docker = os.path.exists("/data")
        if is_docker:
            upload_dir = Path("/data/uploads")
            
        for img_record in existing_images:
            if img_record.file_id and img_record.file_id.startswith("/static/uploads/"):
                filename = img_record.file_id.split("/")[-1]
                thumb_filename = filename.replace(".webp", "_thumb.webp")
                
                main_path = upload_dir / filename
                thumb_path = upload_dir / thumb_filename
                
                try:
                    if main_path.exists():
                        os.remove(main_path)
                    if thumb_path.exists():
                        os.remove(thumb_path)
                except Exception as e:
                    logging.warning(f"Could not delete old image file {filename}: {e}")

        # Delete existing images from DB
        from sqlalchemy import delete
        await db.execute(delete(ProductImage).where(ProductImage.product_id == product_id))
        
        # Add new images
        if new_images:
            for idx, file_id in enumerate(new_images):
                img = ProductImage(
                    product_id=product_id,
                    file_id=file_id,
                    is_main=(idx == 0)
                )
                db.add(img)
            
            # Update legacy fields for compatibility
            update_data["image_file_id"] = new_images[0]
            # We don't have image_url here usually unless passed, but let's leave it.

    for key, value in update_data.items():
        setattr(db_product, key, value)
    
    await db.commit()
    await db.refresh(db_product)
    
    # Reload with images
    result = await db.execute(select(Product).options(selectinload(Product.images)).where(Product.id == product_id))
    return result.scalar_one()


@router.delete("/{product_id}", response_model=MessageResponse)
async def delete_product(product_id: int, db: AsyncSession = Depends(get_db)):
    """Delete (deactivate) a product and remove its images from disk."""
    import os
    import logging
    from pathlib import Path
    
    result = await db.execute(select(Product).options(selectinload(Product.images)).where(Product.id == product_id))
    db_product = result.scalar_one_or_none()
    
    if not db_product:
        raise HTTPException(status_code=404, detail="Товар не найден")
    
    # physical deletion of image files
    current_file = Path(__file__).resolve()
    backend_root = current_file.parent.parent.parent
    upload_dir = backend_root / "static" / "uploads"
    is_docker = os.path.exists("/data")
    if is_docker:
        upload_dir = Path("/data/uploads")
        
    for img_record in db_product.images:
        if img_record.file_id and img_record.file_id.startswith("/static/uploads/"):
            filename = img_record.file_id.split("/")[-1]
            thumb_filename = filename.replace(".webp", "_thumb.webp")
            
            main_path = upload_dir / filename
            thumb_path = upload_dir / thumb_filename
            
            try:
                if main_path.exists():
                    os.remove(main_path)
                if thumb_path.exists():
                    os.remove(thumb_path)
            except Exception as e:
                logging.warning(f"Could not delete old image file {filename}: {e}")
                
    # Also clear the image records from DB to save space and remove references to deleted files
    from sqlalchemy import delete
    await db.execute(delete(ProductImage).where(ProductImage.product_id == product_id))
    
    # Soft delete - deactivate
    db_product.active = False
    await db.commit()
    
    return MessageResponse(message="Товар удалён, изображения стёрты с диска.", id=product_id)
