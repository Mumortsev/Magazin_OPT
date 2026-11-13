import os

def remove_bom(filepath):
    try:
        with open(filepath, 'rb') as f:
            content = f.read()
        if content.startswith(b'\xef\xbb\xbf'):
            with open(filepath, 'wb') as f:
                f.write(content[3:])
            print(f"Removed BOM from: {filepath}")
    except Exception as e:
        print(f"Error on {filepath}: {e}")

print("Scanning for BOMs in frontend...")
for root, dirs, files in os.walk('frontend'):
    for file in files:
        if file.endswith(('.js', '.css', '.html')):
            remove_bom(os.path.join(root, file))
print("Done scan.")
