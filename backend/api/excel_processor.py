import pandas as pd
from sqlalchemy import select
from api.database import AsyncSessionLocal
from api.models import Category, Subcategory, Product
import logging
import os

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

# Поддерживаемые форматы
SUPPORTED_EXTENSIONS = {'.xlsx', '.xls', '.xlsm', '.xlsb', '.ods', '.csv', '.tsv'}


COLUMN_ALIASES = {
    'category': ['категория', 'группа'],
    'subcategory': ['подкатегория', 'подгруппа'],
    'name': ['наименование', 'название', 'товар', 'имя', 'продукт'],
    'article': ['артикул', 'sku', 'код', 'штрихкод'],
    'price': ['цена (за 1 шт/₽)', 'цена', 'стоимость', 'прайс', 'цена/шт'],
    'pack_size': ['кол-во в пачке (шт)', 'кол-во в пачке', 'кол-во в упаковке', 'в пачке', 'штук в упаковке', 'шт/уп', 'упаковка'],
    'desc': ['описание', 'информация', 'детали', 'заметки']
}


def read_spreadsheet(file_path: str) -> pd.DataFrame:
    """
    Читает файл таблицы любого поддерживаемого формата.
    Поддерживает: .xlsx, .xls, .xlsm, .xlsb, .ods, .csv, .tsv
    """
    extension = os.path.splitext(file_path)[1].lower()

    # CSV / TSV — отдельная ветка
    if extension == '.csv':
        # Пробуем разные кодировки
        for enc in ('utf-8-sig', 'utf-8', 'cp1251', 'latin-1'):
            try:
                return pd.read_csv(file_path, encoding=enc, sep=None, engine='python')
            except (UnicodeDecodeError, Exception):
                continue
        return pd.read_csv(file_path, encoding='latin-1', sep=None, engine='python')

    if extension == '.tsv':
        for enc in ('utf-8-sig', 'utf-8', 'cp1251', 'latin-1'):
            try:
                return pd.read_csv(file_path, encoding=enc, sep='\t')
            except (UnicodeDecodeError, Exception):
                continue
        return pd.read_csv(file_path, encoding='latin-1', sep='\t')

    # Excel-форматы: подбираем движок
    engine_map = {
        '.xlsx': 'openpyxl',
        '.xlsm': 'openpyxl',
        '.xls':  'xlrd',
        '.xlsb': 'pyxlsb',
        '.ods':  'odf',
    }

    engine = engine_map.get(extension)

    # Первая попытка — с указанным движком
    if engine:
        try:
            return pd.read_excel(file_path, engine=engine)
        except ImportError:
            logger.warning(f"Движок '{engine}' не установлен, пробуем без него")
        except Exception as e:
            logger.warning(f"Ошибка с движком '{engine}': {e}, пробуем другие варианты")

    # Фолбэк — pandas сам попробует определить движок
    try:
        return pd.read_excel(file_path)
    except Exception:
        pass

    # Последний фолбэк — может быть CSV, переименованный в .xlsx
    try:
        return pd.read_csv(file_path, sep=None, engine='python', encoding='utf-8-sig')
    except Exception:
        pass

    raise ValueError(
        f"Не удалось прочитать файл. Поддерживаемые форматы: "
        f"{', '.join(sorted(SUPPORTED_EXTENSIONS))}"
    )


