package cn.knowledgestar.map;

import android.app.Activity;
import android.graphics.Color;
import android.os.Bundle;
import android.util.Log;
import android.view.KeyEvent;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;

import java.io.ByteArrayInputStream;
import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.util.HashMap;
import java.util.Map;
import java.util.zip.ZipEntry;
import java.util.zip.ZipFile;

/**
 * 知识星图安卓外壳：用 WebView 加载打包进 APK 的网页。
 * 网页资源通过自定义 https 域名 appassets.androidplatform.net 提供，
 * 这样 ES Modules / fetch / Service Worker 都能在同源下正常工作。
 */
public class MainActivity extends Activity {

    private static final String TAG = "KSM";
    private static final String HOST = "appassets.androidplatform.net";
    private static final String BASE_URL = "https://" + HOST + "/";
    private static final String ASSET_PREFIX = "assets/www/";

    private WebView webView;
    private ZipFile apkZip;
    private final Map<String, ZipEntry> entryMap = new HashMap<>();

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);

        webView = new WebView(this);
        webView.setBackgroundColor(Color.parseColor("#03060F"));

        WebSettings s = webView.getSettings();
        s.setJavaScriptEnabled(true);
        s.setDomStorageEnabled(true);
        s.setDatabaseEnabled(true);
        s.setAllowFileAccess(false);
        s.setAllowContentAccess(false);
        s.setMediaPlaybackRequiresUserGesture(false);
        s.setSupportZoom(false);
        s.setBuiltInZoomControls(false);
        // 关键：关闭整页缩放，避免画面被拉伸变形
        s.setUseWideViewPort(false);
        s.setLoadWithOverviewMode(false);
        s.setMixedContentMode(WebSettings.MIXED_CONTENT_NEVER_ALLOW);

        webView.setWebViewClient(new WebViewClient() {
            @Override
            public WebResourceResponse shouldInterceptRequest(WebView view, WebResourceRequest request) {
                if (request == null || request.getUrl() == null) return null;
                if (!HOST.equals(request.getUrl().getHost())) return null;
                return serve(request.getUrl().getPath());
            }
        });

        webView.setWebChromeClient(new WebChromeClient() {
            @Override
            public boolean onConsoleMessage(android.webkit.ConsoleMessage msg) {
                Log.i(TAG, "console: " + msg.message() + " @" + msg.sourceId() + ":" + msg.lineNumber());
                return true;
            }
        });

        openApkEntries();
        setContentView(webView);
        webView.loadUrl(BASE_URL + "index.html");
    }

    private void openApkEntries() {
        try {
            apkZip = new ZipFile(getApplicationInfo().sourceDir);
            java.util.Enumeration<? extends ZipEntry> en = apkZip.entries();
            while (en.hasMoreElements()) {
                ZipEntry e = en.nextElement();
                entryMap.put(e.getName().replace('\\', '/'), e);
            }
        } catch (IOException e) {
            Log.e(TAG, "open apk failed", e);
        }
    }

    private WebResourceResponse serve(String urlPath) {
        String path = urlPath == null ? "" : urlPath;
        while (path.startsWith("/")) path = path.substring(1);
        // 去掉路径穿越，避免越界读取
        if (path.contains("..")) {
            return notFound();
        }
        if (path.isEmpty() || path.endsWith("/")) {
            path = path + "index.html";
        }
        String entryName = ASSET_PREFIX + path;

        byte[] data = null;
        if (apkZip != null) {
            ZipEntry entry = entryMap.get(entryName);
            if (entry != null) {
                try (InputStream in = apkZip.getInputStream(entry)) {
                    data = readAll(in);
                } catch (IOException e) {
                    Log.e(TAG, "read entry failed: " + entryName, e);
                }
            }
        }
        if (data == null) {
            try (InputStream in = getAssets().open(entryName.substring("assets/".length()))) {
                data = readAll(in);
            } catch (IOException ignored) {
                // 资源不存在
            }
        }
        if (data == null) return notFound();

        Map<String, String> headers = new HashMap<>();
        // 静态资源允许短期缓存，加速二次加载；HTML 不缓存以便及时更新
        String lowerPath = path.toLowerCase();
        boolean staticAsset = lowerPath.endsWith(".js") || lowerPath.endsWith(".mjs")
                || lowerPath.endsWith(".css") || lowerPath.endsWith(".png") || lowerPath.endsWith(".jpg")
                || lowerPath.endsWith(".svg") || lowerPath.endsWith(".webp") || lowerPath.endsWith(".json")
                || lowerPath.endsWith(".woff2") || lowerPath.endsWith(".woff");
        headers.put("Cache-Control", staticAsset ? "max-age=3600" : "no-store");
        headers.put("Access-Control-Allow-Origin", "*");
        return new WebResourceResponse(mimeOf(path), "utf-8", 200, "OK", headers, new ByteArrayInputStream(data));
    }

    private WebResourceResponse notFound() {
        Map<String, String> headers = new HashMap<>();
        headers.put("Cache-Control", "no-store");
        return new WebResourceResponse("text/plain", "utf-8", 404, "Not Found", headers,
                new ByteArrayInputStream("Not found".getBytes()));
    }

    private static byte[] readAll(InputStream in) throws IOException {
        ByteArrayOutputStream out = new ByteArrayOutputStream(64 * 1024);
        byte[] buf = new byte[16 * 1024];
        int n;
        while ((n = in.read(buf)) > 0) out.write(buf, 0, n);
        return out.toByteArray();
    }

    private static String mimeOf(String path) {
        String p = path.toLowerCase();
        if (p.endsWith(".html") || p.endsWith(".htm")) return "text/html";
        if (p.endsWith(".js") || p.endsWith(".mjs")) return "application/javascript";
        if (p.endsWith(".css")) return "text/css";
        if (p.endsWith(".json") || p.endsWith(".map")) return "application/json";
        if (p.endsWith(".png")) return "image/png";
        if (p.endsWith(".jpg") || p.endsWith(".jpeg")) return "image/jpeg";
        if (p.endsWith(".svg")) return "image/svg+xml";
        if (p.endsWith(".webp")) return "image/webp";
        if (p.endsWith(".ico")) return "image/x-icon";
        if (p.endsWith(".woff2")) return "font/woff2";
        if (p.endsWith(".woff")) return "font/woff";
        if (p.endsWith(".ttf")) return "font/ttf";
        if (p.endsWith(".otf")) return "font/otf";
        if (p.endsWith(".wasm")) return "application/wasm";
        if (p.endsWith(".txt") || p.endsWith(".md")) return "text/plain";
        return "application/octet-stream";
    }

    @Override
    public boolean onKeyDown(int keyCode, KeyEvent event) {
        if (keyCode == KeyEvent.KEYCODE_BACK && webView != null && webView.canGoBack()) {
            webView.goBack();
            return true;
        }
        return super.onKeyDown(keyCode, event);
    }

    @Override
    protected void onDestroy() {
        if (webView != null) {
            webView.destroy();
            webView = null;
        }
        if (apkZip != null) {
            try {
                apkZip.close();
            } catch (IOException ignored) {
            }
            apkZip = null;
        }
        super.onDestroy();
    }
}
