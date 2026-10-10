package org.loka.core.backup

import java.security.SecureRandom
import java.util.Base64
import javax.crypto.Cipher
import javax.crypto.spec.GCMParameterSpec
import javax.crypto.spec.SecretKeySpec

/** Portable AES-GCM archive. This contains history only, never messaging identity keys. */
object BackupCipher {
    const val MAX_BYTES = 16 * 1024 * 1024
    private val header = "LOKABK01".toByteArray(Charsets.US_ASCII)
    fun recoveryCode(): String = Base64.getUrlEncoder().withoutPadding()
        .encodeToString(ByteArray(32).also { SecureRandom().nextBytes(it) })
    private fun key(code: String): SecretKeySpec {
        require(code.length == 43 && code.all { it in 'A'..'Z' || it in 'a'..'z' || it in '0'..'9' || it == '-' || it == '_' }) { "Invalid recovery key" }
        val raw = Base64.getUrlDecoder().decode(code)
        require(raw.size == 32 && Base64.getUrlEncoder().withoutPadding().encodeToString(raw) == code) { "Invalid recovery key" }
        return SecretKeySpec(raw, "AES").also { raw.fill(0) }
    }
    fun encrypt(plain: ByteArray, code: String): ByteArray {
        require(plain.size <= MAX_BYTES - header.size - 12 - 16) { "Backup too large" }
        val nonce = ByteArray(12).also { SecureRandom().nextBytes(it) }
        val cipher = Cipher.getInstance("AES/GCM/NoPadding")
        cipher.init(Cipher.ENCRYPT_MODE, key(code), GCMParameterSpec(128, nonce))
        cipher.updateAAD(header)
        return header + nonce + cipher.doFinal(plain)
    }
    fun decrypt(archive: ByteArray, code: String): ByteArray {
        require(archive.size in (header.size + 12 + 16)..MAX_BYTES) { "Invalid backup size" }
        require(archive.copyOfRange(0, header.size).contentEquals(header)) { "Unsupported backup version" }
        val cipher = Cipher.getInstance("AES/GCM/NoPadding")
        cipher.init(Cipher.DECRYPT_MODE, key(code), GCMParameterSpec(128, archive.copyOfRange(header.size, header.size + 12)))
        cipher.updateAAD(header)
        return cipher.doFinal(archive, header.size + 12, archive.size - header.size - 12)
    }
}
