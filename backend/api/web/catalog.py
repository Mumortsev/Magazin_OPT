from datetime import datetime
from decimal import Decimal
import io
import os
from pathlib import Path
import re
from typing import Annotated, Literal
from urllib.parse import urlsplit
from uuid import uuid4

from fastapi import APIRouter, Depends, HTTPException, Query, UploadFile
from PIL import Image, ImageOps, UnidentifiedImageError
from pydantic import BaseModel, Field, StringConstraints, field_validator
from sqlalchemy import event, func, or_, select, update
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload
from starlette.concurrency import run_in_threadpool

from ..database import engine, get_db
from ..models import Category, Product, ProductImage, Subcategory
from ..routes.images import get_upload_dir
from .models import ContentRecord, Staff
from .security import admin_only, audit, begin_write

public = APIRouter(prefix="/api/v1/shop")
admin = APIRouter(prefix="/api/v1/admin", dependencies=[Depends(admin_only)])
MEDIA = Path(os.getenv("SHOP_MEDIA_DIR", str(get_upload_dir())))
PAGE_SIZE = 30
Name = Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=255)]
Collection = Literal["sale", "hits", "new"]
COLLECTION_FIELDS = {"sale": "offer_ids", "hits": "featured_ids"}
COLLECTION_LIMIT = 24


@event.listens_for(engine.sync_engine, "connect")
def sqlite_functions(connection, _record):
    if engine.dialect.name == "sqlite":
        connection.create_function("shop_casefold", 1, lambda value: value.casefold() if value else "", deterministic=True)


def media_url(value: str | None) -> str | None:
    if not value:
        return None
    if value.startswith(("/uploads/", "/static/uploads/")):
        filename = value.rsplit("/", 1)[-1]
        return f"/uploads/{filename}" if re.fullmatch(r"[\w.-]+\.(?:webp|jpg|jpeg|png)", filename, re.I) else None
    if value.startswith("/api/images/"):
        value = value.removeprefix("/api/images/")
    if re.fullmatch(r"[\w-]{10,255}", value, re.ASCII):
        return f"/api/images/{value}"
    try:
        parsed = urlsplit(value)
        if parsed.scheme == "https" and parsed.hostname and not parsed.username and not parsed.password:
            return value
    except ValueError:
        pass
    return None


def valid_media(value: str | None, *, local_banner: bool = False) -> str | None:
    if not value:
        return None
    if local_banner and value == "/images/hero.webp":
        return value
    resolved = media_url(value)
    if resolved is None or len(resolved) > 1000:
        raise ValueError("Укажите адрес HTTPS или загрузите изображение")
    return resolved


def pictures(product: Product) -> list[str]:
    gallery = sorted(product.images, key=lambda image: (not image.is_main, image.id))
    values = [media_url(image.image_url or image.file_id) for image in gallery]
    if not any(values):
        values.append(media_url(product.image_url or product.image_file_id))
    return list(dict.fromkeys(value for value in values if value))


def serialize_product(product: Product) -> dict:
    return {"id": product.id, "name": product.name, "description": product.description, "sku": product.sku,
            "country": product.country, "category_id": product.category_id, "category": product.category.name,
            "subcategory_id": product.subcategory_id, "price": float(product.price_per_unit),
            "pack": product.pieces_per_pack, "minimum": product.min_order_packs, "available": product.in_stock,
            "isNew": product.is_new, "images": pictures(product), "badge": product.badge_text}


def visible_products():
    return (select(Product).join(Product.category).outerjoin(Product.subcategory)
        .where(Product.active.is_(True), Category.active.is_(True),
               or_(Product.subcategory_id.is_(None), Subcategory.active.is_(True)))
        .options(selectinload(Product.images), selectinload(Product.category)))


def search_products(query, phrase: str):
    if phrase.strip():
        search = phrase.strip().casefold()
        query = query.where(or_(func.instr(func.shop_casefold(Product.name), search) > 0,
                                func.instr(func.shop_casefold(Product.sku), search) > 0))
    return query


def stock_filter():
    return or_(Product.in_stock.is_(None), Product.in_stock >= Product.min_order_packs)


def category_dict(item: Category | Subcategory, parent_id: int | None = None) -> dict:
    return {"id": item.id, "parent_id": parent_id, "name": item.name, "order": item.order,
            "active": item.active, "image": media_url(item.image_url or item.image_file_id)}


