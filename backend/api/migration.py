"""
Database migration utility.
Helps ensure DB schema is up to date on platforms like Amvera where DROP/CREATE is not an option.
"""
import logging
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import text
from .database import engine

async def check_and_fix_schema():
    """
    Checks if critical columns exist in the database and adds them if missing.
    This is a safe operation that does not lose data.
    """
    logging.info("Checking database schema...")
    
    async with engine.connect() as conn:
        # Check 'orders' table
        try:
            # Check for customer_organization
            # SQLite doesn't have IF NOT EXISTS for columns easily, so we try to select 1 row and catch error?
            # Or PRAGMA table_info('orders')
            
            result = await conn.execute(text("PRAGMA table_info('orders')"))
            columns = [row[1] for row in result.fetchall()]
            
            if "customer_organization" not in columns:
                logging.warning("⚠️ Column 'customer_organization' missing in 'orders'. Adding it...")
                await conn.execute(text("ALTER TABLE orders ADD COLUMN customer_organization TEXT"))
                await conn.commit()
                logging.info("✅ Added 'customer_organization' to 'orders'.")
                
            if "assigned_manager" not in columns:
                logging.warning("⚠️ Column 'assigned_manager' missing in 'orders'. Adding it...")
                await conn.execute(text("ALTER TABLE orders ADD COLUMN assigned_manager VARCHAR(50) DEFAULT NULL"))
                await conn.commit()
                logging.info("✅ Added 'assigned_manager' to 'orders'.")
                
            if "customer_comment" not in columns:
                logging.warning("⚠️ Column 'customer_comment' missing in 'orders'. Adding it...")
                await conn.execute(text("ALTER TABLE orders ADD COLUMN customer_comment TEXT DEFAULT NULL"))
                await conn.commit()
                logging.info("✅ Added 'customer_comment' to 'orders'.")

            if "whatsapp_phone" not in columns:
                logging.warning("⚠️ Column 'whatsapp_phone' missing in 'orders'. Adding it...")
                await conn.execute(text("ALTER TABLE orders ADD COLUMN whatsapp_phone VARCHAR(50) DEFAULT NULL"))
                await conn.commit()
                logging.info("✅ Added 'whatsapp_phone' to 'orders'.")

            if "platform" not in columns:
                logging.warning("⚠️ Column 'platform' missing in 'orders'. Adding it...")
                await conn.execute(text("ALTER TABLE orders ADD COLUMN platform VARCHAR(20) DEFAULT 'telegram'"))
                await conn.commit()
                logging.info("✅ Added 'platform' to 'orders'.")
                
            # Ensure composite index on customer_phone and telegram_user_id exists
            try:
                await conn.execute(text("CREATE INDEX IF NOT EXISTS ix_orders_phone_tg ON orders (customer_phone, telegram_user_id)"))
                await conn.commit()
                logging.info("✅ Ensured index ix_orders_phone_tg exists on orders table.")
            except Exception as e:
                logging.error(f"Error creating composite index ix_orders_phone_tg: {e}")
                
        except Exception as e:
            logging.error(f"Error checking 'orders' schema: {e}")

        # Check 'order_items' table
        try:
            result = await conn.execute(text("PRAGMA table_info('order_items')"))
            columns = [row[1] for row in result.fetchall()]
            
            if "quantity_pieces" not in columns:
                logging.warning("⚠️ Column 'quantity_pieces' missing in 'order_items'. Adding it...")
                await conn.execute(text("ALTER TABLE order_items ADD COLUMN quantity_pieces INTEGER NOT NULL DEFAULT 0"))
                await conn.commit()
                logging.info("✅ Added 'quantity_pieces' to 'order_items'.")
                
        except Exception as e:
            logging.error(f"Error checking 'order_items' schema: {e}")

        # Check 'products' table for pieces_per_pack if needed
        try:
            result = await conn.execute(text("PRAGMA table_info('products')"))
            columns = [row[1] for row in result.fetchall()]
            
            # Check for pieces_per_pack
            if "pieces_per_pack" not in columns:
                logging.warning("⚠️ Column 'pieces_per_pack' missing in 'products'. Adding it...")
                await conn.execute(text("ALTER TABLE products ADD COLUMN pieces_per_pack INTEGER DEFAULT 1"))
                await conn.commit()
            
            # Check for badge_text
            if "badge_text" not in columns:
                logging.warning("⚠️ Column 'badge_text' missing in 'products'. Adding it...")
                await conn.execute(text("ALTER TABLE products ADD COLUMN badge_text VARCHAR(50)"))
                await conn.commit()

            # Check for badge_bg_color
            if "badge_bg_color" not in columns:
                logging.warning("⚠️ Column 'badge_bg_color' missing in 'products'. Adding it...")
                await conn.execute(text("ALTER TABLE products ADD COLUMN badge_bg_color VARCHAR(20)"))
                await conn.commit()
                
            # Check if any products have NULL pieces_per_pack and fix them
            await conn.execute(text("UPDATE products SET pieces_per_pack = 1 WHERE pieces_per_pack IS NULL"))
            await conn.commit()
            
            # Check for in_stock
            if "in_stock" not in columns:
                logging.warning("⚠️ Column 'in_stock' missing in 'products'. Adding it...")
                await conn.execute(text("ALTER TABLE products ADD COLUMN in_stock INTEGER DEFAULT NULL"))
                await conn.commit()
                logging.info("✅ Added 'in_stock' to 'products'.")
            
            # Check for is_new
            if "is_new" not in columns:
                logging.warning("⚠️ Column 'is_new' missing in 'products'. Adding it...")
                await conn.execute(text("ALTER TABLE products ADD COLUMN is_new BOOLEAN DEFAULT 0"))
                await conn.commit()
                logging.info("✅ Added 'is_new' to 'products'.")
            
        except Exception as e:
            logging.error(f"Error checking 'products' schema: {e}")

        # Check 'categories' table
        try:
            result = await conn.execute(text("PRAGMA table_info('categories')"))
            columns = [row[1] for row in result.fetchall()]
            
            if "image_file_id" not in columns:
                logging.warning("⚠️ Column 'image_file_id' missing in 'categories'. Adding it...")
                await conn.execute(text("ALTER TABLE categories ADD COLUMN image_file_id VARCHAR(255) DEFAULT NULL"))
                await conn.commit()
                logging.info("✅ Added 'image_file_id' to 'categories'.")

            if "image_url" not in columns:
                logging.warning("⚠️ Column 'image_url' missing in 'categories'. Adding it...")
                await conn.execute(text("ALTER TABLE categories ADD COLUMN image_url VARCHAR(1000) DEFAULT NULL"))
                await conn.commit()
                logging.info("✅ Added 'image_url' to 'categories'.")
        except Exception as e:
            logging.error(f"Error checking 'categories' schema: {e}")

        # Check 'subcategories' table
        try:
            result = await conn.execute(text("PRAGMA table_info('subcategories')"))
            columns = [row[1] for row in result.fetchall()]
            
            if "image_file_id" not in columns:
                logging.warning("⚠️ Column 'image_file_id' missing in 'subcategories'. Adding it...")
                await conn.execute(text("ALTER TABLE subcategories ADD COLUMN image_file_id VARCHAR(255) DEFAULT NULL"))
                await conn.commit()
                logging.info("✅ Added 'image_file_id' to 'subcategories'.")

            if "image_url" not in columns:
                logging.warning("⚠️ Column 'image_url' missing in 'subcategories'. Adding it...")
                await conn.execute(text("ALTER TABLE subcategories ADD COLUMN image_url VARCHAR(1000) DEFAULT NULL"))
                await conn.commit()
                logging.info("✅ Added 'image_url' to 'subcategories'.")
        except Exception as e:
            logging.error(f"Error checking 'subcategories' schema: {e}")

        # Check and create 'fcm_tokens' table
        try:
            await conn.execute(text("""
                CREATE TABLE IF NOT EXISTS fcm_tokens (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    device_id VARCHAR(255) NOT NULL,
                    token TEXT NOT NULL,
                    role VARCHAR(20) NOT NULL DEFAULT 'admin',
                    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
                )
            """))
            await conn.execute(text("CREATE INDEX IF NOT EXISTS ix_fcm_tokens_device_id ON fcm_tokens (device_id)"))
            await conn.commit()
            logging.info("✅ Ensured fcm_tokens table and index exist.")
        except Exception as e:
            logging.error(f"Error checking/creating fcm_tokens table: {e}")
            
        # Run categories deduplication and cleanup
        try:
            await cleanup_duplicate_categories(conn)
        except Exception as e:
            logging.error(f"Error calling cleanup_duplicate_categories: {e}")
            
    logging.info("Schema check complete.")


