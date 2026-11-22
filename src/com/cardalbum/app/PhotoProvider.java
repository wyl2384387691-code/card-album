package com.cardalbum.app;

import android.content.ContentProvider;
import android.content.ContentUris;
import android.content.ContentValues;
import android.database.Cursor;
import android.net.Uri;
import android.os.ParcelFileDescriptor;
import android.provider.MediaStore;

import java.io.File;
import java.io.FileNotFoundException;
import java.util.List;

/**
 * Serves originals, generated thumbnails and extracted motion-photo videos to
 * the WebView through content:// URIs. Exported=false, so only this app can read.
 */
public class PhotoProvider extends ContentProvider {
    public static final String AUTHORITY = "com.cardalbum.app.photos";

    @Override
    public boolean onCreate() {
        return true;
    }

    @Override
    public ParcelFileDescriptor openFile(Uri uri, String mode) throws FileNotFoundException {
        if (!"r".equals(mode) && !"rt".equals(mode)) throw new FileNotFoundException("Read only");
        List<String> segments = uri.getPathSegments();
        if (segments == null || segments.size() < 2) throw new FileNotFoundException("Bad uri");
        String kind = segments.get(0);
        String idText = segments.get(1);
        if ("thumb".equals(kind)) {
            File file = Thumbs.ensure(getContext(), idText, uri.getQueryParameter("v"), 512);
            if (file == null) throw new FileNotFoundException("No thumbnail");
            return ParcelFileDescriptor.open(file, ParcelFileDescriptor.MODE_READ_ONLY);
        }
        if ("motion".equals(kind)) {
            File file = MotionPhotos.cacheFile(getContext(), idText);
            if (!file.exists() || file.length() <= 1024) throw new FileNotFoundException("No motion video");
            return ParcelFileDescriptor.open(file, ParcelFileDescriptor.MODE_READ_ONLY);
        }
        if ("full".equals(kind)) {
            Uri media = MediaUtils.uri(idText);
            ParcelFileDescriptor pfd = getContext().getContentResolver().openFileDescriptor(media, "r");
            if (pfd == null) throw new FileNotFoundException("No media");
            return pfd;
        }
        throw new FileNotFoundException("Unknown kind");
    }

    @Override
    public String getType(Uri uri) {
        List<String> segments = uri.getPathSegments();
        if (segments == null || segments.size() < 2) return null;
        String kind = segments.get(0);
        if ("thumb".equals(kind)) return "image/jpeg";
        if ("motion".equals(kind)) return "video/mp4";
        try {
            Uri media = MediaUtils.uri(segments.get(1));
            String type = getContext().getContentResolver().getType(media);
            return type == null ? "application/octet-stream" : type;
        } catch (Exception e) {
            return "application/octet-stream";
        }
    }

    @Override
    public Cursor query(Uri uri, String[] projection, String selection, String[] selectionArgs, String sortOrder) {
        return null;
    }

    @Override
    public Uri insert(Uri uri, ContentValues values) {
        return null;
    }

    @Override
    public int delete(Uri uri, String selection, String[] selectionArgs) {
        return 0;
    }

    @Override
    public int update(Uri uri, ContentValues values, String selection, String[] selectionArgs) {
        return 0;
    }
}
