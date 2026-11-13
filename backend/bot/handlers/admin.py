"""
Admin handlers with FSM for product/category management.
"""
import os
from aiogram import Router, F, Dispatcher
from aiogram.filters import Command, StateFilter
from aiogram.fsm.context import FSMContext
from aiogram.fsm.state import State, StatesGroup
from aiogram.types import Message, CallbackQuery, ContentType
from dotenv import load_dotenv

from ..keyboards import (
    get_admin_menu_keyboard, get_categories_keyboard,
    get_subcategories_keyboard, get_category_management_keyboard,
    get_category_actions_keyboard,
    get_product_actions_keyboard, get_product_edit_keyboard,
    get_order_actions_keyboard, get_skip_keyboard, get_cancel_keyboard,
    get_confirm_keyboard, get_done_keyboard
)
from ..utils import (
    is_admin, get_categories, get_products, get_product,
    create_product, update_product, delete_product,
    create_category, update_category, create_subcategory, delete_category,
    get_orders, update_order_status,
    format_product_info, format_order_info
)

load_dotenv()

router = Router()

ADMIN_IDS = [int(x.strip()) for x in os.getenv("ADMIN_IDS", "").split(",") if x.strip()]


# FSM States
class AddProductStates(StatesGroup):
    waiting_photo = State()
    waiting_name = State()
    waiting_category = State()
    waiting_subcategory = State()
    waiting_price = State()
    waiting_pieces_per_pack = State()
    waiting_stock = State()
    waiting_description = State()
    waiting_excel = State()


class EditProductStates(StatesGroup):
    waiting_value = State()
    waiting_value = State()
    waiting_photos = State()
    waiting_badge_text = State()
    waiting_badge_color = State()


class AddCategoryStates(StatesGroup):
    waiting_name = State()


class AddSubcategoryStates(StatesGroup):
    waiting_category = State()
    waiting_name = State()


class EditCategoryStates(StatesGroup):
    waiting_new_name = State()
    waiting_photo = State()


class FindProductStates(StatesGroup):
    waiting_query = State()


# Middleware to check admin access
async def admin_check(handler, event, data):
    """Check if user is admin before processing."""
    user_id = None
    if isinstance(event, Message):
        user_id = event.from_user.id
    elif isinstance(event, CallbackQuery):
        user_id = event.from_user.id
    
    if user_id and not is_admin(user_id):
        if isinstance(event, Message):
            await event.answer("⛔ У вас нет доступа к админ-панели.")
        elif isinstance(event, CallbackQuery):
            await event.answer("⛔ Нет доступа", show_alert=True)
        return
    
    return await handler(event, data)


def setup_admin_handlers(dp: Dispatcher):
    """Setup admin handlers with middleware."""
    router.message.middleware(admin_check)
    router.callback_query.middleware(admin_check)


# --- Main Admin Menu ---

@router.message(Command("admin"))
@router.message(F.text == "👨‍💼 Админ-панель")
async def cmd_admin(message: Message):
    """Show admin panel."""
    if not is_admin(message.from_user.id):
        await message.answer("⛔ У вас нет доступа к админ-панели.")
        return
    
    await message.answer(
        "👨‍💼 <b>Админ-панель</b>\n\nВыберите действие:",
        reply_markup=get_admin_menu_keyboard()
    )


@router.callback_query(F.data == "admin:menu")
async def admin_menu(callback: CallbackQuery, state: FSMContext):
    """Return to admin menu."""
    await state.clear()
    await callback.message.edit_text(
        "👨‍💼 <b>Админ-панель</b>\n\nВыберите действие:",
        reply_markup=get_admin_menu_keyboard()
    )


@router.callback_query(F.data == "cancel")
async def cancel_action(callback: CallbackQuery, state: FSMContext):
    """Cancel current action."""
    await state.clear()
    await callback.message.edit_text(
        "❌ Действие отменено.\n\n👨‍💼 <b>Админ-панель</b>\n\nВыберите действие:",
        reply_markup=get_admin_menu_keyboard()
    )


# --- Add Product Flow ---

@router.callback_query(F.data == "admin:add_product")
async def start_add_product(callback: CallbackQuery, state: FSMContext):
    """Start adding a new product."""
    await state.set_state(AddProductStates.waiting_photo)
    await callback.message.edit_text(
        "📷 <b>Добавление товара</b>\n\n"
        "Шаг 1/8: Отправьте <b>фото товара</b>\n"
        "Можно отправить несколько фото по очереди.",
        reply_markup=get_cancel_keyboard()
    )


@router.message(AddProductStates.waiting_photo, F.photo)
async def process_product_photo(message: Message, state: FSMContext):
    """Process product photo."""
    photo = message.photo[-1]  # Get largest photo
    
    data = await state.get_data()
    images = data.get("images", [])
    images.append(photo.file_id)
    
    await state.update_data(images=images)
    
    count = len(images)
    await message.answer(
        f"✅ Фото #{count} загружено!\n\n"
        "Отправьте ещё фото или нажмите <b>Готово</b>, чтобы продолжить.",
        reply_markup=get_done_keyboard()
    )


