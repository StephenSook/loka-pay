package org.loka.meshlab

import org.bouncycastle.crypto.params.Ed25519PublicKeyParameters
import org.bouncycastle.crypto.signers.Ed25519Signer
import org.loka.core.pay.Ed25519Verifier
import org.loka.core.pay.Pins

/** Pins compiled from config/pins.json (see app/build.gradle.kts), checked by the core parser. */
internal object PayConfig {
    sealed interface Status {
        /** Deployment and server key both pinned: certificates can be verified. */
        class Ready(val pins: Pins, val serverPublicKey: ByteArray) : Status
        /** The deployment is pinned but the server's Ed25519 key is not published yet. */
        class ServerKeyNotPinned(val pins: Pins) : Status
        /** config/pins.json was missing or a field could not be read. */
        class Unavailable(val reason: String) : Status
    }

    fun status(
        cluster: String = BuildConfig.PINS_CLUSTER,
        programId: String = BuildConfig.PINS_PROGRAM_ID,
        mint: String = BuildConfig.PINS_MINT,
        serverKey: String = BuildConfig.PINS_SERVER_ED25519,
    ): Status {
        if (cluster.isEmpty() || programId.isEmpty() || mint.isEmpty()) {
            return Status.Unavailable("config/pins.json has no cluster, program id or mint in this build.")
        }
        val pins = try {
            Pins.parse(cluster, programId, mint, serverKey.ifEmpty { null })
        } catch (e: IllegalArgumentException) {
            return Status.Unavailable(e.message ?: "config/pins.json could not be read.")
        }
        val key = pins.serverPublicKey ?: return Status.ServerKeyNotPinned(pins)
        return Status.Ready(pins, key)
    }
}

/**
 * Ed25519 (RFC 8032) through BouncyCastle's lightweight API. It is called directly, not
 * registered as a java.security provider, so it cannot collide with Android's own "BC" provider.
 */
internal object BouncyCastleEd25519Verifier : Ed25519Verifier {
    override fun verify(publicKey: ByteArray, message: ByteArray, signature: ByteArray): Boolean {
        if (publicKey.size != 32 || signature.size != 64) return false
        return try {
            Ed25519Signer().run {
                init(false, Ed25519PublicKeyParameters(publicKey, 0))
                update(message, 0, message.size)
                verifySignature(signature)
            }
        } catch (e: Exception) {
            false
        }
    }
}
