"""
FastAPI main application entry point.
"""
import os
from contextlib import asynccontextmanager
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from dotenv import load_dotenv

from .database import init_db
from .routes import categories, products, orders, images, admin, whatsapp, auth

load_dotenv()

import logging
from logging.handlers import RotatingFileHandler

# Configure logging to a file in the data directory with 5MB rotation
try:
    os.makedirs("data", exist_ok=True)
    log_file = os.path.join("data", "shop.log")
    
    # 5 MB = 5 * 1024 * 1024 bytes
    file_handler = RotatingFileHandler(
        log_file,
        maxBytes=5 * 1024 * 1024,
        backupCount=1,
        encoding="utf-8"
    )
    formatter = logging.Formatter(
        "%(asctime)s - %(name)s - %(levelname)s - %(message)s"
    )
    file_handler.setFormatter(formatter)
    file_handler.setLevel(logging.INFO)
    
    # Configure root logger
    root_logger = logging.getLogger()
    root_logger.setLevel(logging.INFO)
    # Avoid adding duplicate handlers if reloaded
    for h in root_logger.handlers[:]:
        if isinstance(h, RotatingFileHandler):
            root_logger.removeHandler(h)
    root_logger.addHandler(file_handler)
    
    # Configure uvicorn loggers to write to the same file
    for uvicorn_logger_name in ("uvicorn", "uvicorn.error", "uvicorn.access", "fastapi"):
        ul = logging.getLogger(uvicorn_logger_name)
        ul.addHandler(file_handler)
        
    logging.info("📝 Logging successfully configured to data/shop.log with 5MB rotation.")
except Exception as log_ex:
    print(f"Error configuring RotatingFileHandler: {log_ex}")

DEBUG = os.getenv("DEBUG", "false").lower() == "true"
WEBAPP_URL = os.getenv("WEBAPP_URL", "*")


@asynccontextmanager
async def lifespan(app: FastAPI):
    """Initialize database on startup."""
    await init_db()
    
    try:
        # Run schema fix (migration) first to ensure database tables have all necessary columns
        from .migration import check_and_fix_schema
        await check_and_fix_schema()

        # Run seeder after migration
        from .seeder import seed_categories
        await seed_categories()
        
        # Auto register Wazzup Webhook if needed with a delay to ensure server is listening
        try:
            from .routes.whatsapp import register_wazzup_webhook_if_needed
            import asyncio
            async def register_with_delay():
                await asyncio.sleep(5.0)  # Wait for uvicorn to start listening
                await register_wazzup_webhook_if_needed()
            asyncio.create_task(register_with_delay())
        except Exception as ex:
            print(f"Error calling Wazzup webhook registration: {ex}")
    except Exception as e:
        print(f"Error seeding/migrating/registering: {e}")
        
    yield


app = FastAPI(
    title="Telegram Shop API",
    description="Backend API for Telegram Mini App Store",
    version="1.0.0",
    lifespan=lifespan,
    docs_url="/docs" if DEBUG else None,
    redoc_url="/redoc" if DEBUG else None
)

# CORS middleware
# Telegram WebApp on Android sometimes sends strict Origin headers (e.g. tgwebapp:// or null)
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"], # Force allow all for Mini App
    allow_credentials=True, # Note: allow_credentials=True with allow_origins=["*"] is restricted in some FastAPI versions, but usually works if set correctly. If it fails, we set allow_origin_regex=".*"
    allow_origin_regex=".*", # Catch-all for tgwebapp:// and https://web.telegram.org
    allow_methods=["*"],
    allow_headers=["*"],
    expose_headers=["*"]
)
@app.middleware("http")
async def add_no_cache_header(request, call_next):
    response = await call_next(request)
    response.headers["Cache-Control"] = "no-cache, no-store, must-revalidate"
    response.headers["Pragma"] = "no-cache"
    response.headers["Expires"] = "0"
    return response

from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse
import os

# ... existing imports

# After app definition and middleware...

# Include routers
app.include_router(categories.router)
app.include_router(products.router)
app.include_router(orders.router)
app.include_router(images.router)
app.include_router(admin.router)
app.include_router(whatsapp.router)
app.include_router(auth.router)

@app.get("/health")
async def health():
    """Health check for Docker."""
    return {"status": "healthy"}

