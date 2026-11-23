from datetime import datetime, timedelta
import hashlib
import hmac
import os
import secrets
from urllib.parse import urlsplit

from argon2 import PasswordHasher
from argon2.exceptions import InvalidHashError, VerificationError
from fastapi import APIRouter, Depends, HTTPException, Request, Response
from pydantic import BaseModel, Field
from sqlalchemy import delete, select, text
from sqlalchemy.dialects.sqlite import insert
from sqlalchemy.ext.asyncio import AsyncSession
from starlette.concurrency import run_in_threadpool

from ..database import AsyncSessionLocal, get_db
from .models import Audit, RateLimit, Session, Staff

router = APIRouter(prefix="/api/v1/admin")
TTL = timedelta(hours=12)
PASSWORDS = PasswordHasher()
DUMMY_HASH = PASSWORDS.hash(secrets.token_urlsafe(32))
ORIGIN = os.environ.get("SHOP_ORIGIN", "http://localhost:8000").rstrip("/")
HTTPS = urlsplit(ORIGIN).scheme == "https"
LOOPBACK = {"localhost", "127.0.0.1", "::1"}
LOCAL_ADMIN = (
    urlsplit(ORIGIN).scheme == "http"
    and urlsplit(ORIGIN).hostname in LOOPBACK
    and os.getenv("SHOP_LOCAL_ADMIN", "").lower() == "true"
)
LOCAL_ADMIN_PASSWORD = "admin"
COOKIE = "__Host-kurortnik_staff" if HTTPS else "kurortnik_staff"


def digest(value: str) -> str:
    return hashlib.sha256(value.encode()).hexdigest()


async def begin_write(db: AsyncSession) -> None:
    # Acquire the SQLite write reservation before selecting rows used by the mutation.
    await db.execute(text("BEGIN IMMEDIATE"))


async def limit(request: Request, bucket: str, maximum: int, window: int, subject: str | None = None) -> None:
    now = datetime.utcnow()
    epoch = int(now.timestamp()) // window
    ip = request.client.host if request.client else "unknown"
    key = digest(f"{bucket}:{subject or ip}:{epoch}")
    async with AsyncSessionLocal() as db:
        query = insert(RateLimit).values(key=key, hits=1, expires_at=now + timedelta(seconds=window*2))
        result = await db.execute(query.on_conflict_do_update(index_elements=[RateLimit.key], set_={"hits": RateLimit.hits + 1}).returning(RateLimit.hits))
        hits = result.scalar_one()
        await db.commit()
    if hits > maximum:
        raise HTTPException(429, "Слишком много запросов. Попробуйте позже.", headers={"Retry-After": str(window)})


def check_origin(request: Request) -> None:
    if request.headers.get("origin") != ORIGIN:
        raise HTTPException(403, "Источник запроса не разрешён")


async def read_session(db: AsyncSession, token: str):
    if not token or len(token) != 43:
        return None
    return (await db.execute(
        select(Staff, Session).join(Session, Session.staff_id == Staff.id)
        .where(Session.token == digest(token), Session.expires_at > datetime.utcnow(), Staff.active.is_(True))
    )).first()


async def require_staff(request: Request) -> Staff:
    async with AsyncSessionLocal() as db:
        row = await read_session(db, request.cookies.get(COOKIE, ""))
    if row is None:
        raise HTTPException(401, "Войдите в учётную запись сотрудника")
    staff, session = row
    if request.method not in {"GET", "HEAD", "OPTIONS"}:
        check_origin(request)
        if not hmac.compare_digest(session.csrf, request.headers.get("x-csrf-token", "")):
            raise HTTPException(403, "Проверка сеанса не пройдена")
    await limit(request, "staff", 600, 60, str(staff.id))
    request.state.session = session
    return staff


def admin_only(staff: Staff = Depends(require_staff)) -> Staff:
    if staff.role != "admin":
        raise HTTPException(403, "Требуются права администратора")
    return staff


def audit(db: AsyncSession, staff: Staff, action: str, target: object) -> None:
    db.add(Audit(staff_id=staff.id, action=action, target=str(target)[:100]))


def staff_response(staff: Staff, session: Session) -> dict:
    return {"id": staff.id, "name": staff.name, "role": staff.role, "csrf": session.csrf}


class Credentials(BaseModel):
    login: str = Field(min_length=1, max_length=100)
    password: str = Field(min_length=1, max_length=256)


def verify_password(password_hash: str, value: str) -> bool:
    try:
        return PASSWORDS.verify(password_hash, value)
    except (VerificationError, InvalidHashError):
        return False


@router.post("/login")
async def login(values: Credentials, request: Request, response: Response, db: AsyncSession = Depends(get_db)):
    check_origin(request)
    normalized = values.login.strip().casefold()
    await limit(request, "login-ip", 20, 900)
    await limit(request, "login-account", 8, 900, normalized or "empty")
    staff = await db.scalar(select(Staff).where(Staff.login == normalized, Staff.active.is_(True)))
    password_valid = await run_in_threadpool(verify_password, staff.password if staff else DUMMY_HASH, values.password)
    local_admin_blocked = (
        normalized == "admin"
        and values.password == LOCAL_ADMIN_PASSWORD
        and not (LOCAL_ADMIN and request.client and request.client.host in LOOPBACK)
    )
    if not password_valid or staff is None or local_admin_blocked:
        raise HTTPException(401, "Неверный логин или пароль")
    token = secrets.token_urlsafe(32)
    previous = await read_session(db, request.cookies.get(COOKIE, ""))
    if previous:
        await db.delete(previous[1])
    session = Session(token=digest(token), csrf=secrets.token_hex(32), staff_id=staff.id, expires_at=datetime.utcnow()+TTL)
    db.add(session)
    audit(db, staff, "login", staff.id)
    await db.commit()
    response.set_cookie(COOKIE, token, max_age=int(TTL.total_seconds()), secure=HTTPS, httponly=True, samesite="strict")
    return staff_response(staff, session)


@router.get("/session")
async def session(request: Request, staff: Staff = Depends(require_staff)):
    return staff_response(staff, request.state.session)


@router.post("/logout")
async def logout(request: Request, response: Response, staff: Staff = Depends(require_staff), db: AsyncSession = Depends(get_db)):
    await db.execute(delete(Session).where(Session.token == request.state.session.token))
    audit(db, staff, "logout", staff.id)
    await db.commit()
    response.delete_cookie(COOKIE, secure=HTTPS, httponly=True, samesite="strict")
    return {"ok": True}


@router.get("/team")
async def team(_: Staff = Depends(require_staff), db: AsyncSession = Depends(get_db)):
    return [{"id": person.id, "name": person.name} for person in (await db.scalars(select(Staff).where(Staff.active.is_(True)).order_by(Staff.name))).all()]
