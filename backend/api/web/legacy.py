"""Compatibility gate for a Mini App sharing the wholesale database."""
from datetime import datetime
from time import time
import hashlib
import hmac
import json
import os
from urllib.parse import parse_qsl

from fastapi import Request
from fastapi.responses import JSONResponse, RedirectResponse

SHARED = os.getenv("SHOP_SHARED_LEGACY", "").lower() == "true"


def trusted_bot(request: Request) -> bool:
    expected = os.getenv("SHOP_LEGACY_BOT_KEY", "")
    return len(expected) >= 32 and hmac.compare_digest(expected, request.headers.get("x-shop-bot-key", ""))


def telegram_id(request: Request) -> int | None:
    token = os.getenv("BOT_TOKEN", "")
    raw = request.headers.get("x-telegram-init-data", "")
    if not token or not raw or len(raw) > 8192:
        return None
    try:
        pairs = parse_qsl(raw, strict_parsing=True, max_num_fields=24)
        fields = dict(pairs)
        if len(pairs) != len(fields):
            return None
        signature = fields.pop("hash")
        now = int(datetime.now().timestamp())
        if not now-86400 <= int(fields["auth_date"]) <= now+60:
            return None
        check = "\n".join(f"{key}={value}" for key,value in sorted(fields.items()))
        secret = hmac.digest(b"WebAppData",token.encode(),hashlib.sha256)
        expected = hmac.new(secret,check.encode(),hashlib.sha256).hexdigest()
        if hmac.compare_digest(signature,expected):
            return int(json.loads(fields["user"])["id"])
    except (KeyError, ValueError, TypeError):
        return None
    return None


async def gate(request: Request, call_next):
    path, method = request.url.path.rstrip("/"), request.method
    if path.startswith(("/api/debug","/debug")) or "/pdfs/" in path or path in {"/api/admin/reset-db","/api/fcm-token","/pdfs","/static/pdfs"}:
        return JSONResponse({"detail":"Маршрут закрыт"},status_code=404)
    if path in {"/admin.html","/static/admin.html"}:
        admin_url = os.getenv("SHOP_ADMIN_URL")
        if admin_url and admin_url.startswith("https://"):
            return RedirectResponse(admin_url,302)
        return JSONResponse({"detail":"Откройте веб-админку магазина"},status_code=404)
    if path == "/api/orders/me" and request.query_params.get("telegram_user_id"):
        if not request.query_params.get("whatsapp_phone"):
            try:
                claimed = int(request.query_params["telegram_user_id"])
            except ValueError:
                claimed = None
            actual = telegram_id(request)
            if actual is None or claimed != actual:
                return JSONResponse({"detail":"Откройте профиль из Telegram"},status_code=403)
    protected = (
        path.startswith("/api/admin") or
        (path.startswith("/api/orders") and path != "/api/orders/me" and not (path=="/api/orders" and method=="POST")) or
        (path.startswith(("/api/products","/api/categories","/api/images")) and method not in {"GET","HEAD","OPTIONS"}) or
        request.query_params.get("admin_view","").lower() in {"true","yes","1","on","t","y"}
    )
    if protected and not trusted_bot(request):
        return JSONResponse({"detail":"Требуется серверная авторизация"},status_code=403)
    if path == "/api/whatsapp/webhook" and method=="POST":
        secret = os.getenv("SHOP_WHATSAPP_WEBHOOK_KEY","")
        supplied = request.query_params.get("hook_key","")
        if len(secret)<32 or not hmac.compare_digest(secret,supplied):
            return JSONResponse({"detail":"Недействительный webhook"},status_code=403)
    return await call_next(request)


def validate_environment():
    if len(os.getenv("SHOP_LEGACY_BOT_KEY","")) < 32:
        raise RuntimeError("SHOP_SHARED_LEGACY requires SHOP_LEGACY_BOT_KEY (32 characters or more)")
    if os.getenv("WHATSAPP_API_PROVIDER") or os.getenv("WHATSAPP_ACCESS_TOKEN") or os.getenv("WAZZUP_API_KEY"):
        if min(len(os.getenv("WHATSAPP_VERIFY_TOKEN","")),len(os.getenv("SHOP_WHATSAPP_WEBHOOK_KEY",""))) < 32:
            raise RuntimeError("Shared WhatsApp requires separately configured webhook and verification keys")


def receipt_signature(order_id: int, expires: int) -> str:
    secret = os.getenv("WHATSAPP_VERIFY_TOKEN", "")
    if len(secret) < 32:
        raise RuntimeError("WhatsApp verification key is missing")
    return hmac.new(secret.encode(), f"receipt:{order_id}:{expires}".encode(), hashlib.sha256).hexdigest()


def receipt_is_valid(order_id: int, expires: int, signature: str) -> bool:
    if not SHARED or not time() <= expires <= time() + 3600 or len(signature) != 64:
        return False
    try:
        return hmac.compare_digest(receipt_signature(order_id, expires), signature)
    except RuntimeError:
        return False


def whatsapp_identity(request: Request, phone: str | None) -> bool:
    if not phone or len(os.getenv("WHATSAPP_VERIFY_TOKEN","")) < 32:
        return False
    from ..routes.whatsapp import verify_phone_token
    return verify_phone_token(phone,request.headers.get("x-whatsapp-token",""))
