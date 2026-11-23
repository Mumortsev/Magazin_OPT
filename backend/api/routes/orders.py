from typing import Optional
import os
import json
import logging
from fastapi import Request, APIRouter, Depends, HTTPException, Query, BackgroundTasks
from sqlalchemy import select, delete
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload
from pywebpush import webpush, WebPushException

from ..web import legacy
from ..database import get_db, AsyncSessionLocal
from ..models import Product, Order, OrderItem, PushSubscription
from ..schemas import (
    CartValidateRequest, CartValidateResponse, CartValidateError,
    OrderCreate, OrderResponse, OrderListResponse, MessageResponse,
    OrderItemResponse
)
from ..notifier import notify_new_order

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api", tags=["orders"])

STATUS_TRANSLATIONS = {
    "new": "Новый",
    "processing": "Принят в работу",
    "shipped": "Отправлен (доставка)",
    "cancelled": "Отменен",
    "completed": "Выполнен"
}

def clean_phone_str(p: str) -> str:
    """Normalize phone number to 7XXXXXXXXXX format."""
    digits = "".join(filter(str.isdigit, p))
    if not digits:
        return ""
    if digits.startswith("8") and len(digits) == 11:
        digits = "7" + digits[1:]
    elif len(digits) == 10:
        digits = "7" + digits
    return digits

async def send_web_push_async(subscription_id: int, endpoint: str, p256dh: str, auth: str, payload_data: str):
    try:
        import asyncio
        loop = asyncio.get_event_loop()
        
        subscription_info = {
            "endpoint": endpoint,
            "keys": {
                "p256dh": p256dh,
                "auth": auth
            }
        }
        
        vapid_private_key = os.getenv("VAPID_PRIVATE_KEY")
        vapid_claims = {"sub": os.getenv("VAPID_CLAIM_EMAIL", "mailto:owner@yandex.ru")}
        
        if not vapid_private_key:
            logger.warning("VAPID_PRIVATE_KEY not set, skipping web push")
            return
            
        def do_push():
            return webpush(
                subscription_info=subscription_info,
                data=payload_data,
                vapid_private_key=vapid_private_key,
                vapid_claims=vapid_claims,
                ttl=86400
            )
            
        await loop.run_in_executor(None, do_push)
        logger.info(f"Successfully sent Web Push to subscription {subscription_id}")
        
    except WebPushException as ex:
        logger.warning(f"WebPushException for subscription {subscription_id}: {ex}")
        if ex.response is not None and ex.response.status_code in [404, 410]:
            logger.info(f"Removing expired subscription {subscription_id}")
            async with AsyncSessionLocal() as session:
                try:
                    await session.execute(
                        delete(PushSubscription).where(PushSubscription.id == subscription_id)
                    )
                    await session.commit()
                except Exception as db_ex:
                    logger.error(f"Error deleting expired subscription {subscription_id}: {db_ex}")
    except Exception as ex:
        logger.error(f"Unexpected error sending push notification: {ex}")



@router.post("/cart/validate", response_model=CartValidateResponse)
async def validate_cart(
    cart: CartValidateRequest,
    db: AsyncSession = Depends(get_db)
):
    """
    Validate cart items before checkout.
    Checks if quantities are valid multiples of pack sizes and products are in stock.
    """
    errors = []
    total_amount = 0.0
    
    for item in cart.items:
        result = await db.execute(
            select(Product).where(Product.id == item.product_id)
        )
        product = result.scalar_one_or_none()
        
        if not product or not product.active:
            errors.append(CartValidateError(
                product_id=item.product_id,
                product_name=product.name if product else "Неизвестный товар",
                error="Товар не найден или недоступен"
            ))
            continue
        
        # Check minimum order
        if item.quantity_packs < product.min_order_packs:
            errors.append(CartValidateError(
                product_id=product.id,
                product_name=product.name,
                error=f"Минимальный заказ: {product.min_order_packs} пачек"
            ))
            continue
        
        # Check stock
        if product.in_stock is not None and item.quantity_packs > product.in_stock:
            errors.append(CartValidateError(
                product_id=product.id,
                product_name=product.name,
                error=f"Недостаточно товара. Доступно: {product.in_stock} пачек"
            ))
            continue
        
        # Calculate subtotal
        pieces = item.quantity_packs * (product.pieces_per_pack or 1)
        subtotal = pieces * float(product.price_per_unit or 0.0)
        total_amount += subtotal
    
    return CartValidateResponse(
        valid=len(errors) == 0,
        errors=errors,
        total_amount=round(total_amount, 2)
    )


