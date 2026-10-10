package org.loka.meshlab

import android.content.ContentResolver
import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.graphics.Matrix
import android.media.ExifInterface
import android.net.Uri
import java.io.ByteArrayInputStream
import java.io.ByteArrayOutputStream
import org.loka.core.ChatContent

internal object ImageAttachment {
    fun prepare(resolver: ContentResolver, uri: Uri): ByteArray {
        val source = resolver.openInputStream(uri)!!.use { input ->
            val output = ByteArrayOutputStream(); val buffer = ByteArray(8192)
            while (true) { val n = input.read(buffer); if (n < 0) break; require(output.size() + n <= 16 * 1024 * 1024); output.write(buffer, 0, n) }
            output.toByteArray()
        }
        val options = BitmapFactory.Options().apply { inJustDecodeBounds = true }
        BitmapFactory.decodeByteArray(source, 0, source.size, options)
        require(options.outWidth > 0 && options.outHeight > 0)
        options.inJustDecodeBounds = false
        options.inSampleSize = 1
        while (maxOf(options.outWidth, options.outHeight) / options.inSampleSize > 2048) options.inSampleSize *= 2
        var bitmap = requireNotNull(BitmapFactory.decodeByteArray(source, 0, source.size, options))
        try {
            val orientation = runCatching { ExifInterface(ByteArrayInputStream(source)).getAttributeInt(ExifInterface.TAG_ORIENTATION, 1) }.getOrDefault(1)
            val matrix = Matrix().apply {
                when (orientation) {
                    2 -> setScale(-1f, 1f); 3 -> setRotate(180f); 4 -> setScale(1f, -1f)
                    5 -> { setRotate(90f); postScale(-1f, 1f) }; 6 -> setRotate(90f)
                    7 -> { setRotate(-90f); postScale(-1f, 1f) }; 8 -> setRotate(-90f)
                }
            }
            val oriented = Bitmap.createBitmap(bitmap, 0, 0, bitmap.width, bitmap.height, matrix, true)
            if (oriented !== bitmap) { bitmap.recycle(); bitmap = oriented }
            var dimension = 1024
            while (dimension >= 128) {
                val scale = minOf(1f, dimension.toFloat() / maxOf(bitmap.width, bitmap.height))
                val scaled = Bitmap.createScaledBitmap(bitmap, maxOf(1, (bitmap.width * scale).toInt()), maxOf(1, (bitmap.height * scale).toInt()), true)
                try {
                    for (quality in listOf(75, 60, 45, 30)) {
                        val output = ByteArrayOutputStream(); check(scaled.compress(Bitmap.CompressFormat.JPEG, quality, output))
                        val bytes = output.toByteArray()
                        if (ChatContent.validImage(bytes)) return bytes
                    }
                } finally { if (scaled !== bitmap) scaled.recycle() }
                dimension /= 2
            }
            error("Photo too large")
        } finally { bitmap.recycle() }
    }
}
