import sqlite3
import os

db_path = os.path.join(os.getcwd(), 'data', 'shop.db')

if not os.path.exists('data'):
    print("No data dir")
else:
    conn = sqlite3.connect(db_path)
    cursor = conn.cursor()
    
    try:
        cursor.execute("ALTER TABLE categories ADD COLUMN active BOOLEAN DEFAULT 1;")
        print("Added active to categories")
    except Exception as e:
        print(f"Error categories: {e}")
        
    try:
        cursor.execute("ALTER TABLE subcategories ADD COLUMN active BOOLEAN DEFAULT 1;")
        print("Added active to subcategories")
    except Exception as e:
        print(f"Error subcategories: {e}")
        
    try:
        cursor.execute("CREATE INDEX IF NOT EXISTS ix_orders_customer_phone ON orders (customer_phone);")
        print("Created index ix_orders_customer_phone")
    except Exception as e:
        print(f"Error index: {e}")
        
    try:
        cursor.execute("CREATE INDEX IF NOT EXISTS ix_orders_phone_tg ON orders (customer_phone, telegram_user_id);")
        print("Created composite index ix_orders_phone_tg")
    except Exception as e:
        print(f"Error composite index: {e}")
        
    conn.commit()
    conn.close()
    print("Done")