@router.post("/orders", response_model=OrderResponse)
async def create_order(
    order_data: OrderCreate,
    background_tasks: BackgroundTasks,
    request: Request,
    db: AsyncSession = Depends(get_db)
):
    """
    Create a new order.
    Validates all items and calculates totals.
    """
    if legacy.SHARED:
        from ..web.security import begin_write, limit
        from ..web.orders import normalize_phone
        await limit(request,"miniapp-orders",30,600)
        if not order_data.items or len(order_data.items)>100 or len({item.product_id for item in order_data.items}) != len(order_data.items):
            raise HTTPException(422,"Проверьте количество и состав позиций")
        if not 10 <= len(normalize_phone(order_data.customer_phone)) <= 15 or any(item.quantity_packs>100000 for item in order_data.items):
            raise HTTPException(422,"Проверьте телефон и число упаковок")
        identity = legacy.telegram_id(request)
        wa = order_data.whatsapp_phone if legacy.whatsapp_identity(request,order_data.whatsapp_phone) else None
        order_data.telegram_user_id = identity
        order_data.whatsapp_phone = wa
        order_data.platform = "telegram" if identity else "whatsapp" if wa else "legacy-web"
        await begin_write(db)

    # Filter active and skipped items
    active_items = []
    skipped_items = []
    for item in order_data.items:
        result = await db.execute(
            select(Product).where(Product.id == item.product_id)
        )
        product = result.scalar_one_or_none()
        if not product or not product.active:
            name = product.name if product else f"Товар (ID: {item.product_id})"
            skipped_items.append(name)
        else:
            active_items.append(item)

    if len(active_items) == 0:
        raise HTTPException(
            status_code=400,
            detail={
                "message": "Ошибка валидации корзины",
                "errors": [{
                    "product_id": item.product_id,
                    "product_name": "Товары недоступны",
                    "error": "Все товары в вашем заказе закончились или недоступны"
                } for item in order_data.items]
            }
        )

    # Validate cart first
    cart_request = CartValidateRequest(
        items=[{"product_id": item.product_id, "quantity_packs": item.quantity_packs} for item in active_items]
    )
    validation = await validate_cart(cart_request, db)
    
    if not validation.valid:
        raise HTTPException(
            status_code=400,
            detail={
                "message": "Ошибка валидации корзины",
                "errors": [e.model_dump() for e in validation.errors]
            }
        )
    
    # Create order
    db_order = Order(
        telegram_user_id=order_data.telegram_user_id if order_data.telegram_user_id is not None else 0,
        whatsapp_phone=order_data.whatsapp_phone,
        platform=order_data.platform,
        customer_name=order_data.customer_name,
        customer_organization=order_data.customer_organization,
        customer_phone=order_data.customer_phone,
        customer_comment=order_data.customer_comment,
        total_amount=validation.total_amount,
        status="new"
    )
    db.add(db_order)
    await db.flush()  # Get order ID
    
    # Create order items
    for item in active_items:
        result = await db.execute(select(Product).where(Product.id == item.product_id))
        product = result.scalar_one()
        
        pieces = item.quantity_packs * (product.pieces_per_pack or 1)
        subtotal = pieces * float(product.price_per_unit or 0.0)
        
        db_item = OrderItem(
            order_id=db_order.id,
            product_id=product.id,
            quantity_packs=item.quantity_packs,
            quantity_pieces=pieces,
            price_per_unit=float(product.price_per_unit),
            subtotal=subtotal
        )
        db.add(db_item)
        
        # Update stock if tracked
        if product.in_stock is not None:
            product.in_stock -= item.quantity_packs
    
    if legacy.SHARED:
        from ..web.orders import enqueue, record
        record(db, db_order, "Mini App", "created")
        await enqueue(db, db_order)
    await db.commit()
    
    # Fetch complete order with items
    result = await db.execute(
        select(Order)
        .options(selectinload(Order.items))
        .where(Order.id == db_order.id)
    )
    order = result.scalar_one()
    
    # Build response with product names
    order_response = OrderResponse(
        id=order.id,
        telegram_user_id=order.telegram_user_id if order.telegram_user_id != 0 else None,
        whatsapp_phone=order.whatsapp_phone,
        platform=order.platform,
        customer_name=order.customer_name,
        customer_organization=order.customer_organization,
        customer_phone=order.customer_phone,
        customer_comment=order.customer_comment,
        total_amount=float(order.total_amount),
        status=order.status,
        created_at=order.created_at,
        items=[],
        skipped_items=skipped_items
    )
    
    items_data = []
    for item in order.items:
        product_result = await db.execute(select(Product).where(Product.id == item.product_id))
        product = product_result.scalar_one()
        product_image = product.image_url or product.image_file_id
        item_resp = {
            "id": item.id,
            "product_id": item.product_id,
            "product_name": product.name,
            "product_image": product_image,
            "product_sku": product.sku,
            "quantity_packs": item.quantity_packs,
            "quantity_pieces": item.quantity_pieces,
            "price_per_unit": float(item.price_per_unit),
            "subtotal": float(item.subtotal)
        }
        order_response.items.append(OrderItemResponse(**item_resp))
        
        # Create a copy with product_image for the notifier
        items_data.append(item_resp)
        
    # Send notification in background
    order_info = {
        "id": order.id,
        "telegram_user_id": order.telegram_user_id if order.telegram_user_id != 0 else None,
        "whatsapp_phone": order.whatsapp_phone,
        "platform": order.platform,
        "customer_name": order.customer_name,
        "customer_organization": order.customer_organization,
        "customer_phone": order.customer_phone,
        "customer_comment": order.customer_comment,
        "total_amount": float(order.total_amount),
        "created_at": order.created_at
    }
    background_tasks.add_task(notify_new_order, order_info, items_data)
    
    return order_response


