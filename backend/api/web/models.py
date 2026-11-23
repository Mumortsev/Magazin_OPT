"""Additive web tables. Existing Mini App rows keep their original schema."""
from datetime import datetime

from sqlalchemy import Boolean, DateTime, ForeignKey, Integer, JSON, String, Text, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column

from ..database import Base


class Staff(Base):
    __tablename__ = "web_staff"
    id: Mapped[int] = mapped_column(primary_key=True)
    login: Mapped[str] = mapped_column(String(100), unique=True)
    name: Mapped[str] = mapped_column(String(100))
    email: Mapped[str | None] = mapped_column(String(254))
    password: Mapped[str] = mapped_column(Text)
    role: Mapped[str] = mapped_column(String(10))
    active: Mapped[bool] = mapped_column(Boolean, default=True)


class Session(Base):
    __tablename__ = "web_sessions"
    token: Mapped[str] = mapped_column(String(64), primary_key=True)
    csrf: Mapped[str] = mapped_column(String(64))
    staff_id: Mapped[int] = mapped_column(ForeignKey("web_staff.id"), index=True)
    expires_at: Mapped[datetime] = mapped_column(DateTime, index=True)


class RateLimit(Base):
    __tablename__ = "web_rate_limits"
    key: Mapped[str] = mapped_column(String(64), primary_key=True)
    expires_at: Mapped[datetime] = mapped_column(DateTime, index=True)
    hits: Mapped[int] = mapped_column(Integer)


class RequestKey(Base):
    __tablename__ = "web_order_keys"
    key: Mapped[str] = mapped_column(String(36), primary_key=True)
    fingerprint: Mapped[str] = mapped_column(String(64))
    order_id: Mapped[int] = mapped_column(ForeignKey("orders.id"), unique=True)


class Assignment(Base):
    __tablename__ = "web_order_assignments"
    order_id: Mapped[int] = mapped_column(ForeignKey("orders.id"), primary_key=True)
    staff_id: Mapped[int | None] = mapped_column(ForeignKey("web_staff.id"))
    archived: Mapped[bool] = mapped_column(Boolean, default=False)


class ItemSnapshot(Base):
    __tablename__ = "web_order_item_snapshots"
    item_id: Mapped[int] = mapped_column(ForeignKey("order_items.id"), primary_key=True)
    name: Mapped[str] = mapped_column(String(500))
    sku: Mapped[str | None] = mapped_column(String(100))
    image: Mapped[str | None] = mapped_column(Text)


class OrderEvent(Base):
    __tablename__ = "web_order_events"
    id: Mapped[int] = mapped_column(primary_key=True)
    order_id: Mapped[int] = mapped_column(ForeignKey("orders.id"), index=True)
    actor: Mapped[str] = mapped_column(String(100))
    status: Mapped[str] = mapped_column(String(20))
    action: Mapped[str] = mapped_column(String(20))
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)


class Audit(Base):
    __tablename__ = "web_admin_audit"
    id: Mapped[int] = mapped_column(primary_key=True)
    staff_id: Mapped[int] = mapped_column(ForeignKey("web_staff.id"), index=True)
    action: Mapped[str] = mapped_column(String(50))
    target: Mapped[str] = mapped_column(String(100))
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)


class ContentRecord(Base):
    __tablename__ = "web_content"
    id: Mapped[int] = mapped_column(primary_key=True)
    value: Mapped[dict] = mapped_column(JSON)


class ImportPreview(Base):
    __tablename__ = "web_import_previews"
    id: Mapped[str] = mapped_column(String(36), primary_key=True)
    staff_id: Mapped[int] = mapped_column(ForeignKey("web_staff.id"))
    expires_at: Mapped[datetime] = mapped_column(DateTime, index=True)
    rows: Mapped[list] = mapped_column(JSON)
    fingerprint: Mapped[str] = mapped_column(String(64))


class Device(Base):
    __tablename__ = "web_push_devices"
    id: Mapped[int] = mapped_column(primary_key=True)
    staff_id: Mapped[int] = mapped_column(ForeignKey("web_staff.id"), index=True)
    endpoint: Mapped[str] = mapped_column(Text, unique=True)
    p256dh: Mapped[str] = mapped_column(String(100))
    auth: Mapped[str] = mapped_column(String(100))
    label: Mapped[str] = mapped_column(String(100))
    active: Mapped[bool] = mapped_column(Boolean, default=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)


class Delivery(Base):
    __tablename__ = "web_deliveries"
    __table_args__ = (UniqueConstraint("order_id", "channel", "recipient"),)
    id: Mapped[int] = mapped_column(primary_key=True)
    order_id: Mapped[int] = mapped_column(ForeignKey("orders.id"), index=True)
    staff_id: Mapped[int] = mapped_column(ForeignKey("web_staff.id"), index=True)
    channel: Mapped[str] = mapped_column(String(10))
    recipient: Mapped[str] = mapped_column(String(254))
    status: Mapped[str] = mapped_column(String(20), index=True, default="pending")
    attempts: Mapped[int] = mapped_column(Integer, default=0)
    next_at: Mapped[datetime] = mapped_column(DateTime, index=True, default=datetime.utcnow)
    lease: Mapped[str | None] = mapped_column(String(64))
    last_error: Mapped[str | None] = mapped_column(String(255))


class DeliveryAttempt(Base):
    __tablename__ = "web_delivery_attempts"
    id: Mapped[int] = mapped_column(primary_key=True)
    delivery_id: Mapped[int] = mapped_column(ForeignKey("web_deliveries.id"), index=True)
    outcome: Mapped[str] = mapped_column(String(20))
    error: Mapped[str | None] = mapped_column(String(255))
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)
