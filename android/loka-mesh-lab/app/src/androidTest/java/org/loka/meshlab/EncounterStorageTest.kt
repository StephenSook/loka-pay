package org.loka.meshlab

import android.content.ContentValues
import android.database.sqlite.SQLiteDatabase
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import org.junit.Assert.*
import org.junit.Test
import org.junit.runner.RunWith
import org.loka.core.EncounterHistory
import java.security.KeyStore
import java.util.UUID

/** Isolated database and storage key: never touches the user's history. */
@RunWith(AndroidJUnit4::class)
class EncounterStorageTest {
    @Test fun encryptedEncounterRestartAndTamperRejection() {
        val context = InstrumentationRegistry.getInstrumentation().targetContext
        val name = "loka-encounter-test-${UUID.randomUUID()}.db"
        val peer = "a".repeat(64)
        val record = EncounterHistory.Record(peer, 1, 6000, 0.75)
        try {
            HistoryStore(context,name).use { it.saveEncounters(listOf(record),66000) }
            HistoryStore(context,name).use { assertEquals(listOf(record),it.loadEncounters(66000)) }
            val db = SQLiteDatabase.openDatabase(context.getDatabasePath(name).path,null,SQLiteDatabase.OPEN_READWRITE)
            db.use {
                val bytes = it.rawQuery("SELECT payload FROM encounter_state WHERE id=1",null).use { c -> c.moveToFirst(); c.getBlob(0) }
                assertFalse(String(bytes,Charsets.ISO_8859_1).contains(peer))
                bytes[bytes.lastIndex] = (bytes.last().toInt() xor 1).toByte()
                it.update("encounter_state",ContentValues().apply { put("payload",bytes) },"id=1",null)
            }
            HistoryStore(context,name).use { store ->
                assertTrue(runCatching { store.loadEncounters(66000) }.isFailure)
                assertTrue(store.load().isEmpty()) // Optional metadata failure leaves chat storage usable.
            }
        } finally {
            context.deleteDatabase(name)
            KeyStore.getInstance("AndroidKeyStore").apply { load(null); deleteEntry("loka-history-storage-v1-$name") }
        }
    }
}