@router.callback_query(AddProductStates.waiting_photo, F.data == "done")
async def finish_photo_upload(callback: CallbackQuery, state: FSMContext):
    """Finish photo upload."""
    data = await state.get_data()
    if not data.get("images"):
        await callback.answer("❌ Загрузите хотя бы одно фото!", show_alert=True)
        return

    await state.set_state(AddProductStates.waiting_name)
    await callback.message.answer(
        "Шаг 2/8: Напишите <b>название товара</b>",
        reply_markup=get_cancel_keyboard()
    )


@router.message(AddProductStates.waiting_photo)
async def process_product_photo_invalid(message: Message):
    """Handle non-photo message in photo state."""
    await message.answer(
        "❌ Пожалуйста, отправьте <b>фото</b> товара.",
        reply_markup=get_cancel_keyboard()
    )


@router.message(AddProductStates.waiting_name)
async def process_product_name(message: Message, state: FSMContext):
    """Process product name."""
    await state.update_data(name=message.text.strip())
    
    data = await state.get_data()
    
    # Check if category is already selected (e.g. via "Add Product" from category menu)
    if data.get("category_id"):
        category_id = data["category_id"]
        
        # Get subcategories for this category
        categories = await get_categories()
        category = next((c for c in categories if c["id"] == category_id), None)
        subcategories = category.get("subcategories", []) if category else []
        
        if not subcategories:
            # No subcategories, skip to price
            await state.update_data(subcategory_id=None)
            await state.set_state(AddProductStates.waiting_price)
            await message.answer(
                "Шаг 5/8: Укажите <b>цену за 1 штуку</b> (₽)\n\n"
                "Напишите число, например: 10",
                reply_markup=get_cancel_keyboard()
            )
            return
        
        await state.set_state(AddProductStates.waiting_subcategory)
        await message.answer(
            "Шаг 4/8: Выберите <b>подкатегорию</b>",
            reply_markup=get_subcategories_keyboard(subcategories, category_id, "add")
        )
        return

    categories = await get_categories()
    if not categories:
        await state.set_state(AddCategoryStates.waiting_name)
        await message.answer(
            "📁 Категорий пока нет. Создайте первую категорию.\n\n"
            "Напишите <b>название категории</b>:"
        )
        return
    
    await state.set_state(AddProductStates.waiting_category)
    await message.answer(
        "Шаг 3/8: Выберите <b>категорию</b>",
        reply_markup=get_categories_keyboard(categories, "add")
    )


@router.callback_query(AddProductStates.waiting_category, F.data.startswith("cat:add:"))
async def process_product_category(callback: CallbackQuery, state: FSMContext):
    """Process category selection."""
    category_id = int(callback.data.split(":")[2])
    await state.update_data(category_id=category_id)
    
    # Get subcategories for this category
    categories = await get_categories()
    category = next((c for c in categories if c["id"] == category_id), None)
    subcategories = category.get("subcategories", []) if category else []
    
    if not subcategories:
        # No subcategories, skip to price
        await state.update_data(subcategory_id=None)
        await state.set_state(AddProductStates.waiting_price)
        await callback.message.edit_text(
            "Шаг 5/8: Укажите <b>цену за 1 штуку</b> (₽)\n\n"
            "Напишите число, например: 10",
            reply_markup=get_cancel_keyboard()
        )
        return
    
    await state.set_state(AddProductStates.waiting_subcategory)
    await callback.message.edit_text(
        "Шаг 4/8: Выберите <b>подкатегорию</b>",
        reply_markup=get_subcategories_keyboard(subcategories, category_id, "add")
    )


@router.callback_query(AddProductStates.waiting_subcategory, F.data.startswith("subcat:add:"))
async def process_product_subcategory(callback: CallbackQuery, state: FSMContext):
    """Process subcategory selection."""
    subcategory_id = int(callback.data.split(":")[2])
    await state.update_data(subcategory_id=subcategory_id)
    
    await state.set_state(AddProductStates.waiting_price)
    await callback.message.edit_text(
        "Шаг 5/8: Укажите <b>цену за 1 штуку</b> (₽)\n\n"
        "Напишите число, например: 10",
        reply_markup=get_cancel_keyboard()
    )


@router.message(AddProductStates.waiting_price)
async def process_product_price(message: Message, state: FSMContext):
    """Process product price."""
    try:
        price = float(message.text.strip().replace(",", ".").replace("₽", ""))
        if price <= 0:
            raise ValueError
    except ValueError:
        await message.answer("❌ Введите корректную цену (положительное число).")
        return
    
    await state.update_data(price_per_unit=price)
    await state.set_state(AddProductStates.waiting_pieces_per_pack)
    await message.answer(
        "Шаг 6/8: Сколько <b>штук в одной пачке</b>?\n\n"
        "Напишите число, например: 50",
        reply_markup=get_cancel_keyboard()
    )


