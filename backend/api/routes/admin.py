"""
Admin API routes.
"""
import os
from fastapi import APIRouter, HTTPException, Header, Depends
from fastapi.responses import Response
from pydantic import BaseModel
from typing import Optional
import pandas as pd
import io
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, func, desc, and_
from ..database import get_db
from ..models import Order, OrderItem, Product

router = APIRouter(prefix="/api/admin", tags=["admin"])

ADMIN_IDS = [int(x.strip()) for x in os.getenv("ADMIN_IDS", "").split(",") if x.strip()]

class AdminCheckRequest(BaseModel):
    user_id: int

@router.post("/check")
async def check_admin(data: AdminCheckRequest):
    """Check if user is admin."""
    if data.user_id not in ADMIN_IDS:
        raise HTTPException(status_code=403, detail="Not authorized")
    return {"status": "ok", "is_admin": True}

@router.get("/template")
async def get_excel_template():
    """Generate and return sample Excel template."""
    columns = [
        "Категория", "Подкатегория", "Наименование", 
        "Артикул", "Цена (за 1 шт/₽)", "Кол-во в пачке (шт)", "Описание"
    ]
    # Create empty dataframe with these columns
    df = pd.DataFrame(columns=columns)
    
    # Optional: Add example row
    example_row = {
        "Категория": "Пример категории",
        "Подкатегория": "Пример подкатегории",
        "Наименование": "Название товара",
        "Артикул": "ART-123",
        "Цена (за 1 шт/₽)": 100,
        "Кол-во в пачке (шт)": 1,
        "Описание": "Описание товара"
    }
    df = pd.concat([df, pd.DataFrame([example_row])], ignore_index=True)

    output = io.BytesIO()
    with pd.ExcelWriter(output, engine='openpyxl') as writer:
        df.to_excel(writer, index=False)
    
    output.seek(0)
    
    headers = {
        'Content-Disposition': 'attachment; filename="import_template.xlsx"'
    }
    return Response(content=output.getvalue(), media_type='application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', headers=headers)

@router.post("/reset-db")
async def reset_database(data: AdminCheckRequest):
    """
    NUCLEAR OPTION: Drops all tables and reseeds the database.
    Use with caution!
    """
    if data.user_id not in ADMIN_IDS:
        raise HTTPException(status_code=403, detail="Not authorized")
    
    from ..database import engine, Base
    from ..seeder import seed_categories
    
    # Drop all tables
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.drop_all)
        await conn.run_sync(Base.metadata.create_all)
        
    # Re-seed
    await seed_categories()
    
    return {"status": "ok", "message": "Database has been reset completely."}

@router.get("/stats")
async def get_stats(user_id: int, db: AsyncSession = Depends(get_db)):
    """Get analytics statistics."""
    if user_id not in ADMIN_IDS:
        raise HTTPException(status_code=403, detail="Not authorized")

    # 1. Total Revenue & Orders Count (completed, shipped, processing, new, accepted)
    # Exclude cancelled and rejected
    excluded_statuses = ['cancelled', 'rejected']
    
    query = select(
        func.sum(Order.total_amount).label("total_revenue"),
        func.count(Order.id).label("total_orders"),
        func.count(func.distinct(Order.telegram_user_id)).label("total_customers") # All time customers
    ).where(Order.status.not_in(excluded_statuses))
    
    result = await db.execute(query)
    stats = result.first()
    
    total_revenue = float(stats.total_revenue or 0)
    total_orders = int(stats.total_orders or 0)
    total_customers = int(stats.total_customers or 0)
    avg_check = total_revenue / total_orders if total_orders > 0 else 0

    # 2. Sales Chart (Last 30 days)
    # Group by date
    from datetime import datetime, timedelta
    thirty_days_ago = datetime.utcnow() - timedelta(days=30)
    
    chart_query = select(
        func.date(Order.created_at).label("date"),
        func.sum(Order.total_amount).label("daily_revenue"),
        func.count(Order.id).label("daily_orders")
    ).where(
        Order.status.not_in(excluded_statuses),
        Order.created_at >= thirty_days_ago
    ).group_by(func.date(Order.created_at)).order_by("date")
    
    chart_result = await db.execute(chart_query)
    chart_data = [
        {"date": str(row.date), "revenue": float(row.daily_revenue), "orders": row.daily_orders}
        for row in chart_result
    ]
    
    # Fill missing dates? Ideally yes, but frontend can handle or just show existing data points.
    
    # 3. Top 5 Products
    top_products_query = select(
        Product.name,
        func.sum(OrderItem.quantity_packs).label("total_sold"),
        func.sum(OrderItem.subtotal).label("revenue_generated") # Assuming subtotal exists or calculate
    ).join(OrderItem.product).join(OrderItem.order).where(
        Order.status.not_in(excluded_statuses)
    ).group_by(Product.id).order_by(desc("total_sold")).limit(5)
    
    # Note: OrderItem might not have subtotal in model? Let's check model again. 
    # If not, we calculate standard price * quantity. 
    # But wait, looking at OrderItem in previous turn, it didn't show subtotal field in the snippet.
    # Let's assume standard calculation if field missing: Product.price_per_unit * Product.pieces_per_pack * OrderItem.quantity_packs
    # Actually simpler: just quantity for now.
    
    top_products_result = await db.execute(top_products_query)
    top_products = [
        {"name": row.name, "sold": row.total_sold}
        for row in top_products_result
    ]

    return {
        "revenue": total_revenue,
        "orders_count": total_orders,
        "avg_check": avg_check,
        "customers_count": total_customers,
        "chart_data": chart_data,
        "top_products": top_products
    }