class InformationPage(BaseModel):
    title: Name
    body: str = Field(max_length=16000)


class Content(BaseModel):
    title: str = Field(default="Курортник — курортные товары оптом", max_length=160)
    description: str = Field(default="Оптовый каталог курортных товаров. Выберите упаковки и отправьте заявку менеджеру.", max_length=320)
    banner_title: str = Field(default="Курортные товары оптом", max_length=160)
    banner_text: str = Field(default="Соберите ассортимент для магазина или сезонной торговой точки.", max_length=1200)
    banner_image: str = "/images/hero.webp"
    conditions: str = Field(default="Заказ оформляется упаковками. Менеджер уточнит наличие и стоимость по телефону.", max_length=16000)
    delivery: str = Field(default="Способ, сроки и стоимость доставки согласовываются с менеджером.", max_length=16000)
    phone: str = Field(default="", max_length=40, pattern=r"^[+\d().\s-]*$")
    email: str = Field(default="", max_length=254, pattern=r"^(?:[\w.+-]+@[\w.-]+\.[a-zA-Z]{2,}|)$")
    address: str = Field(default="", max_length=500)
    steps: list[Name] = Field(default_factory=lambda: ["Найдите нужные товары в каталоге.", "Укажите количество упаковок и проверьте корзину.", "Отправьте заявку и дождитесь звонка менеджера."], max_length=12)
    featured_ids: list[Annotated[int, Field(gt=0)]] = Field(default_factory=list, max_length=COLLECTION_LIMIT)
    offer_ids: list[Annotated[int, Field(gt=0)]] = Field(default_factory=list, max_length=COLLECTION_LIMIT)
    pages: dict[Annotated[str, StringConstraints(pattern=r"^[a-z0-9-]{1,80}$")], InformationPage] = Field(default_factory=lambda: {
        "about": InformationPage(title="О компании", body="Курортник — оптовый каталог пляжных принадлежностей, летней обуви и сувениров."),
        "privacy": InformationPage(title="Обработка контактных данных", body="Контактные данные из заявки используются для связи с покупателем и согласования заказа."),
    }, max_length=24)

    @field_validator("banner_image")
    @classmethod
    def image(cls, value: str) -> str:
        return valid_media(value, local_banner=True) or ""


async def get_content(db: AsyncSession) -> Content:
    row = await db.get(ContentRecord, 1)
    return Content.model_validate(row.value) if row else Content()


def collection_filter(collection: Collection, content: Content):
    if collection == "new":
        return Product.is_new.is_(True)
    return Product.id.in_(getattr(content, COLLECTION_FIELDS[collection]))


@public.get("/home")
async def home(db: AsyncSession = Depends(get_db)):
    categories = (await db.scalars(select(Category).where(Category.active.is_(True))
        .options(selectinload(Category.subcategories)).order_by(Category.order, Category.id))).all()
    return {"content": await get_content(db), "categories": [
        {**category_dict(item), "subcategories": [category_dict(child, item.id) for child in sorted(item.subcategories, key=lambda x:(x.order,x.id)) if child.active]} for item in categories]}


@public.get("/highlights")
async def highlights(db: AsyncSession = Depends(get_db)):
    content = await get_content(db)
    query = visible_products().where(stock_filter())
    ids = set(content.featured_ids + content.offer_ids)
    saved = {p.id: serialize_product(p) for p in (await db.scalars(query.where(Product.id.in_(ids)))).all()}
    newest = (await db.scalars(query.where(Product.is_new.is_(True)).order_by(Product.created_at.desc(), Product.id.desc()).limit(8))).all()
    return {"featured": [saved[id] for id in dict.fromkeys(content.featured_ids) if id in saved],
            "offers": [saved[id] for id in dict.fromkeys(content.offer_ids) if id in saved],
            "newest": [serialize_product(product) for product in newest]}


