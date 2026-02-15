// File: app/src/main/java/com/flowork/gui/EngineActivity.kt
package com.flowork.gui

import android.Manifest
import android.annotation.SuppressLint
import android.app.Activity
import android.app.DownloadManager
import android.content.ContentValues
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.media.projection.MediaProjectionManager
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.os.Environment
import android.provider.MediaStore
import android.provider.Settings
import android.util.Base64
import android.webkit.CookieManager
import android.webkit.GeolocationPermissions
import android.webkit.JavascriptInterface
import android.webkit.PermissionRequest
import android.webkit.URLUtil
import android.webkit.ValueCallback
import android.webkit.WebChromeClient
import android.webkit.WebResourceRequest
import android.webkit.WebSettings
import android.webkit.WebView
import android.webkit.WebViewClient
import android.widget.Toast
import androidx.activity.result.contract.ActivityResultContracts
import androidx.appcompat.app.AppCompatActivity
import androidx.core.content.ContextCompat
import com.flowork.os.FloatingControlService
import com.flowork.os.R
import java.io.BufferedOutputStream
import java.io.File
import java.io.FileOutputStream
import java.io.OutputStream

class EngineActivity : AppCompatActivity() {

    private lateinit var webView: WebView
    private lateinit var mediaProjectionManager: MediaProjectionManager

    // --- VARIABEL UPLOAD ---
    private var filePathCallback: ValueCallback<Array<Uri>>? = null
    private var isMenuActionPending = false

    // --- VARIABEL DOWNLOAD CHUNK (Optimized) ---
    private var tempDownloadFile: File? = null
    // [OPTIMASI] Gunakan BufferedOutputStream untuk performa tulis file 10x lebih cepat
    private var tempDownloadStream: BufferedOutputStream? = null
    private var currentDownloadMime = "application/octet-stream"
    private var currentDownloadName = "downloaded_file"

    // --- PERMISSION HANDLERS ---
    private var pendingPermissionRequest: PermissionRequest? = null
    private var pendingGeolocationCallback: GeolocationPermissions.Callback? = null
    private var pendingGeolocationOrigin: String? = null

    // Launcher: Izin Web (Kamera/Mic)
    private val webViewPermissionLauncher = registerForActivityResult(
        ActivityResultContracts.RequestMultiplePermissions()
    ) { permissions ->
        val granted = permissions.entries.all { it.value }
        if (granted) {
            pendingPermissionRequest?.grant(pendingPermissionRequest?.resources)
        } else {
            pendingPermissionRequest?.deny()
            Toast.makeText(this, "Izin WebView ditolak.", Toast.LENGTH_SHORT).show()
        }
        pendingPermissionRequest = null
    }

    // Launcher: Izin Lokasi Web
    private val webViewLocationLauncher = registerForActivityResult(
        ActivityResultContracts.RequestMultiplePermissions()
    ) { permissions ->
        val granted = permissions[Manifest.permission.ACCESS_FINE_LOCATION] == true ||
                      permissions[Manifest.permission.ACCESS_COARSE_LOCATION] == true
        pendingGeolocationCallback?.invoke(pendingGeolocationOrigin, granted, false)
        pendingGeolocationCallback = null
    }

    // Launcher: Upload File
    private val fileChooserLauncher = registerForActivityResult(
        ActivityResultContracts.StartActivityForResult()
    ) { result ->
        if (result.resultCode == Activity.RESULT_OK) {
            val results = result.data?.data?.let { arrayOf(it) }
            filePathCallback?.onReceiveValue(results)
        } else {
            filePathCallback?.onReceiveValue(null)
        }
        filePathCallback = null
    }

    // Launcher: Overlay (Floating Window)
    private val overlayPermissionLauncher = registerForActivityResult(
        ActivityResultContracts.StartActivityForResult()
    ) {
        if (Settings.canDrawOverlays(this)) {
            if (isMenuActionPending) checkRuntimePermissions(false) else startRecordingFlow()
        } else {
            Toast.makeText(this, "Izin Overlay Wajib Diberikan!", Toast.LENGTH_SHORT).show()
            isMenuActionPending = false
        }
    }

