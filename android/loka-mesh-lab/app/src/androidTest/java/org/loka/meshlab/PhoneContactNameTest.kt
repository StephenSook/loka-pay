package org.loka.meshlab

import android.Manifest
import android.content.ContentProviderOperation
import android.content.ContentUris
import android.os.Build
import android.provider.ContactsContract as C
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import org.junit.Assert.*
import org.junit.Test
import org.junit.runner.RunWith

@RunWith(AndroidJUnit4::class)
class PhoneContactNameTest {
    @Test fun exactInternationalNumbersOnly() {
        assertEquals("+12025550123", PhoneContactName.normalize("+1 (202) 555-0123"))
        listOf("2025550123", "0012025550123", "+02025550123", "+1", "+12025550123 ext 4", "++12025550123", "+١٢٠٢٥٥٥٠١٢٣").forEach {
            assertNull(PhoneContactName.normalize(it))
        }
    }
    @Test fun readsOnlyTheMatchingLocalName() {
        check(Build.HARDWARE.contains("ranchu") || Build.HARDWARE.contains("goldfish")) { "Run contacts fixtures only on an isolated emulator" }
        val instrumentation = InstrumentationRegistry.getInstrumentation()
        val context = instrumentation.targetContext
        val resolver = context.contentResolver
        val rawContacts = mutableListOf<Long>()
        instrumentation.uiAutomation.adoptShellPermissionIdentity(Manifest.permission.READ_CONTACTS, Manifest.permission.WRITE_CONTACTS)
        try {
            val ops = arrayListOf(
                ContentProviderOperation.newInsert(C.RawContacts.CONTENT_URI)
                    .withValue(C.RawContacts.ACCOUNT_TYPE, null).withValue(C.RawContacts.ACCOUNT_NAME, null)
                    .withValue(C.RawContacts.AGGREGATION_MODE, C.RawContacts.AGGREGATION_MODE_DISABLED).build(),
                ContentProviderOperation.newInsert(C.Data.CONTENT_URI).withValueBackReference(C.Data.RAW_CONTACT_ID, 0)
                    .withValue(C.Data.MIMETYPE, C.CommonDataKinds.StructuredName.CONTENT_ITEM_TYPE)
                    .withValue(C.CommonDataKinds.StructuredName.DISPLAY_NAME, "LOKA Test Contact").build(),
                ContentProviderOperation.newInsert(C.Data.CONTENT_URI).withValueBackReference(C.Data.RAW_CONTACT_ID, 0)
                    .withValue(C.Data.MIMETYPE, C.CommonDataKinds.Phone.CONTENT_ITEM_TYPE)
                    .withValue(C.CommonDataKinds.Phone.NUMBER, "+12025550123")
                    .withValue(C.CommonDataKinds.Phone.TYPE, C.CommonDataKinds.Phone.TYPE_MOBILE).build()
            )
            val result = resolver.applyBatch(C.AUTHORITY, ops)
            rawContacts += ContentUris.parseId(checkNotNull(result[0].uri))
            assertEquals("LOKA Test Contact", PhoneContactName.lookup(context, "+1 (202) 555-0123"))
            assertNull(PhoneContactName.lookup(context, "+442025550123")) // Same suffix is not the same number.
            assertNull(PhoneContactName.lookup(context, "+12025550999"))
        } finally {
            rawContacts.forEach { resolver.delete(ContentUris.withAppendedId(C.RawContacts.CONTENT_URI, it), null, null) }
            instrumentation.uiAutomation.dropShellPermissionIdentity()
        }
    }
}
