from datetime import datetime, timedelta
from decimal import Decimal
import json
import re
from typing import Annotated, Literal
from uuid import UUID

from fastapi import APIRouter, Depends, Header, HTTPException, Query, Request
from pydantic import BaseModel, ConfigDict, Field, StringConstraints
from sqlalchemy import func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from ..database import get_db
from ..models import Category, Order, OrderItem, Product
from .catalog import PAGE_SIZE, pictures, visible_products
from .models import Assignment, Delivery, Device, ItemSnapshot, OrderEvent, RequestKey, Staff
from .security import admin_only, audit, begin_write, digest, limit, require_staff

public = APIRouter(prefix="/api/v1/shop")
admin = APIRouter(prefix="/api/v1/admin", dependencies=[Depends(require_staff)])
Status = Literal["new", "processing", "accepted", "shipped", "completed", "cancelled"]
STATES = {"new", "processing", "accepted", "shipped", "completed", "cancelled", "rejected"}


class Line(BaseModel):
    model_config = ConfigDict(extra="forbid")
    product_id: int = Field(gt=0, le=2147483647, strict=True)
    quantity_packs: int = Field(ge=1, le=100000, strict=True)


class Application(BaseModel):
    model_config = ConfigDict(extra="forbid")
    name: Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=255)]
    phone: str = Field(max_length=30, pattern=r"^[+\d().\s-]+$")
    organization: str | None = Field(default=None, max_length=255)
    comment: str | None = Field(default=None, max_length=2000)
    items: list[Line] = Field(min_length=1, max_length=100)


def normalize_phone(value: str) -> str:
    digits = re.sub(r"[^0-9]", "", value)
    if len(digits) == 10:
        digits = "7" + digits
    elif len(digits) == 11 and digits.startswith("8"):
        digits = "7" + digits[1:]
    return digits


@public.post("/orders", status_code=201)
async def submit(values: Application, request: Request, idempotency_key: UUID = Header(), db: AsyncSession = Depends(get_db)):
    await limit(request, "order", 30, 600)
    phone = normalize_phone(values.phone)
    if not 10 <= len(phone) <= 15:
        raise HTTPException(422, "Укажите телефон с кодом города или страны")
    ids = [line.product_id for line in values.items]
    if len(ids) != len(set(ids)):
        raise HTTPException(422, "Объедините повторяющиеся позиции")
    key = str(idempotency_key)
    canonical = values.model_dump()
    canonical["phone"] = phone
    canonical["items"].sort(key=lambda line: line["product_id"])
    fingerprint = digest(json.dumps(canonical, sort_keys=True, ensure_ascii=False))
    await begin_write(db)
    existing = await db.get(RequestKey, key)
    if existing:
        if existing.fingerprint != fingerprint:
            raise HTTPException(409, "Этот ключ уже использован для другой заявки")
        order = await db.get(Order, existing.order_id)
        return {"id": order.id, "total": order.total_amount}
    products = {product.id: product for product in (await db.scalars(visible_products().where(Product.id.in_(ids)))).all()}
    order = Order(platform="web", customer_name=values.name, customer_phone="+"+phone,
                  customer_organization=(values.organization or "").strip() or None,
                  customer_comment=(values.comment or "").strip() or None, status="new", total_amount=Decimal(0))
    snapshots = []
    for line in values.items:
        product = products.get(line.product_id)
        if not product:
            raise HTTPException(409, f"Товар №{line.product_id} сейчас недоступен. Обновите корзину.")
        if line.quantity_packs < product.min_order_packs:
            raise HTTPException(409, f"«{product.name}» — минимум {product.min_order_packs} уп.")
        if product.in_stock is not None and product.in_stock < line.quantity_packs:
            raise HTTPException(409, f"«{product.name}» — доступно {product.in_stock} уп.")
        if product.pieces_per_pack < 1 or product.price_per_unit < 0:
            raise HTTPException(409, f"«{product.name}» — уточните фасовку или цену у менеджера.")
        pieces = line.quantity_packs * product.pieces_per_pack
        subtotal = pieces * product.price_per_unit
        order.total_amount += subtotal
        if order.total_amount > Decimal("9999999999.99") or pieces > 2147483647:
            raise HTTPException(422, "Разделите большой заказ на несколько заявок")
        item = OrderItem(product_id=product.id, quantity_packs=line.quantity_packs,
                         quantity_pieces=pieces, price_per_unit=product.price_per_unit, subtotal=subtotal)
        order.items.append(item)
        snapshots.append((item, product))
        if product.in_stock is not None:
            product.in_stock -= line.quantity_packs
    db.add(order)
    await db.flush()
    for item, product in snapshots:
        images = pictures(product)
        db.add(ItemSnapshot(item_id=item.id, name=product.name, sku=product.sku, image=images[0] if images else None))
    db.add(RequestKey(key=key, fingerprint=fingerprint, order_id=order.id))
    record(db, order, "Сайт", "created")
    await enqueue(db, order)
    await db.commit()
    return {"id": order.id, "total": order.total_amount}


