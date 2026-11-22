package com.cardalbum.app;

import android.content.ContentResolver;
import android.content.Context;
import android.graphics.Bitmap;
import android.media.MediaMetadataRetriever;
import android.net.Uri;
import android.os.Build;
import android.provider.MediaStore;
import android.util.Base64;
import android.util.Size;

import java.io.ByteArrayOutputStream;
import java.io.File;
import java.io.FileOutputStream;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.Semaphore;

/** Small, cached image/video thumbnails used by the WebView grid. */
final class Thumbs {
    private static final int JPEG_QUALITY = 88;
    private static final Semaphore WORKERS = new Semaphore(4);
    private static final ConcurrentHashMap<String, Object> LOCKS = new ConcurrentHashMap<>();

    private Thumbs() {}

    static File dir(Context context) {
        File d = new File(context.getCacheDir(), "thumbs");
        if (!d.exists()) d.mkdirs();
        return d;
    }

    static String safeVersion(String version) {
        if (version == null) return "";
        StringBuilder out = new StringBuilder();
        for (int i = 0; i < version.length() && out.length() < 20; i++) {
            char c = version.charAt(i);
            if (c >= '0' && c <= '9') out.append(c);
        }
        return out.toString();
    }

    private static File fileFor(Context context, String idText, String version) {
        String safeId = idText.replaceAll("[^A-Za-z0-9_-]", "_");
        String v = safeVersion(version);
        return new File(dir(context), safeId + (v.isEmpty() ? "" : "_" + v) + ".jpg");
    }

    static File ensure(Context context, String idText, String version, int maxSize) {
        File out = fileFor(context, idText, version);
        if (out.exists() && out.length() > 128) return out;
        Object lock = LOCKS.computeIfAbsent(idText + "_" + safeVersion(version), k -> new Object());
        synchronized (lock) {
            if (out.exists() && out.length() > 128) return out;
            Bitmap bitmap;
            boolean acquired = false;
            try {
                WORKERS.acquire();
                acquired = true;
                bitmap = loadBitmap(context, idText, maxSize);
            } catch (InterruptedException e) {
                Thread.currentThread().interrupt();
                return null;
            } finally {
                if (acquired) WORKERS.release();
            }
            if (bitmap == null) return null;
            File tmp = new File(out.getAbsolutePath() + "." + Thread.currentThread().getId() + ".tmp");
            try (FileOutputStream fos = new FileOutputStream(tmp)) {
                bitmap.compress(Bitmap.CompressFormat.JPEG, JPEG_QUALITY, fos);
                fos.getFD().sync();
            } catch (Exception e) {
                tmp.delete();
                bitmap.recycle();
                return null;
            }
            bitmap.recycle();
            if (out.exists()) out.delete();
            if (!tmp.renameTo(out)) {
                tmp.delete();
                return null;
            }
            return out;
        }
    }

    static String dataUrl(Context context, String idText) {
        Bitmap bitmap;
        boolean acquired = false;
        try {
            WORKERS.acquire();
            acquired = true;
            bitmap = loadBitmap(context, idText, 420);
        } catch (InterruptedException e) {
            Thread.currentThread().interrupt();
            return "";
        } finally {
            if (acquired) WORKERS.release();
        }
        if (bitmap == null) return "";
        ByteArrayOutputStream bos = new ByteArrayOutputStream(48 * 1024);
        bitmap.compress(Bitmap.CompressFormat.JPEG, 82, bos);
        bitmap.recycle();
        return "data:image/jpeg;base64," + Base64.encodeToString(bos.toByteArray(), Base64.NO_WRAP);
    }

    private static Bitmap loadBitmap(Context context, String idText, int maxSize) {
        Uri uri = MediaUtils.uri(idText);
        ContentResolver resolver = context.getContentResolver();
        Bitmap bitmap = null;
        if (MediaUtils.isVideo(idText)) {
            bitmap = videoFrame(context, uri);
            if (bitmap == null && Build.VERSION.SDK_INT >= 29) {
                try { bitmap = resolver.loadThumbnail(uri, new Size(maxSize, maxSize), null); }
                catch (Exception ignored) { bitmap = null; }
            }
            if (bitmap == null && Build.VERSION.SDK_INT < 29) {
                try {
                    bitmap = MediaStore.Video.Thumbnails.getThumbnail(resolver,
                            MediaUtils.numericId(idText), MediaStore.Video.Thumbnails.MINI_KIND, null);
                } catch (Exception ignored) { bitmap = null; }
            }
        } else {
            if (Build.VERSION.SDK_INT >= 29) {
                try { bitmap = resolver.loadThumbnail(uri, new Size(maxSize, maxSize), null); }
                catch (Exception ignored) { bitmap = null; }
            }
            if (bitmap == null) bitmap = ImageOps.load(context, uri, maxSize);
        }
        if (bitmap == null) return null;
        if (bitmap.getWidth() > maxSize || bitmap.getHeight() > maxSize) {
            float scale = Math.min((float) maxSize / bitmap.getWidth(), (float) maxSize / bitmap.getHeight());
            Bitmap scaled = Bitmap.createScaledBitmap(bitmap,
                    Math.max(1, Math.round(bitmap.getWidth() * scale)),
                    Math.max(1, Math.round(bitmap.getHeight() * scale)), true);
            if (scaled != bitmap) bitmap.recycle();
            bitmap = scaled;
        }
        return bitmap;
    }

    private static Bitmap videoFrame(Context context, Uri uri) {
        MediaMetadataRetriever retriever = new MediaMetadataRetriever();
        try {
            retriever.setDataSource(context, uri);
            Bitmap b = retriever.getFrameAtTime(1_000_000L, MediaMetadataRetriever.OPTION_CLOSEST);
            if (b == null) b = retriever.getFrameAtTime(0, MediaMetadataRetriever.OPTION_CLOSEST);
            return b;
        } catch (Exception e) {
            return null;
        } finally {
            try { retriever.release(); } catch (Exception ignored) {}
        }
    }
}