@router.message(AddProductStates.waiting_pieces_per_pack)
async def process_product_pack(message: Message, state: FSMContext):
    """Process pieces per pack."""
    try:
        pieces = int(message.text.strip())
        if pieces < 1:
            raise ValueError
    except ValueError:
        await message.answer("❌ Введите корректное количество (целое положительное число).")
        return
    
    await state.update_data(pieces_per_pack=pieces)
    await state.set_state(AddProductStates.waiting_stock)
    await message.answer(
        "Шаг 7/8: Укажите <b>остаток в пачках</b>\n\n"
        "Напишите число или 0, если остаток неограничен.",
        reply_markup=get_cancel_keyboard()
    )


@router.message(AddProductStates.waiting_stock)
async def process_product_stock(message: Message, state: FSMContext):
    """Process product stock."""
    try:
        stock = int(message.text.strip())
        if stock < 0:
            raise ValueError
    except ValueError:
        await message.answer("❌ Введите корректное количество (0 или положительное число).")
        return
    
    # 0 means unlimited
    await state.update_data(in_stock=stock if stock > 0 else None)
    await state.set_state(AddProductStates.waiting_description)
    await message.answer(
        "Шаг 8/8: Напишите <b>краткое описание</b> товара\n\n"
        "Или нажмите «Пропустить», если описание не нужно.",
        reply_markup=get_skip_keyboard()
    )


@router.message(AddProductStates.waiting_description)
async def process_product_description(message: Message, state: FSMContext):
    """Process product description and save."""
    description = message.text.strip() if message.text else None
    await state.update_data(description=description)
    
    # Get all data and create product
    data = await state.get_data()
    
    product_data = {
        "name": data["name"],
        "description": data.get("description"),
        "price_per_unit": data["price_per_unit"],
        "pieces_per_pack": data["pieces_per_pack"],
        "min_order_packs": 1,
        "category_id": data["category_id"],
        "subcategory_id": data.get("subcategory_id"),
        "image_file_id": data.get("images", [])[0] if data.get("images") else None, # Fallback
        "images": data.get("images", []),
        "in_stock": data.get("in_stock"),
        "active": True
    }
    
    result = await create_product(product_data)
    await state.clear()
    
    if "error" in result:
        await message.answer(
            f"❌ Ошибка при создании товара: {result.get('detail', 'Неизвестная ошибка')}",
            reply_markup=get_admin_menu_keyboard()
        )
        return
    
    await message.answer(
        f"✅ <b>Товар добавлен!</b>\n\n"
        f"🆔 ID: #{result.get('id')}\n"
        f"📝 Название: {result.get('name')}\n"
        f"💰 Цена: {result.get('price_per_unit')}₽ за шт\n"
        f"📦 В пачке: {result.get('pieces_per_pack')} шт",
        reply_markup=get_admin_menu_keyboard()
    )


@router.callback_query(AddProductStates.waiting_description, F.data == "skip")
async def skip_description(callback: CallbackQuery, state: FSMContext):
    """Skip description."""
    await state.update_data(description=None)
    
    # Get all data and create product
    data = await state.get_data()
    
    product_data = {
        "name": data["name"],
        "description": data.get("description"),
        "price_per_unit": data["price_per_unit"],
        "pieces_per_pack": data["pieces_per_pack"],
        "min_order_packs": 1,
        "category_id": data["category_id"],
        "subcategory_id": data.get("subcategory_id"),
        "image_file_id": data.get("images", [])[0] if data.get("images") else None, # Fallback
        "images": data.get("images", []),
        "in_stock": data.get("in_stock"),
        "active": True
    }
    
    result = await create_product(product_data)
    await state.clear()
    
    if "error" in result:
        await callback.message.edit_text(
            f"❌ Ошибка при создании товара: {result.get('detail', 'Неизвестная ошибка')}",
            reply_markup=get_admin_menu_keyboard()
        )
        return
    
    await callback.message.edit_text(
        f"✅ <b>Товар добавлен!</b>\n\n"
        f"🆔 ID: #{result.get('id')}\n"
        f"📝 Название: {result.get('name')}\n"
        f"💰 Цена: {result.get('price_per_unit')}₽ за шт\n"
        f"📦 В пачке: {result.get('pieces_per_pack')} шт",
        reply_markup=get_admin_menu_keyboard()
    )


# --- Badge Editing ---
from ..keyboards import get_badge_color_keyboard

@router.callback_query(F.data.startswith("edit:badge:"))
async def start_edit_product_badge(callback: CallbackQuery, state: FSMContext):
    """Start changing product badge."""
    product_id = int(callback.data.split(":")[2])
    
    # Needs to fetch current product to preserve badge_text if skipping
    product = await get_product(product_id, admin_view=True)
    current_text = product.get("badge_text", "")
    
    await state.update_data(product_id=product_id, badge_text=current_text)
    
    await state.set_state(EditProductStates.waiting_badge_text)
    await callback.message.edit_text(
        f"🏷 <b>Метка товара</b>\n"
        f"Текущая: {current_text or 'Нет'}\n\n"
        "Напишите текст метки (например: НОВИНКА, -20%, ХИТ).\n"
        "Максимум 15 символов.\n\n"
        "Или отправьте точку «.» чтобы оставить текст без изменений и перейти к цвету.",
        reply_markup=get_cancel_keyboard()
    )