async def enqueue(db: AsyncSession, order: Order):
    staff = (await db.scalars(select(Staff).where(Staff.active.is_(True)))).all()
    recipients = {}
    for person in staff:
        if person.email:
            recipients.setdefault(person.email.casefold(), person)
    for address, person in recipients.items():
        db.add(Delivery(order_id=order.id, channel="email", recipient=address, staff_id=person.id))
    devices = (await db.scalars(select(Device).join(Staff).where(Staff.active.is_(True), Device.active.is_(True)))).all()
    for device in devices:
        db.add(Delivery(order_id=order.id, channel="push", recipient=str(device.id), staff_id=device.staff_id))


def record(db: AsyncSession, order: Order, actor: str, action: str):
    db.add(OrderEvent(order_id=order.id, actor=actor, status=order.status, action=action))


def active_orders():
    return select(Order).outerjoin(Assignment).where(or_(Assignment.order_id.is_(None), Assignment.archived.is_(False)))


def order_details(query):
    return query.options(selectinload(Order.items).selectinload(OrderItem.product).selectinload(Product.images))


async def serialize(db, orders, *, include_history=False):
    ids = [order.id for order in orders]
    assignments = {assignment.order_id: (assignment.staff_id, name) for assignment, name in (await db.execute(
        select(Assignment, Staff.name).outerjoin(Staff).where(Assignment.order_id.in_(ids)))).all()}
    item_ids = [item.id for order in orders for item in order.items]
    snapshots = {snap.item_id: snap for snap in (await db.scalars(select(ItemSnapshot).where(ItemSnapshot.item_id.in_(item_ids)))).all()}
    history = {}
    if include_history:
        events = (await db.scalars(select(OrderEvent).where(OrderEvent.order_id.in_(ids)).order_by(OrderEvent.id))).all()
        for event in events:
            history.setdefault(event.order_id, []).append({"id": event.id, "actor": event.actor,
                "status": event.status, "action": event.action, "created_at": event.created_at})
    results = []
    for order in orders:
        manager_id, manager = assignments.get(order.id, (None, None))
        items = []
        for item in order.items:
            saved = snapshots.get(item.id)
            product = item.product
            photos = pictures(product) if product and not saved else []
            items.append({"id":item.id, "name":saved.name if saved else product.name if product else f"Товар №{item.product_id}",
                          "sku":saved.sku if saved else product.sku if product else None,
                          "photo":saved.image if saved else photos[0] if photos else None,
                          "packs":item.quantity_packs, "pieces":item.quantity_pieces,
                          "price":item.price_per_unit, "subtotal":item.subtotal})
        results.append({"id":order.id, "name":order.customer_name, "phone":order.customer_phone,
            "organization":order.customer_organization, "comment":order.customer_comment,
            "status":order.status, "created_at":order.created_at, "total":order.total_amount,
            "manager":manager or order.assigned_manager, "manager_id":manager_id,
            "items":items, "history":history.get(order.id, [])})
    return results


@admin.get("/orders")
async def orders(status: str = "", page: int = Query(1, ge=1, le=100000), db: AsyncSession = Depends(get_db)):
    query = active_orders()
    if status:
        if status not in STATES:
            raise HTTPException(422, "Неизвестный статус")
        query = query.where(Order.status.in_({"cancelled","rejected"}) if status == "cancelled" else Order.status == status)
    count = await db.scalar(select(func.count()).select_from(query.subquery()))
    rows = (await db.scalars(order_details(query).order_by(Order.id.desc()).offset((page-1)*PAGE_SIZE).limit(PAGE_SIZE))).all()
    return {"items":await serialize(db,rows), "total":count}


@admin.get("/orders/{key}")
async def order(key: int, db: AsyncSession = Depends(get_db)):
    row = await db.scalar(order_details(active_orders().where(Order.id == key)))
    if row is None:
        raise HTTPException(404, "Заявка не найдена")
    return (await serialize(db,[row],include_history=True))[0]


