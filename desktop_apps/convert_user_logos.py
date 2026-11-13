import os
from PIL import Image

def convert_logos():
    shop_jpg = 'Админ.jpeg'
    admin_jpg = 'Магазин.jpeg'
    
    ico_sizes = [(16, 16), (32, 32), (48, 48), (64, 64), (128, 128), (256, 256)]
    
    if os.path.exists(shop_jpg):
        print(f"Converting {shop_jpg} to shop.ico...")
        img = Image.open(shop_jpg)
        if img.mode != 'RGB':
            img = img.convert('RGB')
        img.save('shop.ico', format='ICO', sizes=ico_sizes)
        print("Successfully generated shop.ico")
    else:
        print(f"Warning: {shop_jpg} not found!")

    if os.path.exists(admin_jpg):
        print(f"Converting {admin_jpg} to admin.ico...")
        img = Image.open(admin_jpg)
        if img.mode != 'RGB':
            img = img.convert('RGB')
        img.save('admin.ico', format='ICO', sizes=ico_sizes)
        print("Successfully generated admin.ico")
    else:
        print(f"Warning: {admin_jpg} not found!")

if __name__ == '__main__':
    convert_logos()