    // Launcher: Runtime Permission (Android Permission)
    private val runtimePermissionLauncher = registerForActivityResult(
        ActivityResultContracts.RequestMultiplePermissions()
    ) { permissions ->
        val camera = permissions[Manifest.permission.CAMERA] ?: false
        val audio = permissions[Manifest.permission.RECORD_AUDIO] ?: false

        if (camera && audio) {
            if (isMenuActionPending) {
                startFloatingMenuService()
                isMenuActionPending = false
            } else {
                requestScreenCapturePermission()
            }
        } else {
            Toast.makeText(this, "Wajib izinkan Kamera & Mic!", Toast.LENGTH_LONG).show()
            isMenuActionPending = false
        }
    }

    // Launcher: Screen Capture (Media Projection)
    private val screenCaptureLauncher = registerForActivityResult(
        ActivityResultContracts.StartActivityForResult()
    ) { result ->
        if (result.resultCode == Activity.RESULT_OK && result.data != null) {
            startFloatingService(result.resultCode, result.data!!)
        } else {
            Toast.makeText(this, "Izin Rekam Layar Ditolak", Toast.LENGTH_SHORT).show()
        }
    }

    @SuppressLint("SetJavaScriptEnabled")
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContentView(R.layout.activity_engine)

        mediaProjectionManager = getSystemService(Context.MEDIA_PROJECTION_SERVICE) as MediaProjectionManager
        val logicUrl = intent.getStringExtra("LOGIC_URL") ?: ""
        val appName = intent.getStringExtra("APP_NAME") ?: "Flowork App"

        webView = findViewById(R.id.webViewEngine)
        setupWebViewSettings()
        setupDownloadListener()

        webView.webChromeClient = getCustomWebChromeClient()
        // [MODIFIED] Gunakan Custom Client untuk handle External Link dengan Cepat
        webView.webViewClient = getCustomWebViewClient()

        // Inject Interface dengan nama "Android"
        webView.addJavascriptInterface(WebAppInterface(this), "Android")

