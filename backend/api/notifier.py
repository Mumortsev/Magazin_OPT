"""
Notification utility to send messages to Telegram admins.
Refactored to use httpx instead of aiogram to avoid dependency issues in API.
"""
import os
import httpx
import logging
from typing import List
from dotenv import load_dotenv

load_dotenv()

BOT_TOKEN = os.getenv("BOT_TOKEN")
# Parse ADMIN_IDS safely
try:
    ADMIN_IDS = [int(x.strip()) for x in os.getenv("ADMIN_IDS", "").split(",") if x.strip()]
except ValueError:
    print("Error parsing ADMIN_IDS")
    ADMIN_IDS = []

async def notify_new_order(order_data: dict, items: List[dict]):
    """
    Send notification about new order to all admins and the client.
    Generates a PDF order summary and sends it as a document.
    """
    from .pdf_generator import generate_order_pdf
    from .whatsapp_service import whatsapp_service

    # 1. Generate PDF
    pdf_path = None
    try:
        pdf_path = await generate_order_pdf(order_data, items)
        print(f"Generated PDF for order #{order_data.get('id')} at {pdf_path}")
    except Exception as e:
        print(f"Error generating PDF for order #{order_data.get('id')}: {e}")

    # Format message
    items_text = ""
    for item in items:
        # Calculate pieces per pack for display
        per_pack = int(item['quantity_pieces'] / item['quantity_packs']) if item['quantity_packs'] > 0 else 1
        p_name = str(item['product_name']).replace("<", "&lt;").replace(">", "&gt;")
        if item.get('product_sku'):
            p_name += f" (Арт: {item['product_sku']})"
            
        items_text += (
            f"• {p_name}: {item['quantity_packs']} шт "
            f"({per_pack} шт./уп.) × {item['price_per_unit']}₽ = {item['subtotal']}₽\n"
        )

    org = order_data.get("customer_organization")
    org_text = f"\n🏢 {org}" if org else ""
    
    comment = order_data.get("customer_comment")
    comment_text = f"\n📝 <b>Комментарий:</b> <i>{str(comment).replace('<', '&lt;')}</i>" if comment else ""
    
    c_name = str(order_data.get('customer_name', 'Unknown')).replace("<", "&lt;")
    platform_name = "WhatsApp" if order_data.get("platform") == "whatsapp" else "Telegram"
    
    message = (
        f"🆕 <b>Новый заказ #{order_data.get('id')} ({platform_name})</b>\n"
        f"👤 {c_name}{org_text}\n"
        f"📱 {order_data.get('customer_phone')}{comment_text}\n\n"
        f"<b>Товары:</b>\n{items_text}\n"
        f"<b>💰 Итого: {order_data.get('total_amount')}₽</b>"
    )

    # 2. Notify Admins in Telegram
    if BOT_TOKEN and ADMIN_IDS:
        api_url = f"https://api.telegram.org/bot{BOT_TOKEN}/sendMessage"
        doc_url = f"https://api.telegram.org/bot{BOT_TOKEN}/sendDocument"
        
        async with httpx.AsyncClient(timeout=15.0) as client:
            for admin_id in ADMIN_IDS:
                try:
                    # Send text message
                    payload = {
                        "chat_id": admin_id,
                        "text": message,
                        "parse_mode": "HTML"
                    }
                    await client.post(api_url, json=payload)
                    
                    # Send PDF document
                    if pdf_path and os.path.exists(pdf_path):
                        with open(pdf_path, "rb") as f:
                            files = {"document": (f"Order_{order_data.get('id')}.pdf", f, "application/pdf")}
                            data = {"chat_id": admin_id, "caption": f"PDF-заказ #{order_data.get('id')}"}
                            await client.post(doc_url, data=data, files=files)
                except Exception as e:
                    print(f"Error sending notification to admin {admin_id}: {e}")

    # 3. Notify Client on Telegram (if ordered via TG)
    tg_user_id = order_data.get("telegram_user_id")
    if tg_user_id and str(tg_user_id) != "0" and order_data.get("platform") != "whatsapp":
        if BOT_TOKEN:
            api_url = f"https://api.telegram.org/bot{BOT_TOKEN}/sendMessage"
            doc_url = f"https://api.telegram.org/bot{BOT_TOKEN}/sendDocument"
            client_msg = (
                f"🌸 <b>Спасибо за ваш заказ #{order_data.get('id')}!</b>\n"
                f"Наш менеджер свяжется с вами в ближайшее время.\n\n"
                f"<b>Ваш заказ:</b>\n{items_text}\n"
                f"<b>💰 Итого: {order_data.get('total_amount')}₽</b>\n\n"
                f"Ниже прикреплен файл вашего заказа."
            )
            async with httpx.AsyncClient(timeout=15.0) as client:
                try:
                    await client.post(api_url, json={"chat_id": tg_user_id, "text": client_msg, "parse_mode": "HTML"})
                    if pdf_path and os.path.exists(pdf_path):
                        with open(pdf_path, "rb") as f:
                            files = {"document": (f"Order_{order_data.get('id')}.pdf", f, "application/pdf")}
                            data = {"chat_id": tg_user_id, "caption": f"Заказ #{order_data.get('id')}"}
                            await client.post(doc_url, data=data, files=files)
                except Exception as e:
                    print(f"Error sending receipt to Telegram client {tg_user_id}: {e}")

    # 4. Notify Client on WhatsApp (if ordered via WhatsApp)
    wa_phone = order_data.get("whatsapp_phone")
    if wa_phone and order_data.get("platform") == "whatsapp":
        try:
            webapp_url = os.getenv("WEBAPP_URL", "http://localhost:3000")
            pdf_filename = f"order_{order_data.get('id')}.pdf"
            public_pdf_url = f"{webapp_url}/static/pdfs/{pdf_filename}"
            
            # Format product list without HTML tags for WhatsApp
            items_text_wa = items_text.replace("<b>", "*").replace("</b>", "*").replace("<i>", "_").replace("</i>", "_")
            items_text_wa = items_text_wa.replace("&lt;", "<").replace("&gt;", ">")
            
            client_msg = (
                f"🌸 *Спасибо за ваш заказ #{order_data.get('id')}!*\n"
                f"Наш менеджер свяжется с вами в ближайшее время.\n\n"
                f"*Ваш заказ:*\n{items_text_wa}\n"
                f"*💰 Итого: {order_data.get('total_amount')}₽*"
            )
            # Send text
            await whatsapp_service.send_text_message(wa_phone, client_msg)
            
            # Send document
            await whatsapp_service.send_document_message(
                to_phone=wa_phone,
                document_url=public_pdf_url,
                filename=pdf_filename,
                caption=f"Детали заказа #{order_data.get('id')}"
            )
        except Exception as e:
            print(f"Error sending receipt to WhatsApp client {wa_phone}: {e}")

    # 5. Notify Admins via Web Push
    try:
        await send_admin_web_pushes(order_data)
    except Exception as e:
        print(f"Error calling send_admin_web_pushes: {e}")

    # 6. Notify Admins via Android FCM Push
    try:
        await send_fcm_push(order_data)
    except Exception as e:
        print(f"Error calling send_fcm_push: {e}")


