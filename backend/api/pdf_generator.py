"""
PDF Order Generator using ReportLab.
Supports Russian Cyrillic fonts and includes product images.
"""
import os
import httpx
import logging
from typing import List, Dict, Any, Optional
from pathlib import Path
import tempfile

from reportlab.lib.pagesizes import letter, A4
from reportlab.lib import colors
from reportlab.platypus import SimpleDocTemplate, Paragraph, Spacer, Table, TableStyle, Image
from reportlab.lib.styles import getSampleStyleSheet, ParagraphStyle
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont

logger = logging.getLogger(__name__)

# Directory where PDFs will be stored and exposed statically
is_docker = os.path.exists("/data")
if is_docker:
    STATIC_PDF_DIR = Path("/data/static/pdfs")
    UPLOAD_DIR = Path("/data/uploads")
else:
    STATIC_PDF_DIR = Path(__file__).resolve().parent.parent / "static" / "pdfs"
    UPLOAD_DIR = Path(__file__).resolve().parent.parent / "static" / "uploads"

os.makedirs(STATIC_PDF_DIR, exist_ok=True)

# Register font with Cyrillic support
FONT_NAME = "DejaVuSans"

def setup_pdf_font():
    """Download or locate a TTF font with Cyrillic support and register it."""
    font_registered = False
    
    # List of possible local font paths
    paths_to_try = [
        # Windows standard path
        "C:\\Windows\\Fonts\\arial.ttf",
        "C:\\Windows\\Fonts\\tahoma.ttf",
        # Linux standard paths
        "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf",
        "/usr/share/fonts/truetype/liberation/LiberationSans-Regular.ttf",
    ]
    
    for path in paths_to_try:
        if os.path.exists(path):
            try:
                pdfmetrics.registerFont(TTFont(FONT_NAME, path))
                logger.info(f"Registered local font from: {path}")
                font_registered = True
                break
            except Exception as e:
                logger.warning(f"Failed to register local font at {path}: {e}")

    # Fallback: Download DejaVuSans from public repository if no local fonts found
    if not font_registered:
        local_font_path = Path(__file__).parent.parent / "data" / "DejaVuSans.ttf"
        os.makedirs(local_font_path.parent, exist_ok=True)
        
        if not local_font_path.exists():
            logger.info("Cyrillic font not found. Downloading DejaVuSans.ttf...")
            try:
                url = "https://raw.githubusercontent.com/dejavu-fonts/dejavu-fonts/master/resources/DejaVuSans.ttf"
                response = httpx.get(url, follow_redirects=True, timeout=30.0)
                if response.status_code == 200:
                    with open(local_font_path, "wb") as f:
                        f.write(response.content)
                    logger.info("Successfully downloaded DejaVuSans.ttf")
                else:
                    logger.error(f"Failed to download font: HTTP {response.status_code}")
            except Exception as e:
                logger.error(f"Error downloading font: {e}")
                
        if local_font_path.exists():
            try:
                pdfmetrics.registerFont(TTFont(FONT_NAME, str(local_font_path)))
                logger.info(f"Registered downloaded font: {local_font_path}")
                font_registered = True
            except Exception as e:
                logger.error(f"Failed to register downloaded font: {e}")
                
    if not font_registered:
        logger.error("Could not register any Cyrillic font. PDF generation might fail with Russian characters!")


# Run font setup
setup_pdf_font()


