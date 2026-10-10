package org.loka.core.pay

import java.security.KeyFactory
import java.security.Signature
import java.security.spec.X509EncodedKeySpec

/**
 * Ed25519 verification (RFC 8032, no prehash) for server-signed structures (CONF, ALLOW, MERCH).
 * The core stays free of Android code, so the platform supplies the implementation: the JVM has
 * one built in ([JcaEd25519Verifier]); the Android app supplies its own because older Android
 * versions do not ship Ed25519 in java.security.
 */
fun interface Ed25519Verifier {
    /** True only for a valid signature. Must return false, never throw, on malformed input. */
    fun verify(publicKey: ByteArray, message: ByteArray, signature: ByteArray): Boolean
}

/** java.security "Ed25519" (JDK 15 and newer). */
object JcaEd25519Verifier : Ed25519Verifier {
    // DER SubjectPublicKeyInfo header for an Ed25519 key (OID 1.3.101.112), followed by the 32 raw bytes.
    private val SPKI_PREFIX = hexToBytes("302a300506032b6570032100")

    override fun verify(publicKey: ByteArray, message: ByteArray, signature: ByteArray): Boolean {
        if (publicKey.size != 32 || signature.size != 64) return false
        return try {
            val key = KeyFactory.getInstance("Ed25519").generatePublic(X509EncodedKeySpec(SPKI_PREFIX + publicKey))
            Signature.getInstance("Ed25519").run {
                initVerify(key)
                update(message)
                verify(signature)
            }
        } catch (e: Exception) {
            false
        }
    }
}

/** Throws `bad_signature` unless [signature] is a valid Ed25519 signature by [publicKey] over [message]. */
internal fun Ed25519Verifier.requireValid(signature: ByteArray, message: ByteArray, publicKey: ByteArray) {
    if (publicKey.size != 32 || signature.size != 64 || !verify(publicKey, message, signature)) fail(PaymentError.BAD_SIGNATURE)
}
