"""Spreadsheet preview and transactional application using the legacy column names."""
from datetime import datetime, timedelta
from decimal import Decimal, InvalidOperation
from io import BytesIO
import json
from pathlib import Path
from tempfile import TemporaryDirectory
from uuid import uuid4
from zipfile import BadZipFile, ZipFile

from fastapi import APIRouter, Depends, HTTPException, UploadFile
import pandas as pd
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from starlette.concurrency import run_in_threadpool

from ..database import get_db
from ..excel_processor import COLUMN_ALIASES, read_spreadsheet
from ..models import Category, Product, Subcategory
from ..routes.admin import get_excel_template
from .models import ImportPreview, Staff
from .security import admin_only, audit, begin_write, digest

router = APIRouter(prefix="/api/v1/admin/import", dependencies=[Depends(admin_only)])
FORMATS = {".xlsx", ".xls", ".xlsm", ".xlsb", ".ods", ".csv", ".tsv"}
LIMIT = 10 * 1024 * 1024


def spreadsheet(suffix: str, data: bytes):
    if suffix in {".xlsx", ".xlsm", ".xlsb", ".ods"}:
        with ZipFile(BytesIO(data)) as archive:
            members = archive.infolist()
            if len(members) > 10000 or sum(item.file_size for item in members) > 80 * 1024 * 1024:
                raise ValueError("Слишком большой архив таблицы")
            if any(item.flag_bits & 1 for item in members):
                raise ValueError("Таблицы с паролем не поддерживаются")
    if suffix == ".xls" and not data.startswith(bytes.fromhex("D0CF11E0A1B11AE1")):
        raise ValueError("Содержимое файла не соответствует формату XLS")
    if suffix in {".csv", ".tsv"} and b"\0" in data:
        raise ValueError("Текстовая таблица содержит двоичные данные")

    with TemporaryDirectory() as base:
        path = Path(base) / ("products" + suffix)
        path.write_bytes(data)
        frame = read_spreadsheet(str(path))

    if frame.empty or len(frame) > 3000 or len(frame.columns) > 100:
        raise ValueError("Таблица должна содержать от 1 до 3000 строк и не больше 100 столбцов")
    frame.columns = [str(column).strip().casefold() for column in frame.columns]
    columns = {key: next((column for column in frame.columns if column in aliases), None)
               for key, aliases in COLUMN_ALIASES.items()}
    if not columns["name"]:
        raise ValueError("Добавьте столбец «Наименование»")
    rows, errors, warnings = [], [], []
    for number, (_, row) in enumerate(frame.iterrows(), 2):
        def cell(key):
            value = row.get(columns[key])
            return str(value).replace("\xa0", " ").strip() if not pd.isna(value) else ""

        if row.dropna().empty:
            continue
        name, category, subcategory = cell("name"), cell("category") or "Без категории", cell("subcategory")
        sku, description = cell("article"), cell("desc")
        if not name or len(name) > 500 or max(len(category),len(subcategory)) > 255 or len(sku) > 100 or len(description) > 12000:
            errors.append(f"Строка {number}: отсутствует название или превышена длина поля")
            continue
        try:
            raw_price, raw_pack = cell("price"), cell("pack_size")
            price = Decimal(raw_price.replace(" ", "").replace("₽", "").replace("$", "").replace(",", ".") or "0")
            packs = Decimal(raw_pack.replace(" ", "").replace(",", ".") or "1")
            if not price.is_finite() or not 0 <= price <= Decimal("99999999.99") or price != price.quantize(Decimal(".01")):
                raise ValueError
            if not packs.is_finite() or not 1 <= packs <= 100000 or packs != int(packs):
                raise ValueError
        except (ValueError, InvalidOperation):
            errors.append(f"Строка {number}: укажите цену с точностью до копеек и целую фасовку больше нуля")
            continue
        if not raw_price:
            warnings.append(f"Строка {number}: пустая цена будет записана как 0 ₽")
        rows.append({"line":number,"name":name,"category":category,"subcategory":subcategory,"sku":sku or None,
                     "description":description or None,"price":str(price),"packs":int(packs)})
    if not rows and not errors:
        errors.append("В таблице нет товаров")
    return rows, errors, warnings


