package com.seosol.ebookviewer.recent;

import android.app.Activity;
import android.content.Intent;
import android.content.SharedPreferences;
import android.content.res.Configuration;
import android.graphics.Color;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.util.Log;
import android.view.View;
import android.view.ActionMode;
import android.view.WindowInsets;
import android.webkit.ConsoleMessage;
import android.webkit.JavascriptInterface;
import android.webkit.ValueCallback;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.FrameLayout;
import android.widget.Toast;
import android.window.OnBackInvokedCallback;
import android.window.OnBackInvokedDispatcher;
import org.json.JSONObject;
import java.io.ByteArrayInputStream;
import java.io.IOException;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.HashSet;
import java.util.Set;

/** Offline app asset host. All HTTPS responses are served from the APK, never the network. */
public final class MainActivity extends Activity {
    private static final String ORIGIN = "https://appassets.androidplatform.net";
    private static final String HOME = ORIGIN + "/assets/index.html";
    private static final int PICK_FILE = 101;
    private WebView web;
    private ChatGPTClient chatGPT;
    private FrameLayout root;
    private ValueCallback<Uri[]> pendingFiles;
    private final Set<String> selectedFiles = new HashSet<>();
    private SharedPreferences position;
    private OnBackInvokedCallback backCallback;
    private String pendingSelection;
    private boolean documentReady, externalSelection;

    private void receiveSelection(Intent intent) {
        if (intent == null || !Intent.ACTION_PROCESS_TEXT.equals(intent.getAction()) ||
                !"text/plain".equals(intent.getType())) return;
        CharSequence value = intent.getCharSequenceExtra(Intent.EXTRA_PROCESS_TEXT);
        String text = value == null ? "" : value.toString().trim();
        if (text.isEmpty() || text.length() > 32000) {
            Toast.makeText(this, "본문은 1~32,000자까지 선택해 주세요.", Toast.LENGTH_LONG).show();
            return;
        }
        // Keep selected text in memory only: never in a URL, log or book history.
        pendingSelection = text;
        externalSelection = true;
    }

    private void openPendingSelection() {
        if (!documentReady || pendingSelection == null) return;
        String selected = pendingSelection;
        pendingSelection = null;
        String literal = JSONObject.quote(selected).replace("\u2028", "\\u2028").replace("\u2029", "\\u2029");
        web.evaluateJavascript("readerReady.then(function(){window.readerOpenExternalChatGPT(" + literal + ");})", null);
    }

    @Override protected void onNewIntent(Intent intent) {
        super.onNewIntent(intent);
        setIntent(intent);
        receiveSelection(intent);
        openPendingSelection();
    }

    public final class SelectionBridge {
        @JavascriptInterface public void close() {
            runOnUiThread(() -> {
                if (!externalSelection) return;
                externalSelection = false;
                // Complete PROCESS_TEXT and return to the untouched browser tab.
                setResult(RESULT_CANCELED);
                finish();
            });
        }
    }