async def get_image_file_path(image_ref: Optional[str], bot_token: Optional[str]) -> Optional[str]:
    """
    Get a local file path for the product image.
    Downloads Telegram file_ids or external URLs if necessary.
    """
    if not image_ref:
        return None

    # Case 1: Local upload path (e.g. /uploads/... or /static/uploads/...)
    if image_ref.startswith("/uploads/") or image_ref.startswith("/static/uploads/"):
        filename = image_ref.split("/")[-1]
        local_path = UPLOAD_DIR / filename
        if local_path.exists():
            return str(local_path)
            
    # Case 2: Telegram file_id (doesn't contain slashes or HTTP)
    if not image_ref.startswith("http") and not image_ref.startswith("/") and len(image_ref) > 20:
        if not bot_token:
            bot_token = os.getenv("BOT_TOKEN")
        if bot_token:
            try:
                async with httpx.AsyncClient(timeout=10.0) as client:
                    # Get file path from Telegram
                    res = await client.get(
                        f"https://api.telegram.org/bot{bot_token}/getFile",
                        params={"file_id": image_ref}
                    )
                    data = res.json()
                    if data.get("ok"):
                        file_path = data["result"]["file_path"]
                        file_url = f"https://api.telegram.org/file/bot{bot_token}/{file_path}"
                        
                        # Download image to a temp file
                        img_res = await client.get(file_url)
                        if img_res.status_code == 200:
                            suffix = "." + file_path.split(".")[-1] if "." in file_path else ".jpg"
                            temp_file = tempfile.NamedTemporaryFile(delete=False, suffix=suffix)
                            temp_file.write(img_res.content)
                            temp_file.close()
                            return temp_file.name
            except Exception as e:
                logger.error(f"Failed to fetch Telegram image {image_ref} for PDF: {e}")

    # Case 3: External HTTP(S) URL
    if image_ref.startswith("http"):
        try:
            async with httpx.AsyncClient(timeout=10.0) as client:
                res = await client.get(image_ref)
                if res.status_code == 200:
                    suffix = "." + image_ref.split(".")[-1].split("?")[0] if "." in image_ref else ".jpg"
                    temp_file = tempfile.NamedTemporaryFile(delete=False, suffix=suffix)
                    temp_file.write(res.content)
                    temp_file.close()
                    return temp_file.name
        except Exception as e:
            logger.error(f"Failed to fetch external image {image_ref} for PDF: {e}")

    return None