@router.message(EditProductStates.waiting_badge_text)
async def process_badge_text(message: Message, state: FSMContext):
    """Process badge text."""
    text = message.text.strip()
    if len(text) > 15:
        await message.answer("❌ Слишком длинный текст. Максимум 15 знаков.")
        return

    if text != ".":
        await state.update_data(badge_text=text)
    
    await state.set_state(EditProductStates.waiting_badge_color)
    await message.answer(
        "🎨 <b>Выберите цвет метки:</b>",
        reply_markup=get_badge_color_keyboard()
    )


@router.callback_query(EditProductStates.waiting_badge_color, F.data.startswith("badge_color:"))
async def process_badge_color(callback: CallbackQuery, state: FSMContext):
    """Process badge color."""
    color_code = callback.data.split(":")[1]
    data = await state.get_data()
    product_id = data.get("product_id")
    badge_text = data.get("badge_text")
    
    updates = {}
    if color_code == "clear":
        updates = {"badge_text": None, "badge_bg_color": None}
    else:
        # Use existing text if not changed (already in state)
        if badge_text:
             updates["badge_text"] = badge_text
        updates["badge_bg_color"] = color_code
    
    try:
        result = await update_product(product_id, updates)
        await state.clear()
        
        info_text = format_product_info(result)
        await callback.message.edit_text(
            f"✅ Метка обновлена!\n\n{info_text}",
            reply_markup=get_product_actions_keyboard(product_id)
        )
    except Exception as e:
        await callback.message.edit_text(
            f"❌ Ошибка: {str(e)}",
            reply_markup=get_admin_menu_keyboard()
        )


# --- Excel Import ---

@router.callback_query(F.data == "admin:import_excel")
async def start_import_excel(callback: CallbackQuery, state: FSMContext):
    """Start Excel import process."""
    await state.set_state(AddProductStates.waiting_excel)
    await callback.message.edit_text(
        "📊 <b>Массовый импорт товаров из Excel</b>\n\n"
        "1. Подготовьте файл .xlsx с колонками:\n"
        "<i>Категория, Подкатегория, Наименование, Артикул, Цена (за 1 шт/₽), Кол-во в пачке (шт), Описание</i>\n\n"
        "2. Отправьте файл мне сообщением.",
        reply_markup=get_cancel_keyboard()
    )

@router.message(AddProductStates.waiting_excel, F.document)
async def process_excel_document(message: Message, state: FSMContext):
    """Handle the uploaded Excel file."""
    if not message.document.file_name.endswith(('.xlsx', '.xls')):
        await message.answer("❌ Пожалуйста, отправьте файл в формате Excel (.xlsx)")
        return

    wait_msg = await message.answer("⏳ Обрабатываю файл, пожалуйста, подождите...")
    
    # Download file
    file_id = message.document.file_id
    file = await message.bot.get_file(file_id)
    file_path = f"data/imports/{message.document.file_name}"
    os.makedirs("data/imports", exist_ok=True)
    
    await message.bot.download_file(file.file_path, file_path)
    
    try:
        # Import logic
        from api.excel_processor import process_excel_import
        result_text = await process_excel_import(file_path)
        
        await wait_msg.delete()
        await message.answer(result_text, reply_markup=get_admin_menu_keyboard())
        
    except Exception as e:
        await wait_msg.delete()
        await message.answer(
            f"❌ Произошла ошибка при обработке файла:\n{str(e)}", 
            reply_markup=get_admin_menu_keyboard()
        )
    finally:
        # Clean up file
        if os.path.exists(file_path):
            try:
                os.remove(file_path)
            except:
                pass
        await state.clear()


# --- Find Product ---

@router.callback_query(F.data == "admin:find_product")
async def start_find_product(callback: CallbackQuery, state: FSMContext):
    """Start product search."""
    await state.set_state(FindProductStates.waiting_query)
    await callback.message.edit_text(
        "🔍 <b>Поиск товара</b>\n\n"
        "Введите название или часть названия товара:",
        reply_markup=get_cancel_keyboard()
    )


@router.message(Command("find"))
async def cmd_find_product(message: Message, state: FSMContext):
    """Find product by command."""
    if not is_admin(message.from_user.id):
        return
    
    query = message.text.replace("/find", "").strip()
    if not query:
        await state.set_state(FindProductStates.waiting_query)
        await message.answer(
            "🔍 <b>Поиск товара</b>\n\n"
            "Введите название или часть названия товара:",
            reply_markup=get_cancel_keyboard()
        )
        return
    
    await search_and_show_products(message, query)


@router.message(FindProductStates.waiting_query)
async def process_find_query(message: Message, state: FSMContext):
    """Process search query."""
    await state.clear()
    await search_and_show_products(message, message.text.strip())