        val localEngineUrl = "file:///android_asset/engine.html?src=$logicUrl&name=$appName"
        webView.loadUrl(localEngineUrl)
    }

    private fun setupWebViewSettings() {
        webView.settings.apply {
            javaScriptEnabled = true
            domStorageEnabled = true
            databaseEnabled = true
            // allowFileAccess = false // [COMMENTED] Kadang butuh true untuk aset lokal tertentu
            allowFileAccess = true
            allowContentAccess = true
            mixedContentMode = WebSettings.MIXED_CONTENT_COMPATIBILITY_MODE
            useWideViewPort = true
            loadWithOverviewMode = true
            setGeolocationEnabled(true)
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                safeBrowsingEnabled = true
            }

            // [OPTIMASI] Prioritas Render & Cache
            setRenderPriority(WebSettings.RenderPriority.HIGH)
            cacheMode = WebSettings.LOAD_DEFAULT
        }

        // [OPTIMASI] Hardware Acceleration
        webView.setLayerType(android.view.View.LAYER_TYPE_HARDWARE, null)
    }

    // [ADDED] Custom Client untuk menangkap URL eksternal (Ads, Link) agar buka di Chrome
    private fun getCustomWebViewClient() = object : WebViewClient() {
        override fun shouldOverrideUrlLoading(view: WebView?, request: WebResourceRequest?): Boolean {
            val url = request?.url.toString()
            // Jika URL adalah HTTP/HTTPS dan BUKAN aset lokal/internal, buka di Browser System (Chrome)
            if (url.startsWith("http") || url.startsWith("https")) {
                // Kecuali url tertentu jika ada whitelist internal, tambahkan logika di sini.
                // Untuk sekarang, anggap semua http/s adalah eksternal agar ringan.
                try {
                    val intent = Intent(Intent.ACTION_VIEW, Uri.parse(url))
                    startActivity(intent)
                    return true // True berarti WebView JANGAN load url ini (Stop Loading)
                } catch (e: Exception) {
                    e.printStackTrace()
                }
            }
            return false // Lanjutkan loading di WebView (untuk file:// atau data:)
        }
    }

    private fun setupDownloadListener() {
        webView.setDownloadListener { url, userAgent, contentDisposition, mimetype, _ ->
            try {
                when {
                    url.startsWith("blob:") -> {
                        // [OPTIMASI] Handle Blob URL dengan JS Injection (Future Proof)
                        val js = """
                            var xhr = new XMLHttpRequest();
                            xhr.open('GET', '$url', true);
                            xhr.responseType = 'blob';
                            xhr.onload = function(e) {
                                if (this.status == 200) {
                                    var reader = new FileReader();
                                    reader.onload = function(e) {
                                        Android.appendChunk(reader.result.split(',')[1]);
                                        Android.finishChunkDownload();
                                    };
                                    reader.readAsDataURL(this.response);
                                }
                            };
                            xhr.send();
                        """.trimIndent()
                        // Kita trigger download chunk via JS otomatis
                        webView.evaluateJavascript("Android.startChunkDownload('blob_download', '$mimetype'); $js", null)
                        Toast.makeText(this, "Processing Blob Download...", Toast.LENGTH_SHORT).show()
                    }
                    url.startsWith("data:") -> {
                        handleDataUriDownload(url, mimetype)
                    }
                    else -> {
                        // Regular HTTP Download
                        val request = DownloadManager.Request(Uri.parse(url))
                        request.setMimeType(mimetype)
                        val cookies = CookieManager.getInstance().getCookie(url)
                        request.addRequestHeader("cookie", cookies)
                        request.addRequestHeader("User-Agent", userAgent)
                        request.setDescription("Downloading file...")
                        val filename = URLUtil.guessFileName(url, contentDisposition, mimetype)
                        request.setTitle(filename)
                        request.setNotificationVisibility(DownloadManager.Request.VISIBILITY_VISIBLE_NOTIFY_COMPLETED)
                        request.setDestinationInExternalPublicDir(Environment.DIRECTORY_DOWNLOADS, filename)
                        val dm = getSystemService(DOWNLOAD_SERVICE) as DownloadManager
                        dm.enqueue(request)
                        Toast.makeText(this, "Downloading $filename...", Toast.LENGTH_SHORT).show()
                    }
                }
            } catch (e: Exception) {
                Toast.makeText(this, "Download Error: ${e.message}", Toast.LENGTH_SHORT).show()
                e.printStackTrace()
            }
        }
    }

    private fun getCustomWebChromeClient() = object : WebChromeClient() {
        override fun onPermissionRequest(request: PermissionRequest?) {
            if (request == null) return
            val resources = request.resources
            val permissionsNeeded = mutableListOf<String>()

            resources.forEach { r ->
                if (r == PermissionRequest.RESOURCE_VIDEO_CAPTURE) permissionsNeeded.add(Manifest.permission.CAMERA)
                if (r == PermissionRequest.RESOURCE_AUDIO_CAPTURE) permissionsNeeded.add(Manifest.permission.RECORD_AUDIO)
            }

            if (permissionsNeeded.isNotEmpty()) {
                val missing = permissionsNeeded.filter {
                    ContextCompat.checkSelfPermission(this@EngineActivity, it) != PackageManager.PERMISSION_GRANTED
                }

                if (missing.isEmpty()) {
                    request.grant(resources)
                } else {
                    pendingPermissionRequest = request
                    webViewPermissionLauncher.launch(missing.toTypedArray())
                }
            } else {
                request.grant(resources)
            }
        }

        override fun onGeolocationPermissionsShowPrompt(origin: String?, callback: GeolocationPermissions.Callback?) {
            val hasFine = ContextCompat.checkSelfPermission(this@EngineActivity, Manifest.permission.ACCESS_FINE_LOCATION) == PackageManager.PERMISSION_GRANTED
            val hasCoarse = ContextCompat.checkSelfPermission(this@EngineActivity, Manifest.permission.ACCESS_COARSE_LOCATION) == PackageManager.PERMISSION_GRANTED

            if (hasFine || hasCoarse) {
                callback?.invoke(origin, true, false)
            } else {
                pendingGeolocationCallback = callback
                pendingGeolocationOrigin = origin
                webViewLocationLauncher.launch(arrayOf(Manifest.permission.ACCESS_FINE_LOCATION, Manifest.permission.ACCESS_COARSE_LOCATION))
            }
        }

        override fun onShowFileChooser(webView: WebView?, filePathCallback: ValueCallback<Array<Uri>>?, fileChooserParams: FileChooserParams?): Boolean {
            this@EngineActivity.filePathCallback = filePathCallback
            val intent = fileChooserParams?.createIntent()
            if (intent != null) fileChooserLauncher.launch(intent) else return false
            return true
        }
    }

    // [OPTIMASI] Handle Data URI yang lebih robust
    private fun handleDataUriDownload(dataUrl: String, mimeType: String) {
        val delimiter = "base64,"
        val imageIdx = dataUrl.indexOf(delimiter)
        if (imageIdx != -1) {
            val base64Data = dataUrl.substring(imageIdx + delimiter.length)
            // Fix mimeType fallback
            val finalMime = if (mimeType.isEmpty() || mimeType == "null") {
                dataUrl.substring(0, imageIdx).substringAfter("data:").substringBefore(";")
            } else mimeType

            val extension = when {
                finalMime.contains("png") -> ".png"
                finalMime.contains("jpeg") -> ".jpg"
                finalMime.contains("pdf") -> ".pdf"
                finalMime.contains("html") -> ".html"
                finalMime.contains("json") -> ".json"
                else -> ".bin"
            }

            val filename = "download_${System.currentTimeMillis()}$extension"
            val tempFile = File(cacheDir, filename)

            try {
                val bytes = Base64.decode(base64Data, Base64.DEFAULT)
                tempFile.writeBytes(bytes)
                saveToMediaStore(tempFile, filename, finalMime)
                Toast.makeText(this, "Download Selesai: $filename", Toast.LENGTH_SHORT).show()
            } catch (e: Exception) {
                Toast.makeText(this, "Gagal Data URI: ${e.message}", Toast.LENGTH_SHORT).show()
            }
        }
    }

    private fun saveToMediaStore(file: File, filename: String, mimeType: String) {
        if (!file.exists()) return
        val resolver = contentResolver
        val contentValues = ContentValues().apply {
            put(MediaStore.MediaColumns.DISPLAY_NAME, filename)
            put(MediaStore.MediaColumns.MIME_TYPE, mimeType)
            put(MediaStore.MediaColumns.RELATIVE_PATH, Environment.DIRECTORY_DOWNLOADS)
        }

        try {
            val uri = resolver.insert(MediaStore.Downloads.EXTERNAL_CONTENT_URI, contentValues)
            if (uri != null) {
                resolver.openOutputStream(uri).use { output ->
                    file.inputStream().use { input -> input.copyTo(output!!) }
                }
                file.delete() // Hapus temp file setelah sukses copy
            }
        } catch (e: Exception) {
            e.printStackTrace()
            Toast.makeText(this, "Gagal simpan ke Galeri: ${e.message}", Toast.LENGTH_LONG).show()
        }
    }

    // --- INTERFACE JS <-> KOTLIN ---
    inner class WebAppInterface(private val context: Context) {
        @JavascriptInterface
        fun goHome() { finish() }

        @JavascriptInterface
        fun toggleRecording() { runOnUiThread { startRecordingFlow() } }

        @JavascriptInterface
        fun toggleMenu() { runOnUiThread { startMenuFlow() } }

        // [ADDED] Fungsi Open Browser Super Cepat (Native)
        @JavascriptInterface
        fun openInBrowser(url: String) {
            try {
                val intent = Intent(Intent.ACTION_VIEW, Uri.parse(url))
                intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
                context.startActivity(intent)
            } catch (e: Exception) {
                e.printStackTrace()
                Toast.makeText(context, "Gagal membuka browser: ${e.message}", Toast.LENGTH_SHORT).show()
            }
        }

        @JavascriptInterface
        fun startChunkDownload(filename: String, mimeType: String) {
            try {
                val sanitizedName = File(filename).name
                currentDownloadName = if (sanitizedName.isNotEmpty()) sanitizedName else "downloaded_file"
                currentDownloadMime = mimeType

                tempDownloadFile = File(cacheDir, "temp_${System.currentTimeMillis()}")
                // [OPTIMASI] Gunakan BufferedOutputStream agar penulisan byte tidak menghambat thread
                tempDownloadStream = BufferedOutputStream(FileOutputStream(tempDownloadFile))
            } catch (e: Exception) { e.printStackTrace() }
        }

        @JavascriptInterface
        fun appendChunk(base64Chunk: String) {
            try {
                if (tempDownloadStream != null) {
                    // [OPTIMASI] Flag NO_WRAP sedikit lebih cepat untuk chunk data murni
                    val decodedBytes = Base64.decode(base64Chunk, Base64.NO_WRAP)
                    tempDownloadStream?.write(decodedBytes)
                }
            } catch (e: Exception) { e.printStackTrace() }
        }

        @JavascriptInterface
        fun finishChunkDownload() {
            try {
                tempDownloadStream?.flush()
                tempDownloadStream?.close()
                tempDownloadStream = null

                if (tempDownloadFile != null && tempDownloadFile!!.exists()) {
                    runOnUiThread {
                        saveToMediaStore(tempDownloadFile!!, currentDownloadName, currentDownloadMime)
                        Toast.makeText(context, "Download Selesai: $currentDownloadName", Toast.LENGTH_LONG).show()
                    }
                }
            } catch (e: Exception) {
                runOnUiThread {
                    Toast.makeText(context, "Gagal Simpan: ${e.message}", Toast.LENGTH_SHORT).show()
                }
            }
        }
    }

    // --- FLOW CONTROL ---

    fun startRecordingFlow() {
        isMenuActionPending = false
        if (!Settings.canDrawOverlays(this)) { requestOverlayPermission(); return }
        checkRuntimePermissions(true)
    }

    fun startMenuFlow() {
        isMenuActionPending = true
        if (!Settings.canDrawOverlays(this)) { requestOverlayPermission(); return }
        checkRuntimePermissions(false)
    }

    private fun requestOverlayPermission() {
        val intent = Intent(Settings.ACTION_MANAGE_OVERLAY_PERMISSION, Uri.parse("package:$packageName"))
        overlayPermissionLauncher.launch(intent)
    }

    private fun checkRuntimePermissions(forRecording: Boolean) {
        val permissionsToRequest = mutableListOf<String>()
        // Izin Lokasi (Opsional tapi sering diminta web)
        if (ContextCompat.checkSelfPermission(this, Manifest.permission.ACCESS_FINE_LOCATION) != PackageManager.PERMISSION_GRANTED)
            permissionsToRequest.add(Manifest.permission.ACCESS_FINE_LOCATION)
        if (ContextCompat.checkSelfPermission(this, Manifest.permission.ACCESS_COARSE_LOCATION) != PackageManager.PERMISSION_GRANTED)
            permissionsToRequest.add(Manifest.permission.ACCESS_COARSE_LOCATION)

        // Izin Core
        if (ContextCompat.checkSelfPermission(this, Manifest.permission.CAMERA) != PackageManager.PERMISSION_GRANTED)
            permissionsToRequest.add(Manifest.permission.CAMERA)
        if (ContextCompat.checkSelfPermission(this, Manifest.permission.RECORD_AUDIO) != PackageManager.PERMISSION_GRANTED)
            permissionsToRequest.add(Manifest.permission.RECORD_AUDIO)

        // Izin Notif (Android 13+)
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            if (ContextCompat.checkSelfPermission(this, Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED)
                permissionsToRequest.add(Manifest.permission.POST_NOTIFICATIONS)
        }

        if (permissionsToRequest.isNotEmpty()) {
            runtimePermissionLauncher.launch(permissionsToRequest.toTypedArray())
        } else {
            if (forRecording) requestScreenCapturePermission() else startFloatingMenuService()
        }
    }

    private fun requestScreenCapturePermission() {
        val captureIntent = mediaProjectionManager.createScreenCaptureIntent()
        screenCaptureLauncher.launch(captureIntent)
    }

    private fun startFloatingMenuService() {
        val intent = Intent(this, FloatingControlService::class.java).apply {
            action = "ACTION_TOGGLE_MENU_VISIBILITY"
        }
        startService(intent)
    }

    private fun startFloatingService(resultCode: Int, data: Intent) {
        val intent = Intent(this, FloatingControlService::class.java).apply {
            action = "ACTION_START_WITH_PERMISSION"
            putExtra("KEY_RESULT_CODE", resultCode)
            putExtra("KEY_DATA", data)
            putExtra("KEY_QUALITY", "720p")
        }
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) startForegroundService(intent) else startService(intent)
    }
}