async def plan(db: AsyncSession, rows: list[dict]):
    category_names = {row["category"] for row in rows}
    categories = {}
    for category in (await db.scalars(select(Category).where(Category.name.in_(category_names)).order_by(Category.id))).all():
        categories.setdefault(category.name, category)
    products = {}
    for product in (await db.scalars(select(Product).where(Product.category_id.in_([category.id for category in categories.values()]),
            Product.name.in_({row["name"] for row in rows})).order_by(Product.id))).all():
        products.setdefault((product.category_id, product.name), []).append(product)
    seen = {}
    matches, errors = [], []
    for row in rows:
        key = (row["category"],row["name"])
        skus = seen.setdefault(key,set())
        sku = row["sku"]
        if sku in skus or (skus and sku is None) or None in skus:
            errors.append(f"Строка {row['line']}: повторная или неоднозначная позиция")
        skus.add(sku)
        category = categories.get(row["category"])
        candidates = [p for p in products.get((category.id,row["name"]),[]) if not sku or sku==p.sku] if category else []
        if len(candidates)>1:
            errors.append(f"Строка {row['line']}: найдено несколько одинаковых товаров")
        matches.append((category, candidates[0] if candidates else None))
    signature = digest(json.dumps(
        [(category.id if category else None, bool(category and category.active), product.id if product else None,
          str(product.updated_at) if product else None) for category, product in matches]))
    return matches, errors, signature


@router.get("/template")
async def template():
    return await get_excel_template()


@router.post("")
async def preview(file: UploadFile, staff: Staff = Depends(admin_only), db: AsyncSession = Depends(get_db)):
    suffix = Path(file.filename or "").suffix.lower()
    data = await file.read(LIMIT+1)
    if suffix not in FORMATS or not 0 < len(data) <= LIMIT:
        raise HTTPException(400, "Выберите поддерживаемую таблицу размером до 10 МБ")
    try:
        rows, errors, warnings = await run_in_threadpool(spreadsheet, suffix, data)
    except (ValueError, BadZipFile) as error:
        message = str(error) if str(error) in {
            "Слишком большой архив таблицы","Таблицы с паролем не поддерживаются","Содержимое файла не соответствует формату XLS",
            "Текстовая таблица содержит двоичные данные","Таблица должна содержать от 1 до 3000 строк и не больше 100 столбцов",
            "Добавьте столбец «Наименование»"} else "Проверьте формат и содержимое таблицы"
        raise HTTPException(400,message) from error
    except Exception as error:
        raise HTTPException(400,"Не удалось прочитать таблицу") from error
    matches, conflicts, fingerprint = await plan(db,rows)
    errors.extend(conflicts)
    key = str(uuid4())
    if rows and not errors:
        db.add(ImportPreview(id=key,staff_id=staff.id,expires_at=datetime.utcnow()+timedelta(hours=1),rows=rows,fingerprint=fingerprint))
        await db.commit()
    updated = sum(product is not None for _,product in matches)
    return {"id":key,"added":len(rows)-updated,"updated":updated,"errors":errors,"warnings":warnings}


@router.post("/{key}")
async def apply(key: str, staff: Staff = Depends(admin_only), db: AsyncSession = Depends(get_db)):
    await begin_write(db)
    preview = await db.get(ImportPreview,key)
    if not preview or preview.staff_id != staff.id or preview.expires_at <= datetime.utcnow():
        raise HTTPException(404,"Предпросмотр недоступен. Загрузите файл ещё раз.")
    matches, errors, fingerprint = await plan(db,preview.rows)
    if errors or preview.fingerprint != fingerprint:
        raise HTTPException(409,"Каталог изменился после проверки. Проверьте файл ещё раз.")
    categories, children = {}, {}
    for row,(known, product) in zip(preview.rows,matches,strict=True):
        name = row["category"]
        category = categories.get(name) or known
        if category is None:
            category = Category(name=name,active=True)
            db.add(category)
            await db.flush()
        category.active = True
        categories[name] = category
        child = None
        if row["subcategory"]:
            name = row["subcategory"]
            key_child = (category.id,name)
            child = children.get(key_child)
            if child is None:
                child = await db.scalar(select(Subcategory).where(Subcategory.category_id==category.id,Subcategory.name==name).order_by(Subcategory.id))
            if child is None:
                child = Subcategory(name=name,category_id=category.id,active=True)
                db.add(child)
                await db.flush()
            child.active = True
            children[key_child] = child
        if product is None:
            product = Product(name=row["name"],category_id=category.id)
            db.add(product)
        product.subcategory_id = child.id if child else None
        product.sku = row["sku"]
        product.description = row["description"]
        product.price_per_unit = Decimal(row["price"])
        product.pieces_per_pack = row["packs"]
        product.active = True
    await db.delete(preview)
    audit(db,staff,"import.apply",key)
    await db.commit()
    return {"ok":True}