@router.get("/orders/me", response_model=OrderListResponse)
async def get_my_orders(
    telegram_user_id: Optional[int] = Query(None, description="Telegram user ID"),
    whatsapp_phone: Optional[str] = Query(None, description="WhatsApp phone number"),
    token: Optional[str] = Query(None, description="Verification token for WhatsApp"),
    db: AsyncSession = Depends(get_db)
):
    """Get orders for a specific user, linking Telegram ID and WhatsApp phone by phone number."""
    if not telegram_user_id and not whatsapp_phone:
        raise HTTPException(status_code=400, detail="Необходим telegram_user_id или whatsapp_phone")
        
    query = select(Order).options(
        selectinload(Order.items).selectinload(OrderItem.product).selectinload(Product.images)
    ).order_by(Order.created_at.desc())
    
    # Clean phone helper
    def clean_phone_str(p: str) -> str:
        return "".join(filter(str.isdigit, p))

    if whatsapp_phone:
        # WhatsApp Mode
        from .whatsapp import verify_phone_token
        if (legacy.SHARED and len(os.getenv("WHATSAPP_VERIFY_TOKEN","")) < 32) or not token or not verify_phone_token(whatsapp_phone, token):
            raise HTTPException(status_code=403, detail="Доступ запрещен: недействительный токен")
        
        cleaned_wa = clean_phone_str(whatsapp_phone)
        # Find all orders where whatsapp_phone is this number OR customer_phone matches this number
        # We handle potential format differences (e.g. +7..., 7..., 8...) by comparing cleaned digits
        result_all = await db.execute(
            select(Order).options(
                selectinload(Order.items).selectinload(OrderItem.product).selectinload(Product.images)
            ).order_by(Order.created_at.desc())
        )
        all_orders = result_all.scalars().all()
        orders = [
            o for o in all_orders 
            if (o.whatsapp_phone and clean_phone_str(o.whatsapp_phone) == cleaned_wa) 
            or (o.customer_phone and clean_phone_str(o.customer_phone) == cleaned_wa)
        ]
    else:
        # Telegram Mode
        # 1. Find all phone numbers associated with this telegram_user_id from past orders
        phone_query = select(Order.customer_phone).where(Order.telegram_user_id == telegram_user_id)
        phone_result = await db.execute(phone_query)
        user_phones = {clean_phone_str(p) for p in phone_result.scalars().all() if p}
        
        # 2. Get all orders
        result_all = await db.execute(
            select(Order).options(
                selectinload(Order.items).selectinload(OrderItem.product).selectinload(Product.images)
            ).order_by(Order.created_at.desc())
        )
        all_orders = result_all.scalars().all()
        
        # 3. Filter: order matches Telegram ID OR matches any of the user's phone numbers (both customer_phone and whatsapp_phone)
        orders = []
        for o in all_orders:
            o_tg_match = (o.telegram_user_id == telegram_user_id)
            cleaned_cust = clean_phone_str(o.customer_phone) if o.customer_phone else ""
            cleaned_wa = clean_phone_str(o.whatsapp_phone) if o.whatsapp_phone else ""
            
            o_phone_match = (cleaned_cust in user_phones or (cleaned_wa and cleaned_wa in user_phones)) if user_phones else False
            
            if o_tg_match or o_phone_match:
                orders.append(o)
    
    if legacy.SHARED:
        if whatsapp_phone:
            orders = [o for o in orders if o.whatsapp_phone and clean_phone_str(o.whatsapp_phone)==cleaned_wa]
        else:
            orders = [o for o in orders if o.telegram_user_id==telegram_user_id]
        orders = [o for o in orders if o.platform!="web"]

    order_responses = []
    for order in orders:
        order_resp = OrderResponse(
            id=order.id,
            telegram_user_id=order.telegram_user_id if order.telegram_user_id != 0 else None,
            whatsapp_phone=order.whatsapp_phone,
            platform=order.platform,
            customer_name=order.customer_name,
            customer_organization=order.customer_organization,
            customer_phone=order.customer_phone,
            customer_comment=order.customer_comment,
            total_amount=float(order.total_amount),
            status=order.status,
            assigned_manager=order.assigned_manager,
            created_at=order.created_at,
            items=[]
        )
        
        for item in order.items:
            product = item.product
            
            # Get product image (from images relationship or legacy fields)
            product_image = None
            if product:
                if product.images:
                    # Get main image or first image
                    main_img = next((img for img in product.images if img.is_main), None)
                    if main_img:
                        product_image = main_img.file_id or main_img.image_url
                    elif product.images:
                        product_image = product.images[0].file_id or product.images[0].image_url
                # Fallback to legacy fields
                if not product_image:
                    product_image = product.image_file_id or product.image_url
            
            order_resp.items.append(OrderItemResponse(
                id=item.id,
                product_id=item.product_id,
                product_name=product.name if product else "Удалённый товар",
                product_image=product_image,
                product_sku=product.sku if product else None,
                quantity_packs=item.quantity_packs,
                quantity_pieces=item.quantity_pieces,
                price_per_unit=float(item.price_per_unit),
                subtotal=float(item.subtotal)
            ))
        
        order_responses.append(order_resp)
    
    return OrderListResponse(orders=order_responses)


