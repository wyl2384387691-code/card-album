package com.cardalbum.app;

import android.content.ContentResolver;
import android.content.Context;
import android.net.Uri;
import android.os.ParcelFileDescriptor;

import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.nio.charset.StandardCharsets;
import java.util.Locale;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

/**
 * Reads the MP4 payload embedded in Android / Google / vendor motion photos.
 *
 * Motion photos are commonly a JPEG with an MP4 appended after the EOI marker.
 * The XMP block can be in the JPEG APP1 segment (Google/Samsung/Xiaomi) or just
 * after the EOI.  This class checks the JPEG metadata, and as a final fallback
 * locates a real ftyp/moov/mdat MP4 box in the appended bytes.
 */
final class MotionPhotos {
    private static final int HEAD = 384 * 1024;
    private static final int TAIL = 384 * 1024;
    private static final Pattern ITEM_LENGTH = Pattern.compile("Item:Length=\"(\\d+)\"");
    private static final Pattern MICRO_VIDEO = Pattern.compile("(?:MicroVideoOffset|MotionPhotoOffset)=\"(\\d+)\"");

    private MotionPhotos() {}

    static File cacheFile(Context context, String idText) {
        String safe = idText.replaceAll("[^A-Za-z0-9_-]", "_");
        File dir = new File(context.getCacheDir(), "motion");
        if (!dir.exists()) dir.mkdirs();
        return new File(dir, safe + ".mp4");
    }

    /** XMP exposed by MediaStore is enough for the "only live" filter. */
    static boolean xmpLooksMotion(String xmp) {
        if (xmp == null || xmp.isEmpty()) return false;
        String lower = xmp.toLowerCase(Locale.ROOT);
        return lower.contains("motionphoto") || lower.contains("microvideo")
                || lower.contains("motionphotoversion") || lower.contains("item:semantic")
                || lower.contains("item:length") || lower.contains("motionphotooffset")
                || lower.contains("microvideooffset");
    }

    static boolean hasMotion(Context context, String idText) {
        if (MediaUtils.isVideo(idText)) return false;
        Uri uri = MediaUtils.uri(idText);
        try {
            String meta = readMetadata(context, uri);
            if (xmpLooksMotion(meta)) return true;
        } catch (Exception ignored) {}
        try {
            return findMp4Start(context, uri) >= 0;
        } catch (Exception e) {
            return false;
        }
    }

    static File ensure(Context context, String idText) {
        File out = cacheFile(context, idText);
        if (out.exists() && out.length() > 1024) return out;
        synchronized (MotionPhotos.class) {
            if (out.exists() && out.length() > 1024) return out;
            Uri uri = MediaUtils.uri(idText);
            try (ParcelFileDescriptor pfd = context.getContentResolver().openFileDescriptor(uri, "r")) {
                if (pfd == null) return null;
                long size = pfd.getStatSize();
                if (size <= 2048) return null;

                String meta = readMetadata(context, uri);
                long start = -1;
                long length = -1;

                Matcher m = ITEM_LENGTH.matcher(meta);
                while (m.find()) {
                    try {
                        long n = Long.parseLong(m.group(1));
                        if (n > length) length = n;
                    } catch (Exception ignored) {}
                }
                if (length > 1024 && length < size) {
                    start = size - length;
                } else {
                    Matcher mm = MICRO_VIDEO.matcher(meta);
                    if (mm.find()) {
                        try {
                            long offset = Long.parseLong(mm.group(1));
                            if (offset > 1024 && offset < size) {
                                length = offset;
                                start = size - offset;
                            }
                        } catch (Exception ignored) {}
                    }
                }

                if (start < 0 || length <= 1024 || start + length > size) {
                    long found = findMp4Start(context, uri);
                    if (found >= 0 && found < size - 1024) {
                        start = found;
                        length = size - found;
                    }
                }
                if (start < 0 || length <= 1024) return null;

                File tmp = new File(out.getAbsolutePath() + ".tmp");
                if (!copyRange(context, uri, start, length, tmp)) {
                    tmp.delete();
                    return null;
                }
                if (out.exists()) out.delete();
                if (!tmp.renameTo(out)) {
                    tmp.delete();
                    return null;
                }
                return out;
            } catch (Exception e) {
                return null;
            }
        }
    }