async def paginate(db, query, sort, page, transform):
    total = await db.scalar(select(func.count()).select_from(query.subquery()))
    items = (await db.scalars(query.order_by(sort, Product.id).offset((page-1)*PAGE_SIZE).limit(PAGE_SIZE))).all()
    return {"items": [transform(item) for item in items], "total": total, "pages": max(1, (total+PAGE_SIZE-1)//PAGE_SIZE)}


@public.get("/products")
async def products(q: str = Query("", max_length=120), category: int | None = None, subcategory: int | None = None,
    sort: Literal["name", "price_asc", "price_desc", "newest"] = "name", stock: Literal["", "yes", "no"] = "",
    country: str = Query("", max_length=100), newest: bool = False, page: int = Query(1, ge=1, le=100000),
    collection: Collection | None = None, db: AsyncSession = Depends(get_db)):
    query = search_products(visible_products(), q)
    if category: query = query.where(Product.category_id == category)
    if subcategory: query = query.where(Product.subcategory_id == subcategory)
    if newest: query = query.where(Product.is_new.is_(True))
    if collection:
        query = query.where(collection_filter(collection, await get_content(db)), stock_filter())
    if stock: query = query.where(stock_filter() if stock == "yes" else ~stock_filter())
    if country.strip(): query = query.where(func.instr(func.shop_casefold(Product.country), country.strip().casefold()) > 0)
    sorting = {"name": func.shop_casefold(Product.name), "price_asc": Product.price_per_unit.asc(),
               "price_desc": Product.price_per_unit.desc(), "newest": Product.created_at.desc()}
    return await paginate(db, query, sorting[sort], page, serialize_product)


@public.get("/products/{product_id}")
async def product(product_id: int, db: AsyncSession = Depends(get_db)):
    result = await db.scalar(visible_products().where(Product.id == product_id))
    if not result:
        raise HTTPException(404, "Товар не найден")
    return serialize_product(result)


@public.get("/cart-products")
async def cart_products(ids: str = Query("", max_length=2000, pattern=r"^(?:\d+(?:,\d+)*)?$"), db: AsyncSession = Depends(get_db)):
    keys = ids.split(",") if ids else []
    if len(keys) > 100 or any(len(key) > 10 for key in keys):
        raise HTTPException(400, "Слишком много товаров или неверный номер товара")
    return [serialize_product(item) for item in (await db.scalars(visible_products().where(Product.id.in_(map(int, keys))))).all()]


@admin.get("/content")
async def read_content(db: AsyncSession = Depends(get_db)):
    return await get_content(db)


@admin.put("/content")
async def save_content(content: Content, staff: Staff = Depends(admin_only), db: AsyncSession = Depends(get_db)):
    await begin_write(db)
    row = await db.get(ContentRecord, 1)
    fields = content.model_fields_set.intersection(COLLECTION_FIELDS.values())
    ids = {key for field in fields for key in getattr(content, field)}
    if ids != set((await db.scalars(select(Product.id).where(Product.id.in_(ids)))).all()):
        raise HTTPException(400, "В подборке указан неизвестный товар")
    values = content.model_dump()
    if row:
        for field in COLLECTION_FIELDS.values():
            if field not in fields and field in row.value:
                values[field] = row.value[field]
        row.value = values
    else:
        db.add(ContentRecord(id=1, value=values))
    audit(db, staff, "content.save", 1)
    await db.commit()
    return values


@admin.get("/categories")
async def admin_categories(db: AsyncSession = Depends(get_db)):
    categories = (await db.scalars(select(Category).options(selectinload(Category.subcategories))
        .order_by(Category.order, Category.id))).all()
    # A single public editor key keeps two independent legacy primary-key spaces distinct.
    return [row for item in categories for row in [category_dict(item), *[
        {**category_dict(child, item.id), "id": -child.id} for child in sorted(item.subcategories, key=lambda x:(x.order,x.id))]]]


class CategoryInput(BaseModel):
    name: Name
    order: int = Field(ge=-1000000, le=1000000)
    active: bool
    parent_id: int | None = Field(default=None, gt=0)
    image: str | None = None

    @field_validator("image")
    @classmethod
    def check_image(cls, value):
        return valid_media(value)


@admin.post("/categories", status_code=201)
@admin.put("/categories/{key}")
async def save_category(values: CategoryInput, key: int | None = None, staff: Staff = Depends(admin_only), db: AsyncSession = Depends(get_db)):
    await begin_write(db)
    model = Subcategory if (key is not None and key < 0) or values.parent_id else Category
    if key is not None:
        if (key < 0) != bool(values.parent_id):
            raise HTTPException(400, "Нельзя менять уровень категории")
        row = await db.get(model, abs(key))
        if not row:
            raise HTTPException(404, "Категория не найдена")
        if model is Subcategory and row.category_id != values.parent_id:
            raise HTTPException(400, "Нельзя менять родительскую категорию")
    else:
        if values.parent_id and not await db.get(Category, values.parent_id):
            raise HTTPException(400, "Родительская категория не найдена")
        row = model(**({"category_id": values.parent_id} if values.parent_id else {}))
        db.add(row)
    row.name, row.order, row.active = values.name, values.order, values.active
    row.image_file_id, row.image_url = None, values.image
    await db.flush()
    result = row.id if model is Category else -row.id
    audit(db, staff, "category.save", result)
    await db.commit()
    return {"id": result}


@admin.delete("/categories/{key}")
async def remove_category(key: int, staff: Staff = Depends(admin_only), db: AsyncSession = Depends(get_db)):
    await begin_write(db)
    row = await db.get(Subcategory if key < 0 else Category, abs(key))
    if not row:
        raise HTTPException(404, "Категория не найдена")
    if key > 0 and row.name.strip().casefold() == "новинки":
        raise HTTPException(409, "Категория «Новинки» используется в каталоге")
    row.active = False
    condition = Product.subcategory_id == -key if key < 0 else Product.category_id == key
    await db.execute(update(Product).where(condition).values(active=False))
    audit(db, staff, "category.remove", key)
    await db.commit()
    return {"ok": True}


class ProductInput(BaseModel):
    name: Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=500)]
    description: str | None = Field(default=None, max_length=12000)
    sku: str | None = Field(default=None, max_length=100)
    country: str | None = Field(default=None, max_length=100)
    badge_text: str | None = Field(default=None, max_length=50)
    badge_bg_color: str | None = Field(default=None, max_length=20)
    price_per_unit: Decimal = Field(ge=0, max_digits=10, decimal_places=2)
    pieces_per_pack: int = Field(ge=1, le=100000)
    min_order_packs: int = Field(ge=1, le=100000)
    in_stock: int | None = Field(default=None, ge=0, le=2147483647)
    category_id: int = Field(gt=0)
    subcategory_id: int | None = None
    active: bool
    is_new: bool
    images: list[str] = Field(default_factory=list, max_length=12)
    expected_updated_at: datetime | None = None

    @field_validator("images")
    @classmethod
    def check_images(cls, values):
        return list(dict.fromkeys(valid_media(value) for value in values if value))