@router.put("/orders/{order_id}/status", response_model=MessageResponse)
async def update_order_status(
    order_id: int,
    status: str = Query(..., description="New status: new, processing, shipped, cancelled, completed"),
    manager: Optional[str] = Query(None, description="Assigned manager identifier"),
    background_tasks: BackgroundTasks = None,
    db: AsyncSession = Depends(get_db)
):
    """Update order status and optionally manager (admin only)."""
    valid_statuses = ["new", "processing", "shipped", "cancelled", "completed", "accepted", "rejected"]
    if legacy.SHARED:
        from ..web.security import begin_write
        await begin_write(db)
    if status not in valid_statuses:
        raise HTTPException(status_code=400, detail=f"Неверный статус. Допустимые: {', '.join(valid_statuses)}")
    
    result = await db.execute(select(Order).where(Order.id == order_id))
    order = result.scalar_one_or_none()
    
    if not order:
        raise HTTPException(status_code=404, detail="Заказ не найден")
    
    if legacy.SHARED:
        from ..web.models import Assignment
        assignment = await db.get(Assignment,order_id)
        if order.platform=="web" or assignment and (assignment.archived or assignment.staff_id):
            raise HTTPException(409,"Заявка обрабатывается в веб-админке")
    old_status = order.status
    order.status = status
    if manager is not None:
        order.assigned_manager = None if manager == "" else manager

    if legacy.SHARED and old_status != status:
        from ..web.orders import record
        record(db,order,"Telegram-бот","update")
    await db.commit()
    
    # Dispatch web push if status changed
    if old_status != status and background_tasks:
        phones = set()
        if order.customer_phone:
            phones.add(clean_phone_str(order.customer_phone))
        if order.whatsapp_phone:
            phones.add(clean_phone_str(order.whatsapp_phone))
        
        phones = {p for p in phones if p}
        
        if phones:
            sub_stmt = select(PushSubscription).where(PushSubscription.phone.in_(list(phones)))
            sub_result = await db.execute(sub_stmt)
            subs = sub_result.scalars().all()
            
            if subs:
                status_ru = STATUS_TRANSLATIONS.get(status, status)
                payload = {
                    "title": "Статус заказа изменен",
                    "body": f"Статус вашего заказа #{order.id} изменен на: {status_ru}",
                    "icon": "/assets/icons/icon-192x192.png",
                    "data": {
                        "orderId": order.id,
                        "status": status,
                        "url": "/index.html?page=profile"
                    }
                }
                payload_str = json.dumps(payload, ensure_ascii=False)
                for sub in subs:
                    background_tasks.add_task(
                        send_web_push_async,
                        sub.id,
                        sub.endpoint,
                        sub.p256dh,
                        sub.auth,
                        payload_str
                    )
    
    return MessageResponse(message=f"Заказ #{order_id} обновлён (статус '{status}')")


