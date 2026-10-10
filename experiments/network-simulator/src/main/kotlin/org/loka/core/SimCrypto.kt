package org.loka.core

import java.security.MessageDigest
import java.util.UUID

/** SIMULATOR ONLY: not encryption, not authentication, never included in the app.
 * Routing uses the unchanged production MeshEngine and actual Packet codec/validation.
 * Synthetic key/cipher/signature-shaped fixtures avoid 1,000 RSA identities/operations.
 * Crypto CPU/security results must come from the separate realCheck source set. */
class LabCrypto(val publicKey: ByteArray, private val packetId: () -> String) {
    val deviceId = fingerprint(publicKey)
    fun encrypt(recipient: ByteArray, text: String, now: Long): Packet {
        val plain = text.toByteArray(); require(plain.size in 1..MAX_TEXT_BYTES)
        val p = Packet(packetId(), deviceId, fingerprint(recipient), now, now + MAX_LIFETIME_MS,
            MAX_HOPS, publicKey, ByteArray(384), ByteArray(12), plain + ByteArray(16), ByteArray(384))
        return p.copy(signature = checksum(p))
    }
    fun decrypt(packet: Packet): String {
        require(packet.destination == deviceId && verify(packet))
        return packet.ciphertext.copyOf(packet.ciphertext.size - 16).toString(Charsets.UTF_8)
    }
    companion object {
        private fun checksum(packet: Packet): ByteArray = MessageDigest.getInstance("SHA-256").digest(packet.signedData()) + ByteArray(352)
        fun verify(packet: Packet): Boolean = packet.signature.contentEquals(checksum(packet))
    }
}