async def cleanup_duplicate_categories(conn):
    """
    Cleans up duplicate inactive categories, merges products into active categories,
    cleans up subcategories leaving only 'Магниты со стразами' under 'Магниты',
    and deletes the test category 'Наушники'.
    """
    logging.info("Starting database categories cleanup/merging...")
    try:
        # Clean up leading/trailing whitespaces in all category and subcategory names first
        await conn.execute(text("UPDATE categories SET name = TRIM(name)"))
        await conn.execute(text("UPDATE subcategories SET name = TRIM(name)"))
        await conn.commit()

        # 1. Delete test category 'Наушники' and its products
        res_hp = await conn.execute(text("SELECT id, name FROM categories"))
        hp_ids = []
        for row in res_hp.fetchall():
            c_id, c_name = row[0], row[1]
            if c_name.strip().lower() == "наушники":
                hp_ids.append(c_id)
        
        for hp_id in hp_ids:
            logging.info(f"Removing test category 'Наушники' (ID {hp_id}) and its products...")
            res_p = await conn.execute(text("SELECT id FROM products WHERE category_id = :hp_id"), {"hp_id": hp_id})
            prod_ids = [row[0] for row in res_p.fetchall()]
            
            for p_id in prod_ids:
                await conn.execute(text("DELETE FROM order_items WHERE product_id = :p_id"), {"p_id": p_id})
                await conn.execute(text("DELETE FROM product_images WHERE product_id = :p_id"), {"p_id": p_id})
                await conn.execute(text("DELETE FROM products WHERE id = :p_id"), {"p_id": p_id})
                logging.info(f"Deleted product ID {p_id} (Xiaomi/JBL test products)")
                
            await conn.execute(text("DELETE FROM subcategories WHERE category_id = :hp_id"), {"hp_id": hp_id})
            await conn.execute(text("DELETE FROM categories WHERE id = :hp_id"), {"hp_id": hp_id})
            await conn.commit()
            logging.info(f"Successfully deleted category 'Наушники' (ID {hp_id})")

        # 2. Find active 'Магниты' category
        res_mag = await conn.execute(text("SELECT id FROM categories WHERE name = 'Магниты' AND active = 1"))
        mag_row = res_mag.fetchone()
        magnets_active_id = mag_row[0] if mag_row else None
        
        straz_subcat_id = None
        if magnets_active_id:
            # Find or create 'Магниты со стразами' subcategory
            res_straz = await conn.execute(text("""
                SELECT id FROM subcategories 
                WHERE category_id = :cat_id AND name = 'Магниты со стразами'
            """), {"cat_id": magnets_active_id})
            straz_row = res_straz.fetchone()
            if straz_row:
                straz_subcat_id = straz_row[0]
            else:
                await conn.execute(text("""
                    INSERT INTO subcategories (category_id, name, "order", active)
                    VALUES (:cat_id, 'Магниты со стразами', 0, 1)
                """), {"cat_id": magnets_active_id})
                res_rowid = await conn.execute(text("SELECT last_insert_rowid()"))
                straz_subcat_id = res_rowid.scalar()
                logging.info(f"Created active subcategory 'Магниты со стразами' (ID {straz_subcat_id}) under 'Магниты'")

            # Update products of active 'Магниты' category that pointed to other subcategories
            # Set their subcategory_id to NULL
            await conn.execute(text("""
                UPDATE products 
                SET subcategory_id = NULL 
                WHERE category_id = :cat_id AND subcategory_id != :straz_id AND subcategory_id IS NOT NULL
            """), {"cat_id": magnets_active_id, "straz_id": straz_subcat_id})
            
            # Delete all subcategories of active 'Магниты' except 'Магниты со стразами'
            await conn.execute(text("""
                DELETE FROM subcategories 
                WHERE category_id = :cat_id AND id != :straz_id
            """), {"cat_id": magnets_active_id, "straz_id": straz_subcat_id})
            await conn.commit()
            logging.info("Cleaned up subcategories of 'Магниты', leaving only 'Магниты со стразами'.")

        # 3. Retrieve all categories
        result = await conn.execute(text("SELECT id, name, active FROM categories"))
        db_categories = result.fetchall()
        
        active_by_id = {}
        active_by_name = {}  # normalized name -> id
        inactive_categories = []
        
        for row in db_categories:
            cat_id, name, active = row[0], row[1], bool(row[2])
            norm_name = " ".join(name.lower().split())
            if active:
                active_by_id[cat_id] = name
                active_by_name[norm_name] = cat_id
            else:
                if norm_name != "наушники":
                    inactive_categories.append((cat_id, name, norm_name))

        fallback_name_map = {
            "глицерин": "глицирин",
            "изделия из дерева": "дерево",
            "катана- чесалка- сачок-деревянные изделья": "сачки, чесалки, катаны",
            "надувка китай": "надувка (китай)",
            "палатки и зонты": "палатки, зонты",
            "спорттовары, мячи": "мячи",
            "спорттовары- мячи-игрушки": "мячи",
            "спорт товары-мячи-игрушки": "игрушки",
            "спорт a25:g51товары-мячи-игрушки": "игры",
            "сумки пляжные,полотенца ,шляпы,парео": "сумки пляжные",
            "чайники-кружки-тарелки-свистки": "чайники",
            "шторки , ароматизаторы ,пемза,дождевики,пепельницы": "шторки для авто",
            "очки-маски- ласты (китай)": "маски, очки, ласты",
            "мыло": "фигурки полистон",
            "средства от комаров": "средства для загара",
            "планшеты": "игры",
            "палатки-зонты-лежаки-стулья": "лежаки",
            "летняя обувь": "аквашузы",
            "статуэтки из полистоуна": "фигурки полистон",
            "стулья": "лежаки",
            "сумки": "сумки пляжные",
            # Магниты / Тарелки mappings to 'магниты'
            "магнит-тарелки": "магниты",
            "магниты - тарелки": "магниты",
            "магниты-тарелки": "магниты",
            "тарелки": "магниты"
        }

        # Fetch all subcategory names to check if product's old subcategory was "стразы"
        subcat_names_res = await conn.execute(text("SELECT id, name FROM subcategories"))
        subcat_names = {row[0]: row[1] for row in subcat_names_res.fetchall()}

        for in_id, in_name, norm_name in inactive_categories:
            target_active_id = active_by_name.get(norm_name)
            if not target_active_id:
                mapped_name = fallback_name_map.get(norm_name)
                if mapped_name:
                    target_active_id = active_by_name.get(mapped_name)
                    
            if not target_active_id:
                logging.warning(f"Could not find active target for inactive category '{in_name}' (ID {in_id})")
                continue
                
            logging.info(f"Merging inactive category '{in_name}' (ID {in_id}) -> active '{active_by_id[target_active_id]}' (ID {target_active_id})...")
            
            # Fetch all products from the inactive category to process them
            prod_res = await conn.execute(text("SELECT id, name, subcategory_id FROM products WHERE category_id = :in_id"), {"in_id": in_id})
            in_prods = prod_res.fetchall()
            
            for p_id, p_name, old_sub_id in in_prods:
                new_sub_id = None
                # If target category is 'Магниты', check if this product belongs to 'Магниты со стразами'
                if magnets_active_id and target_active_id == magnets_active_id:
                    old_sub_name = subcat_names.get(old_sub_id, "") if old_sub_id else ""
                    if "страз" in p_name.lower() or "страз" in old_sub_name.lower():
                        new_sub_id = straz_subcat_id
                
                # Update product
                await conn.execute(text("""
                    UPDATE products 
                    SET category_id = :target_cat_id, subcategory_id = :new_sub_id 
                    WHERE id = :p_id
                """), {
                    "target_cat_id": target_active_id,
                    "new_sub_id": new_sub_id,
                    "p_id": p_id
                })
            
            # Delete old subcategories of this inactive category
            await conn.execute(text("DELETE FROM subcategories WHERE category_id = :old_cat_id"), {"old_cat_id": in_id})
            # Delete old category itself
            await conn.execute(text("DELETE FROM categories WHERE id = :old_cat_id"), {"old_cat_id": in_id})
            
            await conn.commit()
            logging.info(f"Successfully merged category ID {in_id} into ID {target_active_id} and cleaned up.")
            
        logging.info("Database categories cleanup/merging complete!")
    except Exception as e:
        logging.error(f"Error during categories cleanup: {e}")