@app.get("/api/debug/info")
async def debug_info():
    """Debug endpoint to check paths and files."""
    import os
    from pathlib import Path
    
    current_file = Path(__file__).resolve()
    backend_root = current_file.parent.parent
    static_dir = backend_root / "static"
    uploads_dir = static_dir / "uploads"
    
    files = []
    if os.path.exists(uploads_dir):
        files = os.listdir(uploads_dir)
        
    token = os.getenv("WHATSAPP_ACCESS_TOKEN", "")
    phone_id = os.getenv("WHATSAPP_PHONE_NUMBER_ID", "")
    
    return {
        "current_file": str(current_file),
        "backend_root": str(backend_root),
        "static_dir": str(static_dir),
        "uploads_dir": str(uploads_dir),
        "uploads_exists": os.path.exists(uploads_dir),
        "files_count": len(files),
        "files_sample": files[:10],
        "cwd": os.getcwd(),
        "whatsapp_provider": os.getenv("WHATSAPP_API_PROVIDER", "meta").lower(),
        "whatsapp_phone_id": phone_id,
        "whatsapp_token_len": len(token),
        "whatsapp_token_prefix": token[:15] if token else None,
        "whatsapp_token_suffix": token[-15:] if token else None,
    }

@app.get("/debug-files")
async def debug_files_list():
    """List all files in static directory."""
    import os
    path = "/app/static"
    try:
        if os.path.exists(path):
            files = os.listdir(path)
            return {"path": path, "exists": True, "files": files}
        else:
            return {"path": path, "exists": False}
    except Exception as e:
        return {"error": str(e)}

# Serve Static Files (Frontend)
# Use absolute path to ensure consistency
from pathlib import Path

# Determine if running in Docker
is_docker = os.path.exists("/app/static")

if is_docker:
    static_dir = Path("/app/static")
    uploads_dir = Path("/app/static/uploads")
else:
    current_file = Path(__file__).resolve()
    backend_root = current_file.parent.parent
    # Try multiple ways to find project root
    project_root = backend_root.parent
    
    # Check common relative locations
    possible_frontends = [
        project_root / "frontend",
        backend_root / "../frontend",
        Path("C:/Antigravity/Project/frontend"), # Hardcoded fallback for this user's env
    ]
    
    frontend_dir = None
    for path in possible_frontends:
        if path.resolve().exists():
            frontend_dir = path.resolve()
            break
            
    if frontend_dir:
        static_dir = frontend_dir
        print(f"SUCCESS: Serving Frontend from: {static_dir}")
    else:
        static_dir = backend_root / "static"
        print(f"WARNING: Frontend not found, serving backend/static: {static_dir}")
        
    uploads_dir = static_dir / "uploads"

# Ensure both directories exist on startup
os.makedirs(static_dir, exist_ok=True)
os.makedirs(uploads_dir, exist_ok=True)
print(f"Active Static Directory: {static_dir}")

app.mount("/static", StaticFiles(directory=str(static_dir)), name="static_assets") 

# In Docker, mount persistent uploads from /data/uploads
if os.path.exists("/data"):
    persistent_uploads = Path("/data/uploads")
    os.makedirs(persistent_uploads, exist_ok=True)
    app.mount("/uploads", StaticFiles(directory=str(persistent_uploads)), name="persistent_uploads")
    print(f"Persistent Uploads mounted from: {persistent_uploads}") 

    persistent_pdfs = Path("/data/static/pdfs")
    os.makedirs(persistent_pdfs, exist_ok=True)
    app.mount("/static/pdfs", StaticFiles(directory=str(persistent_pdfs)), name="persistent_pdfs")
    print(f"Persistent PDFs mounted from: {persistent_pdfs}")

from .seeder import seed_categories
from .migration import check_and_fix_schema

@app.get("/debug/force-seed")
async def force_seed_db():
    """Forces the database seeding process."""
    try:
        await seed_categories()
        return {"status": "ok", "message": "Seeding initiated. Check logs."}
    except Exception as e:
        return {"status": "error", "message": str(e)}


@app.get("/debug/force-migrate")
async def force_migrate_db():
    """Forces the database migration manually."""
    try:
        await check_and_fix_schema()
        return {"status": "ok", "message": "Migration completed successfully. Columns added."}
    except Exception as e:
        return {"status": "error", "message": str(e)} 

@app.get("/")
async def serve_index():
    return FileResponse(static_dir / "index.html")

@app.get("/index.html")
async def serve_index_explicit():
    return FileResponse(static_dir / "index.html")

@app.get("/manifest.json")
async def serve_manifest():
    return FileResponse(static_dir / "manifest.json", media_type="application/json")