async def mutable_order(db, key):
    row = await db.scalar(active_orders().where(Order.id == key))
    if row is None:
        raise HTTPException(404, "Заявка не найдена")
    assignment = await db.get(Assignment, key)
    return row, assignment


@admin.post("/orders/{key}/claim")
async def claim(key: int, staff: Staff = Depends(require_staff), db: AsyncSession = Depends(get_db)):
    await begin_write(db)
    row, assignment = await mutable_order(db, key)
    if row.status != "new" or row.assigned_manager or (assignment and assignment.staff_id):
        raise HTTPException(409, "Заявка уже взята в работу. Откройте её ещё раз.")
    if not assignment:
        assignment = Assignment(order_id=key)
        db.add(assignment)
    assignment.staff_id = staff.id
    row.status = "processing"
    record(db, row, staff.name, "claim")
    audit(db, staff, "order.claim", key)
    await db.commit()
    return {"ok":True}


class StatusInput(BaseModel):
    status: Status
    manager_id: int | None = Field(default=None, ge=0)
    expected_status: str = Field(max_length=20)


@admin.put("/orders/{key}/status")
async def status(key: int, values: StatusInput, staff: Staff = Depends(require_staff), db: AsyncSession = Depends(get_db)):
    await begin_write(db)
    row, assignment = await mutable_order(db, key)
    if row.status != values.expected_status:
        raise HTTPException(409, "Статус уже изменился. Проверьте текущую заявку.")
    if staff.role != "admin" and (not assignment or assignment.staff_id != staff.id or values.manager_id is not None):
        raise HTTPException(403, "Изменить статус может ответственный сотрудник или администратор")
    if values.manager_id is not None:
        if values.manager_id and not await db.scalar(select(Staff.id).where(Staff.id==values.manager_id, Staff.active.is_(True))):
            raise HTTPException(400, "Выберите действующего сотрудника")
        if not assignment:
            assignment = Assignment(order_id=key)
            db.add(assignment)
        assignment.staff_id = values.manager_id or None
        row.assigned_manager = None
    if row.status != values.status or values.manager_id is not None:
        row.status = values.status
        record(db, row, staff.name, "update")
        audit(db, staff, "order.update", key)
        await db.commit()
    return {"ok":True}


@admin.delete("/orders/{key}")
async def archive(key: int, staff: Staff = Depends(admin_only), db: AsyncSession = Depends(get_db)):
    await begin_write(db)
    row, assignment = await mutable_order(db,key)
    if not assignment:
        assignment = Assignment(order_id=key)
        db.add(assignment)
    assignment.archived = True
    record(db, row, staff.name, "archive")
    audit(db, staff, "order.archive", key)
    await db.commit()
    return {"ok":True}


@admin.get("/analytics")
async def analytics(_: Staff = Depends(admin_only), db: AsyncSession = Depends(get_db)):
    rows = (await db.execute(active_orders().where(Order.status.not_in(["cancelled","rejected"]))
        .with_only_columns(Order.id, Order.total_amount, Order.customer_phone, Order.telegram_user_id, Order.status, Order.created_at))).all()
    total = sum(row.total_amount for row in rows)
    today = datetime.utcnow().date()
    days = {str(today-timedelta(days=offset)):{"total":0,"count":0} for offset in reversed(range(30))}
    for row in rows:
        day = days.get(str(row.created_at.date()))
        if day is not None:
            day["total"] += row.total_amount
            day["count"] += 1
    packs = func.sum(OrderItem.quantity_packs)
    top = (await db.execute(select(Product.name, packs).join(OrderItem, OrderItem.product_id==Product.id)
        .join(Order).outerjoin(Assignment)
        .where(or_(Assignment.order_id.is_(None), Assignment.archived.is_(False)), Order.status.not_in(["cancelled","rejected"]))
        .group_by(Product.id,Product.name).order_by(packs.desc(),Product.id).limit(5))).all()
    return {"total":total, "count":len(rows), "average":round(total/len(rows),2) if rows else 0,
        "customers":len({normalize_phone(row.customer_phone) or ("telegram:"+str(row.telegram_user_id) if row.telegram_user_id else "order:"+str(row.id)) for row in rows}),
        "products":await db.scalar(select(func.count(Product.id))), "categories":await db.scalar(select(func.count(Category.id))),
        "new":sum(row.status=="new" for row in rows), "completed":sum(row.status=="completed" for row in rows),
        "confirmed_sum":sum(row.total_amount for row in rows if row.status in {"accepted","completed"}),
        "days":[{"date":day,**value} for day,value in days.items()], "top":[{"name":name,"packs":quantity} for name,quantity in top]}
