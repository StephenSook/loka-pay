package org.loka.meshlab

import android.graphics.Bitmap
import android.net.Uri
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import org.junit.Assert.*
import org.junit.Test
import org.junit.runner.RunWith
import org.loka.core.contact.ContactCode
import java.io.File
import java.security.KeyPairGenerator

@RunWith(AndroidJUnit4::class)
class ContactQrTest {
    @Test fun savedQrCanBeImportedWithoutChangingIdentity() {
        val context = InstrumentationRegistry.getInstrumentation().targetContext
        val key = KeyPairGenerator.getInstance("RSA").apply { initialize(3072) }.generateKeyPair().public.encoded
        val link = ContactCode.encode(key)
        val image = ContactQr.bitmap(link)
        val file = File(context.cacheDir, "contact-qr-test.png")
        try {
            file.outputStream().use { assertTrue(image.compress(Bitmap.CompressFormat.PNG, 100, it)) }
            val scanned = ContactQr.read(context.contentResolver, Uri.fromFile(file))
            assertEquals(link, scanned)
            assertArrayEquals(key, ContactCode.decode(scanned))
        } finally { file.delete(); image.recycle() }
    }
}
