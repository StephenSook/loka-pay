package org.loka.meshlab

import android.content.ContentValues
import android.content.Context
import android.database.sqlite.SQLiteDatabase
import android.database.sqlite.SQLiteOpenHelper
import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyProperties
import org.json.JSONObject
import org.loka.core.MAX_TEXT_BYTES
import org.loka.core.backup.BackupCipher
import java.security.KeyStore
import javax.crypto.Cipher
import javax.crypto.KeyGenerator
import javax.crypto.SecretKey
import javax.crypto.spec.GCMParameterSpec

internal object HistoryFormat {
    const val MAX_MESSAGES = 5000
    const val MAX_BODY = 131072
    fun encodeMessage(message: ChatMessage): JSONObject = JSONObject().apply {
        message.route?.let { r -> put("route", JSONObject().put("transport", r.transport).put("carrier", r.carrier).put("at", r.at).put("expiresAt", r.expiresAt)) }
        put("lifetime", message.lifetime); put("id", message.id); put("peer", message.peerId); put("body", message.body)
        put("image", message.image); put("voice", message.voice); put("delivered", message.delivered); put("packets", org.json.JSONArray(message.packetIds));
        put("deliveredAt", message.deliveredAt); put("readAt", message.readAt); put("readReceiptQueued", message.readReceiptQueued); put("hops", message.reportedHops); put("myReaction", message.myReaction); put("peerReaction", message.peerReaction); put("reactionPacket", message.reactionPacket)
        put("outgoing", message.outgoing); put("time", message.timestamp); put("name", message.peerName)
    }
    fun decodeMessage(json: JSONObject): ChatMessage {
        val message = ChatMessage(json.getString("id"), json.getString("peer"), json.getString("body"),
            json.getBoolean("outgoing"), json.getLong("time"), json.optString("name", ""),
            route = json.optJSONObject("route")?.let { org.loka.core.LocalRouteEvidence(it.getString("transport"), it.getString("carrier"), it.getLong("at"), it.getLong("expiresAt")).also { r -> r.validate() } },
            lifetime = json.optLong("lifetime", org.loka.core.MAX_LIFETIME_MS), activeQueue = false, image = json.optBoolean("image"), voice = json.optBoolean("voice"), delivered = json.optBoolean("delivered"),
            deliveredAt = if (json.has("deliveredAt")) json.getLong("deliveredAt") else null,
            readAt = if (json.has("readAt")) json.getLong("readAt") else null, readReceiptQueued = json.optBoolean("readReceiptQueued"),
            reportedHops = if (json.has("hops")) json.getInt("hops") else null,
            myReaction = if (json.has("myReaction")) json.getString("myReaction") else null,
            peerReaction = if (json.has("peerReaction")) json.getString("peerReaction") else null,
            reactionPacket = if (json.has("reactionPacket")) json.getString("reactionPacket") else null,
            packetIds = json.optJSONArray("packets")?.let { a -> require(a.length() <= 96); (0 until a.length()).map { a.getString(it) } } ?: emptyList())
        require(message.id.length in 1..128 && message.id.all { it.isLetterOrDigit() && it.code < 128 || it == '-' })
        require(message.peerId.length == 64 && message.peerId.all { it in '0'..'9' || it in 'a'..'f' })
        require(message.body.toByteArray(Charsets.UTF_8).size in 1..(if (message.voice || message.image) MAX_BODY else MAX_TEXT_BYTES))
        require(!(message.voice && message.image))
        if (message.voice || message.image) {
            val bytes = android.util.Base64.decode(message.body, android.util.Base64.NO_WRAP)
            if (message.image) require(org.loka.core.ChatContent.validImage(bytes))
            require(bytes.size in 1..98304 && android.util.Base64.encodeToString(bytes, android.util.Base64.NO_WRAP) == message.body)
        }
        require(message.packetIds.all { java.util.UUID.fromString(it).toString() == it })
        require(message.deliveredAt == null || message.deliveredAt >= 0); require(message.readAt == null || message.readAt >= 0)
        require(message.reportedHops == null || message.reportedHops in 1..7)
        org.loka.core.ChatContent.reactionVersion(message.myReaction); org.loka.core.ChatContent.reactionVersion(message.peerReaction)
        message.reactionPacket?.let { require(java.util.UUID.fromString(it).toString() == it) }
        require(message.lifetime in 1..org.loka.core.CARRY_LIFETIME_MS)
        require(message.timestamp >= 0 && message.peerName.length <= 40)
        return message
    }
    fun encode(messages: List<ChatMessage>): ByteArray {
        require(messages.size <= MAX_MESSAGES)
        val output = java.io.ByteArrayOutputStream()
        java.io.DataOutputStream(output).use { data ->
            fun text(value: String, max: Int) {
                val bytes = value.toByteArray(Charsets.UTF_8)
                require(bytes.size <= max); data.writeInt(bytes.size); data.write(bytes)
            }
            data.writeInt(4); data.writeInt(messages.size)
            messages.forEach { message ->
                decodeMessage(encodeMessage(message))
                text(encodeMessage(message).toString(), MAX_BODY * 2 + 8192)
            }
        }
        return output.toByteArray().also { require(it.size < BackupCipher.MAX_BYTES - 36) }
    }
    fun decode(bytes: ByteArray): List<ChatMessage> {
        require(bytes.size < BackupCipher.MAX_BYTES)
        val data = java.io.DataInputStream(java.io.ByteArrayInputStream(bytes))
        fun text(max: Int): String {
            val length = data.readInt(); require(length in 0..max)
            val value = ByteArray(length); data.readFully(value)
            return Charsets.UTF_8.newDecoder().onMalformedInput(java.nio.charset.CodingErrorAction.REPORT)
                .onUnmappableCharacter(java.nio.charset.CodingErrorAction.REPORT).decode(java.nio.ByteBuffer.wrap(value)).toString()
        }
        val version = data.readInt(); require(version in 1..4)
        val count = data.readInt(); require(count in 0..MAX_MESSAGES)
        val messages = (0 until count).map {
            if (version == 4) return@map decodeMessage(JSONObject(text(MAX_BODY * 2 + 8192)))
            val id = text(128); val peer = text(64); val body = text(MAX_BODY)
            val direction = data.readUnsignedByte(); require(direction in 0..1)
            val message = ChatMessage(id, peer, body, direction == 1, data.readLong(), text(160),
                voice = if (version >= 2) data.readBoolean() else false, delivered = if (version >= 2) data.readBoolean() else false, image = if (version >= 3) data.readBoolean() else false)
            decodeMessage(encodeMessage(message))
        }
        require(data.available() == 0)
        require(messages.map { it.id }.toSet().size == messages.size)
        return messages
    }
}

