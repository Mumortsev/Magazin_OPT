"""Explicit schema and staff maintenance. Run with python -m api.web.manage."""
import argparse
import asyncio
from datetime import datetime
from getpass import getpass
import re

from sqlalchemy import delete, inspect, select, text

from .. import models as legacy_models  # Register shared ORM tables.
from ..database import AsyncSessionLocal, Base, engine
from . import models
from .security import PASSWORDS, begin_write


async def migrate():
    if engine.dialect.name != "sqlite":
        raise RuntimeError("Текущая версия веб-миграции поддерживает SQLite")
    async with engine.begin() as connection:
        existing = await connection.run_sync(lambda conn: set(inspect(conn).get_table_names()))
        if {"products","orders","categories","subcategories","order_items"} & existing:
            required = [table for table in Base.metadata.sorted_tables if not table.name.startswith("web_") and table.name not in {"fcm_tokens","push_subscriptions"}]
            for table in required:
                result = await connection.execute(text(f"PRAGMA table_info({table.name})"))
                actual = {row[1] for row in result}
                missing = set(table.columns.keys()) - actual
                if missing:
                    raise RuntimeError(f"Обновите совместимую копию БД до схемы основной ветки: {table.name}: {', '.join(sorted(missing))}")
        await connection.run_sync(Base.metadata.create_all)


async def create_staff(args, password):
    async with AsyncSessionLocal() as db:
        await begin_write(db)
        login = args.login.strip().casefold()
        if await db.scalar(select(models.Staff.id).where(models.Staff.login==login)):
            raise RuntimeError("Такой логин уже существует")
        db.add(models.Staff(login=login,name=args.name.strip(),email=args.email,role=args.role,password=PASSWORDS.hash(password)))
        await db.commit()


async def disable(login):
    async with AsyncSessionLocal() as db:
        await begin_write(db)
        staff = await db.scalar(select(models.Staff).where(models.Staff.login==login.strip().casefold()))
        if not staff:
            raise RuntimeError("Учётная запись не найдена")
        staff.active = False
        await db.execute(delete(models.Session).where(models.Session.staff_id==staff.id))
        await db.commit()


async def cleanup():
    async with AsyncSessionLocal() as db:
        now = datetime.utcnow()
        for model in (models.Session, models.RateLimit, models.ImportPreview):
            await db.execute(delete(model).where(model.expires_at<now))
        await db.commit()


def main():
    parser = argparse.ArgumentParser()
    commands = parser.add_subparsers(dest="action",required=True)
    commands.add_parser("migrate")
    commands.add_parser("cleanup")
    add = commands.add_parser("add-staff")
    add.add_argument("login")
    add.add_argument("name")
    add.add_argument("role", choices=["admin","manager"])
    add.add_argument("--email")
    commands.add_parser("disable-staff").add_argument("login")
    args = parser.parse_args()
    if args.action == "migrate":
        asyncio.run(migrate())
    elif args.action == "cleanup":
        asyncio.run(cleanup())
    elif args.action == "disable-staff":
        asyncio.run(disable(args.login))
    else:
        if not 1 <= len(args.login.strip()) <= 100 or not 1 <= len(args.name.strip()) <= 100:
            parser.error("Логин и имя должны содержать от 1 до 100 символов")
        if args.email and (len(args.email)>254 or not re.fullmatch(r"[\w.+-]+@[\w.-]+\.[a-zA-Z]{2,}",args.email)):
            parser.error("Неверный адрес почты")
        password = getpass("Пароль сотрудника: ")
        if not 12 <= len(password) <= 256 or password != getpass("Повторите пароль: "):
            parser.error("Пароль должен содержать 12–256 символов, значения должны совпадать")
        asyncio.run(create_staff(args,password))


if __name__ == "__main__":
    main()