async def search_and_show_products(message: Message, query: str):
    """Search and display products."""
    result = await get_products(q=query, limit=10, admin_view=True)
    
    if "error" in result:
        await message.answer(
            "❌ Ошибка поиска. Попробуйте позже.",
            reply_markup=get_admin_menu_keyboard()
        )
        return
    
    products = result.get("items", [])
    
    if not products:
        await message.answer(
            f"🔍 По запросу «{query}» ничего не найдено.",
            reply_markup=get_admin_menu_keyboard()
        )
        return
    
    for product in products:
        text = format_product_info(product)
        await message.answer(
            text,
            reply_markup=get_product_actions_keyboard(product["id"])
        )


# --- Category Management ---

@router.callback_query(F.data == "admin:categories")
async def category_management(callback: CallbackQuery):
    """Show category management menu."""
    await callback.message.edit_text(
        "📁 <b>Управление категориями</b>\n\n"
        "Выберите действие:",
        reply_markup=get_category_management_keyboard()
    )


@router.callback_query(F.data == "cat:create")
async def start_create_category(callback: CallbackQuery, state: FSMContext):
    """Start creating a category."""
    await state.set_state(AddCategoryStates.waiting_name)
    await callback.message.edit_text(
        "📁 <b>Создание категории</b>\n\n"
        "Напишите <b>название категории</b>:",
        reply_markup=get_cancel_keyboard()
    )


@router.message(AddCategoryStates.waiting_name)
async def process_category_name(message: Message, state: FSMContext):
    """Process category name."""
    name = message.text.strip()
    result = await create_category(name)
    await state.clear()
    
    if "error" in result:
        await message.answer(
            f"❌ Ошибка: {result.get('detail', 'Не удалось создать категорию')}",
            reply_markup=get_admin_menu_keyboard()
        )
        return
    
    await message.answer(
        f"✅ Категория «{name}» создана!\n\n"
        f"🆔 ID: #{result.get('id')}",
        reply_markup=get_admin_menu_keyboard()
    )


@router.callback_query(F.data == "subcat:create_select")
async def select_category_for_subcategory(callback: CallbackQuery, state: FSMContext):
    """Select category for new subcategory."""
    categories = await get_categories()
    
    if not categories:
        await callback.message.edit_text(
            "❌ Сначала создайте категорию.",
            reply_markup=get_category_management_keyboard()
        )
        return
    
    await state.set_state(AddSubcategoryStates.waiting_category)
    await callback.message.edit_text(
        "📁 <b>Создание подкатегории</b>\n\n"
        "Выберите <b>родительскую категорию</b>:",
        reply_markup=get_categories_keyboard(categories, "subcat")
    )


@router.callback_query(AddSubcategoryStates.waiting_category, F.data.startswith("cat:subcat:"))
async def process_subcategory_parent(callback: CallbackQuery, state: FSMContext):
    """Process parent category for subcategory."""
    category_id = int(callback.data.split(":")[2])
    await state.update_data(category_id=category_id)
    await state.set_state(AddSubcategoryStates.waiting_name)
    
    await callback.message.edit_text(
        "📁 <b>Создание подкатегории</b>\n\n"
        "Напишите <b>название подкатегории</b>:",
        reply_markup=get_cancel_keyboard()
    )


@router.message(AddSubcategoryStates.waiting_name)
async def process_subcategory_name(message: Message, state: FSMContext):
    """Process subcategory name."""
    name = message.text.strip()
    data = await state.get_data()
    category_id = data.get("category_id")
    
    result = await create_subcategory(category_id, name)
    await state.clear()
    
    if "error" in result:
        await message.answer(
            f"❌ Ошибка: {result.get('detail', 'Не удалось создать подкатегорию')}",
            reply_markup=get_admin_menu_keyboard()
        )
        return
    
    await message.answer(
        f"✅ Подкатегория «{name}» создана!\n\n"
        f"🆔 ID: #{result.get('id')}",
        reply_markup=get_admin_menu_keyboard()
    )


# --- Category Actions (List, Rename, Delete, Products) ---

@router.callback_query(F.data == "cat:list")
async def list_categories_for_management(callback: CallbackQuery):
    """List categories for detailed management."""
    categories = await get_categories()
    
    if not categories:
        await callback.message.edit_text(
            "📁 Категорий пока нет.",
            reply_markup=get_category_management_keyboard()
        )
        return
        
    await callback.message.edit_text(
        "📁 <b>Выберите категорию для управления:</b>",
        reply_markup=get_categories_keyboard(categories, "manage")
    )


@router.callback_query(F.data.startswith("cat:manage:"))
async def manage_category_menu(callback: CallbackQuery):
    """Show actions for a specific category."""
    category_id = int(callback.data.split(":")[2])
    
    # Needs to fetch category name, but api only gives list.
    # Optimization: fetch list and find (or add get_category endpoint later if needed).
    categories = await get_categories()
    category = next((c for c in categories if c["id"] == category_id), None)
    
    cat_name = category["name"] if category else "???"
    
    await callback.message.edit_text(
        f"📁 <b>Категория: {cat_name}</b>\n"
        f"🆔 ID: {category_id}\n\n"
        "Выберите действие:",
        reply_markup=get_category_actions_keyboard(category_id)
    )