/** Payload encryption: SQLite contains only opaque IDs and authenticated ciphertext. */
internal class HistoryStore(context: Context, name: String = "loka-history-v1.db") : AutoCloseable {
    private val alias = "loka-history-storage-v1-$name"
    private val store = KeyStore.getInstance("AndroidKeyStore").apply { load(null) }
    private val helper = object : SQLiteOpenHelper(context, name, null, 1) {
        override fun onCreate(db: SQLiteDatabase) {
            db.execSQL("CREATE TABLE history (id TEXT PRIMARY KEY NOT NULL, payload BLOB NOT NULL)")
        }
        override fun onUpgrade(db: SQLiteDatabase, oldVersion: Int, newVersion: Int) { error("Unsupported history version") }
    }
    private val key: SecretKey
    @Synchronized fun loadEncounters(now: Long): List<org.loka.core.EncounterHistory.Record> {
        val db = helper.writableDatabase
        db.execSQL("CREATE TABLE IF NOT EXISTS encounter_state (id INTEGER PRIMARY KEY, payload BLOB NOT NULL)")
        return db.rawQuery("SELECT payload FROM encounter_state WHERE id=1", null).use { cursor ->
            if (!cursor.moveToFirst()) emptyList() else {
                val bytes = cursor.getBlob(0); require(bytes.size in 28..32796)
                val cipher = Cipher.getInstance("AES/GCM/NoPadding")
                cipher.init(Cipher.DECRYPT_MODE, key, GCMParameterSpec(128, bytes.copyOfRange(0,12)))
                cipher.updateAAD("loka.encounters.v1".toByteArray())
                val array = org.json.JSONArray(String(cipher.doFinal(bytes.copyOfRange(12,bytes.size)), Charsets.UTF_8))
                require(array.length() <= 64)
                val records = (0 until array.length()).map { index ->
                    val r = array.getJSONObject(index)
                    org.loka.core.EncounterHistory.Record(r.getString("identity"), r.getInt("encounters"), r.getLong("lastEncounter"), r.getDouble("estimate"))
                }
                org.loka.core.EncounterHistory().apply { restore(records, now) }.saved(now)
            }
        }
    }
    @Synchronized fun saveEncounters(records: List<org.loka.core.EncounterHistory.Record>, now: Long) {
        val checked = org.loka.core.EncounterHistory().apply { restore(records, now) }.saved(now)
        val plain = org.json.JSONArray(checked.map { r -> JSONObject().put("identity",r.identity).put("encounters",r.encounters).put("lastEncounter",r.lastEncounter).put("estimate",r.estimate) }).toString().toByteArray(Charsets.UTF_8)
        require(plain.size <= 32768)
        val cipher = Cipher.getInstance("AES/GCM/NoPadding"); cipher.init(Cipher.ENCRYPT_MODE,key)
        cipher.updateAAD("loka.encounters.v1".toByteArray())
        val db = helper.writableDatabase
        db.execSQL("CREATE TABLE IF NOT EXISTS encounter_state (id INTEGER PRIMARY KEY, payload BLOB NOT NULL)")
        check(db.insertWithOnConflict("encounter_state",null,ContentValues().apply { put("id",1); put("payload",cipher.iv + cipher.doFinal(plain)) },SQLiteDatabase.CONFLICT_REPLACE) != -1L)
    }
    @Synchronized fun saveGame(raw: String) {
        val plain = raw.toByteArray(Charsets.UTF_8); require(plain.size <= 16384)
        val cipher = Cipher.getInstance("AES/GCM/NoPadding"); cipher.init(Cipher.ENCRYPT_MODE, key)
        cipher.updateAAD("loka.game.v1".toByteArray(Charsets.UTF_8))
        val db = helper.writableDatabase
        db.execSQL("CREATE TABLE IF NOT EXISTS game_state (id INTEGER PRIMARY KEY, payload BLOB NOT NULL)")
        check(db.insertWithOnConflict("game_state", null, ContentValues().apply { put("id", 1); put("payload", cipher.iv + cipher.doFinal(plain)) }, SQLiteDatabase.CONFLICT_REPLACE) != -1L)
    }
    @Synchronized fun loadGame(): String? {
        val db = helper.writableDatabase
        db.execSQL("CREATE TABLE IF NOT EXISTS game_state (id INTEGER PRIMARY KEY, payload BLOB NOT NULL)")
        return db.rawQuery("SELECT payload FROM game_state WHERE id=1", null).use { c ->
            if (!c.moveToFirst()) null else {
                val bytes = c.getBlob(0); require(bytes.size in 28..16412)
                val cipher = Cipher.getInstance("AES/GCM/NoPadding")
                cipher.init(Cipher.DECRYPT_MODE, key, GCMParameterSpec(128, bytes.copyOfRange(0, 12)))
                cipher.updateAAD("loka.game.v1".toByteArray(Charsets.UTF_8))
                org.loka.core.ChatContent.utf8(cipher.doFinal(bytes.copyOfRange(12, bytes.size)))
            }
        }
    }
    @Synchronized fun saveParty(raw: String) {
        val plain = raw.toByteArray(Charsets.UTF_8); require(plain.size <= 32768)
        val cipher = Cipher.getInstance("AES/GCM/NoPadding"); cipher.init(Cipher.ENCRYPT_MODE, key)
        cipher.updateAAD("loka.party.v1".toByteArray(Charsets.UTF_8))
        val db = helper.writableDatabase
        db.execSQL("CREATE TABLE IF NOT EXISTS game_state (id INTEGER PRIMARY KEY, payload BLOB NOT NULL)")
        check(db.insertWithOnConflict("game_state", null, ContentValues().apply { put("id", 2); put("payload", cipher.iv + cipher.doFinal(plain)) }, SQLiteDatabase.CONFLICT_REPLACE) != -1L)
    }
    @Synchronized fun loadParty(): String? {
        val db = helper.writableDatabase
        db.execSQL("CREATE TABLE IF NOT EXISTS game_state (id INTEGER PRIMARY KEY, payload BLOB NOT NULL)")
        return db.rawQuery("SELECT payload FROM game_state WHERE id=2", null).use { c ->
            if (!c.moveToFirst()) null else {
                val bytes = c.getBlob(0); require(bytes.size in 28..32796)
                val cipher = Cipher.getInstance("AES/GCM/NoPadding")
                cipher.init(Cipher.DECRYPT_MODE, key, GCMParameterSpec(128, bytes.copyOfRange(0, 12)))
                cipher.updateAAD("loka.party.v1".toByteArray(Charsets.UTF_8))
                org.loka.core.ChatContent.utf8(cipher.doFinal(bytes.copyOfRange(12, bytes.size)))
            }
        }
    }
    @Synchronized fun loadNearby(): org.loka.core.NearbySaved? {
        val db = helper.writableDatabase
        db.execSQL("CREATE TABLE IF NOT EXISTS nearby_state (id INTEGER PRIMARY KEY, payload BLOB NOT NULL)")
        return db.rawQuery("SELECT payload FROM nearby_state WHERE id=1", null).use { cursor ->
            if (!cursor.moveToFirst()) null else {
                val bytes=cursor.getBlob(0); require(bytes.size in 28..262172)
                val cipher=Cipher.getInstance("AES/GCM/NoPadding")
                cipher.init(Cipher.DECRYPT_MODE,key,GCMParameterSpec(128,bytes.copyOfRange(0,12)))
                cipher.updateAAD("loka.nearby.v1".toByteArray())
                NearbyStorage.decode(cipher.doFinal(bytes.copyOfRange(12,bytes.size)))
            }
        }
    }
    @Synchronized fun saveNearby(state: org.loka.core.NearbySaved) {
        val cipher=Cipher.getInstance("AES/GCM/NoPadding"); cipher.init(Cipher.ENCRYPT_MODE,key)
        cipher.updateAAD("loka.nearby.v1".toByteArray())
        val bytes=cipher.iv + cipher.doFinal(NearbyStorage.encode(state))
        val db=helper.writableDatabase
        db.execSQL("CREATE TABLE IF NOT EXISTS nearby_state (id INTEGER PRIMARY KEY, payload BLOB NOT NULL)")
        check(db.insertWithOnConflict("nearby_state",null,ContentValues().apply { put("id",1); put("payload",bytes) },SQLiteDatabase.CONFLICT_REPLACE) != -1L)
    }
    @Synchronized fun saveCarry(frames: List<ByteArray>) {
        require(frames.size <= 128 && frames.sumOf { it.size } <= 524288 && frames.all { it.size <= 16384 })
        val plain = org.json.JSONArray(frames.map { android.util.Base64.encodeToString(it, android.util.Base64.NO_WRAP) }).toString().toByteArray()
        val cipher = Cipher.getInstance("AES/GCM/NoPadding"); cipher.init(Cipher.ENCRYPT_MODE, key)
        cipher.updateAAD("loka.carry.v1".toByteArray())
        val payload = cipher.iv + cipher.doFinal(plain)
        val db = helper.writableDatabase
        db.execSQL("CREATE TABLE IF NOT EXISTS carry_state (id INTEGER PRIMARY KEY, payload BLOB NOT NULL)")
        check(db.insertWithOnConflict("carry_state", null, ContentValues().apply { put("id", 1); put("payload", payload) }, SQLiteDatabase.CONFLICT_REPLACE) != -1L)
    }
    @Synchronized fun loadCarry(): List<ByteArray> {
        val db = helper.writableDatabase
        db.execSQL("CREATE TABLE IF NOT EXISTS carry_state (id INTEGER PRIMARY KEY, payload BLOB NOT NULL)")
        return db.rawQuery("SELECT payload FROM carry_state WHERE id=1", null).use { c ->
            if (!c.moveToFirst()) emptyList() else {
                val bytes = c.getBlob(0); require(bytes.size in 28..800000)
                val cipher = Cipher.getInstance("AES/GCM/NoPadding")
                cipher.init(Cipher.DECRYPT_MODE, key, GCMParameterSpec(128, bytes.copyOfRange(0,12)))
                cipher.updateAAD("loka.carry.v1".toByteArray())
                val array = org.json.JSONArray(String(cipher.doFinal(bytes.copyOfRange(12,bytes.size)), Charsets.UTF_8))
                require(array.length() <= 128)
                (0 until array.length()).map { android.util.Base64.decode(array.getString(it), android.util.Base64.NO_WRAP) }
                    .also { frames -> require(frames.sumOf { it.size } <= 524288 && frames.all { it.size <= 16384 }) }
            }
        }
    }
    companion object { private val keyCreationLock = Any() }
    init {
        synchronized(keyCreationLock) {
        // Never regenerate an absent key over an existing encrypted history database.
        if (!store.containsAlias(alias)) {
            require(!context.getDatabasePath(name).exists()) { "Local history key is unavailable; restore from an encrypted backup" }
            KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, "AndroidKeyStore").apply {
                init(KeyGenParameterSpec.Builder(alias, KeyProperties.PURPOSE_ENCRYPT or KeyProperties.PURPOSE_DECRYPT)
                    .setKeySize(256).setBlockModes(KeyProperties.BLOCK_MODE_GCM)
                    .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
                    .setRandomizedEncryptionRequired(true).build())
            }.generateKey()
        }
        key = store.getKey(alias, null) as SecretKey
        }
    }
    private fun aad(id: String) = "loka.history.v1:$id".toByteArray(Charsets.UTF_8)
    private fun seal(message: ChatMessage): ByteArray {
        val cipher = Cipher.getInstance("AES/GCM/NoPadding")
        cipher.init(Cipher.ENCRYPT_MODE, key)
        require(cipher.iv.size == 12)
        cipher.updateAAD(aad(message.id))
        val plain = HistoryFormat.encodeMessage(message).toString().toByteArray(Charsets.UTF_8)
        return try { require(plain.size + 28 <= HistoryFormat.MAX_BODY * 2 + 8192); cipher.iv + cipher.doFinal(plain) } finally { plain.fill(0) }
    }
    private fun open(id: String, payload: ByteArray): ChatMessage {
        require(payload.size in 28..(HistoryFormat.MAX_BODY * 2 + 8192))
        val cipher = Cipher.getInstance("AES/GCM/NoPadding")
        cipher.init(Cipher.DECRYPT_MODE, key, GCMParameterSpec(128, payload.copyOfRange(0, 12)))
        cipher.updateAAD(aad(id))
        val plain = cipher.doFinal(payload, 12, payload.size - 12)
        try {
            return HistoryFormat.decodeMessage(JSONObject(String(plain, Charsets.UTF_8))).also { require(it.id == id) }
        } finally { plain.fill(0) }
    }
    @Synchronized fun load(): List<ChatMessage> = helper.readableDatabase.rawQuery(
        "SELECT id,payload FROM history ORDER BY rowid", null).use { cursor ->
        buildList { while (cursor.moveToNext()) { require(size < HistoryFormat.MAX_MESSAGES); add(open(cursor.getString(0), cursor.getBlob(1))) } }
    }
    @Synchronized fun append(message: ChatMessage) {
        HistoryFormat.decodeMessage(HistoryFormat.encodeMessage(message))
        val encrypted = seal(message)
        val db = helper.writableDatabase
        db.beginTransaction()
        try {
            db.insertWithOnConflict("history", null, ContentValues().apply { put("id", message.id); put("payload", encrypted) }, SQLiteDatabase.CONFLICT_IGNORE)
                .also { require(it != -1L || android.database.DatabaseUtils.longForQuery(db, "SELECT COUNT(*) FROM history WHERE id=?", arrayOf(message.id)) == 1L) }
            db.execSQL("DELETE FROM history WHERE rowid NOT IN (SELECT rowid FROM history ORDER BY rowid DESC LIMIT ${HistoryFormat.MAX_MESSAGES})")
            db.setTransactionSuccessful()
        } finally { db.endTransaction() }
    }
    @Synchronized fun update(message: ChatMessage) {
        HistoryFormat.decodeMessage(HistoryFormat.encodeMessage(message))
        helper.writableDatabase.update("history", ContentValues().apply { put("payload", seal(message)) }, "id=?", arrayOf(message.id))
    }
    @Synchronized fun merge(messages: List<ChatMessage>): List<ChatMessage> {
        require(messages.size <= HistoryFormat.MAX_MESSAGES * 2)
        messages.forEach { HistoryFormat.decodeMessage(HistoryFormat.encodeMessage(it)) }
        val merged = (load() + messages).distinctBy { it.id }.sortedBy { it.timestamp }.takeLast(HistoryFormat.MAX_MESSAGES)
        val encrypted = merged.map { it.id to seal(it) }
        val db = helper.writableDatabase
        db.beginTransaction()
        try {
            db.delete("history", null, null)
            encrypted.forEach { (id, payload) ->
                db.insertOrThrow("history", null, ContentValues().apply { put("id", id); put("payload", payload) })
            }
            db.setTransactionSuccessful()
        } finally { db.endTransaction() }
        return merged
    }
    @Synchronized override fun close() { helper.close() }
}