def admin_product(item: Product):
    return {**{key: getattr(item, key) for key in ProductInput.model_fields if key not in {"images","expected_updated_at"}},
            "price_per_unit": float(item.price_per_unit), "id": item.id, "images": pictures(item), "updated_at": item.updated_at}


@admin.get("/products")
async def admin_products(q: str = Query("", max_length=120), filter: Literal["", "new", "hidden", "out"] = "",
    category: str = Query("", pattern=r"^-?\d{0,10}$"), page: int = Query(1, ge=1, le=100000),
    collection: Collection | None = None, members_only: bool = False, db: AsyncSession = Depends(get_db)):
    query = search_products(select(Product).options(selectinload(Product.images)), q)
    if category and category != "-":
        key = int(category)
        query = query.where(Product.subcategory_id == -key if key < 0 else Product.category_id == key)
    if filter:
        query = query.where({"new": Product.is_new.is_(True), "hidden": Product.active.is_(False), "out": ~stock_filter()}[filter])
    if collection:
        content = await get_content(db)
        if members_only:
            query = query.where(collection_filter(collection, content))
        ids = set(getattr(content, COLLECTION_FIELDS[collection])) if collection != "new" else set()
        return await paginate(db, query, func.shop_casefold(Product.name), page, lambda item: {
            **admin_product(item), "in_collection": item.is_new if collection == "new" else item.id in ids,
        })
    return await paginate(db, query, func.shop_casefold(Product.name), page, admin_product)


class CollectionMembership(BaseModel):
    included: bool


@admin.put("/collections/{collection}/{key}")
async def set_collection_membership(collection: Collection, key: int, values: CollectionMembership,
    staff: Staff = Depends(admin_only), db: AsyncSession = Depends(get_db)):
    await begin_write(db)
    item = await db.get(Product, key)
    if item is None:
        raise HTTPException(404, "Товар не найден")
    if collection == "new":
        item.is_new = values.included
    else:
        row = await db.get(ContentRecord, 1)
        content = Content.model_validate(row.value) if row else Content()
        field = COLLECTION_FIELDS[collection]
        ids = getattr(content, field)
        if values.included and key not in ids:
            if len(ids) >= COLLECTION_LIMIT:
                raise HTTPException(409, f"В подборке может быть не больше {COLLECTION_LIMIT} товаров")
            ids.append(key)
        if not values.included:
            ids = [value for value in ids if value != key]
        updated = {**content.model_dump(), field: ids}
        if row:
            row.value = updated
        else:
            db.add(ContentRecord(id=1, value=updated))
    audit(db, staff, f"collection.{collection}.{'add' if values.included else 'remove'}", key)
    await db.commit()
    return {"included": values.included}