async def send_admin_web_pushes(order_data: dict):
    from .database import AsyncSessionLocal
    from .models import PushSubscription
    from sqlalchemy import select, delete
    import json
    import asyncio
    from pywebpush import webpush, WebPushException

    admin_phones = [f"admin_{admin_id}" for admin_id in ADMIN_IDS]
    if not admin_phones:
        return

    async with AsyncSessionLocal() as session:
        try:
            stmt = select(PushSubscription).where(PushSubscription.phone.in_(admin_phones))
            result = await session.execute(stmt)
            subs = result.scalars().all()
        except Exception as e:
            print(f"Error fetching admin subscriptions: {e}")
            return

        if not subs:
            return

        platform_name = "WhatsApp" if order_data.get("platform") == "whatsapp" else "Telegram"
        payload = {
            "title": "🆕 Новый заказ!",
            "body": f"Заказ #{order_data.get('id')} на сумму {order_data.get('total_amount')}₽ ({platform_name})",
            "icon": "/assets/icons/admin-icon-512x512.png",
            "data": {
                "orderId": order_data.get("id"),
                "url": "/admin.html"
            }
        }
        payload_data = json.dumps(payload, ensure_ascii=False)

        vapid_private_key = os.getenv("VAPID_PRIVATE_KEY")
        vapid_claims = {"sub": os.getenv("VAPID_CLAIM_EMAIL", "mailto:owner@yandex.ru")}

        if not vapid_private_key:
            print("VAPID_PRIVATE_KEY not set, skipping admin web push")
            return

        loop = asyncio.get_event_loop()

        for sub in subs:
            subscription_info = {
                "endpoint": sub.endpoint,
                "keys": {
                    "p256dh": sub.p256dh,
                    "auth": sub.auth
                }
            }
            try:
                def do_push():
                    return webpush(
                        subscription_info=subscription_info,
                        data=payload_data,
                        vapid_private_key=vapid_private_key,
                        vapid_claims=vapid_claims,
                        ttl=86400
                    )
                await loop.run_in_executor(None, do_push)
                print(f"Sent admin push notification to sub {sub.id}")
            except WebPushException as ex:
                print(f"WebPushException for admin subscription {sub.id}: {ex}")
                if ex.response is not None and ex.response.status_code in [404, 410]:
                    # delete expired
                    try:
                        await session.execute(
                            delete(PushSubscription).where(PushSubscription.id == sub.id)
                        )
                        await session.commit()
                        print(f"Deleted expired admin subscription {sub.id}")
                    except Exception as db_ex:
                        print(f"Error deleting expired subscription: {db_ex}")
            except Exception as e:
                print(f"Error sending admin push: {e}")


