"""Database-backed delivery with persisted leases and browser SSE."""
import asyncio
from datetime import datetime, timedelta
from email.message import EmailMessage
import base64
import json
import logging
import os
import re
import smtplib
import ssl
from urllib.parse import urlsplit
from uuid import uuid4

from fastapi import APIRouter, Depends, HTTPException, Request
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, Field
from pywebpush import WebPushException, webpush
import requests
from sqlalchemy import func, select
from starlette.concurrency import run_in_threadpool

from ..database import AsyncSessionLocal, get_db
from ..models import Order
from .models import Delivery, DeliveryAttempt, Device, OrderEvent, Staff
from .orders import active_orders
from .security import COOKIE, ORIGIN, admin_only, audit, begin_write, read_session, require_staff

router = APIRouter(prefix="/api/v1/admin", dependencies=[Depends(require_staff)])
PUBLIC_KEY = os.getenv("VAPID_PUBLIC_KEY", "")
PRIVATE_KEY = os.getenv("VAPID_PRIVATE_KEY", "")
CLAIM = os.getenv("VAPID_CLAIM_EMAIL", "")
SMTP_HOST = os.getenv("SHOP_SMTP_HOST", "")
MAX_ATTEMPTS = 6
LEASE = timedelta(seconds=90)
LOG = logging.getLogger(__name__)


class Keys(BaseModel):
    p256dh: str = Field(max_length=100)
    auth: str = Field(max_length=100)


class Subscription(BaseModel):
    endpoint: str = Field(max_length=2048)
    keys: Keys
    label: str = Field(default="Браузер",max_length=100)


def safe_endpoint(value: str) -> bool:
    try:
        url = urlsplit(value)
        host = url.hostname or ""
        allowed = host in {"fcm.googleapis.com","updates.push.services.mozilla.com","web.push.apple.com","android.googleapis.com"} or (
            host.endswith(".notify.windows.com") and bool(re.fullmatch(r"[a-z0-9-]+\.notify\.windows\.com", host))
        )
        return allowed and url.scheme == "https" and url.netloc == host and url.path.startswith("/") and not url.fragment and not any(char.isspace() or char=="\\" for char in value)
    except ValueError:
        return False


def key_bytes(value: str, size: int) -> bool:
    if not re.fullmatch(r"[A-Za-z0-9_-]+={0,2}",value):
        return False
    try:
        binary = base64.urlsafe_b64decode(value.rstrip("=") + "="*(-len(value.rstrip("="))%4))
        return len(binary)==size and (size != 65 or binary[0]==4)
    except ValueError:
        return False


@router.get("/push/key")
async def vapid_key():
    if not (PUBLIC_KEY and PRIVATE_KEY and CLAIM):
        raise HTTPException(503,"Web Push ещё не настроен")
    return {"public_key":PUBLIC_KEY}


@router.get("/push")
async def devices(staff: Staff = Depends(require_staff), db=Depends(get_db)):
    rows = (await db.scalars(select(Device).where(Device.staff_id==staff.id,Device.active.is_(True)).order_by(Device.id))).all()
    return [{"id":item.id,"label":item.label,"created_at":item.created_at} for item in rows]


@router.post("/push")
async def subscribe(values: Subscription, staff: Staff = Depends(require_staff), db=Depends(get_db)):
    if not safe_endpoint(values.endpoint) or not key_bytes(values.keys.p256dh,65) or not key_bytes(values.keys.auth,16):
        raise HTTPException(422,"Некорректная подписка браузера")
    await begin_write(db)
    device = await db.scalar(select(Device).where(Device.endpoint==values.endpoint))
    if device and device.staff_id != staff.id:
        raise HTTPException(409,"Этот браузер подключён к другой учётной записи. Отключите предыдущее устройство.")
    if not device:
        active_count = await db.scalar(select(func.count(Device.id)).where(Device.staff_id==staff.id,Device.active.is_(True)))
        if active_count>=20:
            raise HTTPException(409,"Отключите одно из старых устройств")
        device = Device(staff_id=staff.id,endpoint=values.endpoint)
        db.add(device)
    device.p256dh,device.auth,device.label,device.active = values.keys.p256dh,values.keys.auth,values.label,True
    await db.flush()
    audit(db,staff,"push.subscribe",device.id)
    await db.commit()
    return {"id":device.id}