@router.callback_query(F.data.startswith("cat:rename:"))
async def start_category_rename(callback: CallbackQuery, state: FSMContext):
    """Start category renaming."""
    category_id = int(callback.data.split(":")[2])
    await state.update_data(category_id=category_id)
    await state.set_state(EditCategoryStates.waiting_new_name)
    
    await callback.message.edit_text(
        "✏️ <b>Переименование категории</b>\n\n"
        "Введите новое название:",
        reply_markup=get_cancel_keyboard()
    )


@router.message(EditCategoryStates.waiting_new_name)
async def process_category_rename(message: Message, state: FSMContext):
    """Process new category name."""
    new_name = message.text.strip()
    data = await state.get_data()
    category_id = data.get("category_id")
    
    result = await update_category(category_id, {"name": new_name})
    await state.clear()
    
    if "error" in result:
        await message.answer(
            f"❌ Ошибка: {result.get('detail')}",
            reply_markup=get_admin_menu_keyboard()
        )
        return

    await message.answer(
        f"✅ Категория переименована в «{new_name}»!",
        reply_markup=get_category_actions_keyboard(category_id)
    )


@router.callback_query(F.data.startswith("cat:photo:"))
async def start_category_photo(callback: CallbackQuery, state: FSMContext):
    """Start category photo update."""
    category_id = int(callback.data.split(":")[2])
    await state.update_data(category_id=category_id)
    await state.set_state(EditCategoryStates.waiting_photo)
    
    await callback.message.edit_text(
        "🖼 <b>Изменение фото категории</b>\n\n"
        "Отправьте мне <b>фотографию</b> для этой категории:",
        reply_markup=get_cancel_keyboard()
    )


@router.message(EditCategoryStates.waiting_photo, F.photo)
async def process_category_photo(message: Message, state: FSMContext):
    """Process new category photo."""
    photo = message.photo[-1]  # Get largest photo
    file_id = photo.file_id
    
    data = await state.get_data()
    category_id = data.get("category_id")
    
    result = await update_category(category_id, {"image_file_id": file_id})
    await state.clear()
    
    if "error" in result:
        await message.answer(
            f"❌ Ошибка при обновлении фото: {result.get('detail', 'Неизвестная ошибка')}",
            reply_markup=get_admin_menu_keyboard()
        )
        return
        
    await message.answer(
        f"✅ Фото категории успешно обновлено!",
        reply_markup=get_category_actions_keyboard(category_id)
    )


@router.message(EditCategoryStates.waiting_photo)
async def process_category_photo_invalid(message: Message):
    """Handle non-photo message in category photo state."""
    await message.answer(
        "❌ Пожалуйста, отправьте <b>фотографию</b>.",
        reply_markup=get_cancel_keyboard()
    )


@router.callback_query(F.data.startswith("cat:delete:"))
async def confirm_delete_category(callback: CallbackQuery):
    """Confirm category deletion."""
    category_id = int(callback.data.split(":")[2])
    
    await callback.message.edit_text(
        "⚠️ <b>Вы уверены?</b>\n\n"
        "Удаление категории удалит и все её товары!",
        reply_markup=get_confirm_keyboard("category", category_id)
    )


@router.callback_query(F.data.startswith("confirm:category:"))
async def do_delete_category(callback: CallbackQuery):
    """Delete the category."""
    category_id = int(callback.data.split(":")[2])
    result = await delete_category(category_id)
    
    if "error" in result:
        await callback.answer(f"❌ Ошибка: {result.get('detail')}", show_alert=True)
        return
        
    await callback.message.edit_text(
        "🗑 Категория удалена.",
        reply_markup=get_category_management_keyboard()
    )


@router.callback_query(F.data.startswith("cat:products:"))
async def list_category_products(callback: CallbackQuery):
    """List products in category for management."""
    category_id = int(callback.data.split(":")[2])
    result = await get_products(category=category_id, limit=50, admin_view=True) # Increased limit for admin
    
    products = result.get("items", [])
    
    if not products:
        await callback.message.edit_text(
            "📦 В этой категории нет товаров.",
            reply_markup=get_category_actions_keyboard(category_id)
        )
        return
        
    await callback.message.answer(
        f"📦 <b>Товары в категории</b> ({len(products)} шт):",
        reply_markup=None 
    )
    
    # Show products with Edit buttons
    for product in products:
        text = format_product_info(product)
        await callback.message.answer(
            text,
            reply_markup=get_product_actions_keyboard(product["id"])
        )

    # Show "Add Product" button at the end
    builder = InlineKeyboardBuilder()
    builder.row(InlineKeyboardButton(text="➕ Добавить товар сюда", callback_data=f"product:add_to:{category_id}"))
    builder.row(InlineKeyboardButton(text="◀️ Назад к категории", callback_data=f"cat:manage:{category_id}"))
    
    await callback.message.answer(
        "👇 Действия:",
        reply_markup=builder.as_markup()
    )