class Bulk(BaseModel):
    ids: list[int] = Field(min_length=1, max_length=200)
    active: bool


@admin.patch("/products/bulk")
async def bulk_products(values: Bulk, staff: Staff = Depends(admin_only), db: AsyncSession = Depends(get_db)):
    await begin_write(db)
    result = await db.execute(update(Product).where(Product.id.in_(values.ids)).values(active=values.active))
    if result.rowcount != len(set(values.ids)):
        raise HTTPException(404, "Часть товаров не найдена")
    for key in set(values.ids):
        audit(db, staff, "product.visibility", key)
    await db.commit()
    return {"ok": True}


@admin.post("/products", status_code=201)
@admin.put("/products/{key}")
async def save_product(values: ProductInput, key: int | None = None, staff: Staff = Depends(admin_only), db: AsyncSession = Depends(get_db)):
    await begin_write(db)
    if not await db.get(Category, values.category_id):
        raise HTTPException(400, "Выберите существующую категорию")
    if values.subcategory_id is not None:
        child = await db.get(Subcategory, values.subcategory_id)
        if not child or child.category_id != values.category_id:
            raise HTTPException(400, "Подкатегория не входит в выбранную категорию")
    fields = values.model_dump(exclude={"images","expected_updated_at"})
    if key is not None:
        result = await db.scalar(select(Product).where(Product.id == key).options(selectinload(Product.images)))
        if result is None:
            raise HTTPException(404, "Товар не найден")
        if values.expected_updated_at != result.updated_at:
            raise HTTPException(409, "Товар изменился после открытия формы. Откройте его ещё раз, чтобы видеть актуальные остатки.")
        for field, value in fields.items():
            setattr(result, field, value)
        result.updated_at = datetime.utcnow()
    else:
        result = Product(**fields)
        db.add(result)
    result.images = [ProductImage(image_url=image, is_main=index == 0) for index, image in enumerate(values.images)]
    result.image_file_id = None
    result.image_url = values.images[0] if values.images else None
    await db.flush()
    audit(db, staff, "product.save", result.id)
    await db.commit()
    return {"id": result.id}


@admin.delete("/products/{key}")
async def remove_product(key: int, staff: Staff = Depends(admin_only), db: AsyncSession = Depends(get_db)):
    return await bulk_products(Bulk(ids=[key], active=False), staff, db)


def convert_image(raw: bytes) -> str:
    try:
        with Image.open(io.BytesIO(raw), formats=["JPEG", "PNG", "WEBP"]) as source:
            if source.width * source.height > 24_000_000 or getattr(source, "n_frames", 1) != 1:
                raise ValueError("Слишком большое или анимированное изображение")
            image = ImageOps.exif_transpose(source).convert("RGBA" if "A" in source.getbands() else "RGB")
            image.thumbnail((1600, 1600), Image.Resampling.LANCZOS)
            name = uuid4().hex + ".webp"
            image.save(MEDIA / name, "WEBP", quality=82, method=4, exif=b"")
            return "/uploads/" + name
    except (UnidentifiedImageError, OSError, Image.DecompressionBombError) as error:
        raise ValueError("Загрузите корректное изображение JPEG, PNG или WebP") from error


@admin.post("/images", status_code=201)
async def upload_image(file: UploadFile, staff: Staff = Depends(admin_only), db: AsyncSession = Depends(get_db)):
    size = 8 * 1024 * 1024
    raw = await file.read(size + 1)
    if not raw or len(raw) > size:
        raise HTTPException(400, "Размер изображения должен быть от 1 байта до 8 МБ")
    try:
        url = await run_in_threadpool(convert_image, raw)
    except ValueError as error:
        raise HTTPException(400, str(error)) from error
    audit(db, staff, "image.upload", url)
    await db.commit()
    return {"url": url}
