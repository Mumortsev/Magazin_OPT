"""
User handlers for basic bot commands.
"""
import os
from aiogram import Router, F
from aiogram.filters import CommandStart, Command
from aiogram.types import Message, WebAppInfo
from aiogram.utils.keyboard import InlineKeyboardBuilder

from ..keyboards import get_main_menu_keyboard
from ..utils import is_admin

router = Router()

# Hardcode URL to bypass any stale env vars
WEBAPP_URL = "https://kurortnik-kurortnik.amvera.io"
WEBAPP_URL_VERSIONED = f"{WEBAPP_URL}/index.html?v=21.0"


@router.message(CommandStart())
async def cmd_start(message: Message):
    """Handle /start command."""
    user = message.from_user
    
    # Set the Menu Button to open Web App
    from aiogram.types import MenuButtonWebApp, WebAppInfo, ReplyKeyboardMarkup, KeyboardButton, ReplyKeyboardRemove
    from ..utils import is_admin
    
    await message.bot.set_chat_menu_button(
        chat_id=message.chat.id,
        menu_button=MenuButtonWebApp(text="Каталог", web_app=WebAppInfo(url=WEBAPP_URL_VERSIONED))
    )
    
    # Check if user is admin
    if is_admin(user.id):
        # Admin gets a Reply Keyboard with Admin Panel button
        kb = ReplyKeyboardMarkup(
            keyboard=[
                [KeyboardButton(text="👨‍💼 Админ-панель")]
            ],
            resize_keyboard=True
        )
        await message.answer("🛠 Панель администратора активирована", reply_markup=kb)
    else:
        # For non-admins, we just remove any existing reply keyboard
        # but don't send any new text as requested
        await message.answer("ㅤ", reply_markup=ReplyKeyboardRemove())
        # Note: aiogram doesn't allow sending a completely empty message, 
        # so we use an invisible character or a very short confirmation if needed.
        # But usually, it's better to just delete the start message or similar.
        # To strictly "remove text", we can just not call answer() if we don't need to remove keyboard.
        # However, ReplyKeyboardRemove REQUIRES a message to be sent.
        # If the user doesn't have a keyboard, we can just skip it.


@router.message(Command("get_my_id"))
async def cmd_get_my_id(message: Message):
    """Handle /get_my_id command - shows user's Telegram ID."""
    await message.answer(
        f"🆔 Ваш Telegram ID: <code>{message.from_user.id}</code>\n\n"
        f"Скопируйте этот ID и отправьте администратору, "
        f"чтобы он добавил вас в список админов."
    )


@router.message(F.text == "🛍 Открыть магазин")
async def open_shop(message: Message):
    """Open the Mini App."""
    builder = InlineKeyboardBuilder()
    builder.button(
        text="🛍 Открыть каталог",
        web_app=WebAppInfo(url=WEBAPP_URL_VERSIONED)
    )
    
    await message.answer(
        "Нажмите кнопку ниже, чтобы открыть магазин:",
        reply_markup=builder.as_markup()
    )


@router.message(F.text == "📦 Мои заказы")
async def my_orders(message: Message):
    """Show user's orders."""
    from ..utils import api_request
    
    result = await api_request(
        "GET",
        "/api/orders/me",
        params={"telegram_user_id": message.from_user.id}
    )
    
    if "error" in result:
        await message.answer("❌ Ошибка загрузки заказов. Попробуйте позже.")
        return
    
    orders = result.get("orders", [])
    
    if not orders:
        await message.answer(
            "📦 У вас пока нет заказов.\n\n"
            "Откройте магазин и добавьте товары в корзину!"
        )
        return
    
    text = f"📦 <b>Ваши заказы:</b>\n\n"
    
    status_emoji = {
        "new": "🆕",
        "accepted": "✅",
        "rejected": "❌",
        "completed": "📦"
    }
    
    # Use unified formatting for order info
    from ..utils import format_order_info
    for order in orders[:5]:  # Show last 5 orders fully
        text += format_order_info(order) + "\n\n"
    
    if len(orders) > 10:
        text += f"\n<i>...и ещё {len(orders) - 10} заказов</i>"
    
    await message.answer(text)


@router.message(Command("help"))
async def cmd_help(message: Message):
    """Handle /help command."""
    is_user_admin = is_admin(message.from_user.id)
    
    text = (
        "📋 <b>Доступные команды:</b>\n\n"
        "/start — Главное меню\n"
        "/get_my_id — Узнать свой Telegram ID\n"
        "/help — Показать эту справку\n"
    )
    
    if is_user_admin:
        text += (
            "\n<b>Команды администратора:</b>\n"
            "/admin — Открыть админ-панель\n"
            "/find [запрос] — Найти товар\n"
        )
    
    await message.answer(text)