@router.callback_query(F.data.startswith("product:add_to:"))
async def add_product_to_category(callback: CallbackQuery, state: FSMContext):
    """Shortcut to add product directly to specific category."""
    category_id = int(callback.data.split(":")[2])
    
    await state.set_state(AddProductStates.waiting_photo)
    await state.update_data(category_id=category_id) # Pre-fill category
    
    await callback.message.edit_text(
        "📷 <b>Добавление товара</b>\n\n"
        "Шаг 1/8: Отправьте <b>фото товара</b>",
        reply_markup=get_cancel_keyboard()
    )


# --- Orders ---

@router.callback_query(F.data == "admin:new_orders")
async def show_new_orders(callback: CallbackQuery):
    """Show new orders."""
    result = await get_orders(status="new")
    
    if "error" in result:
        await callback.message.edit_text(
            "❌ Ошибка загрузки заказов.",
            reply_markup=get_admin_menu_keyboard()
        )
        return
    
    orders = result.get("orders", [])
    
    if not orders:
        await callback.message.edit_text(
            "📦 Нет новых заказов.",
            reply_markup=get_admin_menu_keyboard()
        )
        return
    
    await callback.message.edit_text(
        f"📦 <b>Новые заказы:</b> {len(orders)}",
        reply_markup=get_admin_menu_keyboard()
    )
    
    for order in orders[:10]:
        text = format_order_info(order)
        await callback.message.answer(
            text,
            reply_markup=get_order_actions_keyboard(order["id"], order["telegram_user_id"])
        )


@router.callback_query(F.data.startswith("order:accept:"))
async def accept_order(callback: CallbackQuery):
    """Accept an order."""
    order_id = int(callback.data.split(":")[2])
    result = await update_order_status(order_id, "accepted")
    
    if "error" in result:
        await callback.answer(f"❌ Ошибка: {result.get('detail')}", show_alert=True)
        return
    
    await callback.answer("✅ Заказ принят!")
    await callback.message.edit_text(
        callback.message.text + "\n\n✅ <b>ПРИНЯТ</b>",
        reply_markup=None
    )


@router.callback_query(F.data.startswith("order:reject:"))
async def reject_order(callback: CallbackQuery):
    """Reject an order."""
    order_id = int(callback.data.split(":")[2])
    result = await update_order_status(order_id, "rejected")
    
    if "error" in result:
        await callback.answer(f"❌ Ошибка: {result.get('detail')}", show_alert=True)
        return
    
    await callback.answer("❌ Заказ отклонён!")
    await callback.message.edit_text(
        callback.message.text + "\n\n❌ <b>ОТКЛОНЁН</b>",
        reply_markup=None
    )


# --- Statistics ---

@router.callback_query(F.data == "admin:stats")
async def show_stats(callback: CallbackQuery):
    """Show statistics."""
    products_result = await get_products(limit=1, admin_view=True)
    orders_result = await get_orders()
    categories = await get_categories()
    
    total_products = products_result.get("total", 0) if "error" not in products_result else 0
    orders = orders_result.get("orders", []) if "error" not in orders_result else []
    
    new_orders = sum(1 for o in orders if o.get("status") == "new")
    completed_orders = sum(1 for o in orders if o.get("status") == "completed")
    total_revenue = sum(o.get("total_amount", 0) for o in orders if o.get("status") in ["accepted", "completed"])
    
    await callback.message.edit_text(
        f"📊 <b>Статистика магазина</b>\n\n"
        f"📁 Категорий: {len(categories)}\n"
        f"📦 Товаров: {total_products}\n"
        f"🛒 Всего заказов: {len(orders)}\n"
        f"🆕 Новых заказов: {new_orders}\n"
        f"✅ Выполненных: {completed_orders}\n"
        f"💰 Выручка: {total_revenue:.2f}₽",
        reply_markup=get_admin_menu_keyboard()
    )


# --- Product Edit ---

@router.callback_query(F.data.startswith("product:edit:"))
async def edit_product_menu(callback: CallbackQuery):
    """Show product edit menu."""
    product_id = int(callback.data.split(":")[2])
    product = await get_product(product_id, admin_view=True)
    
    if "error" in product:
        await callback.answer("❌ Товар не найден", show_alert=True)
        return
    
    await callback.message.edit_text(
        f"✏️ <b>Редактирование товара</b>\n\n"
        f"{format_product_info(product)}\n\n"
        "Что изменить?",
        reply_markup=get_product_edit_keyboard(product_id)
    )


@router.callback_query(F.data.startswith("product:view:"))
async def view_product_details(callback: CallbackQuery):
    """View product details (e.g. back from edit)."""
    product_id = int(callback.data.split(":")[2])
    product = await get_product(product_id, admin_view=True)
    
    if "error" in product:
        await callback.answer("❌ Товар не найден", show_alert=True)
        return

    text = format_product_info(product)
    await callback.message.edit_text(
        text,
        reply_markup=get_product_actions_keyboard(product_id)
    )