@router.delete("/push/{key}")
async def unsubscribe(key: int, staff: Staff = Depends(require_staff), db=Depends(get_db)):
    await begin_write(db)
    device = await db.get(Device,key)
    if not device or device.staff_id != staff.id:
        raise HTTPException(404,"Устройство не найдено")
    device.active = False
    audit(db,staff,"push.unsubscribe",key)
    await db.commit()
    return {"ok":True}


async def delivery_log(db, staff_id=None):
    query = select(Delivery).order_by(Delivery.id.desc()).limit(100)
    if staff_id:
        query = query.where(Delivery.staff_id==staff_id)
    return [{"id":row.id,"order_id":row.order_id,"channel":row.channel,"status":row.status,
             "attempts":row.attempts,"last_error":row.last_error,"next_at":row.next_at}
            for row in (await db.scalars(query)).all()]


@router.get("/deliveries")
async def list_deliveries(_: Staff = Depends(admin_only), db=Depends(get_db)):
    return await delivery_log(db)


@router.get("/my-deliveries")
async def my_deliveries(staff: Staff = Depends(require_staff), db=Depends(get_db)):
    return await delivery_log(db,staff.id)


@router.get("/deliveries/{key}/attempts")
async def attempts(key: int, _: Staff = Depends(admin_only), db=Depends(get_db)):
    rows = (await db.scalars(select(DeliveryAttempt).where(DeliveryAttempt.delivery_id==key).order_by(DeliveryAttempt.id.desc()))).all()
    return [{"status":row.outcome,"error":row.error,"created_at":row.created_at} for row in rows]


@router.post("/deliveries/{key}/retry")
async def retry(key: int, staff: Staff = Depends(admin_only), db=Depends(get_db)):
    await begin_write(db)
    delivery = await db.get(Delivery,key)
    if not delivery or delivery.status != "failed":
        raise HTTPException(409,"Повтор доступен для доставки с ошибкой")
    delivery.status,delivery.attempts,delivery.next_at = "pending",0,datetime.utcnow()
    audit(db,staff,"delivery.retry",key)
    await db.commit()
    return {"ok":True}


@router.get("/events")
async def events(request: Request):
    token = request.cookies.get(COOKIE,"")

    async def stream():
        checkpoint = None
        heartbeat = 0
        while not await request.is_disconnected():
            async with AsyncSessionLocal() as db:
                if not await read_session(db,token):
                    return
                latest = await db.scalar(select(func.max(OrderEvent.id))) or 0
                total = await db.scalar(select(func.count()).select_from(active_orders().where(Order.status=="new").subquery()))
                order_count = await db.scalar(select(func.count(Order.id)))
            state = (latest,total,order_count)
            if state != checkpoint:
                checkpoint = state
                yield "data: " + json.dumps({"new_count":total,"revision":latest}) + "\n\n"
                heartbeat = 0
            elif heartbeat >= 10:
                yield ": heartbeat\n\n"
                heartbeat = 0
            heartbeat += 1
            await asyncio.sleep(1.25)

    return StreamingResponse(stream(),media_type="text/event-stream",headers={"X-Accel-Buffering":"no","Cache-Control":"no-store"})


class NoRedirects(requests.Session):
    def request(self, method, url, **kwargs):
        kwargs["allow_redirects"] = False
        return super().request(method,url,**kwargs)


def push(device: Device, order: Order):
    if not safe_endpoint(device.endpoint):
        return "invalid","Некорректный адрес службы push"
    if not (PUBLIC_KEY and PRIVATE_KEY and CLAIM):
        return "failed","Web Push не настроен"
    payload = {"title":f"Новая заявка №{order.id}","body":f"Сумма: {order.total_amount:.2f} ₽","id":order.id}
    try:
        with NoRedirects() as session:
            response = webpush({"endpoint":device.endpoint,"keys":{"p256dh":device.p256dh,"auth":device.auth}},
                data=json.dumps(payload,ensure_ascii=False),vapid_private_key=PRIVATE_KEY,
                vapid_claims={"sub":CLAIM},ttl=3600,timeout=15,requests_session=session)
        return ("sent",None) if 200 <= response.status_code < 300 else ("failed",f"Служба push вернула HTTP {response.status_code}")
    except WebPushException as error:
        code = error.response.status_code if error.response is not None else None
        return ("invalid" if code in {404,410} else "failed",f"Служба push вернула HTTP {code}" if code else "Ошибка Web Push")


