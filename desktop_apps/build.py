import os
import shutil
import subprocess
import sys

def build():
    # Use project's virtualenv python if available, otherwise fallback to system python
    python_exe = sys.executable
    print("===================================================")
    print("   Building Desktop Apps for Kurortnik")
    print("===================================================")
    
    # 1. Install/upgrade dependencies
    print("\n[1/5] Installing/upgrading dependencies (pywebview, pyinstaller)...")
    subprocess.run([python_exe, "-m", "pip", "install", "pywebview", "pyinstaller", "--upgrade"])
    
    # Clean previous builds
    print("Cleaning temp build directories...")
    for folder in ['build', 'dist']:
        if os.path.exists(folder):
            try:
                shutil.rmtree(folder)
            except Exception as e:
                print(f"[WARNING] Could not clean folder {folder}: {e}")
                
    for file in os.listdir('.'):
        if file.endswith('.spec'):
            try:
                os.remove(file)
            except:
                pass
            
    # 2. Build Shop app
    print("\n[2/5] Compiling Shop app (Курортник.exe)...")
    cmd_shop = [
        python_exe, "-m", "PyInstaller",
        "--clean", "--noconsole", "--onefile",
        "--icon=shop.ico", "--name=Курортник",
        "build_shop.py"
    ]
    res_shop = subprocess.run(cmd_shop)
    if res_shop.returncode != 0:
        print("[ERROR] Failed to compile Shop app!")
        sys.exit(1)
        
    # 3. Build Admin app
    print("\n[3/5] Compiling Admin app (Админ Курортник.exe)...")
    cmd_admin = [
        python_exe, "-m", "PyInstaller",
        "--clean", "--noconsole", "--onefile",
        "--icon=admin.ico", "--name=Админ Курортник",
        "build_admin.py"
    ]
    res_admin = subprocess.run(cmd_admin)
    if res_admin.returncode != 0:
        print("[ERROR] Failed to compile Admin app!")
        sys.exit(1)
        
    # 4. Clean local cache and prepare release folder
    print("\n[4/5] Preparing release folder...")
    appdata = os.getenv('APPDATA')
    if appdata:
        for folder in ['Kurortnik', 'KurortnikAdmin']:
            path = os.path.join(appdata, folder)
            if os.path.exists(path):
                try:
                    shutil.rmtree(path)
                except Exception as e:
                    print(f"[WARNING] Could not clear cache at {path}: {e}")
                    
    shop_release_dir = '../Kurortnik_Shop'
    admin_release_dir = '../Kurortnik_Admin'
    os.makedirs(shop_release_dir, exist_ok=True)
    os.makedirs(admin_release_dir, exist_ok=True)
    
    # Delete old combined directory if it exists to avoid confusion
    old_release_dir = '../Kurortnik_Desktop_Apps'
    if os.path.exists(old_release_dir):
        try:
            shutil.rmtree(old_release_dir)
        except:
            pass
    
    try:
        shutil.copy('dist/Курортник.exe', os.path.join(shop_release_dir, 'Курортник.exe'))
        shutil.copy('dist/Админ Курортник.exe', os.path.join(admin_release_dir, 'Админ Курортник.exe'))
    except Exception as e:
        print(f"[ERROR] Failed to copy executables to release folders: {e}")
        sys.exit(1)
    
    # 5. Check for Inno Setup compiler
    iscc_paths = [
        r"C:\Program Files (x86)\Inno Setup 6\ISCC.exe",
        r"C:\Program Files\Inno Setup 6\ISCC.exe"
    ]
    iscc_exe = None
    for path in iscc_paths:
        if os.path.exists(path):
            iscc_exe = path
            break
            
    if iscc_exe:
        print("\n[5/5] Compiling Setup Installers (Inno Setup)...")
        subprocess.run([iscc_exe, "installer_shop.iss"])
        subprocess.run([iscc_exe, "installer_admin.iss"])
        print("[SUCCESS] Setup installers created!")
    else:
        print("\n[INFO] Inno Setup 6 not found in default system paths. Skipping installer compilation.")
        print("To create setup files, please install Inno Setup 6 (https://jrsoftware.org/isdl.php) and compile:")
        print("  - installer_shop.iss")
        print("  - installer_admin.iss")
        
    # Clean PyInstaller garbage
    print("\nCleaning up temporary files...")
    if os.path.exists('build'):
        try:
            shutil.rmtree('build')
        except:
            pass
    if os.path.exists('dist'):
        try:
            shutil.rmtree('dist')
        except:
            pass
            
    for file in os.listdir('.'):
        if file.endswith('.spec'):
            try:
                os.remove(file)
            except:
                pass
                
    print("\n===================================================")
    print("[SUCCESS] Desktop apps build finished successfully!")
    print(f"Shop App directory:  '{os.path.abspath(shop_release_dir)}'")
    print(f"Admin App directory: '{os.path.abspath(admin_release_dir)}'")
    print("===================================================")

if __name__ == '__main__':
    build()