    private static String readMetadata(Context context, Uri uri) {
        StringBuilder sb = new StringBuilder();
        try (ParcelFileDescriptor pfd = context.getContentResolver().openFileDescriptor(uri, "r")) {
            if (pfd == null) return "";
            long size = pfd.getStatSize();
            byte[] head = readRange(context, uri, 0, (int) Math.min(HEAD, size));
            if (head != null) sb.append(new String(head, StandardCharsets.ISO_8859_1));
            if (size > TAIL) {
                byte[] tail = readRange(context, uri, Math.max(0, size - TAIL), TAIL);
                if (tail != null) sb.append('\n').append(new String(tail, StandardCharsets.ISO_8859_1));
            }
        } catch (Exception ignored) {}
        return sb.toString();
    }

    /** Scan for a real MP4 box appended after the JPEG. */
    private static long findMp4Start(Context context, Uri uri) {
        try (ParcelFileDescriptor pfd = context.getContentResolver().openFileDescriptor(uri, "r")) {
            if (pfd == null) return -1;
            long size = pfd.getStatSize();
            if (size < 64) return -1;
            long best = -1;
            byte[] buf = new byte[256 * 1024];
            int carry = 0;
            long pos = 0;
            try (FileInputStream fis = new FileInputStream(pfd.getFileDescriptor())) {
                while (pos < size) {
                    int read = fis.read(buf, carry, buf.length - carry);
                    if (read <= 0) break;
                    int total = carry + read;
                    for (int i = 4; i <= total - 8; i++) {
                        if (buf[i] != 'f' || buf[i + 1] != 't' || buf[i + 2] != 'y' || buf[i + 3] != 'p') continue;
                        long start = pos - carry + i - 4;
                        if (start < 0 || start + 16 > size) continue;
                        if (validMp4At(context, uri, start, size)) best = start;
                    }
                    carry = Math.min(12, total);
                    System.arraycopy(buf, total - carry, buf, 0, carry);
                    pos += read;
                }
            }
            return best;
        } catch (Exception e) {
            return -1;
        }
    }

    private static boolean validMp4At(Context context, Uri uri, long start, long size) {
        byte[] head = readRange(context, uri, start, 2048);
        if (head == null || head.length < 16) return false;
        long boxSize = ((long) (head[0] & 0xff) << 24) | ((head[1] & 0xff) << 16)
                | ((head[2] & 0xff) << 8) | (head[3] & 0xff);
        if (boxSize < 8 || start + boxSize > size) return false;
        String brand = new String(head, 4, 4, StandardCharsets.ISO_8859_1).toLowerCase(Locale.ROOT);
        if (!(brand.equals("isom") || brand.equals("iso2") || brand.equals("iso5") || brand.equals("iso6")
                || brand.equals("mp41") || brand.equals("mp42") || brand.equals("m4v ") || brand.equals("msnv")
                || brand.equals("qt  ") || brand.equals("avc1") || brand.equals("dash"))) return false;
        String window = new String(head, StandardCharsets.ISO_8859_1);
        return window.contains("moov") || window.contains("mdat") || window.contains("ftyp");
    }

    private static byte[] readRange(Context context, Uri uri, long start, int max) {
        ContentResolver resolver = context.getContentResolver();
        try (ParcelFileDescriptor pfd = resolver.openFileDescriptor(uri, "r")) {
            if (pfd == null) return null;
            long size = pfd.getStatSize();
            if (start < 0 || start >= size) return null;
            int len = (int) Math.min(max, size - start);
            if (len <= 0) return null;
            byte[] data = new byte[len];
            try (FileInputStream fis = new FileInputStream(pfd.getFileDescriptor())) {
                fis.getChannel().position(start);
                int off = 0;
                while (off < len) {
                    int read = fis.read(data, off, len - off);
                    if (read < 0) break;
                    off += read;
                }
                if (off < len) {
                    byte[] trimmed = new byte[off];
                    System.arraycopy(data, 0, trimmed, 0, off);
                    return trimmed;
                }
            }
            return data;
        } catch (Exception e) {
            return null;
        }
    }

    private static boolean copyRange(Context context, Uri uri, long start, long length, File target) {
        try (ParcelFileDescriptor pfd = context.getContentResolver().openFileDescriptor(uri, "r")) {
            if (pfd == null) return false;
            try (FileInputStream fis = new FileInputStream(pfd.getFileDescriptor());
                 FileOutputStream fos = new FileOutputStream(target)) {
                fis.getChannel().position(start);
                byte[] buffer = new byte[64 * 1024];
                long remaining = length;
                while (remaining > 0) {
                    int read = fis.read(buffer, 0, (int) Math.min(buffer.length, remaining));
                    if (read < 0) break;
                    fos.write(buffer, 0, read);
                    remaining -= read;
                }
                fos.getFD().sync();
                return remaining <= 0;
            }
        } catch (Exception e) {
            return false;
        }
    }
}
