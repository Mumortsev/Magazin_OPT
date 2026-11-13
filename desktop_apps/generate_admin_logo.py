import os
from PIL import Image, ImageDraw, ImageFont

def create_admin_icon():
    # Load original logo
    img_path = '../LogoApp.jpg'
    if not os.path.exists(img_path):
        print(f"Error: {img_path} not found!")
        return
        
    img = Image.open(img_path)
    # Ensure it is RGB
    if img.mode != 'RGB':
        img = img.convert('RGB')
        
    draw = ImageDraw.Draw(img)
    
    # Blue background color in the bottom section
    bg_color = (22, 81, 139)
    
    # Paint over "ДОСТАВКА" using a rectangle that stays strictly inside the circle
    # The circle radius is approx 310px, centered at (320, 320).
    # [160, 475, 480, 550] is fully within the circle boundaries.
    draw.rectangle([155, 475, 485, 555], fill=bg_color)
    
    # Load Segoe UI Bold font or Arial Bold as fallback
    font_path = r"C:\Windows\Fonts\segoeuib.ttf"
    if not os.path.exists(font_path):
        font_path = r"C:\Windows\Fonts\arialbd.ttf"
        
    # We want to write "АДМИН КУРОРТНИК"
    # To fit "АДМИН КУРОРТНИК" beautifully in the circular arc, we use 32px font size.
    try:
        font = ImageFont.truetype(font_path, 32)
    except IOError:
        font = ImageFont.load_default()
        
    text = "АДМИН КУРОРТНИК"
    
    # Calculate text width and height to center it
    try:
        bbox = draw.textbbox((0, 0), text, font=font)
        text_w = bbox[2] - bbox[0]
        text_h = bbox[3] - bbox[1]
    except AttributeError:
        text_w, text_h = draw.textsize(text, font=font)
        
    # Center coordinates
    x = (640 - text_w) // 2
    y = 502
    
    # Draw text in white
    draw.text((x, y), text, fill=(255, 255, 255), font=font)
    
    # Save the resulting image as PNG first for inspection
    img.save('admin_logo_preview.png', 'PNG')
    print("Saved preview to admin_logo_preview.png")
    
    # Save as multi-resolution ICO file for Windows application
    ico_sizes = [(16, 16), (32, 32), (48, 48), (64, 64), (128, 128), (256, 256)]
    img.save('admin.ico', format='ICO', sizes=ico_sizes)
    print("Successfully generated admin.ico with multiple sizes!")

if __name__ == '__main__':
    create_admin_icon()
