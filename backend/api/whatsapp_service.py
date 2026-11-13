"""
WhatsApp Business API client service.
Supports both Meta Cloud API and Wazzup API.
"""
import os
import httpx
import logging
from typing import Optional, List, Dict, Any

from dotenv import load_dotenv

logger = logging.getLogger(__name__)

class WhatsAppService:
    def __init__(self):
        load_dotenv()
        # Force Meta provider and disable Wazzup
        self.provider = "meta"
        self.access_token = os.getenv("WHATSAPP_ACCESS_TOKEN")
        self.phone_number_id = os.getenv("WHATSAPP_PHONE_NUMBER_ID")
        self.api_version = "v20.0"  # standard stable version
        self.base_url = f"https://graph.facebook.com/{self.api_version}/{self.phone_number_id}/messages"
        
        # Wazzup endpoints
        self.wazzup_base_url = "https://api.wazzup24.com/v3"
        self._wazzup_channel_id = None
        
        if not self.access_token:
            logger.warning("WhatsAppService: WHATSAPP_ACCESS_TOKEN is not configured in environment.")
        if self.provider == "meta" and not self.phone_number_id:
            logger.warning("WhatsAppService: WHATSAPP_PHONE_NUMBER_ID is not configured in environment for Meta provider.")

    async def _get_wazzup_channel_id(self) -> Optional[str]:
        """Fetch the first active WhatsApp channel ID from Wazzup."""
        if self._wazzup_channel_id:
            return self._wazzup_channel_id

        headers = {
            "Authorization": f"Bearer {self.access_token}"
        }
        try:
            async with httpx.AsyncClient(timeout=10.0) as client:
                resp = await client.get(f"{self.wazzup_base_url}/channels", headers=headers)
                if resp.status_code == 200:
                    channels = resp.json()
                    # Find first active whatsapp channel
                    for ch in channels:
                        if ch.get("transport") == "whatsapp" and ch.get("state") == "active":
                            self._wazzup_channel_id = ch.get("channelId")
                            logger.info(f"Wazzup: Automatically selected active channel {self._wazzup_channel_id}")
                            return self._wazzup_channel_id
                    # Fallback to any whatsapp channel
                    for ch in channels:
                        if ch.get("transport") == "whatsapp":
                            self._wazzup_channel_id = ch.get("channelId")
                            logger.info(f"Wazzup: Selected channel fallback {self._wazzup_channel_id}")
                            return self._wazzup_channel_id
        except Exception as e:
            logger.error(f"Error fetching Wazzup channels: {e}")
        return None

    async def _send_request(self, payload: Dict[str, Any]) -> bool:
        if not self.access_token:
            logger.error("WhatsApp API Access Token is not configured.")
            return False

        headers = {
            "Authorization": f"Bearer {self.access_token}",
            "Content-Type": "application/json"
        }
        
        try:
            async with httpx.AsyncClient(timeout=15.0) as client:
                response = await client.post(self.base_url, headers=headers, json=payload)
                if response.status_code in (200, 201):
                    logger.info(f"Successfully sent WhatsApp message to {payload.get('to')}")
                    return True
                else:
                    logger.error(f"Failed to send WhatsApp message: Status {response.status_code}, Response: {response.text}")
                    return False
        except Exception as e:
            logger.error(f"Exception during WhatsApp message transmission: {e}")
            return False

    async def _send_wazzup_request(self, payload: Dict[str, Any]) -> bool:
        if not self.access_token:
            logger.error("Wazzup API Access Token is not configured.")
            return False

        # Dynamically inject channelId if missing
        if not payload.get("channelId"):
            channel_id = await self._get_wazzup_channel_id()
            if channel_id:
                payload["channelId"] = channel_id
            else:
                logger.error("Wazzup API: No active WhatsApp channels found on your Wazzup account.")
                return False

        url = f"{self.wazzup_base_url}/message"
        headers = {
            "Authorization": f"Bearer {self.access_token}",
            "Content-Type": "application/json"
        }
        
        try:
            async with httpx.AsyncClient(timeout=15.0) as client:
                response = await client.post(url, headers=headers, json=payload)
                if response.status_code in (200, 201, 202):
                    logger.info(f"Successfully sent Wazzup message to {payload.get('chatId')}")
                    return True
                else:
                    logger.error(f"Failed to send Wazzup message: Status {response.status_code}, Response: {response.text}")
                    return False
        except Exception as e:
            logger.error(f"Exception during Wazzup message transmission: {e}")
            return False

    def _clean_phone(self, to_phone: str) -> str:
        clean_phone = "".join(filter(str.isdigit, to_phone))
        # Sandbox workaround for Russian formatting bug in Meta Developer Console
        if self.provider == "meta" and self.phone_number_id == "1136010606266098" and clean_phone.startswith("79") and len(clean_phone) == 11:
            logger.info(f"Sandbox workaround: rewriting recipient {clean_phone} to 78{clean_phone[1:]} for Meta Sandbox")
            clean_phone = f"78{clean_phone[1:]}"
        return clean_phone

    async def send_text_message(self, to_phone: str, text: str) -> bool:
        """Send a simple text message."""
        clean_phone = self._clean_phone(to_phone)
        
        if self.provider == "wazzup":
            payload = {
                "channelId": "",  # Automatically filled by _send_wazzup_request
                "chatType": "whatsapp",
                "chatId": clean_phone,
                "text": text
            }
            return await self._send_wazzup_request(payload)
            
        payload = {
            "messaging_product": "whatsapp",
            "recipient_type": "individual",
            "to": clean_phone,
            "type": "text",
            "text": {
                "body": text
            }
        }
        return await self._send_request(payload)

    async def send_template_message(
        self, 
        to_phone: str, 
        template_name: str, 
        language_code: str = "ru", 
        components: Optional[List[Dict[str, Any]]] = None
    ) -> bool:
        """Send a template message (required for initiating conversations in official API)."""
        clean_phone = self._clean_phone(to_phone)
        
        if self.provider == "wazzup":
            # In Wazzup (WhatsApp Web Mode), we don't have official templates pre-approved by Meta.
            # We can send a standard text message containing the URL or text directly!
            # Let's extract the dynamic URL suffix if available in components to construct a beautiful text.
            webapp_url = os.getenv("WEBAPP_URL", "https://kurortnik-kurortnik.amvera.io").rstrip("/")
            link = f"{webapp_url}/?platform=whatsapp"
            
            if components:
                for comp in components:
                    if comp.get("type") == "button" and comp.get("sub_type") == "url":
                        params = comp.get("parameters", [])
                        for param in params:
                            if param.get("type") == "text":
                                # Param is "?platform=whatsapp&phone=79180724040&token=..."
                                suffix = param.get("text", "")
                                if suffix.startswith("?"):
                                    link = f"{webapp_url}/{suffix}"
                                else:
                                    link = f"{webapp_url}/{suffix.lstrip('/')}"
                                break

            text = (
                "Приветствуем! Чтобы перейти к покупкам в магазине Курортник, нажмите на ссылку ниже:\n\n"
                f"{link}"
            )
            return await self.send_text_message(to_phone=clean_phone, text=text)
        
        payload = {
            "messaging_product": "whatsapp",
            "to": clean_phone,
            "type": "template",
            "template": {
                "name": template_name,
                "language": {
                    "code": language_code
                }
            }
        }
        if components:
            payload["template"]["components"] = components
            
        return await self._send_request(payload)

    async def send_document_message(
        self, 
        to_phone: str, 
        document_url: str, 
        filename: str, 
        caption: Optional[str] = None
    ) -> bool:
        """Send a PDF or other document via a public URL."""
        clean_phone = self._clean_phone(to_phone)
        
        if self.provider == "wazzup":
            # Wazzup v3: cannot mix text (caption) and contentUri.
            # We will send the document first, and then optionally send the caption as a text message.
            payload = {
                "channelId": "",
                "chatType": "whatsapp",
                "chatId": clean_phone,
                "contentUri": document_url
            }
            success = await self._send_wazzup_request(payload)
            if success and caption:
                # Send caption as a follow-up message
                await self.send_text_message(to_phone=clean_phone, text=caption)
            return success
            
        payload = {
            "messaging_product": "whatsapp",
            "to": clean_phone,
            "type": "document",
            "document": {
                "link": document_url,
                "filename": filename
            }
        }
        if caption:
            payload["document"]["caption"] = caption
            
        return await self._send_request(payload)

# Global service instance
whatsapp_service = WhatsAppService()

