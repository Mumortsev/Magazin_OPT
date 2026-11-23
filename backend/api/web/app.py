"""Same-origin storefront and versioned web API."""
import asyncio
from contextlib import asynccontextmanager, suppress
import html
import os
from pathlib import Path
import re

from fastapi import Depends, FastAPI, HTTPException, Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import FileResponse, HTMLResponse, JSONResponse
from fastapi.staticfiles import StaticFiles
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from ..database import AsyncSessionLocal, get_db
from ..routes.images import get_image
from . import catalog, imports, notifications, orders, security
from .models import Staff

SOURCE = Path(__file__).resolve().parents[3] / "storefront"
DIST = Path(os.getenv("SHOP_DIST_DIR", SOURCE / "dist"))
API_BODY_LIMIT = 11 * 1024 * 1024


@asynccontextmanager
async def lifespan(_app):
    from urllib.parse import urlsplit
    origin = urlsplit(security.ORIGIN)
    if origin.username or origin.password or origin.path or origin.query or origin.fragment or not origin.hostname:
        raise RuntimeError("SHOP_ORIGIN must be a single origin")
    if not security.HTTPS and (origin.scheme != "http" or origin.hostname not in {"localhost", "127.0.0.1", "::1"}):
        raise RuntimeError("SHOP_ORIGIN must use HTTPS outside local development")
    async with AsyncSessionLocal() as db:
        await db.execute(select(Staff.id).limit(1))
    catalog.MEDIA.mkdir(parents=True, exist_ok=True)
    worker = asyncio.create_task(notifications.delivery_worker())
    try:
        yield
    finally:
        worker.cancel()
        with suppress(asyncio.CancelledError):
            await worker


app = FastAPI(title="Курортник", version="1.0", lifespan=lifespan, docs_url=None, redoc_url=None, openapi_url=None)
for router in (catalog.public, orders.public, security.router, catalog.admin, orders.admin, imports.router, notifications.router):
    app.include_router(router)


class BodyLimit:
    """Bound uploads before multipart parsing, including requests without Content-Length."""
    def __init__(self, wrapped):
        self.wrapped = wrapped

    async def __call__(self, scope, receive, send):
        if scope["type"] != "http" or scope.get("method") not in {"POST","PUT","PATCH"}:
            await self.wrapped(scope,receive,send)
            return
        if scope.get("path","") in {"/api/v1/admin/images","/api/v1/admin/import"}:
            limit = API_BODY_LIMIT
        elif scope.get("path") == "/api/v1/admin/content":
            limit = 1024 * 1024
        else:
            limit = 64 * 1024
        length = dict(scope.get("headers",[])).get(b"content-length")
        if length is not None and (not length.isdigit() or len(length)>12 or int(length)>limit):
            await JSONResponse({"detail":"Размер запроса превышает ограничение"},status_code=413)(scope,receive,send)
            return
        received = 0
        async def bounded_receive():
            nonlocal received
            chunk = await receive()
            received += len(chunk.get("body",b""))
            if received > limit:
                raise HTTPException(413,"Размер запроса превышает ограничение")
            return chunk
        await self.wrapped(scope,bounded_receive,send)


app.add_middleware(BodyLimit)


@app.exception_handler(RequestValidationError)
async def invalid(_request, error):
    fields = {"name":"имя","phone":"телефон","organization":"организацию","comment":"комментарий",
              "items":"товары и количество упаковок","price_per_unit":"цену","images":"фотографии"}
    field = next((fields[name] for item in error.errors() for name in item["loc"] if name in fields), None)
    return JSONResponse({"detail":f"Проверьте {field}" if field else "Проверьте введённые данные"}, status_code=422)


@app.middleware("http")
async def headers(request: Request, call_next):
    response = await call_next(request)
    response.headers["X-Content-Type-Options"] = "nosniff"
    response.headers["Referrer-Policy"] = "same-origin"
    response.headers["X-Frame-Options"] = "SAMEORIGIN"
    if request.url.path.startswith(("/api/v1","/admin")):
        response.headers["Cache-Control"] = "no-store"
    elif request.url.path.startswith(("/uploads/","/assets/")) and response.status_code < 400:
        response.headers["Cache-Control"] = "public, max-age=86400"
    return response


@app.get("/health")
async def health():
    return {"status":"healthy"}


@app.get("/api/images/{file_id}")
async def legacy_image(file_id: str, request: Request):
    if not re.fullmatch(r"[A-Za-z0-9_-]{10,255}",file_id):
        raise HTTPException(404)
    await security.limit(request,"legacy-images",240,60)
    return await get_image(file_id)


@app.get("/admin/push-sw.js")
async def worker_script():
    return FileResponse(DIST / "push-sw.js", media_type="text/javascript", headers={"Service-Worker-Allowed":"/admin/"})


@app.get("/admin")
@app.get("/admin/")
@app.get("/admin/orders/{order_id}")
async def admin_page():
    return FileResponse(DIST / "index.html", headers={"X-Robots-Tag":"noindex"})


@app.get("/")
async def index(db: AsyncSession = Depends(get_db)):
    content = await catalog.get_content(db)
    index = (DIST / "index.html").read_text()
    index = re.sub(r"<title>.*?</title>",lambda _:f"<title>{html.escape(content.title)}</title>",index, count=1)
    index = re.sub(r'<meta name="description"[^>]*>',lambda _:f'<meta name="description" content="{html.escape(content.description,quote=True)}">',index,count=1)
    index = re.sub(r'<meta property="og:title"[^>]*>',lambda _:f'<meta property="og:title" content="{html.escape(content.title,quote=True)}">',index,count=1)
    index = re.sub(r'<meta property="og:description"[^>]*>',lambda _:f'<meta property="og:description" content="{html.escape(content.description,quote=True)}">',index,count=1)
    return HTMLResponse(index,headers={"Cache-Control":"no-cache"})


app.mount("/uploads",StaticFiles(directory=catalog.MEDIA,check_dir=False),name="uploads")
app.mount("/",StaticFiles(directory=DIST,check_dir=False),name="storefront")
