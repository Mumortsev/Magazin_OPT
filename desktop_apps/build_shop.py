import os
import webview
import subprocess
import urllib.request

ERROR_HTML = """
<!DOCTYPE html>
<html>
<head>
    <meta charset="UTF-8">
    <title>Ошибка подключения</title>
    <style>
        body {
            background-color: #F5F0E8;
            color: #1B3A5F;
            font-family: 'Segoe UI', Roboto, sans-serif;
            text-align: center;
            padding: 100px 20px;
            margin: 0;
            display: flex;
            flex-direction: column;
            justify-content: center;
            align-items: center;
            height: 60vh;
        }
        .container {
            max-width: 450px;
        }
        h2 {
            color: #1B3A5F;
            margin-bottom: 10px;
            font-weight: 600;
        }
        p {
            color: #555555;
            font-size: 15px;
            line-height: 1.5;
            margin-bottom: 25px;
        }
        .btn {
            background-color: #1B3A5F;
            color: white;
            border: none;
            padding: 12px 30px;
            font-size: 15px;
            font-weight: bold;
            border-radius: 30px;
            cursor: pointer;
            box-shadow: 0 4px 12px rgba(27, 58, 95, 0.2);
            transition: background-color 0.2s;
        }
        .btn:active {
            background-color: #11253f;
        }
    </style>
</head>
<body>
    <div class="container">
        <div style="font-size: 48px; margin-bottom: 15px;">📡</div>
        <h2>Обновление системы</h2>
        <p>Сервер временно недоступен. Возможно, идет плановое обновление или возникли неполадки с интернет-соединением. Пожалуйста, подождите минутку и повторите попытку.</p>
        <button class="btn" onclick="window.pywebview.api.retry_connection()">Повторить попытку</button>
    </div>
</body>
</html>
"""

def check_connection():
    try:
        # Check if we can connect to Amvera's health endpoint
        urllib.request.urlopen("https://kurortnik-kurortnik.amvera.io/health", timeout=5)
        return True
    except Exception:
        return False

class WindowApi:
    def __init__(self, window, target_url):
        self._window = window
        self.target_url = target_url

    def show_notification(self, title, message):
        title_esc = title.replace("'", "''").replace('"', '`"')
        msg_esc = message.replace("'", "''").replace('"', '`"')
        ps_script = f"""
        [void] [System.Reflection.Assembly]::LoadWithPartialName('System.Windows.Forms');
        $notification = New-Object System.Windows.Forms.NotifyIcon;
        $notification.Icon = [System.Drawing.SystemIcons]::Information;
        $notification.Visible = $true;
        $notification.ShowBalloonTip(5000, '{title_esc}', '{msg_esc}', [System.Windows.Forms.ToolTipIcon]::Info);
        Start-Sleep -Seconds 4;
        $notification.Dispose();
        """
        startupinfo = subprocess.STARTUPINFO()
        startupinfo.dwFlags |= subprocess.STARTF_USESHOWWINDOW
        startupinfo.wShowWindow = subprocess.SW_HIDE
        subprocess.Popen(["powershell", "-NoProfile", "-Command", ps_script], startupinfo=startupinfo)

    def retry_connection(self):
        if check_connection():
            self._window.load_url(self.target_url)
        else:
            self._window.evaluate_js("alert('Сервер по-прежнему недоступен. Пожалуйста, подождите минутку и попробуйте снова.');")

def on_loaded(window):
    # Disable right-click context menu and web developer shortcut keys
    window.evaluate_js("""
        document.addEventListener('contextmenu', event => event.preventDefault());
        document.addEventListener('keydown', event => {
            if (event.key === 'F5' || 
                (event.ctrlKey && (event.key === 'r' || event.key === 'R')) || 
                event.key === 'F12') {
                event.preventDefault();
            }
        });
    """)

if __name__ == '__main__':
    # Define custom isolated storage path for the shop app
    appdata_path = os.getenv('APPDATA')
    storage_path = os.path.join(appdata_path, 'Kurortnik') if appdata_path else None

    # Check connection first
    target_url = 'https://kurortnik-kurortnik.amvera.io/?platform=desktop'
    online = check_connection()

    api = WindowApi(None, target_url)

    # Create window with title "Курортник"
    window = webview.create_window(
        title='Курортник',
        url=target_url if online else None,
        html=None if online else ERROR_HTML,
        width=1280,
        height=800,
        min_size=(900, 600),
        resizable=True,
        js_api=api
    )
    
    api._window = window
    
    # Bind loaded event to inject cache-control and UI protection
    window.events.loaded += lambda: on_loaded(window)
    
    # Start webview with persistent user session data
    webview.start(private_mode=False, storage_path=storage_path)
