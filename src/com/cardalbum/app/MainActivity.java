package com.cardalbum.app;

import android.Manifest;
import android.app.Activity;
import android.app.PendingIntent;
import android.content.ContentResolver;
import android.content.ContentValues;
import android.content.Intent;
import android.content.IntentSender;
import android.content.SharedPreferences;
import android.content.pm.PackageManager;
import android.database.Cursor;
import android.graphics.Bitmap;
import android.graphics.BitmapFactory;
import android.media.MediaScannerConnection;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.os.Environment;
import android.os.VibrationEffect;
import android.os.Vibrator;
import android.provider.MediaStore;
import android.provider.Settings;
import android.util.Base64;
import android.util.Log;
import android.view.View;
import android.view.Window;
import android.view.WindowManager;
import android.webkit.JavascriptInterface;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceError;
import android.webkit.WebResourceRequest;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.FrameLayout;
import android.widget.Toast;

import org.json.JSONArray;
import org.json.JSONObject;

import java.io.ByteArrayOutputStream;
import java.io.File;
import java.io.FileOutputStream;
import java.io.OutputStream;
import java.text.SimpleDateFormat;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.Collections;
import java.util.Date;
import java.util.List;
import java.util.Locale;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

public class MainActivity extends Activity {
    private static final String TAG = "CardAlbum";
    private static final String PREFS = "cardalbum";
    private static final String PREF_STORE = "store";
    private static final String PREF_ASKED = "permission_asked";
    private static final int REQ_PERMISSION = 1001;
    private static final int REQ_DELETE = 1002;
    private static final int REQ_WRITE = 1003;
    private static final int BG = 0xFFF6F4EE;
    private static final int BG_TOP = 0xFFF8F6F0;

    private WebView webView;
    private ExecutorService executor;
    private SharedPreferences prefs;
    private boolean initialized = false;
    private boolean pageLoaded = false;
    private boolean permissionRequestInFlight = false;
    private long lastLoadAt = 0;
    private List<String> pendingDeleteIds = null;
    private WriteAction pendingWrite = null;