@router.delete("/orders/{order_id}", response_model=MessageResponse)
async def delete_order(order_id: int, db: AsyncSession = Depends(get_db)):
    """Delete an order completely (admin only)."""
    result = await db.execute(select(Order).where(Order.id == order_id))
    order = result.scalar_one_or_none()
    
    if not order:
        raise HTTPException(status_code=404, detail="Заказ не найден")
        
    if legacy.SHARED:
        raise HTTPException(403,"Архивируйте заявку в веб-админке")
    await db.delete(order)
    await db.commit()
    
    return MessageResponse(message=f"Заказ #{order_id} удалён навсегда")


@router.get("/orders/{order_id}", response_model=OrderResponse)
async def get_order(order_id: int, db: AsyncSession = Depends(get_db)):
    """Get a single order by ID."""
    result = await db.execute(
        select(Order)
        .options(selectinload(Order.items))
        .where(Order.id == order_id)
    )
    order = result.scalar_one_or_none()
    
    if not order:
        raise HTTPException(status_code=404, detail="Заказ не найден")
    
    order_resp = OrderResponse(
        id=order.id,
        telegram_user_id=order.telegram_user_id if order.telegram_user_id != 0 else None,
        whatsapp_phone=order.whatsapp_phone,
        platform=order.platform,
        customer_name=order.customer_name,
        customer_organization=order.customer_organization,
        customer_phone=order.customer_phone,
        customer_comment=order.customer_comment,
        total_amount=float(order.total_amount),
        status=order.status,
        created_at=order.created_at,
        items=[]
    )
    
    for item in order.items:
        product_result = await db.execute(
            select(Product)
            .options(selectinload(Product.images))
            .where(Product.id == item.product_id)
        )
        product = product_result.scalar_one_or_none()
        
        # Get product image
        product_image = None
        if product:
            if product.images:
                main_img = next((img for img in product.images if img.is_main), None)
                if main_img:
                    product_image = main_img.file_id or main_img.image_url
                elif product.images:
                    product_image = product.images[0].file_id or product.images[0].image_url
            if not product_image:
                product_image = product.image_file_id or product.image_url

        order_resp.items.append(OrderItemResponse(
            id=item.id,
            product_id=item.product_id,
            product_name=product.name if product else "Удалённый товар",
            product_image=product_image,
            product_sku=product.sku if product else None,
            quantity_packs=item.quantity_packs,
            quantity_pieces=item.quantity_pieces,
            price_per_unit=float(item.price_per_unit),
            subtotal=float(item.subtotal)
        ))
    
    return order_resp


@router.get("/orders", response_model=OrderListResponse)
async def get_all_orders(
    status: Optional[str] = Query(None, description="Filter by status"),
    limit: Optional[int] = Query(100, description="Limit result count"),
    db: AsyncSession = Depends(get_db)
):
    """Get all orders (admin only)."""
    query = select(Order).options(
        selectinload(Order.items).selectinload(OrderItem.product).selectinload(Product.images)
    ).order_by(Order.created_at.desc())
    
    if status:
        query = query.where(Order.status == status)
        
    if limit:
        query = query.limit(limit)
    
    result = await db.execute(query)
    orders = result.scalars().all()
    
    order_responses = []
    for order in orders:
        order_resp = OrderResponse(
            id=order.id,
            telegram_user_id=order.telegram_user_id if order.telegram_user_id != 0 else None,
            whatsapp_phone=order.whatsapp_phone,
            platform=order.platform,
            customer_name=order.customer_name,
            customer_organization=order.customer_organization,
            customer_phone=order.customer_phone,
            customer_comment=order.customer_comment,
            total_amount=float(order.total_amount),
            status=order.status,
            assigned_manager=order.assigned_manager,
            created_at=order.created_at,
            items=[]
        )
        
        for item in order.items:
            product = item.product
            
            # Get product image
            product_image = None
            if product:
                if product.images:
                    main_img = next((img for img in product.images if img.is_main), None)
                    if main_img:
                        product_image = main_img.file_id or main_img.image_url
                    elif product.images:
                        product_image = product.images[0].file_id or product.images[0].image_url
                if not product_image:
                    product_image = product.image_file_id or product.image_url
            
            order_resp.items.append(OrderItemResponse(
                id=item.id,
                product_id=item.product_id,
                product_name=product.name if product else "Удалённый товар",
                product_image=product_image,
                product_sku=product.sku if product else None,
                quantity_packs=item.quantity_packs,
                quantity_pieces=item.quantity_pieces,
                price_per_unit=float(item.price_per_unit),
                subtotal=float(item.subtotal)
            ))
        
        order_responses.append(order_resp)
    
    return OrderListResponse(orders=order_responses)
