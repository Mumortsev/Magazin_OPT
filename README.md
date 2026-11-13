## Новая оптовая витрина

Сайт: https://mumortsev.github.io/Magazin_OPT/

Исходники и инструкция: [storefront/README.md](storefront/README.md). Оригинальное мини-приложение сохранено ниже и в существующих папках.

---

# Telegram Mini App Store 🛍️

Магазин в виде Telegram Mini App с админ-панелью через бота.

## Структура проекта

```
├── frontend/          # Статичные файлы (для Netlify)
│   ├── index.html
│   ├── css/
│   ├── js/
│   └── assets/
├── backend/           # Python API + Бот (для Railway)
│   ├── api/           # FastAPI сервер
│   ├── bot/           # Telegram бот
│   └── requirements.txt
└── scripts/           # Скрипты импорта данных
```

## Деплой

### 1. Frontend → Netlify

1. Создайте новый сайт на [Netlify](https://netlify.com)
2. Подключите GitHub репозиторий
3. Настройки сборки:
   - **Publish directory:** `frontend`
4. После деплоя скопируйте URL сайта (например: `https://your-shop.netlify.app`)

### 2. Backend → Railway

1. Создайте новый проект на [Railway](https://railway.app)
2. Подключите тот же GitHub репозиторий
3. Укажите **Root Directory:** `backend`
4. Добавьте переменные окружения:
   - `BOT_TOKEN` - токен бота от @BotFather
   - `ADMIN_IDS` - ваш Telegram ID
   - `WEBAPP_URL` - URL сайта с Netlify
   - `DATABASE_URL` - оставить пустым (SQLite создастся автоматически)

### 3. Обновите Netlify

После получения URL бэкенда на Railway:
1. Откройте `netlify.toml`
2. Замените `https://your-backend-api.com` на реальный URL Railway

## Локальная разработка

```bash
# Установка зависимостей
cd backend
pip install -r requirements.txt

# Запуск API
python -m uvicorn api.main:app --reload --port 8000

# В другом терминале - запуск бота
python -m bot.main
```

## Команды бота

- `/start` - Главное меню
- `/get_my_id` - Узнать свой Telegram ID
- `/admin` - Админ-панель (только для админов)

## Лицензия

MIT