async def process_excel_import(file_path: str):
    """
    Обработка файла таблицы и импорт в БД.
    Поддерживает: .xlsx, .xls, .xlsm, .xlsb, .ods, .csv, .tsv
    Колонки: Категория, Подкатегория, Наименование, Артикул, Цена (за 1 шт/₽), Кол-во в пачке (шт), Описание
    """
    try:
        try:
            df = read_spreadsheet(file_path)
        except Exception as e:
            error_msg = str(e)
            logger.error(f"Spreadsheet read error: {error_msg}")
            return f"❌ Ошибка при чтении файла: {error_msg}"

        if df.empty:
            return "❌ Ошибка: Файл пуст."

        # Очистка названий колонок от лишних пробелов и приведение к нижнему регистру для поиска
        df.columns = [str(c).strip().lower() for c in df.columns]

        # Синонимы колонок


        # Определяем, какие колонки реально существуют в загруженном файле
        from typing import Optional, Any, List, Dict
        actual_cols: Dict[str, Any] = {} 
        for key, possible_names in COLUMN_ALIASES.items():
            actual_cols[key] = None
            for col in df.columns:
                if col in possible_names:
                    actual_cols[key] = col
                    break

        if not actual_cols.get('name'):
            return "❌ Ошибка: Не найдена колонка с названием товара. Столбец должен называться 'Наименование' или 'Название'."
        
        # Информационные сообщения
        import_errors: list[str] = []
        import_warnings: list[str] = []
        count_added: int = 0
        count_updated: int = 0
        count_skipped: int = 0

        async with AsyncSessionLocal() as session:
            # Используем iterrows с индексом для отслеживания номера строки (Excel обычно 1-based, +1 на заголовок)
            for idx, row in df.iterrows():
                row_num = idx + 2  # Pandas index starts at 0, header is row 1
                
                name_col = actual_cols['name']
                name_val = row.get(name_col)
                if pd.isna(name_val) or str(name_val).strip() == '' or str(name_val).lower() == 'nan':
                    # Проверяем, не пустая ли вся строка полностью
                    if row.dropna().empty:
                        continue # Просто пустая строка в конце файла
                    import_errors.append(f"Строка {row_num}: Пропущено название товара")
                    count_skipped = int(count_skipped) + 1 # type: ignore
                    continue
                
                name = str(name_val).strip()
                
                # 1. Категория
                cat_col = actual_cols['category']
                cat_val = row.get(cat_col)
                cat_name = str(cat_val).replace('\xa0', ' ').strip() if not pd.isna(cat_val) else 'Без категории'
                if cat_name.lower() == 'nan' or not cat_name:
                    cat_name = 'Без категории'
                
                # 2. Подкатегория
                sub_col = actual_cols['subcategory']
                sub_val = row.get(sub_col)
                sub_name = str(sub_val).replace('\xa0', ' ').strip() if not pd.isna(sub_val) else ''
                if sub_name.lower() == 'nan':
                    sub_name = ''
                
                # 3. Артикул
                art_col = actual_cols['article']
                art_val = row.get(art_col)
                article = str(art_val).strip() if not pd.isna(art_val) else None
                if article and article.lower() == 'nan':
                    article = None
                
                # 4. Цена
                price = 0.0
                price_col = actual_cols['price']
                if price_col:
                    try:
                        p_val = row.get(price_col)
                        if not pd.isna(p_val) and str(p_val).strip() != '':
                            # Очистка цены от валютных знаков и пробелов
                            price_str = str(p_val).replace('₽', '').replace('$', '').replace(' ', '').replace(',', '.').strip()
                            price = float(price_str)
                    except (ValueError, TypeError):
                        import_warnings.append(f"Строка {row_num}: Некорректная цена '{row.get(price_col)}', установлено 0.0")
                    
                # 5. Кол-во в пачке
                pack_size = 1
                pack_col = actual_cols['pack_size']
                if pack_col:
                    try:
                        pk_val = row.get(pack_col)
                        if not pd.isna(pk_val) and str(pk_val).strip() != '':
                            pack_size = int(float(str(pk_val).replace(' ', '').strip()))
                    except (ValueError, TypeError):
                        import_warnings.append(f"Строка {row_num}: Некорректное кол-во в пачке '{row.get(pack_col)}', установлено 1")
                    
                # 6. Описание
                desc_col = actual_cols['desc']
                desc_val = row.get(desc_col)
                desc = str(desc_val).strip() if not pd.isna(desc_val) else None
                if desc and desc.lower() == 'nan':
                    desc = None
                
                try:
                    # Поиск/Создание категории
                    res = await session.execute(select(Category).where(Category.name == cat_name))
                    category = res.scalars().first()
                    if not category:
                        category = Category(name=cat_name)
                        session.add(category)
                        await session.flush()
                    else:
                        category.active = True # Реактивируем категорию при импорте
                    
                    # Поиск подкатегории
                    subcategory_id = None
                    if sub_name:
                        res = await session.execute(
                            select(Subcategory).where(
                                Subcategory.category_id == category.id,
                                Subcategory.name == sub_name
                            )
                        )
                        subcategory = res.scalars().first()
                        if not subcategory:
                            subcategory = Subcategory(category_id=category.id, name=sub_name)
                            session.add(subcategory)
                            await session.flush()
                        else:
                            subcategory.active = True # Реактивируем подкатегорию при импорте
                        subcategory_id = subcategory.id
                    
                    # Поиск и обновление/создание товара
                    query = select(Product).where(
                        Product.name == name,
                        Product.category_id == category.id
                    )
                    
                    if article:
                        query = query.where(Product.sku == article)
                        
                    res = await session.execute(query)
                    product = res.scalars().first()
                    
                    if product:
                        product.price_per_unit = price
                        product.pieces_per_pack = pack_size
                        product.description = desc
                        product.subcategory_id = subcategory_id
                        product.sku = article
                        product.active = True # Реактивируем товар при импорте
                        count_updated = int(count_updated) + 1 # type: ignore
                    else:
                        product = Product(
                            name=name,
                            category_id=category.id,
                            subcategory_id=subcategory_id,
                            price_per_unit=price,
                            pieces_per_pack=pack_size,
                            description=desc,
                            sku=article,
                            active=True
                        )
                        session.add(product)
                        await session.flush()
                        count_added = int(count_added) + 1 # type: ignore
                except Exception as row_err:
                    await session.rollback() # Откатываем изменения текущей строки
                    logger.error(f"Row {row_num} processing error: {row_err}")
                    import_errors.append(f"Строка {row_num}: Ошибка базы данных - {str(row_err)}")
                    count_skipped += 1
                    continue
            
            await session.commit()
            
            # Формирование итогового сообщения
            summary = [f"✅ Импорт завершен!"]
            summary.append(f"Добавлено: {count_added}")
            summary.append(f"Обновлено: {count_updated}")
            if count_skipped > 0:
                summary.append(f"Пропущено: {count_skipped}")
            
            if import_errors:
                summary.append("\n❌ Ошибки:")
                for i in range(min(20, len(import_errors))):
                    summary.append(import_errors[i])
                if len(import_errors) > 20:
                    summary.append(f"...и еще {len(import_errors) - 20} ошибок.")
            
            if import_warnings:
                summary.append("\n⚠️ Предупреждения:")
                for i in range(min(10, len(import_warnings))):
                    summary.append(import_warnings[i])
                if len(import_warnings) > 10:
                    summary.append(f"...и еще {len(import_warnings) - 10} предупреждений.")
                    
            return "\n".join(summary)
            
    except Exception as e:
        logger.error(f"Excel import error: {e}")
        return f"❌ Критическая ошибка при обработке файла: {str(e)}"
