"""
WhatsApp Webhook Router.
Handles Meta verification challenge and incoming WhatsApp messages from both Meta and Wazzup.
"""
import os
import hmac
import hashlib
import logging
from typing import Optional
from fastapi import APIRouter, Query, Request, Response, Depends, BackgroundTasks
from fastapi.responses import PlainTextResponse
import httpx

from ..whatsapp_service import whatsapp_service

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/api/whatsapp", tags=["whatsapp"])

def generate_phone_token(phone: str) -> str:
    """Generate a secure cryptographic token for authenticating a phone number."""
    secret = os.getenv("WHATSAPP_VERIFY_TOKEN", "kurortnik_verify_token_2026").encode()
    return hmac.new(secret, phone.encode(), hashlib.sha256).hexdigest()

def verify_phone_token(phone: str, token: str) -> bool:
    """Verify if the token matches the phone number."""
    expected_token = generate_phone_token(phone)
    return hmac.compare_digest(expected_token, token)

@router.get("/webhook", response_class=PlainTextResponse)
async def verify_webhook(
    hub_mode: Optional[str] = Query(None, alias="hub.mode"),
    hub_challenge: Optional[str] = Query(None, alias="hub.challenge"),
    hub_verify_token: Optional[str] = Query(None, alias="hub.verify_token")
):
    """
    Webhook verification endpoint for Meta Developers Console.
    Meta sends a GET request to verify the server ownership.
    """
    local_verify_token = os.getenv("WHATSAPP_VERIFY_TOKEN", "kurortnik_verify_token_2026")
    
    if hub_mode == "subscribe" and hub_verify_token == local_verify_token:
        logger.info("WhatsApp Webhook successfully verified!")
        return hub_challenge
    
    logger.warning("WhatsApp Webhook verification failed. Token mismatch.")
    return Response(content="Verification token mismatch", status_code=403)


async def handle_whatsapp_message_async(payload: dict):
    """Process incoming WhatsApp message in background (Meta or Wazzup)."""
    try:
        # Check if this is a Wazzup payload
        if "messages" in payload:
            messages = payload.get("messages", [])
            for msg in messages:
                # Wazzup fields
                # We only process messages from the client (not our own messages sent by manager)
                if msg.get("authorType") != "client":
                    continue
                    
                sender_phone = msg.get("chatId")
                if not sender_phone:
                    continue
                    
                text_body = msg.get("text", "").lower().strip()
                logger.info(f"Received Wazzup message from {sender_phone}: {text_body}")
                
                # Generate secure shop link
                token = generate_phone_token(sender_phone)
                dynamic_suffix = f"?platform=whatsapp&phone={sender_phone}&token={token}"
                
                components = [
                    {
                        "type": "button",
                        "sub_type": "url",
                        "index": "0",
                        "parameters": [
                            {
                                "type": "text",
                                "text": dynamic_suffix
                            }
                        ]
                    }
                ]
                
                await whatsapp_service.send_template_message(
                    to_phone=sender_phone,
                    template_name="shop_menu",
                    components=components
                )
            return

        # Fallback to Meta API payload
        entries = payload.get("entry", [])
        for entry in entries:
            changes = entry.get("changes", [])
            for change in changes:
                value = change.get("value", {})
                messages = value.get("messages", [])
                
                for msg in messages:
                    sender_phone = msg.get("from")  # e.g., "79180724040"
                    
                    if not sender_phone:
                        continue
                        
                    msg_type = msg.get("type")
                    text_body = ""
                    
                    if msg_type == "text":
                        text_body = msg.get("text", {}).get("body", "").lower().strip()
                    elif msg_type == "interactive":
                        # Handle button clicks if any
                        interactive_type = msg.get("interactive", {}).get("type")
                        if interactive_type == "button_reply":
                            text_body = msg.get("interactive", {}).get("button_reply", {}).get("title", "").lower().strip()
                            
                    logger.info(f"Received Meta WhatsApp message from {sender_phone}: {text_body}")
                    
                    # Generate secure shop link params
                    token = generate_phone_token(sender_phone)
                    dynamic_suffix = f"?platform=whatsapp&phone={sender_phone}&token={token}"
                    
                    components = [
                        {
                            "type": "button",
                            "sub_type": "url",
                            "index": "0",
                            "parameters": [
                                {
                                    "type": "text",
                                    "text": dynamic_suffix
                                }
                            ]
                        }
                    ]
                    
                    # Send template message to open the shop in the WhatsApp in-app browser
                    await whatsapp_service.send_template_message(
                        to_phone=sender_phone,
                        template_name="shop_menu",
                        language_code="ru",
                        components=components
                    )
                    
    except Exception as e:
        logger.error(f"Error handling WhatsApp incoming event: {e}")

@router.post("/webhook")
async def receive_webhook(request: Request, background_tasks: BackgroundTasks):
    """
    Receives incoming events (messages, status updates) from Meta or Wazzup.
    """
    try:
        payload = await request.json()
        logger.debug(f"WhatsApp Webhook raw payload: {payload}")
        
        # Check if Wazzup payload
        if "messages" in payload:
            background_tasks.add_task(handle_whatsapp_message_async, payload)
            return Response(content="EVENT_RECEIVED", status_code=200)

        # Meta payload message detection
        entries = payload.get("entry", [])
        has_messages = False
        for entry in entries:
            for change in entry.get("changes", []):
                if "messages" in change.get("value", {}):
                    has_messages = True
                    break
        
        if has_messages:
            background_tasks.add_task(handle_whatsapp_message_async, payload)
            
        return Response(content="EVENT_RECEIVED", status_code=200)
    except Exception as e:
        logger.error(f"Error reading WhatsApp Webhook payload: {e}")
        return Response(content="Error processing request", status_code=500)


# Auto-register Webhook in Wazzup on server startup
async def register_wazzup_webhook_if_needed():
    # Wazzup webhook registration is disabled completely
    return