@router.callback_query(F.data.startswith("product:delete:"))
async def confirm_delete_product(callback: CallbackQuery):
    """Confirm product deletion."""
    product_id = int(callback.data.split(":")[2])
    
    await callback.message.edit_text(
        "⚠️ <b>Вы уверены, что хотите удалить этот товар?</b>\n\n"
        "Это действие нельзя отменить.",
        reply_markup=get_confirm_keyboard("product", product_id)
    )


@router.callback_query(F.data.startswith("confirm:product:"))
async def do_delete_product(callback: CallbackQuery):
    """Actually delete the product."""
    product_id = int(callback.data.split(":")[2])
    result = await delete_product(product_id)
    
    if "error" in result:
        await callback.answer(f"❌ Ошибка: {result.get('detail')}", show_alert=True)
        return
    
    await callback.answer("🗑 Товар удалён!")
    await callback.message.edit_text(
        "🗑 Товар удалён.",
        reply_markup=get_admin_menu_keyboard()
    )


@router.callback_query(F.data.startswith("edit:"))
async def start_edit_field(callback: CallbackQuery, state: FSMContext):
    """Start editing a specific field."""
    parts = callback.data.split(":")
    field = parts[1]
    product_id = int(parts[2])
    
    await state.update_data(edit_field=field, product_id=product_id)
    await state.set_state(EditProductStates.waiting_value)
    
    field_names = {
        "price": "новую цену (₽)",
        "stock": "новый остаток в пачках (0 = неограничено)",
        "name": "новое название",
        "pack": "новое количество штук в пачке"
    }
    
    await callback.message.edit_text(
        f"✏️ Введите {field_names.get(field, 'новое значение')}:",
        reply_markup=get_cancel_keyboard()
    )


@router.callback_query(F.data.startswith("edit:photo"))
async def start_edit_photo(callback: CallbackQuery, state: FSMContext):
    """Start editing photos."""
    product_id = int(callback.data.split(":")[2])
    await state.update_data(product_id=product_id, images=[])
    await state.set_state(EditProductStates.waiting_photos)
    
    await callback.message.edit_text(
        "📷 <b>Изменение фото</b>\n\n"
        "Отправьте <b>новые фотографии</b> товара (можно несколько).\n"
        "⚠️ <b>Внимание:</b> Старые фото будут удалены!",
        reply_markup=get_cancel_keyboard()
    )


@router.message(EditProductStates.waiting_photos, F.photo)
async def process_edit_photo(message: Message, state: FSMContext):
    """Process new photos during edit."""
    photo = message.photo[-1]
    data = await state.get_data()
    images = data.get("images", [])
    images.append(photo.file_id)
    await state.update_data(images=images)
    
    count = len(images)
    await message.answer(
        f"✅ Фото #{count} добавлено.\n"
        "Отправьте ещё или нажмите <b>Готово</b>.",
        reply_markup=get_done_keyboard()
    )


@router.callback_query(EditProductStates.waiting_photos, F.data == "done")
async def finish_edit_photo(callback: CallbackQuery, state: FSMContext):
    """Finish photo editing."""
    data = await state.get_data()
    product_id = data.get("product_id")
    images = data.get("images", [])
    
    if not images:
        await callback.answer("❌ Загрузите хотя бы одно фото!", show_alert=True)
        return
        
    result = await update_product(product_id, {"images": images})
    await state.clear()
    
    if "error" in result:
        await callback.message.answer(
            f"❌ Ошибка: {result.get('detail')}",
            reply_markup=get_admin_menu_keyboard()
        )
        return
        
    await callback.message.answer(
        f"✅ <b>Фото обновлены!</b>\n\n{format_product_info(result)}",
        reply_markup=get_admin_menu_keyboard()
    )


@router.message(EditProductStates.waiting_value)
async def process_edit_value(message: Message, state: FSMContext):
    """Process the new field value."""
    data = await state.get_data()
    field = data.get("edit_field")
    product_id = data.get("product_id")
    
    update_data = {}
    
    if field == "price":
        try:
            value = float(message.text.strip().replace(",", ".").replace("₽", ""))
            if value <= 0:
                raise ValueError
            update_data["price_per_unit"] = value
        except ValueError:
            await message.answer("❌ Введите корректную цену (положительное число).")
            return
    
    elif field == "stock":
        try:
            value = int(message.text.strip())
            if value < 0:
                raise ValueError
            update_data["in_stock"] = value if value > 0 else None
        except ValueError:
            await message.answer("❌ Введите корректное число.")
            return
    
    elif field == "name":
        update_data["name"] = message.text.strip()
    
    elif field == "pack":
        try:
            value = int(message.text.strip())
            if value < 1:
                raise ValueError
            update_data["pieces_per_pack"] = value
        except ValueError:
            await message.answer("❌ Введите корректное число (минимум 1).")
            return
    
    result = await update_product(product_id, update_data)
    await state.clear()
    
    if "error" in result:
        await message.answer(
            f"❌ Ошибка: {result.get('detail', 'Не удалось обновить')}",
            reply_markup=get_admin_menu_keyboard()
        )
        return
    
    await message.answer(
        f"✅ Товар обновлён!\n\n{format_product_info(result)}",
        reply_markup=get_admin_menu_keyboard()
    )
