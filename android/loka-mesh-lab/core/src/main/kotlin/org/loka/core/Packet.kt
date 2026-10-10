package org.loka.core

import java.io.ByteArrayInputStream
import java.io.ByteArrayOutputStream
import java.io.DataInputStream
import java.io.DataOutputStream
import java.security.MessageDigest
import java.util.UUID

const val MAX_FRAME_BYTES = 16_384
const val MAX_TEXT_BYTES = 2_048
const val MAX_HOPS = 6
const val MAX_LIFETIME_MS = 300_000L
const val CARRY_LIFETIME_MS = 3_600_000L

fun fingerprint(publicKey: ByteArray): String = MessageDigest.getInstance("SHA-256")
    .digest(publicKey).joinToString("") { "%02x".format(it) }

data class CarryGrant(val target: String, val key: ByteArray, val signature: ByteArray)

data class Packet(
    val id: String,
    val source: String,
    val destination: String,
    val createdAt: Long,
    val expiresAt: Long,
    val remainingHops: Int,
    val senderPublicKey: ByteArray,
    val wrappedKey: ByteArray,
    val nonce: ByteArray,
    val ciphertext: ByteArray,
    val signature: ByteArray,
    val version: Int = 0,
    val carrier: String = "",
    val grants: List<CarryGrant> = emptyList(),
    val returnVia: List<String> = emptyList(),
) {
    fun validate(now: Long) {
        require(UUID.fromString(id).toString() == id) { "Invalid packet ID" }
        require(source.matches(Regex("[0-9a-f]{64}")) && destination.matches(Regex("[0-9a-f]{64}")))
        require(source == fingerprint(senderPublicKey)) { "Source key mismatch" }
        require(remainingHops in 0..MAX_HOPS) { "Invalid hop budget" }
        require(version in 0..3)
        require(if (version == 0 || version == 3) carrier.isEmpty() else (version == 2 && carrier.isEmpty()) || carrier.matches(Regex("[0-9a-f]{64}")) && carrier != source && carrier != destination)
        require(if (version == 3) grants.size <= 3 else grants.isEmpty())
        require(if (version == 3) returnVia.size <= 3 else returnVia.isEmpty())
        require(returnVia.distinct().size == returnVia.size && returnVia.all { it.matches(Regex("[0-9a-f]{64}")) && it != source && it != destination })
        val targets = grants.map { it.target }
        require(targets.distinct().size == targets.size && targets.all { it.matches(Regex("[0-9a-f]{64}")) && it != source && it != destination })
        require(grants.all { it.key.size in 256..1024 && it.signature.size == 384 })
        val lifetime = if (version > 0) CARRY_LIFETIME_MS else MAX_LIFETIME_MS
        require(createdAt >= 0 && createdAt >= now - lifetime && createdAt <= now + 30_000 && expiresAt > now && expiresAt > createdAt)
        require(expiresAt - createdAt <= lifetime) { "Invalid lifetime" }
        require(senderPublicKey.size in 256..1024 && wrappedKey.size == 384)
        require(nonce.size == 12 && ciphertext.size in 16..(MAX_TEXT_BYTES + 16))
        require(signature.size == 384)
    }

    // The chain is append-only. Each holder commits one successor before sending.
    fun holders(): List<String> = listOf(source) + grants.map { it.target }
    fun grantData(target: String): ByteArray = bytes {
        writeUTF("LOKA-CARRY-V3"); blob(signedData()); blob(signature)
        writeInt(grants.size)
        grants.forEach { writeUTF(it.target); blob(it.key); blob(it.signature) }
        writeUTF(target)
    }

    // Immutable routing fields are authenticated. Hop budget is deliberately mutable by relays.
    fun associatedData(): ByteArray = bytes {
        writeInt(version); writeUTF(id); writeUTF(source); writeUTF(destination)
        writeLong(createdAt); writeLong(expiresAt)
        if (version == 1) writeUTF(carrier)
        if (version == 3) { writeInt(returnVia.size); returnVia.forEach { writeUTF(it) } }
    }

    fun signedData(): ByteArray = bytes {
        write(associatedData()); if (version == 2) writeUTF(carrier); blob(senderPublicKey); blob(wrappedKey); blob(nonce); blob(ciphertext)
    }
}

internal fun bytes(block: DataOutputStream.() -> Unit): ByteArray = ByteArrayOutputStream().use { out ->
    DataOutputStream(out).use { it.block() }; out.toByteArray()
}
internal fun DataOutputStream.blob(value: ByteArray) { writeInt(value.size); write(value) }

object PacketCodec {
    fun encode(packet: Packet): ByteArray = bytes {
        write(packet.associatedData()); if (packet.version == 2) writeUTF(packet.carrier); writeInt(packet.remainingHops)
        blob(packet.senderPublicKey); blob(packet.wrappedKey); blob(packet.nonce)
        blob(packet.ciphertext); blob(packet.signature)
        if (packet.version == 3) {
            writeInt(packet.grants.size)
            packet.grants.forEach { writeUTF(it.target); blob(it.key); blob(it.signature) }
        }
    }.also { require(it.size <= MAX_FRAME_BYTES) }

    fun decode(frame: ByteArray): Packet {
        require(frame.size in 1..MAX_FRAME_BYTES) { "Frame too large" }
        return DataInputStream(ByteArrayInputStream(frame)).use { input ->
            val version = input.readInt(); require(version in 0..3) { "Unsupported packet version" }
            val id = input.readUTF(); val source = input.readUTF(); val destination = input.readUTF()
            val created = input.readLong(); val expires = input.readLong()
            val carrier = if (version in 1..2) input.readUTF() else ""
            val hints = if (version == 3) { val count = input.readInt(); require(count in 0..3); List(count) { input.readUTF() } } else emptyList()
            var packet = Packet(
                id, source, destination, created, expires,
                input.readInt(), input.blob(1024), input.blob(384), input.blob(12),
                input.blob(MAX_TEXT_BYTES + 16), input.blob(384), version, carrier, returnVia = hints,
            )
            if (version == 3) {
                val count = input.readInt(); require(count in 0..3)
                packet = packet.copy(grants = List(count) { CarryGrant(input.readUTF(), input.blob(1024), input.blob(384)) })
            }
            require(input.available() == 0) { "Trailing packet data" }
            packet
        }
    }

    private fun DataInputStream.blob(limit: Int): ByteArray {
        val size = readInt()
        require(size in 0..limit && size <= available()) { "Invalid field length" }
        return ByteArray(size).also { readFully(it) }
    }
}