    @Override public void onCreate(Bundle state) {
        super.onCreate(state);
        receiveSelection(getIntent());
        position = getSharedPreferences("reader_position_v1", MODE_PRIVATE);
        root = new FrameLayout(this) {
            private ActionMode.Callback decorate(ActionMode.Callback callback) {
                return web instanceof ReaderWebView ? ((ReaderWebView)web).selectionCallback(callback) : callback;
            }
            @Override public ActionMode startActionModeForChild(View child, ActionMode.Callback callback) {
                return super.startActionModeForChild(child, decorate(callback));
            }
            @Override public ActionMode startActionModeForChild(View child, ActionMode.Callback callback, int type) {
                return super.startActionModeForChild(child, decorate(callback), type);
            }
        };
        web = new ReaderWebView(this);
        root.addView(web, new FrameLayout.LayoutParams(-1, -1));
        setContentView(root);
        configureWindow();
        // Safe-area padding is applied outside WebView, so HTML viewport measurements stay exact.
        root.setOnApplyWindowInsetsListener((view, insets) -> {
            if (Build.VERSION.SDK_INT >= 30) {
                android.graphics.Insets safe = insets.getInsets(
                    WindowInsets.Type.systemBars() | WindowInsets.Type.displayCutout() | WindowInsets.Type.ime());
                view.setPadding(safe.left, safe.top, safe.right, safe.bottom);
                return WindowInsets.CONSUMED;
            }
            view.setPadding(insets.getSystemWindowInsetLeft(), insets.getSystemWindowInsetTop(),
                insets.getSystemWindowInsetRight(), insets.getSystemWindowInsetBottom());
            return insets.consumeSystemWindowInsets();
        });
        root.requestApplyInsets();

        WebSettings settings = web.getSettings();
        settings.setJavaScriptEnabled(true);
        settings.setDomStorageEnabled(true);
        settings.setDatabaseEnabled(true);
        settings.setAllowContentAccess(true); // SAF content:// URIs returned to file inputs.
        settings.setAllowFileAccess(false);
        settings.setAllowFileAccessFromFileURLs(false);
        settings.setAllowUniversalAccessFromFileURLs(false);
        settings.setBlockNetworkLoads(true);
        settings.setMixedContentMode(WebSettings.MIXED_CONTENT_NEVER_ALLOW);
        settings.setCacheMode(WebSettings.LOAD_DEFAULT);
        settings.setTextZoom(100);
        settings.setSupportMultipleWindows(false);
        settings.setJavaScriptCanOpenWindowsAutomatically(false);
        if (Build.VERSION.SDK_INT >= 29) settings.setForceDark(WebSettings.FORCE_DARK_OFF);
        if (Build.VERSION.SDK_INT >= 33) settings.setAlgorithmicDarkeningAllowed(false);
        WebView.setWebContentsDebuggingEnabled(getApplicationInfo().flags != 0 &&
            (getApplicationInfo().flags & android.content.pm.ApplicationInfo.FLAG_DEBUGGABLE) != 0);
        web.addJavascriptInterface(new PositionBridge(), "AndroidReader");
        web.addJavascriptInterface(new SelectionBridge(), "AndroidSelection");
        try { chatGPT = new ChatGPTClient(this, web); web.addJavascriptInterface(chatGPT, "AndroidChatGPT"); }
        catch (Exception error) { Toast.makeText(this, "ChatGPT 계정 저장소를 열지 못했습니다.", Toast.LENGTH_LONG).show(); }
        web.setWebViewClient(new WebViewClient() {
            @Override public void onPageFinished(WebView view, String url) {
                if (isHome(Uri.parse(url))) {
                    documentReady = true;
                    openPendingSelection();
                }
            }
            @Override public WebResourceResponse shouldInterceptRequest(WebView view, WebResourceRequest request) {
                return serve(request.getUrl());
            }
            @Override public WebResourceResponse shouldInterceptRequest(WebView view, String url) {
                return serve(Uri.parse(url));
            }
            @Override public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
                return !isHome(request.getUrl());
            }
            @Override public boolean shouldOverrideUrlLoading(WebView view, String url) {
                return !isHome(Uri.parse(url));
            }
            @Override public void onReceivedError(WebView view, WebResourceRequest request,
                    android.webkit.WebResourceError error) {
                Log.e("EbookViewer", "WebView resource error: " + error.getDescription());
            }
        });
        web.setWebChromeClient(new WebChromeClient() {
            @Override public boolean onConsoleMessage(ConsoleMessage message) {
                if (message.messageLevel() == ConsoleMessage.MessageLevel.ERROR)
                    Log.e("EbookConsole", message.message() + " @ " + message.sourceId() + ":" + message.lineNumber());
                return true;
            }
            @Override public boolean onShowFileChooser(WebView view, ValueCallback<Uri[]> callback,
                    FileChooserParams params) {
                if (pendingFiles != null) pendingFiles.onReceiveValue(null);
                pendingFiles = callback;
                Intent intent = new Intent(Intent.ACTION_OPEN_DOCUMENT);
                intent.addCategory(Intent.CATEGORY_OPENABLE);
                // Many SAF providers report TXT/fonts as octet-stream; HTML validates extensions.
                intent.setType("*/*");
                intent.putExtra(Intent.EXTRA_ALLOW_MULTIPLE, params.getMode() == FileChooserParams.MODE_OPEN_MULTIPLE);
                intent.putExtra(Intent.EXTRA_LOCAL_ONLY, true);
                intent.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);
                try { startActivityForResult(intent, PICK_FILE); }
                catch (android.content.ActivityNotFoundException error) {
                    pendingFiles.onReceiveValue(null);
                    pendingFiles = null;
                    Toast.makeText(MainActivity.this, "파일 선택 앱을 찾을 수 없습니다.", Toast.LENGTH_LONG).show();
                }
                return true;
            }
        });
        if (Build.VERSION.SDK_INT >= 33) {
            backCallback = this::handleBack;
            getOnBackInvokedDispatcher().registerOnBackInvokedCallback(
                OnBackInvokedDispatcher.PRIORITY_DEFAULT, backCallback);
        }
        // Stable origin and application ID preserve DOM storage/IndexedDB across all launches/updates.
        web.loadUrl(HOME);
    }

    private boolean isHome(Uri uri) {
        return "https".equals(uri.getScheme()) && "appassets.androidplatform.net".equals(uri.getHost())
            && (uri.getPort() == -1 || uri.getPort() == 443) && "/assets/index.html".equals(uri.getPath());
    }

    private WebResourceResponse serve(Uri uri) {
        if ("https".equals(uri.getScheme()) && "appassets.androidplatform.net".equals(uri.getHost())
                && (uri.getPort() == -1 || uri.getPort() == 443)) {
            String path = uri.getPath();
            if ("/assets/index.html".equals(path) || "/assets/android.js".equals(path) || "/assets/reader-core.js".equals(path)) {
                try {
                    String mime = path.endsWith(".js") ? "application/javascript" : "text/html";
                    HashMap<String, String> headers = new HashMap<>();
                    headers.put("Cache-Control", "no-cache");
                    headers.put("X-Content-Type-Options", "nosniff");
                    return new WebResourceResponse(mime, "UTF-8", 200, "OK", headers,
                        getAssets().open(path.substring("/assets/".length())));
                } catch (IOException error) { Log.e("EbookViewer", "Missing asset", error); }
            }
        }
        // Only explicit SAF grants may ever be read; all remote URLs and filesystem URLs are blocked.
        synchronized (selectedFiles) {
            if ("content".equals(uri.getScheme()) && selectedFiles.contains(uri.toString())) {
                try { return new WebResourceResponse(getContentResolver().getType(uri), null,
                    getContentResolver().openInputStream(uri)); }
                catch (IOException | SecurityException error) { Log.e("EbookViewer", "SAF read failed", error); }
            }
        }
        return new WebResourceResponse("text/plain", "UTF-8", 403, "Blocked",
            new HashMap<>(), new ByteArrayInputStream(new byte[0]));
    }

    public final class PositionBridge {
        @JavascriptInterface public String readPosition() { return position.getString("checkpoint", ""); }
        @JavascriptInterface public String readSettings() { return position.getString("settings", ""); }
        @JavascriptInterface public void saveSettings(String raw) {
            if (raw == null || raw.length() > 8192 || raw.equals(position.getString("settings", ""))) return;
            try {
                JSONObject settings = new JSONObject(raw);
                if (!settings.has("font") || !settings.has("fontSize")) return;
                if (!position.edit().putString("settings", raw).commit()) Log.e("EbookViewer", "Settings checkpoint failed");
            } catch (org.json.JSONException error) { Log.e("EbookViewer", "Invalid settings checkpoint", error); }
        }
        @JavascriptInterface public void savePosition(String raw) {
            if (raw == null || raw.length() > 8192) return;
            try {
                JSONObject record = new JSONObject(raw);
                if (!record.has("updatedAt") || !record.has("isOpen") || record.has("text")) return;
                // Small synchronous commit protects a page turn even if the process is killed immediately.
                if (!position.edit().putString("checkpoint", raw).commit()) Log.e("EbookViewer", "Checkpoint failed");
            } catch (org.json.JSONException error) { Log.e("EbookViewer", "Invalid checkpoint", error); }
        }
    }

    @Override protected void onActivityResult(int request, int result, Intent data) {
        super.onActivityResult(request, result, data);
        if (request == PICK_FILE && pendingFiles != null) {
            ArrayList<Uri> files = new ArrayList<>();
            if (result == RESULT_OK && data != null) {
                if (data.getClipData() != null) {
                    for (int i = 0; i < data.getClipData().getItemCount(); i++) files.add(data.getClipData().getItemAt(i).getUri());
                } else if (data.getData() != null) files.add(data.getData());
            }
            for (int i = files.size() - 1; i >= 0; i--)
                if (!"content".equals(files.get(i).getScheme())) files.remove(i);
            synchronized (selectedFiles) { for (Uri uri : files) selectedFiles.add(uri.toString()); }
            pendingFiles.onReceiveValue(files.isEmpty() ? null : files.toArray(new Uri[0]));
            pendingFiles = null;
            // Imported text/font bytes are persisted by HTML; no broad or permanent storage permission is needed.
        }
    }

    private void handleBack() {
        if (web == null) { finish(); return; }
        web.evaluateJavascript("window.__androidBack ? window.__androidBack() : false", handled -> {
            if (!"true".equals(handled)) {
                web.evaluateJavascript("window.__androidFlushState && window.__androidFlushState()", result -> finish());
            }
        });
    }
    // API 33+ uses the registered OnBackInvokedCallback above; this override is only the legacy path.
    @android.annotation.SuppressLint("GestureBackNavigation")
    @Override public void onBackPressed() { handleBack(); }
    @Override protected void onPause() {
        if (web != null) web.evaluateJavascript("window.__androidFlushState && window.__androidFlushState()", null);
        super.onPause();
    }
    @Override public void onConfigurationChanged(Configuration config) {
        super.onConfigurationChanged(config);
        configureWindow();
        root.requestApplyInsets();
    }
    private void configureWindow() {
        boolean dark = (getResources().getConfiguration().uiMode & Configuration.UI_MODE_NIGHT_MASK)
            == Configuration.UI_MODE_NIGHT_YES;
        int background = dark ? Color.rgb(18,18,18) : Color.WHITE;
        root.setBackgroundColor(background);
        web.setBackgroundColor(background);
        if (Build.VERSION.SDK_INT >= 30) {
            getWindow().setDecorFitsSystemWindows(false);
            android.view.WindowInsetsController controller = getWindow().getInsetsController();
            if (controller != null) controller.setSystemBarsAppearance(dark ? 0 :
                android.view.WindowInsetsController.APPEARANCE_LIGHT_STATUS_BARS |
                android.view.WindowInsetsController.APPEARANCE_LIGHT_NAVIGATION_BARS,
                android.view.WindowInsetsController.APPEARANCE_LIGHT_STATUS_BARS |
                android.view.WindowInsetsController.APPEARANCE_LIGHT_NAVIGATION_BARS);
        } else {
            int flags = View.SYSTEM_UI_FLAG_LAYOUT_STABLE | View.SYSTEM_UI_FLAG_LAYOUT_FULLSCREEN |
                View.SYSTEM_UI_FLAG_LAYOUT_HIDE_NAVIGATION;
            if (!dark) flags |= View.SYSTEM_UI_FLAG_LIGHT_STATUS_BAR;
            if (!dark && Build.VERSION.SDK_INT >= 26) flags |= View.SYSTEM_UI_FLAG_LIGHT_NAVIGATION_BAR;
            getWindow().getDecorView().setSystemUiVisibility(flags);
        }
        getWindow().setStatusBarColor(background);
        getWindow().setNavigationBarColor(background);
        if (Build.VERSION.SDK_INT >= 29) getWindow().setNavigationBarContrastEnforced(false);
    }
    @Override protected void onDestroy() {
        if (Build.VERSION.SDK_INT >= 33 && backCallback != null)
            getOnBackInvokedDispatcher().unregisterOnBackInvokedCallback(backCallback);
        if (pendingFiles != null) { pendingFiles.onReceiveValue(null); pendingFiles = null; }
        if (chatGPT != null) chatGPT.close();
        if (web != null) {
            root.removeView(web);
            web.removeJavascriptInterface("AndroidReader");
            web.removeJavascriptInterface("AndroidSelection");
            web.removeJavascriptInterface("AndroidChatGPT");
            web.destroy();
        }
        // Never clear cache, WebStorage, databases or app preferences during launch/shutdown.
        super.onDestroy();
    }
}