    private static final class WriteAction {
        final String id;
        final String newName;
        WriteAction(String id, String newName) {
            this.id = id;
            this.newName = newName;
        }
    }

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        prefs = getSharedPreferences(PREFS, MODE_PRIVATE);
        executor = Executors.newSingleThreadExecutor();
        configureWindow();
        buildWebView();
    }

    private void configureWindow() {
        Window window = getWindow();
        window.addFlags(WindowManager.LayoutParams.FLAG_DRAWS_SYSTEM_BAR_BACKGROUNDS);
        window.setStatusBarColor(BG_TOP);
        int flags = View.SYSTEM_UI_FLAG_LIGHT_STATUS_BAR;
        if (Build.VERSION.SDK_INT >= 26) {
            window.setNavigationBarColor(BG);
            flags |= View.SYSTEM_UI_FLAG_LIGHT_NAVIGATION_BAR;
        } else {
            window.setNavigationBarColor(0xFF2D2C28);
        }
        window.getDecorView().setSystemUiVisibility(flags);
        if (Build.VERSION.SDK_INT >= 30) window.setDecorFitsSystemWindows(true);
    }

    private void buildWebView() {
        FrameLayout root = new FrameLayout(this);
        root.setBackgroundColor(BG);
        WebView.setWebContentsDebuggingEnabled(false);
        webView = new WebView(this) {
            @Override
            public android.view.ActionMode startActionMode(android.view.ActionMode.Callback callback) {
                return null;
            }

            @Override
            public android.view.ActionMode startActionMode(android.view.ActionMode.Callback callback, int type) {
                return null;
            }
        };
        webView.setBackgroundColor(BG);
        webView.setOverScrollMode(View.OVER_SCROLL_NEVER);
        webView.setVerticalScrollBarEnabled(false);
        webView.setHorizontalScrollBarEnabled(false);
        webView.setLongClickable(false);
        webView.setOnLongClickListener(v -> true);
        webView.setHapticFeedbackEnabled(false);

        WebSettings s = webView.getSettings();
        s.setJavaScriptEnabled(true);
        s.setDomStorageEnabled(true);
        s.setDatabaseEnabled(true);
        s.setAllowFileAccess(true);
        s.setAllowContentAccess(true);
        s.setAllowFileAccessFromFileURLs(false);
        s.setAllowUniversalAccessFromFileURLs(false);
        s.setSupportZoom(false);
        s.setBuiltInZoomControls(false);
        s.setDisplayZoomControls(false);
        s.setMediaPlaybackRequiresUserGesture(true);
        s.setMixedContentMode(WebSettings.MIXED_CONTENT_NEVER_ALLOW);
        s.setUseWideViewPort(true);
        s.setLoadWithOverviewMode(false);
        s.setTextZoom(100);
        s.setCacheMode(WebSettings.LOAD_DEFAULT);

        webView.addJavascriptInterface(new Bridge(), "Native");
        webView.setWebViewClient(new WebViewClient() {
            @Override
            public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
                Uri u = request.getUrl();
                if (u == null) return true;
                String scheme = u.getScheme();
                return !("file".equals(scheme) || "content".equals(scheme) || "about".equals(scheme));
            }

            @Override
            public void onPageFinished(WebView view, String url) {
                pageLoaded = true;
            }

            @Override
            public void onReceivedError(WebView view, WebResourceRequest request, WebResourceError error) {
                if (request.isForMainFrame()) Log.e(TAG, "main frame error " + error.getErrorCode());
            }
        });
        webView.setWebChromeClient(new WebChromeClient() {
            @Override
            public boolean onConsoleMessage(android.webkit.ConsoleMessage message) {
                Log.d(TAG, "web " + message.message() + " @" + message.lineNumber());
                return true;
            }
        });

        root.addView(webView, new FrameLayout.LayoutParams(
                FrameLayout.LayoutParams.MATCH_PARENT, FrameLayout.LayoutParams.MATCH_PARENT));
        setContentView(root);
        webView.loadUrl("file:///android_asset/index.html");
    }

    /* ---------------- permissions ---------------- */

    private String[] requiredPermissions() {
        if (Build.VERSION.SDK_INT >= 34) {
            return new String[]{
                    Manifest.permission.READ_MEDIA_IMAGES,
                    Manifest.permission.READ_MEDIA_VIDEO,
                    Manifest.permission.READ_MEDIA_VISUAL_USER_SELECTED
            };
        }
        if (Build.VERSION.SDK_INT >= 33) {
            return new String[]{
                    Manifest.permission.READ_MEDIA_IMAGES,
                    Manifest.permission.READ_MEDIA_VIDEO
            };
        }
        if (Build.VERSION.SDK_INT <= 28) {
            return new String[]{
                    Manifest.permission.READ_EXTERNAL_STORAGE,
                    Manifest.permission.WRITE_EXTERNAL_STORAGE
            };
        }
        return new String[]{Manifest.permission.READ_EXTERNAL_STORAGE};
    }

    private boolean hasImageFull() {
        if (Build.VERSION.SDK_INT >= 33) {
            return checkSelfPermission(Manifest.permission.READ_MEDIA_IMAGES) == PackageManager.PERMISSION_GRANTED;
        }
        return checkSelfPermission(Manifest.permission.READ_EXTERNAL_STORAGE) == PackageManager.PERMISSION_GRANTED;
    }

    private boolean hasVideoFull() {
        if (Build.VERSION.SDK_INT >= 33) {
            return checkSelfPermission(Manifest.permission.READ_MEDIA_VIDEO) == PackageManager.PERMISSION_GRANTED;
        }
        return checkSelfPermission(Manifest.permission.READ_EXTERNAL_STORAGE) == PackageManager.PERMISSION_GRANTED;
    }

    private boolean hasPartialAccess() {
        if (Build.VERSION.SDK_INT < 34) return false;
        return checkSelfPermission(Manifest.permission.READ_MEDIA_VISUAL_USER_SELECTED) == PackageManager.PERMISSION_GRANTED;
    }

    private boolean canReadImages() { return hasImageFull() || hasPartialAccess(); }
    private boolean canReadVideos() { return hasVideoFull() || hasPartialAccess(); }
    private boolean hasAnyAccess() { return canReadImages() || canReadVideos(); }
    private boolean hasFullAccess() { return hasImageFull() && hasVideoFull(); }

    private boolean canAskAgain() {
        for (String p : requiredPermissions()) {
            if (shouldShowRequestPermissionRationale(p)) return true;
        }
        return false;
    }

    private String permissionStatus() {
        if (hasFullAccess()) return "granted";
        if (hasPartialAccess()) return "partial";
        if (hasAnyAccess()) return "granted";
        if (prefs.getBoolean(PREF_ASKED, false) && !canAskAgain()) return "blocked";
        return "denied";
    }

    private void notifyPermission(String status) {
        callJs("window.__native&&window.__native.onPermission(" + JSONObject.quote(status) + ");");
    }

    private void initApp() {
        runOnUiThread(() -> {
            initialized = true;
            if (hasAnyAccess()) {
                notifyPermission(hasFullAccess() ? "granted" : (hasPartialAccess() ? "partial" : "granted"));
                loadPhotos();
                return;
            }
            boolean asked = prefs.getBoolean(PREF_ASKED, false);
            if (!asked) {
                prefs.edit().putBoolean(PREF_ASKED, true).apply();
                requestPhotoPermissions();
            } else {
                notifyPermission(permissionStatus());
            }
        });
    }

    private void requestPhotoPermissions() {
        permissionRequestInFlight = true;
        try {
            requestPermissions(requiredPermissions(), REQ_PERMISSION);
        } catch (Exception e) {
            permissionRequestInFlight = false;
            notifyPermission("denied");
        }
    }

    private void requestPermissionFromJs() {
        runOnUiThread(() -> {
            if (hasFullAccess()) {
                notifyPermission("granted");
                loadPhotos();
                return;
            }
            String status = permissionStatus();
            if ("blocked".equals(status)) {
                notifyPermission("blocked");
                return;
            }
            prefs.edit().putBoolean(PREF_ASKED, true).apply();
            requestPhotoPermissions();
        });
    }

    @Override
    public void onRequestPermissionsResult(int requestCode, String[] permissions, int[] grantResults) {
        super.onRequestPermissionsResult(requestCode, permissions, grantResults);
        if (requestCode != REQ_PERMISSION) return;
        permissionRequestInFlight = false;
        if (hasAnyAccess()) {
            notifyPermission(hasFullAccess() ? "granted" : (hasPartialAccess() ? "partial" : "granted"));
            loadPhotos();
        } else {
            notifyPermission(permissionStatus());
        }
    }

    /* ---------------- media query ---------------- */

    private void loadPhotos() {
        if (!hasAnyAccess()) {
            notifyPermission(permissionStatus());
            return;
        }
        lastLoadAt = System.currentTimeMillis();
        executor.execute(this::queryAndSend);
    }

    private void queryAndSend() {
        JSONArray media = new JSONArray();
        String error = null;
        try {
            if (canReadImages()) {
                try { appendMedia(media, false); }
                catch (Exception e) { Log.e(TAG, "image query failed", e); }
            }
            if (canReadVideos()) {
                try { appendMedia(media, true); }
                catch (Exception e) { Log.e(TAG, "video query failed", e); }
            }
            if (media.length() == 0 && !canReadImages() && !canReadVideos()) {
                notifyPermission(permissionStatus());
                return;
            }
        } catch (Exception e) {
            error = "读取相册失败，请稍后重试。";
            Log.e(TAG, "query failed", e);
        }
        try {
            JSONObject payload = new JSONObject();
            payload.put("photos", media);
            payload.put("partial", !hasFullAccess() && hasPartialAccess());
            payload.put("permission", hasFullAccess() ? "granted" : (hasPartialAccess() ? "partial" : "granted"));
            payload.put("limitedImages", !hasImageFull() && !hasPartialAccess());
            payload.put("limitedVideos", !hasVideoFull() && !hasPartialAccess());
            if (error != null) payload.put("error", error);
            callJs("window.__native&&window.__native.onPhotos(" + payload.toString() + ");");
        } catch (Exception e) {
            Log.e(TAG, "payload failed", e);
        }
    }

    private void appendMedia(JSONArray out, boolean video) throws Exception {
        Uri collection = MediaUtils.collection(video);
        List<String> cols = new ArrayList<>(Arrays.asList(
                MediaStore.MediaColumns._ID,
                MediaStore.MediaColumns.DISPLAY_NAME,
                MediaStore.MediaColumns.DATE_TAKEN,
                MediaStore.MediaColumns.DATE_ADDED,
                MediaStore.MediaColumns.WIDTH,
                MediaStore.MediaColumns.HEIGHT,
                MediaStore.MediaColumns.SIZE,
                MediaStore.MediaColumns.MIME_TYPE,
                "bucket_id",
                "bucket_display_name"
        ));
        if (video) cols.add("duration");
        if (!video && Build.VERSION.SDK_INT >= 30) cols.add(MediaStore.MediaColumns.XMP);
        String[] projection = cols.toArray(new String[0]);
        String selection = null;
        if (Build.VERSION.SDK_INT >= 30) {
            selection = MediaStore.MediaColumns.IS_TRASHED + "=0 AND " + MediaStore.MediaColumns.IS_PENDING + "=0";
        } else if (Build.VERSION.SDK_INT >= 29) {
            selection = MediaStore.MediaColumns.IS_PENDING + "=0";
        }
        String order = MediaStore.MediaColumns.DATE_ADDED + " DESC, " + MediaStore.MediaColumns._ID + " DESC";
        ContentResolver resolver = getContentResolver();
        Cursor cursor;
        try {
            cursor = resolver.query(collection, projection, selection, null, order);
        } catch (Exception first) {
            if (!video && Build.VERSION.SDK_INT >= 30) {
                try {
                    cols.remove(MediaStore.MediaColumns.XMP);
                    projection = cols.toArray(new String[0]);
                } catch (Exception ignored) {}
            }
            cursor = resolver.query(collection, projection, null, null, order);
        }
        if (cursor == null) return;
        try {
            int idCol = cursor.getColumnIndex(MediaStore.MediaColumns._ID);
            int nameCol = cursor.getColumnIndex(MediaStore.MediaColumns.DISPLAY_NAME);
            int takenCol = cursor.getColumnIndex(MediaStore.MediaColumns.DATE_TAKEN);
            int addedCol = cursor.getColumnIndex(MediaStore.MediaColumns.DATE_ADDED);
            int widthCol = cursor.getColumnIndex(MediaStore.MediaColumns.WIDTH);
            int heightCol = cursor.getColumnIndex(MediaStore.MediaColumns.HEIGHT);
            int sizeCol = cursor.getColumnIndex(MediaStore.MediaColumns.SIZE);
            int mimeCol = cursor.getColumnIndex(MediaStore.MediaColumns.MIME_TYPE);
            int bucketIdCol = cursor.getColumnIndex("bucket_id");
            int bucketNameCol = cursor.getColumnIndex("bucket_display_name");
            int durationCol = video ? cursor.getColumnIndex("duration") : -1;
            int xmpCol = (!video && Build.VERSION.SDK_INT >= 30) ? cursor.getColumnIndex(MediaStore.MediaColumns.XMP) : -1;
            while (cursor.moveToNext()) {
                long id = idCol >= 0 ? cursor.getLong(idCol) : 0;
                if (id <= 0) continue;
                String name = nameCol >= 0 ? cursor.getString(nameCol) : null;
                if (name == null || name.trim().isEmpty()) name = (video ? "VID_" : "IMG_") + id;
                long taken = takenCol >= 0 ? cursor.getLong(takenCol) : 0;
                long added = addedCol >= 0 ? cursor.getLong(addedCol) : 0;
                if (taken <= 0 && added > 0) taken = added * 1000L;
                String mime = mimeCol >= 0 ? cursor.getString(mimeCol) : null;
                if (mime == null) mime = video ? "video/mp4" : "image/jpeg";
                String bucketId = bucketIdCol >= 0 ? cursor.getString(bucketIdCol) : null;
                String bucketName = bucketNameCol >= 0 ? cursor.getString(bucketNameCol) : null;
                if (bucketName == null || bucketName.trim().isEmpty()) bucketName = "其他";
                String bucketKey = (bucketId != null && !bucketId.isEmpty()) ? "b" + bucketId : "n:" + bucketName;
                JSONObject o = new JSONObject();
                o.put("id", MediaUtils.encode(video, id));
                o.put("type", video ? "video" : "image");
                o.put("name", name);
                o.put("date", taken);
                o.put("w", widthCol >= 0 ? cursor.getInt(widthCol) : 0);
                o.put("h", heightCol >= 0 ? cursor.getInt(heightCol) : 0);
                o.put("size", sizeCol >= 0 ? cursor.getLong(sizeCol) : 0);
                o.put("mime", mime);
                o.put("bucketId", bucketKey);
                o.put("bucketName", bucketName);
                o.put("duration", durationCol >= 0 ? cursor.getLong(durationCol) : 0);
                String lower = mime.toLowerCase(Locale.ROOT);
                o.put("animated", lower.contains("gif"));
                String xmp = null;
                if (xmpCol >= 0) {
                    try {
                        xmp = cursor.getString(xmpCol);
                    } catch (Exception ignored) {
                        try {
                            byte[] bytes = cursor.getBlob(xmpCol);
                            if (bytes != null) xmp = new String(bytes, java.nio.charset.StandardCharsets.UTF_8);
                        } catch (Exception ignored2) {}
                    }
                }
                o.put("motion", !video && MotionPhotos.xmpLooksMotion(xmp));
                out.put(o);
            }
        } finally {
            try { cursor.close(); } catch (Exception ignored) {}
        }
    }

    /* ---------------- actions ---------------- */

    private void deletePhoto(String idText) {
        final Uri uri;
        try { uri = MediaUtils.uri(idText); } catch (Exception e) { toast("无法删除这个文件"); return; }
        runOnUiThread(() -> {
            try {
                if (Build.VERSION.SDK_INT >= 30) {
                    List<Uri> uris = Collections.singletonList(uri);
                    PendingIntent pi = MediaStore.createDeleteRequest(getContentResolver(), uris);
                    pendingDeleteIds = Collections.singletonList(idText);
                    startIntentSenderForResult(pi.getIntentSender(), REQ_DELETE, null, 0, 0, 0);
                } else {
                    int rows = getContentResolver().delete(uri, null, null);
                    callDeleteResult(rows > 0, Collections.singletonList(idText));
                }
            } catch (IntentSender.SendIntentException | SecurityException e) {
                Log.e(TAG, "delete failed", e);
                pendingDeleteIds = null;
                toast("没有删除权限，请在系统相册中操作");
                callDeleteResult(false, Collections.singletonList(idText));
            } catch (Exception e) {
                Log.e(TAG, "delete failed", e);
                pendingDeleteIds = null;
                toast("删除失败，请稍后重试");
                callDeleteResult(false, Collections.singletonList(idText));
            }
        });
    }

    private void deletePhotos(String idsJson) {
        final List<String> ids = new ArrayList<>();
        final List<Uri> uris = new ArrayList<>();
        try {
            JSONArray arr = new JSONArray(idsJson == null ? "[]" : idsJson);
            for (int i = 0; i < arr.length(); i++) {
                String id = arr.getString(i);
                try { uris.add(MediaUtils.uri(id)); ids.add(id); } catch (Exception ignored) {}
            }
        } catch (Exception e) {
            toast("删除失败");
            return;
        }
        if (uris.isEmpty()) return;
        final ArrayList<String> idList = new ArrayList<>(ids);
        runOnUiThread(() -> {
            try {
                if (Build.VERSION.SDK_INT >= 30) {
                    PendingIntent pi = MediaStore.createDeleteRequest(getContentResolver(), uris);
                    pendingDeleteIds = idList;
                    startIntentSenderForResult(pi.getIntentSender(), REQ_DELETE, null, 0, 0, 0);
                } else {
                    int rows = 0;
                    for (Uri uri : uris) {
                        try { rows += getContentResolver().delete(uri, null, null) > 0 ? 1 : 0; } catch (Exception ignored) {}
                    }
                    callDeleteResult(rows > 0, idList);
                }
            } catch (Exception e) {
                pendingDeleteIds = null;
                toast("没有删除权限，请在系统相册中操作");
                callDeleteResult(false, idList);
            }
        });
    }

    private void callDeleteResult(boolean ok, List<String> ids) {
        JSONArray arr = new JSONArray();
        if (ids != null) for (String id : ids) arr.put(id);
        callJs("window.__native&&window.__native.onDeleteResult(" + ok + "," +
                JSONObject.quote(arr.toString()) + ");");
    }

    private void renameMedia(String idText, String requested) {
        runOnUiThread(() -> {
            String newName = validateName(idText, requested);
            if (newName == null) {
                callRenameResult(false, idText, requested, "文件名无效");
                return;
            }
            Uri uri;
            try { uri = MediaUtils.uri(idText); } catch (Exception e) {
                callRenameResult(false, idText, requested, "文件不存在");
                return;
            }
            if (Build.VERSION.SDK_INT >= 30) {
                try {
                    PendingIntent pi = MediaStore.createWriteRequest(getContentResolver(), Collections.singletonList(uri));
                    pendingWrite = new WriteAction(idText, newName);
                    startIntentSenderForResult(pi.getIntentSender(), REQ_WRITE, null, 0, 0, 0);
                } catch (Exception e) {
                    performRename(idText, newName);
                }
            } else {
                performRename(idText, newName);
            }
        });
    }

    private String validateName(String idText, String requested) {
        if (requested == null) return null;
        String name = requested.trim().replaceAll("[\\\\/:*?\"<>|\\r\\n]", "_");
        if (name.isEmpty()) return null;
        if (name.length() > 80) name = name.substring(0, 80);
        String oldName = queryDisplayName(idText);
        String oldExt = "";
        if (oldName != null) {
            int dot = oldName.lastIndexOf('.');
            if (dot > 0) oldExt = oldName.substring(dot);
        }
        if (!name.contains(".") && !oldExt.isEmpty()) name += oldExt;
        return name;
    }

    private String queryDisplayName(String idText) {
        try (Cursor c = getContentResolver().query(MediaUtils.uri(idText),
                new String[]{MediaStore.MediaColumns.DISPLAY_NAME}, null, null, null)) {
            if (c != null && c.moveToFirst()) return c.getString(0);
        } catch (Exception ignored) {}
        return null;
    }

    private void performRename(String idText, String newName) {
        try {
            ContentValues values = new ContentValues();
            values.put(MediaStore.MediaColumns.DISPLAY_NAME, newName);
            int rows = getContentResolver().update(MediaUtils.uri(idText), values, null, null);
            if (rows > 0) {
                callRenameResult(true, idText, newName, "");
            } else {
                callRenameResult(false, idText, newName, "系统拒绝了重命名");
            }
        } catch (SecurityException e) {
            if (Build.VERSION.SDK_INT == 29 && e instanceof android.app.RecoverableSecurityException) {
                try {
                    IntentSender sender = ((android.app.RecoverableSecurityException) e).getUserAction()
                            .getActionIntent().getIntentSender();
                    pendingWrite = new WriteAction(idText, newName);
                    startIntentSenderForResult(sender, REQ_WRITE, null, 0, 0, 0);
                    return;
                } catch (Exception ignored) {}
            }
            callRenameResult(false, idText, newName, "没有修改权限");
        } catch (Exception e) {
            callRenameResult(false, idText, newName, "重命名失败");
        }
    }

    private void callRenameResult(boolean ok, String idText, String newName, String message) {
        try {
            callJs("window.__native&&window.__native.onRenameResult(" + ok + "," +
                    JSONObject.quote(idText) + "," + JSONObject.quote(newName) + "," +
                    JSONObject.quote(message == null ? "" : message) + ");");
        } catch (Exception ignored) {}
    }

    @Override
    protected void onActivityResult(int requestCode, int resultCode, Intent data) {
        super.onActivityResult(requestCode, resultCode, data);
        if (requestCode == REQ_DELETE) {
            boolean ok = resultCode == RESULT_OK;
            List<String> ids = pendingDeleteIds;
            pendingDeleteIds = null;
            callDeleteResult(ok, ids);
            return;
        }
        if (requestCode == REQ_WRITE) {
            WriteAction action = pendingWrite;
            pendingWrite = null;
            if (resultCode == RESULT_OK && action != null) {
                performRename(action.id, action.newName);
            } else if (action != null) {
                callRenameResult(false, action.id, action.newName, "已取消");
            }
        }
    }

    private void shareMedia(String idText) {
        final Uri uri;
        try { uri = MediaUtils.uri(idText); } catch (Exception e) { toast("无法分享这个文件"); return; }
        runOnUiThread(() -> {
            String mime = getContentResolver().getType(uri);
            if (mime == null) mime = MediaUtils.mimeFallback(idText);
            Intent send = new Intent(Intent.ACTION_SEND);
            send.setType(mime);
            send.putExtra(Intent.EXTRA_STREAM, uri);
            send.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);
            try {
                startActivity(Intent.createChooser(send, "分享"));
            } catch (Exception e) {
                toast("分享失败");
            }
        });
    }

    private void shareMediaList(String idsJson, String title) {
        final ArrayList<Uri> uris = new ArrayList<>();
        try {
            JSONArray arr = new JSONArray(idsJson == null ? "[]" : idsJson);
            for (int i = 0; i < arr.length(); i++) {
                try { uris.add(MediaUtils.uri(arr.getString(i))); } catch (Exception ignored) {}
            }
        } catch (Exception e) {
            toast("分享失败");
            return;
        }
        if (uris.isEmpty()) { toast("卡包没有可分享的内容"); return; }
        runOnUiThread(() -> {
            Intent send = new Intent(Intent.ACTION_SEND_MULTIPLE);
            send.setType("*/*");
            send.putParcelableArrayListExtra(Intent.EXTRA_STREAM, uris);
            send.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);
            String name = title == null || title.trim().isEmpty() ? "卡包" : title.trim();
            try {
                startActivity(Intent.createChooser(send, "分享「" + name + "」"));
            } catch (Exception e) {
                toast("分享失败");
            }
        });
    }

    public String getImageData(String idText) {
        if (MediaUtils.isVideo(idText)) return "";
        Bitmap bitmap = ImageOps.load(this, MediaUtils.uri(idText), 1800);
        if (bitmap == null) return "";
        ByteArrayOutputStream bos = new ByteArrayOutputStream(512 * 1024);
        bitmap.compress(Bitmap.CompressFormat.JPEG, 92, bos);
        bitmap.recycle();
        return "data:image/jpeg;base64," + Base64.encodeToString(bos.toByteArray(), Base64.NO_WRAP);
    }

    private void openAppSettings() {
        try {
            startActivity(new Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS,
                    Uri.fromParts("package", getPackageName(), null)));
        } catch (Exception e) {
            toast("无法打开系统设置");
        }
    }

    /* ---------------- bridge / helpers ---------------- */

    private void callJs(String js) {
        if (webView == null) return;
        webView.post(() -> {
            if (webView != null) webView.evaluateJavascript(js, null);
        });
    }

    private void toast(String message) {
        runOnUiThread(() -> Toast.makeText(this, message, Toast.LENGTH_SHORT).show());
    }

    private void haptic() {
        try {
            Vibrator v = (Vibrator) getSystemService(VIBRATOR_SERVICE);
            if (v == null || !v.hasVibrator()) return;
            if (Build.VERSION.SDK_INT >= 26) {
                v.vibrate(VibrationEffect.createOneShot(9, VibrationEffect.DEFAULT_AMPLITUDE));
            } else {
                v.vibrate(9);
            }
        } catch (Exception ignored) {}
    }

    private final class Bridge {
        @JavascriptInterface
        public String getConfig() {
            try {
                JSONObject o = new JSONObject();
                o.put("thumbBase", "content://" + PhotoProvider.AUTHORITY + "/thumb/");
                o.put("fullBase", "content://" + PhotoProvider.AUTHORITY + "/full/");
                o.put("motionBase", "content://" + PhotoProvider.AUTHORITY + "/motion/");
                o.put("version", "0.6.0");
                return o.toString();
            } catch (Exception e) {
                return "{}";
            }
        }

        @JavascriptInterface public void init() { initApp(); }
        @JavascriptInterface public void requestPermission() { requestPermissionFromJs(); }
        @JavascriptInterface public void loadPhotos() { MainActivity.this.loadPhotos(); }
        @JavascriptInterface public void openSettings() { runOnUiThread(MainActivity.this::openAppSettings); }
        @JavascriptInterface public String loadStore() { return prefs.getString(PREF_STORE, ""); }
        @JavascriptInterface public void saveStore(String json) {
            try { prefs.edit().putString(PREF_STORE, json).apply(); } catch (Exception ignored) {}
        }
        @JavascriptInterface public String getThumbData(String id) {
            try { return Thumbs.dataUrl(MainActivity.this, id); } catch (Exception e) { return ""; }
        }
        @JavascriptInterface public String getImageData(String id) {
            try { return MainActivity.this.getImageData(id); } catch (Exception e) { return ""; }
        }
        @JavascriptInterface public void deletePhoto(String id) { MainActivity.this.deletePhoto(id); }
        @JavascriptInterface public void deletePhotos(String idsJson) { MainActivity.this.deletePhotos(idsJson); }
        @JavascriptInterface public void renameMedia(String id, String name) { MainActivity.this.renameMedia(id, name); }
        @JavascriptInterface public void sharePhoto(String id) { MainActivity.this.shareMedia(id); }
        @JavascriptInterface public void shareMediaList(String idsJson, String title) { MainActivity.this.shareMediaList(idsJson, title); }
        @JavascriptInterface public boolean hasMotion(String id) {
            try { return MotionPhotos.hasMotion(MainActivity.this, id); } catch (Exception e) { return false; }
        }
        @JavascriptInterface public String getMotionUrl(String id) {
            try {
                File file = MotionPhotos.ensure(MainActivity.this, id);
                if (file == null) return "";
                return "content://" + PhotoProvider.AUTHORITY + "/motion/" + id + "?v=" + file.lastModified();
            } catch (Exception e) { return ""; }
        }
        @JavascriptInterface public void toast(String message) { MainActivity.this.toast(message); }
        @JavascriptInterface public void haptic() { MainActivity.this.haptic(); }
    }

    /* ---------------- lifecycle ---------------- */

    @Override
    protected void onResume() {
        super.onResume();
        if (!initialized || !pageLoaded || permissionRequestInFlight) return;
        long now = System.currentTimeMillis();
        if (hasAnyAccess()) {
            if (now - lastLoadAt > 2500) loadPhotos();
        } else {
            notifyPermission(permissionStatus());
        }
    }

    @SuppressWarnings("deprecation")
    @Override
    public void onBackPressed() {
        if (webView == null) {
            super.onBackPressed();
            return;
        }
        webView.evaluateJavascript(
                "(function(){try{return window.__onAndroidBack?window.__onAndroidBack():false}catch(e){return false}})()",
                value -> {
                    if ("true".equals(value)) return;
                    if (webView != null && webView.canGoBack()) webView.goBack();
                    else finish();
                });
    }

    @Override
    protected void onDestroy() {
        if (executor != null) executor.shutdownNow();
        if (webView != null) {
            try {
                webView.removeJavascriptInterface("Native");
                webView.stopLoading();
                webView.destroy();
            } catch (Exception ignored) {}
            webView = null;
        }
        super.onDestroy();
    }
}