@app.get("/sw.js")
async def serve_sw():
    response = FileResponse(static_dir / "sw.js", media_type="application/javascript")
    response.headers["Service-Worker-Allowed"] = "/"
    return response

@app.get("/admin.html")
async def serve_admin():
    return FileResponse(static_dir / "admin.html")

@app.get("/api/debug/check-index")
async def debug_check_index():
    try:
        path = str(static_dir / "index.html")
        with open(path, "r", encoding="utf-8") as f:
            content = f.read()
        return {"path": path, "has_navHome": "navHome" in content, "has_20_0": "v=20.0" in content, "has_10_0": "v=10.0" in content, "length": len(content), "content_snippet": content[300:500]}
    except Exception as e:
        return {"error": str(e)}

@app.get("/api/debug/fix-frontend")
async def fix_frontend():
    """Download correct frontend files from GitHub and overwrite broken ones."""
    import httpx
    
    GITHUB_RAW = "https://raw.githubusercontent.com/Mumortsev/Kurortnik24/main"
    files_to_fix = [
        "index.html",
        "js/app.js",
        "js/api.js",
        "js/cart.js",
        "js/catalog.js",
        "css/styles_new.css",
        "css/catalog_append.css",
        "css/extra_styles.css",
        "admin.html",
        "js/admin.js",
        "css/admin.css",
    ]
    
    results = {}
    async with httpx.AsyncClient(timeout=30) as client:
        for filename in files_to_fix:
            try:
                url = f"{GITHUB_RAW}/frontend/{filename}"
                resp = await client.get(url)
                if resp.status_code == 200:
                    filepath = static_dir / filename
                    os.makedirs(filepath.parent, exist_ok=True)
                    with open(str(filepath), "w", encoding="utf-8") as f:
                        f.write(resp.text)
                    results[filename] = f"OK ({len(resp.text)} bytes)"
                else:
                    results[filename] = f"HTTP {resp.status_code}"
            except Exception as e:
                results[filename] = f"ERROR: {str(e)}"
    
    # Verify fix
    try:
        with open(str(static_dir / "index.html"), "r", encoding="utf-8") as f:
            content = f.read()
        results["_verify_navHome"] = "navHome" in content
        results["_verify_v20"] = "v=20.0" in content
        results["_verify_length"] = len(content)
    except Exception as e:
        results["_verify"] = str(e)
    
    return results

# Keep this as fallback for assets, but remove html=True to avoid conflicts
# Re-enabled to serve CSS/JS from root
app.mount("/", StaticFiles(directory=str(static_dir), html=False), name="static")









from pydantic import BaseModel
from sqlalchemy.ext.asyncio import AsyncSession
from .database import get_db
from .models import FcmToken
from datetime import datetime
from sqlalchemy import select
from fastapi import Depends, HTTPException

class FcmTokenRegisterRequest(BaseModel):
    token: str
    role: str = "admin"
    device_id: str

@app.post("/api/fcm-token")
async def register_fcm_token(
    payload: FcmTokenRegisterRequest,
    db: AsyncSession = Depends(get_db)
):
    """Register or update FCM Token for Android client."""
    try:
        stmt = select(FcmToken).where(FcmToken.device_id == payload.device_id)
        result = await db.execute(stmt)
        existing = result.scalar_one_or_none()
        
        if existing:
            existing.token = payload.token
            existing.role = payload.role
            existing.updated_at = datetime.utcnow()
            print(f"[FCM] Updated FCM token for device {payload.device_id}")
        else:
            new_token = FcmToken(
                device_id=payload.device_id,
                token=payload.token,
                role=payload.role
            )
            db.add(new_token)
            print(f"[FCM] Registered new FCM token for device {payload.device_id}")
            
        await db.commit()
        return {"status": "ok", "message": "FCM token registered successfully"}
    except Exception as e:
        print(f"[FCM] Error registering FCM token: {e}")
        raise HTTPException(status_code=500, detail=str(e))

@app.get("/api/debug/fcm-tokens")
async def list_fcm_tokens(db: AsyncSession = Depends(get_db)):
    try:
        stmt = select(FcmToken)
        result = await db.execute(stmt)
        tokens = result.scalars().all()
        return [{"id": t.id, "device_id": t.device_id, "role": t.role, "token_snippet": t.token[:20] + "..." if t.token else None, "updated_at": t.updated_at} for t in tokens]
    except Exception as e:
        return {"error": str(e)}

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(
        "api.main:app",
        host=os.getenv("API_HOST", "0.0.0.0"),
        port=int(os.getenv("API_PORT", 8000)),
        reload=DEBUG
    )