def email(address: str, order: Order):
    sender = os.getenv("SHOP_SMTP_FROM","")
    if not SMTP_HOST or not sender:
        return "failed","Почтовый шлюз не настроен"
    message = EmailMessage()
    message["Subject"] = f"Курортник — новая заявка №{order.id}"
    message["From"],message["To"] = sender,address
    message.set_content(f"Заявка №{order.id}\nСумма: {order.total_amount:.2f} ₽\n{ORIGIN}/admin/orders/{order.id}")
    context = ssl.create_default_context()
    mode = os.getenv("SHOP_SMTP_MODE","starttls")
    if mode not in {"ssl","starttls"}:
        return "failed","Выберите SMTP с TLS"
    port = int(os.getenv("SHOP_SMTP_PORT","465" if mode=="ssl" else "587"))
    connection = smtplib.SMTP_SSL(SMTP_HOST,port,timeout=12,context=context) if mode=="ssl" else smtplib.SMTP(SMTP_HOST,port,timeout=12)
    with connection:
        if mode=="starttls":
            connection.starttls(context=context)
        user = os.getenv("SHOP_SMTP_USER")
        if user:
            connection.login(user,os.environ["SHOP_SMTP_PASSWORD"])
        connection.send_message(message)
    return "sent",None


async def dispatch_one() -> bool:
    now = datetime.utcnow()
    async with AsyncSessionLocal() as db:
        await begin_write(db)
        job = await db.scalar(select(Delivery).where(
            Delivery.next_at<=now,Delivery.status.in_({"pending","sending"})).order_by(Delivery.next_at,Delivery.id).limit(1))
        if not job:
            return False
        if job.attempts>=MAX_ATTEMPTS:
            job.status,job.lease,job.last_error = "failed",None,"Истёк срок последней попытки"
            db.add(DeliveryAttempt(delivery_id=job.id,outcome="failed",error=job.last_error))
            await db.commit()
            return True
        lease = uuid4().hex
        if job.status == "sending":
            db.add(DeliveryAttempt(delivery_id=job.id,outcome="failed",error="Истёк срок попытки"))
        job.status,job.lease,job.next_at = "sending",lease,now+LEASE
        job.attempts += 1
        staff = await db.get(Staff,job.staff_id)
        order = await db.get(Order,job.order_id)
        device = await db.get(Device,int(job.recipient)) if job.channel=="push" else None
        await db.commit()

    try:
        if not staff or not staff.active or not order:
            outcome,error = "invalid","Получатель или заявка недоступны"
        elif job.channel=="push":
            outcome,error = await run_in_threadpool(push,device,order) if device and device.active and device.staff_id==staff.id else ("invalid","Подписка отключена")
        elif not staff.email or staff.email.casefold()!=job.recipient:
            outcome,error = "invalid","Адрес сотрудника изменён"
        else:
            outcome,error = await run_in_threadpool(email,job.recipient,order)
    except Exception as exc:
        outcome,error = "failed","Ошибка транспорта: "+type(exc).__name__

    async with AsyncSessionLocal() as db:
        await begin_write(db)
        current = await db.get(Delivery,job.id)
        if current and current.lease==lease:
            current.lease,current.last_error = None,error
            current.status = "pending" if outcome=="failed" and current.attempts<MAX_ATTEMPTS else outcome
            current.next_at = datetime.utcnow()+timedelta(seconds=min(3600,30*2**(current.attempts-1)))
            if device and outcome=="invalid":
                saved = await db.get(Device,device.id)
                if saved and (saved.endpoint,saved.p256dh,saved.auth)==(device.endpoint,device.p256dh,device.auth):
                    saved.active = False
            db.add(DeliveryAttempt(delivery_id=job.id,outcome=outcome,error=error))
            await db.commit()
    return True


async def delivery_worker():
    while True:
        try:
            if not await dispatch_one():
                await asyncio.sleep(1)
        except Exception:
            LOG.exception("Delivery worker error")
            await asyncio.sleep(5)
