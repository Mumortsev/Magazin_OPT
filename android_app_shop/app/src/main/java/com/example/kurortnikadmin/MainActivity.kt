package com.example.kurortnikadmin

import android.annotation.SuppressLint
import android.content.Intent
import android.content.pm.PackageManager
import android.net.Uri
import android.os.Bundle
import android.view.Gravity
import android.view.View
import android.view.ViewGroup
import android.view.WindowManager
import android.webkit.ValueCallback
import android.webkit.WebChromeClient
import android.webkit.WebResourceError
import android.webkit.WebResourceRequest
import android.webkit.WebView
import android.webkit.WebViewClient
import android.widget.FrameLayout
import android.widget.ProgressBar
import androidx.activity.ComponentActivity
import androidx.core.view.WindowCompat

class MainActivity : ComponentActivity() {
    private var webView: WebView? = null
    private var uploadMessage: ValueCallback<Array<Uri>>? = null
    private val fileChooserResultCode = 1

    @SuppressLint("SetJavaScriptEnabled")
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        
        // Configure system status bar and navigation bar to have solid brand blue background and white icons
        window.apply {
            clearFlags(WindowManager.LayoutParams.FLAG_TRANSLUCENT_STATUS)
            addFlags(WindowManager.LayoutParams.FLAG_DRAWS_SYSTEM_BAR_BACKGROUNDS)
            statusBarColor = android.graphics.Color.parseColor("#1B3A5F") // Brand blue
            navigationBarColor = android.graphics.Color.parseColor("#1B3A5F") // Brand blue
        }
        val controller = WindowCompat.getInsetsController(window, window.decorView)
        controller.isAppearanceLightStatusBars = false // White text/icons on dark status bar
        controller.isAppearanceLightNavigationBars = false // White icons on dark navigation bar
        
        val rootLayout = FrameLayout(this).apply {
            layoutParams = ViewGroup.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT,
                ViewGroup.LayoutParams.MATCH_PARENT
            )
            fitsSystemWindows = true
            setBackgroundColor(android.graphics.Color.parseColor("#1B3A5F")) // Brand blue
        }

        val progressBar = ProgressBar(this).apply {
            layoutParams = FrameLayout.LayoutParams(
                ViewGroup.LayoutParams.WRAP_CONTENT,
                ViewGroup.LayoutParams.WRAP_CONTENT,
                Gravity.CENTER
            )
            visibility = View.VISIBLE
        }

        val webView = WebView(this).apply {
            layoutParams = FrameLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT,
                ViewGroup.LayoutParams.MATCH_PARENT
            )
            
            webViewClient = object : WebViewClient() {
                private var hasError = false

                override fun onPageStarted(view: WebView?, url: String?, favicon: android.graphics.Bitmap?) {
                    super.onPageStarted(view, url, favicon)
                    if (url != "about:blank" && url?.startsWith("data:") != true) {
                        progressBar.visibility = View.VISIBLE
                        hasError = false
                    }
                }

                override fun onPageFinished(view: WebView?, url: String?) {
                    super.onPageFinished(view, url)
                    if (!hasError) {
                        progressBar.visibility = View.GONE
                    }
                }

                override fun onReceivedError(
                    view: WebView,
                    request: WebResourceRequest,
                    error: WebResourceError
                ) {
                    if (request.isForMainFrame) {
                        hasError = true
                        progressBar.visibility = View.GONE
                        
                        val errorHtml = """
                            <!DOCTYPE html>
                            <html>
                            <head>
                                <meta charset="UTF-8">
                                <meta name="viewport" content="width=device-width, initial-scale=1.0">
                                <title>Ошибка подключения</title>
                                <style>
                                    body {
                                        background-color: #F5F0E8;
                                        color: #1B3A5F;
                                        font-family: 'Segoe UI', Roboto, sans-serif;
                                        text-align: center;
                                        padding: 40px 20px;
                                        margin: 0;
                                        display: flex;
                                        flex-direction: column;
                                        justify-content: center;
                                        align-items: center;
                                        height: 80vh;
                                    }
                                    .container {
                                        max-width: 400px;
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
                                        text-decoration: none;
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
                                    <button class="btn" onclick="location.reload()">Повторить попытку</button>
                                </div>
                            </body>
                            </html>
                        """.trimIndent()
                        
                        view.loadDataWithBaseURL(null, errorHtml, "text/html", "UTF-8", null)
                    }
                }

                override fun shouldOverrideUrlLoading(view: WebView, url: String): Boolean {
                    if (url.startsWith("http://") || url.startsWith("https://")) {
                        if (url.contains("kurortnik-kurortnik.amvera.io")) {
                            return false
                        }
                        try {
                            val intent = Intent(Intent.ACTION_VIEW, Uri.parse(url))
                            startActivity(intent)
                        } catch (e: Exception) {
                            e.printStackTrace()
                        }
                        return true
                    }
                    
                    if (url.startsWith("intent:")) {
                        try {
                            val intent = Intent.parseUri(url, Intent.URI_INTENT_SCHEME)
                            if (intent != null) {
                                val info = packageManager.resolveActivity(intent, PackageManager.MATCH_DEFAULT_ONLY)
                                if (info != null) {
                                    startActivity(intent)
                                } else {
                                    val fallbackUrl = intent.getStringExtra("browser_fallback_url")
                                    if (fallbackUrl != null) {
                                        view.loadUrl(fallbackUrl)
                                    }
                                }
                                return true
                            }
                        } catch (e: Exception) {
                            e.printStackTrace()
                        }
                    }
                    
                    try {
                        val intent = Intent(Intent.ACTION_VIEW, Uri.parse(url))
                        startActivity(intent)
                    } catch (e: Exception) {
                        e.printStackTrace()
                    }
                    return true
                }
            }
            
            webChromeClient = object : WebChromeClient() {
                override fun onShowFileChooser(
                    webView: WebView,
                    filePathCallback: ValueCallback<Array<Uri>>,
                    fileChooserParams: FileChooserParams
                ): Boolean {
                    uploadMessage?.onReceiveValue(null)
                    uploadMessage = filePathCallback
                    
                    val intent = fileChooserParams.createIntent()
                    try {
                        startActivityForResult(intent, fileChooserResultCode)
                    } catch (e: Exception) {
                        uploadMessage = null
                        return false
                    }
                    return true
                }
            }
            
            settings.apply {
                javaScriptEnabled = true
                domStorageEnabled = true
                databaseEnabled = true
                allowFileAccess = true
                builtInZoomControls = true
                displayZoomControls = false
                
                // Remove "; wv" from user agent to bypass WebView in-app check and add custom wrapper identification
                userAgentString = userAgentString.replace("; wv", "").replace(" wv", "") + " KurortnikWrapper"
            }
        }
        
        this.webView = webView
        webView.clearCache(true)
        
        rootLayout.addView(webView)
        rootLayout.addView(progressBar)
        setContentView(rootLayout)
        
        webView.loadUrl("https://kurortnik-kurortnik.amvera.io/index.html?wrapper=true")
    }

    override fun onActivityResult(requestCode: Int, resultCode: Int, data: Intent?) {
        super.onActivityResult(requestCode, resultCode, data)
        if (requestCode == fileChooserResultCode) {
            if (uploadMessage == null) return
            uploadMessage?.onReceiveValue(WebChromeClient.FileChooserParams.parseResult(resultCode, data))
            uploadMessage = null
        }
    }

    override fun onBackPressed() {
        if (webView?.canGoBack() == true) {
            webView?.goBack()
        } else {
            super.onBackPressed()
        }
    }
}