async def generate_order_pdf(order_data: Dict[str, Any], items: List[Dict[str, Any]]) -> str:
    """
    Generate an order PDF and save it in static files.
    Returns the absolute path to the generated file.
    """
    order_id = order_data.get("id", "0")
    pdf_filename = f"order_{order_id}.pdf"
    pdf_path = STATIC_PDF_DIR / pdf_filename
    
    doc = SimpleDocTemplate(
        str(pdf_path),
        pagesize=A4,
        rightMargin=30,
        leftMargin=30,
        topMargin=30,
        bottomMargin=30
    )
    
    styles = getSampleStyleSheet()
    
    # Custom styles using Cyrillic-capable font
    style_title = ParagraphStyle(
        'DocTitle',
        parent=styles['Heading1'],
        fontName=FONT_NAME,
        fontSize=18,
        leading=22,
        spaceAfter=15,
        textColor=colors.HexColor("#1A1A2E")
    )
    
    style_heading = ParagraphStyle(
        'DocHeading',
        parent=styles['Heading3'],
        fontName=FONT_NAME,
        fontSize=12,
        leading=16,
        spaceAfter=6,
        textColor=colors.HexColor("#1A1A2E")
    )
    
    style_normal = ParagraphStyle(
        'DocNormal',
        parent=styles['Normal'],
        fontName=FONT_NAME,
        fontSize=10,
        leading=14,
        spaceAfter=4
    )
    
    style_table_header = ParagraphStyle(
        'TableHeader',
        parent=styles['Normal'],
        fontName=FONT_NAME,
        fontSize=9,
        leading=11,
        textColor=colors.white,
        alignment=1  # Centered
    )
    
    style_table_cell = ParagraphStyle(
        'TableCell',
        parent=styles['Normal'],
        fontName=FONT_NAME,
        fontSize=9,
        leading=12
    )

    style_table_cell_center = ParagraphStyle(
        'TableCellCenter',
        parent=styles['Normal'],
        fontName=FONT_NAME,
        fontSize=9,
        leading=12,
        alignment=1  # Centered
    )

    story = []
    
    # Title
    story.append(Paragraph(f"Заказ №{order_id}", style_title))
    
    # Date formatting
    created_at = order_data.get("created_at")
    date_str = ""
    if created_at:
        try:
            if isinstance(created_at, str):
                date_str = created_at.split("T")[0]
            else:
                date_str = created_at.strftime("%Y-%m-%d %H:%M")
        except Exception:
            date_str = str(created_at)
            
    # Client Info block
    platform_name = "WhatsApp" if order_data.get("platform") == "whatsapp" else "Telegram"
    
    info_text = (
        f"<b>Дата заказа:</b> {date_str}<br/>"
        f"<b>Источник:</b> {platform_name}<br/>"
        f"<b>Клиент:</b> {order_data.get('customer_name')}<br/>"
        f"<b>Телефон:</b> {order_data.get('customer_phone')}<br/>"
    )
    if order_data.get("customer_organization"):
        info_text += f"<b>Организация:</b> {order_data.get('customer_organization')}<br/>"
    if order_data.get("customer_comment"):
        info_text += f"<b>Комментарий:</b> {order_data.get('customer_comment')}<br/>"
        
    story.append(Paragraph(info_text, style_normal))
    story.append(Spacer(1, 15))
    
    story.append(Paragraph("Содержимое заказа:", style_heading))
    
    # Table headers
    headers = [
        Paragraph("Фото", style_table_header),
        Paragraph("Товар / Артикул", style_table_header),
        Paragraph("Кол-во (уп.)", style_table_header),
        Paragraph("Цена за шт.", style_table_header),
        Paragraph("Сумма", style_table_header)
    ]
    
    table_data = [headers]
    temp_files_to_cleanup = []
    
    # Load items and images
    bot_token = os.getenv("BOT_TOKEN")
    
    for item in items:
        # Resolve image path
        img_ref = item.get("product_image")
        local_img_path = await get_image_file_path(img_ref, bot_token)
        
        # If downloaded a temp file, register it for cleanup
        if local_img_path and not local_img_path.startswith(str(UPLOAD_DIR)):
            temp_files_to_cleanup.append(local_img_path)
            
        # Draw image flowable if image is available
        img_flowable = ""
        if local_img_path and os.path.exists(local_img_path):
            try:
                img_flowable = Image(local_img_path, width=45, height=45)
            except Exception as e:
                logger.error(f"Reportlab failed to load image {local_img_path}: {e}")
                img_flowable = "Ошибка фото"
        else:
            img_flowable = "Нет фото"

        sku_text = f"<br/><font color='#555555'>Арт: {item.get('product_sku')}</font>" if item.get("product_sku") else ""
        name_p = Paragraph(f"<b>{item.get('product_name')}</b>{sku_text}", style_table_cell)
        
        per_pack = int(item['quantity_pieces'] / item['quantity_packs']) if item.get('quantity_packs', 0) > 0 else 1
        qty_text = f"{item.get('quantity_packs')} уп.<br/><font color='#666666'>({item.get('quantity_pieces')} шт.)</font>"
        qty_p = Paragraph(qty_text, style_table_cell_center)
        
        price_p = Paragraph(f"{item.get('price_per_unit')}₽", style_table_cell_center)
        subtotal_p = Paragraph(f"<b>{item.get('subtotal')}₽</b>", style_table_cell_center)
        
        table_data.append([img_flowable, name_p, qty_p, price_p, subtotal_p])
        
    # Column widths
    col_widths = [60, 240, 80, 80, 80]
    
    product_table = Table(table_data, colWidths=col_widths)
    product_table.setStyle(TableStyle([
        ('BACKGROUND', (0, 0), (-1, 0), colors.HexColor("#1A1A2E")),
        ('ALIGN', (0, 0), (-1, -1), 'CENTER'),
        ('VALIGN', (0, 0), (-1, -1), 'MIDDLE'),
        ('TEXTCOLOR', (0, 0), (-1, 0), colors.white),
        ('GRID', (0, 0), (-1, -1), 0.5, colors.HexColor("#DDDDDD")),
        ('ROWBACKGROUNDS', (0, 1), (-1, -1), [colors.white, colors.HexColor("#F8F9FA")]),
        ('BOTTOMPADDING', (0, 0), (-1, -1), 6),
        ('TOPPADDING', (0, 0), (-1, -1), 6),
    ]))
    
    story.append(product_table)
    story.append(Spacer(1, 20))
    
    # Total block
    style_total = ParagraphStyle(
        'DocTotal',
        parent=styles['Normal'],
        fontName=FONT_NAME,
        fontSize=12,
        leading=16,
        alignment=2,  # Right aligned
        spaceAfter=15
    )
    story.append(Paragraph(f"<b>ИТОГО К ОПЛАТЕ: {order_data.get('total_amount')}₽</b>", style_total))
    
    # Build Document
    doc.build(story)
    
    # Cleanup temp files (downloaded images)
    for path in temp_files_to_cleanup:
        try:
            if os.path.exists(path):
                os.unlink(path)
        except Exception as e:
            logger.error(f"Error deleting temp image file {path}: {e}")
            
    return str(pdf_path)
