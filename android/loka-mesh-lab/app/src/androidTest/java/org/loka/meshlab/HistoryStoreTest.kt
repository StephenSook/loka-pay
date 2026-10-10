package org.loka.meshlab

import android.database.sqlite.SQLiteDatabase
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import org.junit.Assert.*
import org.junit.Test
import org.junit.runner.RunWith
import org.loka.core.backup.BackupCipher
import java.security.KeyStore
import java.util.UUID

@RunWith(AndroidJUnit4::class)
class HistoryStoreTest {
    private val context get() = InstrumentationRegistry.getInstrumentation().targetContext
    private fun isolated(block: (String) -> Unit) {
        val name = "history-test-${UUID.randomUUID()}.db"
        try { block(name) } finally {
            context.deleteDatabase(name)
            KeyStore.getInstance("AndroidKeyStore").apply { load(null); deleteEntry("loka-history-storage-v1-$name") }
        }
    }
    private fun message(id: String = UUID.randomUUID().toString()) = ChatMessage(id, "a".repeat(64), "Persistent private content", true, 42L, "Alice", true)
    @Test fun bundledPartyCatalogIncludesCouplesOnlyCategory() {
        val catalog=PartyCatalog.load(context)
        assertEquals(8,catalog.games.size);assertEquals(218,catalog.games.sumOf{it.cards.size})
        assertEquals(setOf("couples"),catalog.games.single{it.id=="two_player_specials"}.instructions.keys)
    }
    @Test fun partyAndQuizArchivesRemainIsolatedAndBounded() = isolated { name ->
        HistoryStore(context,name).use { it.saveParty("party proposal"); it.saveGame("quiz state") }
        HistoryStore(context,name).use { store ->
            assertEquals("party proposal",store.loadParty()); assertEquals("quiz state",store.loadGame()); assertTrue(store.load().isEmpty())
            try { store.saveParty("x".repeat(32769)); fail("Oversized party archive") } catch (_: IllegalArgumentException) {}
        }
        SQLiteDatabase.openDatabase(context.getDatabasePath(name).path,null,SQLiteDatabase.OPEN_READWRITE).use { db ->
            db.execSQL("UPDATE game_state SET payload = zeroblob(length(payload)) WHERE id = 2")
        }
        HistoryStore(context,name).use { store ->
            try { store.loadParty(); fail("Tampered party archive") } catch (_: Exception) {}
            assertEquals("quiz state",store.loadGame())
        }
    }
    @Test fun routeEvidenceSurvivesEncryptedReopenAndLegacyRowsRemainReadable() = isolated { name ->
        val old = message().copy(activeQueue = false)
        val route = org.loka.core.LocalRouteEvidence("aware", "b".repeat(64), 100, 3600042)
        val recorded = message().copy(activeQueue = false, route = route)
        HistoryStore(context, name).use { it.append(old); it.append(recorded) }
        HistoryStore(context, name).use { store ->
            assertNull(store.load().first { it.id == old.id }.route)
            assertEquals(route, store.load().first { it.id == recorded.id }.route)
        }
        val invalid = HistoryFormat.encodeMessage(recorded)
        invalid.getJSONObject("route").put("transport", "invented")
        assertTrue(runCatching { HistoryFormat.decodeMessage(invalid) }.isFailure)
    }
    @Test fun imagePreparationResizesAndRemovesMetadata() {
        val file = java.io.File.createTempFile("photo-fixture-", ".jpg", context.cacheDir)
        try {
            val bitmap = android.graphics.Bitmap.createBitmap(1500, 750, android.graphics.Bitmap.Config.ARGB_8888)
            bitmap.eraseColor(android.graphics.Color.BLUE)
            file.outputStream().use { bitmap.compress(android.graphics.Bitmap.CompressFormat.JPEG, 95, it) }; bitmap.recycle()
            android.media.ExifInterface(file.absolutePath).apply { setAttribute(android.media.ExifInterface.TAG_ORIENTATION, "6"); setAttribute(android.media.ExifInterface.TAG_ARTIST, "synthetic metadata"); saveAttributes() }
            val bytes = ImageAttachment.prepare(context.contentResolver, android.net.Uri.fromFile(file))
            assertTrue(org.loka.core.ChatContent.validImage(bytes)); assertTrue(bytes.size <= 65536)
            val decoded = android.graphics.BitmapFactory.decodeByteArray(bytes, 0, bytes.size)
            assertTrue(decoded.height > decoded.width); assertTrue(maxOf(decoded.width, decoded.height) <= 1024); decoded.recycle()
            assertNull(android.media.ExifInterface(java.io.ByteArrayInputStream(bytes)).getAttribute(android.media.ExifInterface.TAG_ARTIST))
        } finally { file.delete() }
    }
    @Test fun photoAndLongVoiceSurviveEncryptedHistoryAndBackup() = isolated { name ->
        val bitmap = android.graphics.Bitmap.createBitmap(8, 8, android.graphics.Bitmap.Config.ARGB_8888)
        val output = java.io.ByteArrayOutputStream(); bitmap.compress(android.graphics.Bitmap.CompressFormat.JPEG, 70, output); bitmap.recycle()
        val image = message().copy(body = android.util.Base64.encodeToString(output.toByteArray(), android.util.Base64.NO_WRAP), image = true, activeQueue = false)
        val voice = message().copy(body = android.util.Base64.encodeToString(ByteArray(98304), android.util.Base64.NO_WRAP), voice = true, activeQueue = false)
        HistoryStore(context, name).use { it.append(image); it.append(voice) }
        HistoryStore(context, name).use { assertEquals(2, it.load().size); assertEquals(image, it.load().first { it.id == image.id }) }
        assertEquals(listOf(image, voice), HistoryFormat.decode(HistoryFormat.encode(listOf(image, voice))))
    }
    @Test fun encryptedHistorySurvivesReopenAndDoesNotRestoreNetworkQueue() = isolated { name ->
        val message = message()
        HistoryStore(context, name).use { it.append(message) }
        HistoryStore(context, name).use {
            assertEquals(listOf(message.copy(activeQueue = false)), it.load())
            SQLiteDatabase.openDatabase(context.getDatabasePath(name).path, null, SQLiteDatabase.OPEN_READONLY).use { db ->
                db.rawQuery("SELECT payload FROM history", null).use { cursor ->
                    assertTrue(cursor.moveToFirst())
                    val payload = String(cursor.getBlob(0), Charsets.ISO_8859_1)
                    assertFalse(payload.contains(message.body)); assertFalse(payload.contains(message.peerId)); assertFalse(payload.contains("Alice"))
                }
            }
        }
    }
    @Test fun swappedRowIdentifierFailsAuthenticationWithoutErasingHistory() = isolated { name ->
        HistoryStore(context, name).use { store ->
            store.append(message())
            SQLiteDatabase.openDatabase(context.getDatabasePath(name).path, null, SQLiteDatabase.OPEN_READWRITE).use {
                it.execSQL("UPDATE history SET id='substituted'")
            }
            assertTrue(runCatching { store.load() }.isFailure)
            SQLiteDatabase.openDatabase(context.getDatabasePath(name).path, null, SQLiteDatabase.OPEN_READONLY).use {
                assertEquals(1, android.database.DatabaseUtils.queryNumEntries(it, "history"))
            }
        }
    }
    @Test fun restoredHistoryMergesWithoutOverwritingExistingMessages() = isolated { name ->
        HistoryStore(context, name).use { store ->
            val original = message()
            store.append(original)
            val imported = message().copy(outgoing = false)
            val code = BackupCipher.recoveryCode()
            val restored = HistoryFormat.decode(BackupCipher.decrypt(BackupCipher.encrypt(HistoryFormat.encode(listOf(imported)), code), code))
            store.merge(restored + original.copy(body = "replacement attempt"))
            assertEquals(2, store.load().size)
            assertEquals(original.body, store.load().first { it.id == original.id }.body)
            assertTrue(store.load().none { it.activeQueue })
            assertTrue(runCatching { store.merge(listOf(imported.copy(body = "x".repeat(2049)))) }.isFailure)
            assertEquals(2, store.load().size)
        }
    }
    @Test fun archiveParserRejectsOversizedCountsTruncationTrailingDataAndDuplicateIds() {
        val original = message()
        val archive = HistoryFormat.encode(listOf(original))
        val oversizedCount = java.nio.ByteBuffer.allocate(8).putInt(1).putInt(HistoryFormat.MAX_MESSAGES + 1).array()
        val invalid = listOf(oversizedCount, archive.copyOf(10), archive + byteArrayOf(1),
            HistoryFormat.encode(listOf(original, original)), "{}".toByteArray())
        invalid.forEach { assertTrue(runCatching { HistoryFormat.decode(it) }.isFailure) }
    }
    @Test fun missingLocalKeyDoesNotSilentlyResetExistingHistory() = isolated { name ->
        HistoryStore(context, name).use { it.append(message()) }
        KeyStore.getInstance("AndroidKeyStore").apply { load(null); deleteEntry("loka-history-storage-v1-$name") }
        assertTrue(runCatching { HistoryStore(context, name).close() }.isFailure)
        assertTrue(context.getDatabasePath(name).exists())
    }
}
