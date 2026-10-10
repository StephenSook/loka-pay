package org.loka.experiment

import org.loka.core.*
import java.nio.ByteBuffer
import java.nio.channels.FileChannel
import java.nio.file.*
import java.io.*
import java.security.SecureRandom
import javax.crypto.Cipher
import javax.crypto.spec.GCMParameterSpec
import javax.crypto.spec.SecretKeySpec

/** Isolated custody experiment. Stores only encoded envelope + ingress hint.
 * Not installed in either app. Caller supplies a separate storage key; do not put it in the archive.
 * Fresh engine restart feeds original inbound envelope exactly once, retaining the hop decrement. */
class CiphertextJournal(private val file: Path, key: ByteArray, private val ownID: String,
    private val clock: () -> Long, private val maxItems: Int = 128,
    private val maxBytes: Int = 2 * 1024 * 1024, private val perOrigin: Int = 32) {
    data class Entry(val frame: ByteArray, val ingress: String)
    private val key = SecretKeySpec(key.clone().also { require(it.size == 32) }, "AES")
    private val aad = "loka.experiment.custody.v1".toByteArray()
    private var entries = linkedMapOf<String, Entry>()
    init { require(maxItems in 1..128 && maxBytes in MAX_FRAME_BYTES..(2*1024*1024) && perOrigin in 1..maxItems); load() }
    fun frames(): List<Entry> { expire(); return entries.values.toList() }
    fun bytes(): Long = if (Files.exists(file)) Files.size(file) else 0
    fun put(frame: ByteArray, ingress: String): Boolean {
        require(ingress.toByteArray().size <= 160)
        val packet = checkFrame(frame)
        expire()
        if (packet.id in entries) return true
        if (entries.size >= maxItems || entries.values.sumOf { it.frame.size } + frame.size > maxBytes ||
            entries.values.count { PacketCodec.decode(it.frame).source == packet.source } >= perOrigin) return false
        val next = LinkedHashMap(entries); next[packet.id] = Entry(frame.clone(), ingress)
        save(next); entries = next; return true
    }
    private fun checkFrame(frame: ByteArray): Packet = PacketCodec.decode(frame).also {
        it.validate(clock()); require(LabCrypto.verify(it)); require(it.source != ownID && it.destination != ownID && it.remainingHops > 0)
    }
    private fun expire() {
        val next = LinkedHashMap(entries.filterValues { PacketCodec.decode(it.frame).expiresAt > clock() })
        if (next.size != entries.size) { save(next); entries = next }
    }
    private fun load() {
        if (!Files.exists(file)) return
        require(Files.size(file) in 28..(maxBytes + 65536).toLong())
        val data = Files.readAllBytes(file)
        val cipher = Cipher.getInstance("AES/GCM/NoPadding")
        cipher.init(Cipher.DECRYPT_MODE, key, GCMParameterSpec(128, data.copyOfRange(0, 12))); cipher.updateAAD(aad)
        val plain = cipher.doFinal(data.copyOfRange(12, data.size))
        try { DataInputStream(ByteArrayInputStream(plain)).use { input ->
            require(input.readInt() == 1); val count = input.readInt(); require(count in 0..maxItems)
            var total = 0; val origins = mutableMapOf<String, Int>()
            repeat(count) {
                val ingress = input.readUTF(); require(ingress.toByteArray().size <= 160)
                val size = input.readInt(); require(size in 1..MAX_FRAME_BYTES && size <= input.available())
                total += size; require(total <= maxBytes)
                val frame = ByteArray(size).also(input::readFully); val p = PacketCodec.decode(frame)
                // Never resurrect an expired envelope or extend its original expiry.
                if (p.expiresAt > clock()) {
                    checkFrame(frame); require(p.id !in entries)
                    origins[p.source] = (origins[p.source] ?: 0) + 1; require(origins.getValue(p.source) <= perOrigin)
                    entries[p.id] = Entry(frame, ingress)
                }
            }
            require(input.available() == 0)
        } } finally { plain.fill(0) }
    }
    private fun save(next: Map<String, Entry>) {
        val plain = ByteArrayOutputStream().use { buffer ->
            DataOutputStream(buffer).use { out -> out.writeInt(1); out.writeInt(next.size)
                next.values.forEach { out.writeUTF(it.ingress); out.writeInt(it.frame.size); out.write(it.frame) } }
            buffer.toByteArray()
        }
        val nonce = ByteArray(12).also(SecureRandom()::nextBytes)
        val cipher = Cipher.getInstance("AES/GCM/NoPadding"); cipher.init(Cipher.ENCRYPT_MODE, key, GCMParameterSpec(128, nonce)); cipher.updateAAD(aad)
        val encrypted = try { nonce + cipher.doFinal(plain) } finally { plain.fill(0) }
        Files.createDirectories(file.parent)
        val temp = file.resolveSibling(file.fileName.toString() + ".new")
        FileChannel.open(temp, StandardOpenOption.CREATE, StandardOpenOption.TRUNCATE_EXISTING, StandardOpenOption.WRITE).use { channel ->
            val buffer = ByteBuffer.wrap(encrypted); while (buffer.hasRemaining()) channel.write(buffer); channel.force(true)
        }
        // Required atomic replacement; unsupported filesystems fail rather than falling back to a torn write.
        Files.move(temp, file, StandardCopyOption.ATOMIC_MOVE, StandardCopyOption.REPLACE_EXISTING)
        FileChannel.open(file.parent, StandardOpenOption.READ).use { it.force(true) }
    }
}
