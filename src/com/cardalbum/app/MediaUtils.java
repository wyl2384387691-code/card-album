package com.cardalbum.app;

import android.content.ContentUris;
import android.net.Uri;
import android.provider.MediaStore;

/** Helpers for the prefixed MediaStore ids used by the WebView UI. */
final class MediaUtils {
    private MediaUtils() {}

    static boolean isVideo(String idText) {
        return idText != null && idText.startsWith("v");
    }

    static String encode(boolean video, long id) {
        return (video ? "v" : "i") + id;
    }

    static long numericId(String idText) {
        if (idText == null) throw new NumberFormatException("empty id");
        String s = idText;
        if (s.startsWith("i") || s.startsWith("v")) s = s.substring(1);
        return Long.parseLong(s);
    }

    static Uri collection(boolean video) {
        return video ? MediaStore.Video.Media.EXTERNAL_CONTENT_URI
                : MediaStore.Images.Media.EXTERNAL_CONTENT_URI;
    }

    static Uri uri(String idText) {
        return ContentUris.withAppendedId(collection(isVideo(idText)), numericId(idText));
    }

    static String mimeFallback(String idText) {
        return isVideo(idText) ? "video/*" : "image/*";
    }
}
