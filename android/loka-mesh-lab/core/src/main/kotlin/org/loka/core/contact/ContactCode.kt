package org.loka.core.contact

import java.util.Base64
import org.loka.core.LabCrypto
import org.loka.core.fingerprint

/** Public contact data only. Decoding does not grant trust or establish a route. */
object ContactCode {
    private const val PREFIX = "loka://contact/v1#"
    private const val MAX_LENGTH = 2048
    fun encode(publicKey: ByteArray): String {
        LabCrypto.parsePublicKey(publicKey)
        return PREFIX + Base64.getUrlEncoder().withoutPadding().encodeToString(publicKey)
    }
    fun decode(text: String): ByteArray {
        require(text.length <= MAX_LENGTH) { "Contact link is too long" }
        val link = text.trim()
        require(link.startsWith(PREFIX)) { "Choose a LOKA contact code or link" }
        val payload = link.removePrefix(PREFIX)
        require(payload.isNotEmpty() && payload.all { it.isLetterOrDigit() && it.code < 128 || it == '-' || it == '_' }) { "Invalid contact code" }
        val key = Base64.getUrlDecoder().decode(payload)
        LabCrypto.parsePublicKey(key)
        return key
    }
    fun fingerprint(text: String) = fingerprint(decode(text))
}
