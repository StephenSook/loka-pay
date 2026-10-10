package org.loka.core

import java.security.KeyFactory
import java.security.KeyPair
import java.security.SecureRandom
import java.security.Signature
import java.security.interfaces.RSAPublicKey
import java.security.spec.MGF1ParameterSpec
import java.security.spec.X509EncodedKeySpec
import java.util.UUID
import javax.crypto.Cipher
import javax.crypto.spec.GCMParameterSpec
import javax.crypto.spec.OAEPParameterSpec
import javax.crypto.spec.PSource
import javax.crypto.spec.SecretKeySpec

/** Experimental envelope using standard JCA primitives. Not a production messaging protocol. */
class LabCrypto(private val identity: KeyPair) {
    val publicKey: ByteArray get() = identity.public.encoded
    val deviceId: String get() = fingerprint(publicKey)

    @JvmOverloads fun encrypt(recipientKey: ByteArray, text: String, now: Long, carrier: String = "", automatic: Boolean = false, multiCarry: Boolean = false, returnVia: List<String> = emptyList(), lifetimeMs: Long? = null): Packet {
        val maximum = if (carrier.isEmpty() && !automatic) MAX_LIFETIME_MS else CARRY_LIFETIME_MS
        val lifetime = lifetimeMs ?: maximum; require(lifetime in 1..maximum)
        val plaintext = text.toByteArray(Charsets.UTF_8)
        require(plaintext.size in 1..MAX_TEXT_BYTES) { "Message must be 1–2048 UTF-8 bytes" }
        val recipient = parsePublicKey(recipientKey)
        val random = SecureRandom()
        val aes = ByteArray(32).also(random::nextBytes)
        val nonce = ByteArray(12).also(random::nextBytes)
        val wrapper = Cipher.getInstance("RSA/ECB/OAEPPadding")
        wrapper.init(Cipher.ENCRYPT_MODE, recipient, oaep)
        val unsigned = Packet(UUID.randomUUID().toString(), deviceId, fingerprint(recipientKey), now,
            now + lifetime, MAX_HOPS, publicKey, wrapper.doFinal(aes), nonce, byteArrayOf(), byteArrayOf(), if (automatic && multiCarry) 3 else if (automatic) 2 else if (carrier.isEmpty()) 0 else 1, if (automatic && multiCarry) "" else carrier, returnVia = if (automatic && multiCarry) returnVia else emptyList())
        val cipher = Cipher.getInstance("AES/GCM/NoPadding")
        cipher.init(Cipher.ENCRYPT_MODE, SecretKeySpec(aes, "AES"), GCMParameterSpec(128, nonce))
        cipher.updateAAD(unsigned.associatedData())
        val encrypted = unsigned.copy(ciphertext = cipher.doFinal(plaintext))
        val signer = Signature.getInstance("SHA256withRSA")
        signer.initSign(identity.private); signer.update(encrypted.signedData())
        return encrypted.copy(signature = signer.sign()).also { it.validate(now) }
    }

    /** One durable source-only authorization; ciphertext and message identity stay unchanged. */
    fun authorizeCarrier(packet: Packet, carrier: String): Packet {
        require(packet.version == 2 && packet.source == deviceId && packet.carrier.isEmpty())
        require(carrier.matches(Regex("[0-9a-f]{64}")) && carrier != deviceId && carrier != packet.destination)
        val updated = packet.copy(carrier = carrier)
        val signer = Signature.getInstance("SHA256withRSA")
        signer.initSign(identity.private); signer.update(updated.signedData())
        return updated.copy(signature = signer.sign())
    }

    fun delegate(packet: Packet, target: String): Packet {
        require(packet.version == 3 && packet.grants.size < 3 && packet.holders().last() == deviceId)
        require(target !in packet.holders() && target != packet.destination)
        require(verify(packet))
        val signer = Signature.getInstance("SHA256withRSA")
        signer.initSign(identity.private); signer.update(packet.grantData(target))
        return packet.copy(grants = packet.grants + CarryGrant(target, publicKey, signer.sign()))
    }

    fun decrypt(packet: Packet): String {
        require(packet.destination == deviceId) { "Packet belongs to another device" }
        require(verify(packet)) { "Invalid sender signature" }
        val wrapper = Cipher.getInstance("RSA/ECB/OAEPPadding")
        wrapper.init(Cipher.DECRYPT_MODE, identity.private, oaep)
        val aes = wrapper.doFinal(packet.wrappedKey)
        val cipher = Cipher.getInstance("AES/GCM/NoPadding")
        cipher.init(Cipher.DECRYPT_MODE, SecretKeySpec(aes, "AES"), GCMParameterSpec(128, packet.nonce))
        cipher.updateAAD(packet.associatedData())
        return cipher.doFinal(packet.ciphertext).toString(Charsets.UTF_8)
    }

    companion object {
        // Explicit MGF1 digest matches Android Keystore's default; main OAEP digest is SHA-256.
        private val oaep = OAEPParameterSpec("SHA-256", "MGF1", MGF1ParameterSpec.SHA1, PSource.PSpecified.DEFAULT)
        fun parsePublicKey(encoded: ByteArray): RSAPublicKey {
            require(encoded.size in 256..1024)
            return (KeyFactory.getInstance("RSA").generatePublic(X509EncodedKeySpec(encoded)) as RSAPublicKey)
                .also { require(it.modulus.bitLength() == 3072 && it.publicExponent == java.math.BigInteger.valueOf(65537)) }
        }
        fun verify(packet: Packet): Boolean = runCatching {
            val verifier = Signature.getInstance("SHA256withRSA")
            verifier.initVerify(parsePublicKey(packet.senderPublicKey))
            verifier.update(packet.signedData()); require(verifier.verify(packet.signature))
            if (packet.version == 3) {
                require(packet.grants.size <= 3)
                packet.grants.forEachIndexed { i, grant ->
                    val prefix = packet.copy(grants = packet.grants.take(i))
                    require(fingerprint(grant.key) == prefix.holders().last())
                    require(grant.target !in prefix.holders() && grant.target != packet.destination)
                    verifier.initVerify(parsePublicKey(grant.key)); verifier.update(prefix.grantData(grant.target))
                    require(verifier.verify(grant.signature))
                }
            } else require(packet.grants.isEmpty())
            true
        }.getOrDefault(false)
    }
}