firebase_app = None

def init_firebase():
    global firebase_app
    if firebase_app is not None:
        return firebase_app
    
    import firebase_admin
    from firebase_admin import credentials
    
    possible_paths = [
        "firebase-service-account.json",
        "backend/firebase-service-account.json",
        "/app/firebase-service-account.json"
    ]
    
    current_dir = os.path.dirname(os.path.abspath(__file__))
    parent_dir = os.path.dirname(current_dir)
    possible_paths.append(os.path.join(parent_dir, "firebase-service-account.json"))
    
    for path in possible_paths:
        if os.path.exists(path):
            try:
                cred = credentials.Certificate(path)
                try:
                    firebase_app = firebase_admin.get_app()
                except ValueError:
                    firebase_app = firebase_admin.initialize_app(cred)
                logging.info(f"Successfully initialized Firebase Admin from {path}")
                return firebase_app
            except Exception as e:
                logging.error(f"Error initializing Firebase from {path}: {e}")
                
    logging.warning("No firebase-service-account.json credentials found, FCM push notifications disabled.")
    return None

async def send_fcm_push(order_data: dict):
    """
    Send push notification to Android admins via Firebase Cloud Messaging.
    """
    try:
        app = init_firebase()
        if not app:
            return
            
        from firebase_admin import messaging
        from .database import AsyncSessionLocal
        from .models import FcmToken
        from sqlalchemy import select, delete
        import asyncio
        
        async with AsyncSessionLocal() as session:
            stmt = select(FcmToken).where(FcmToken.role == "admin")
            result = await session.execute(stmt)
            tokens = result.scalars().all()
            
            if not tokens:
                print("[FCM] No admin FCM tokens registered, skipping push.")
                return
                
            platform_name = "WhatsApp" if order_data.get("platform") == "whatsapp" else "Telegram"
            title = "🆕 Новый заказ!"
            body = f"Заказ #{order_data.get('id')} на сумму {order_data.get('total_amount')}₽ ({platform_name})"
            
            loop = asyncio.get_event_loop()
            
            for t in tokens:
                message = messaging.Message(
                    notification=messaging.Notification(
                        title=title,
                        body=body
                    ),
                    data={
                        "order_id": str(order_data.get("id")),
                        "click_action": "FLUTTER_NOTIFICATION_CLICK"
                    },
                    token=t.token
                )
                
                try:
                    def do_send():
                        return messaging.send(message)
                    response = await loop.run_in_executor(None, do_send)
                    print(f"[FCM] Push sent successfully to token {t.id}: {response}")
                except messaging.UnregisteredError:
                    print(f"[FCM] Token {t.id} is unregistered, deleting from DB.")
                    try:
                        await session.execute(delete(FcmToken).where(FcmToken.id == t.id))
                        await session.commit()
                    except Exception as db_ex:
                        logging.error(f"Error deleting expired FCM token: {db_ex}")
                except Exception as e:
                    logging.error(f"Error sending FCM push to token {t.id}: {e}")
    except Exception as general_ex:
        logging.error(f"Error in send_fcm_push: {general_ex}")


