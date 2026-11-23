"""
Web Push Registration and authentication utilities.
"""
import logging
from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from pydantic import BaseModel

from ..web.legacy import SHARED
from ..database import get_db
from ..models import PushSubscription

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/auth", tags=["auth"])

# --- Request Schemas ---

class PushKeys(BaseModel):
    p256dh: str
    auth: str

class PushRegisterRequest(BaseModel):
    phone: str
    endpoint: str
    keys: PushKeys

# --- Helper functions ---

def clean_phone_number(phone: str) -> str:
    """Normalize phone number to 7XXXXXXXXXX format."""
    if phone.startswith("admin_"):
        return phone
    digits = "".join(filter(str.isdigit, phone))
    if not digits:
        return ""
    # Convert starting 8 to 7
    if digits.startswith("8") and len(digits) == 11:
        digits = "7" + digits[1:]
    # Force 7 prefix if 10 digits
    elif len(digits) == 10:
        digits = "7" + digits
    return digits

# --- Endpoints ---

@router.post("/push/register")
async def register_push(
    payload: PushRegisterRequest,
    db: AsyncSession = Depends(get_db)
):
    """
    Register or update a browser Web Push subscription for a user's phone number.
    """
    if SHARED:
        from ..web.notifications import safe_endpoint, key_bytes
        if payload.phone.startswith("admin_") or not safe_endpoint(payload.endpoint) or not key_bytes(payload.keys.p256dh,65) or not key_bytes(payload.keys.auth,16):
            raise HTTPException(422, "Некорректная подписка")
    cleaned_phone = clean_phone_number(payload.phone)
    if not cleaned_phone:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Неверный формат номера телефона"
        )

    # Check if this endpoint is already registered
    stmt = select(PushSubscription).where(PushSubscription.endpoint == payload.endpoint)
    result = await db.execute(stmt)
    existing_sub = result.scalar_one_or_none()

    if existing_sub:
        # Update phone and keys if changed
        existing_sub.phone = cleaned_phone
        existing_sub.p256dh = payload.keys.p256dh
        existing_sub.auth = payload.keys.auth
        logger.info(f"Updated existing Push Subscription for phone: {cleaned_phone}")
    else:
        # Create new subscription
        new_sub = PushSubscription(
            phone=cleaned_phone,
            endpoint=payload.endpoint,
            p256dh=payload.keys.p256dh,
            auth=payload.keys.auth
        )
        db.add(new_sub)
        logger.info(f"Created new Push Subscription for phone: {cleaned_phone}")

    await db.commit()
    return {"status": "success", "message": "Подписка на уведомления зарегистрирована"}
