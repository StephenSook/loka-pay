package org.loka.core.pay

import org.junit.Assert.assertArrayEquals
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertThrows
import org.junit.Assert.assertTrue
import org.junit.Test
import java.math.BigInteger
import java.security.KeyFactory
import java.security.KeyPairGenerator
import java.security.PrivateKey
import java.security.Signature
import java.security.interfaces.ECPublicKey
import java.security.spec.ECGenParameterSpec
import java.security.spec.ECPrivateKeySpec

/** Low-S, DER and r || s, compressed keys, and a DER-returning signer (the shape of the Android Keystore). */
class P256Test {
    private fun expect(code: String, block: () -> Unit) {
        val e = assertThrows(code, PaymentException::class.java) { block() }
        assertEquals(code, e.error.code)
    }

    /** Every 64-byte P-256 signature in the vectors, with the high-S twins. */
    private fun vectorSignatures(): List<ByteArray> {
        val out = mutableListOf<ByteArray>()
        for (n in Vectors.list("notes")) {
            out += n.bytes("signatureHex")
            out += n.bytes("highSTwinSignatureHex")
        }
        out += Vectors.list("acks").map { it.bytes("signatureHex") }
        out += Vectors.list("withdraws").map { it.bytes("signatureHex") }
        out += Vectors.list("refunds").map { it.bytes("signatureHex") }
        return out
    }

    /** The vectors' test key: secret = (sha256(label) mod (n - 1)) + 1 (keys.derivation). */
    private fun vectorPrivateKey(name: String): PrivateKey {
        val label = Vectors.keys.getJSONObject(name).getString("label")
        val digest = BigInteger(1, sha256(label.toByteArray(Charsets.UTF_8)))
        val secret = digest.mod(P256Rules.ORDER - BigInteger.ONE) + BigInteger.ONE
        return KeyFactory.getInstance("EC").generatePrivate(ECPrivateKeySpec(secret, P256Rules.PARAMS))
    }

    private fun derSign(key: PrivateKey, message: ByteArray): ByteArray =
        Signature.getInstance("SHA256withECDSA").run { initSign(key); update(message); sign() }

    @Test fun `the high-S twins normalize to the vector's low-S signatures`() {
        val notes = Vectors.list("notes")
        assertTrue(notes.size >= 4)
        for (n in notes) {
            val low = n.bytes("signatureHex")
            val high = n.bytes("highSTwinSignatureHex")
            assertTrue(P256Rules.isLowS(low))
            assertFalse(P256Rules.isLowS(high))
            assertArrayEquals(low, P256Rules.normalizeLowS(high))
            assertArrayEquals(low, P256Rules.normalizeLowS(low))
            assertTrue(n.getBoolean("highSTwinIsValidWithoutLowSRule"))
            // The twin really is a valid ECDSA signature: plain java.security accepts it, the rule refuses it.
            val key = P256Rules.decompress(n.bytes("payerPublicKeyHex"))
            val plain = Signature.getInstance("SHA256withECDSA").run {
                initVerify(key); update(n.bytes("noteHex")); verify(P256Rules.rawToDer(high))
            }
            assertTrue(plain)
            expect("high_s") { P256Rules.verify(high, n.bytes("noteHex"), n.bytes("payerPublicKeyHex")) }
        }
    }

    @Test fun `DER and r-s round trip for every vector signature`() {
        val sigs = vectorSignatures()
        assertTrue(sigs.size >= 11)
        for (raw in sigs) {
            val der = P256Rules.rawToDer(raw)
            assertEquals(0x30, der[0].toInt())
            assertEquals(der.size - 2, der[1].toInt())
            assertArrayEquals(raw, P256Rules.derToRaw(der))
        }
        // A leading-zero r (max_u64_fields: r starts with 0x00) encodes minimally and comes back padded.
        val padded = Vectors.list("notes")[3].bytes("signatureHex")
        assertEquals(0, padded[0].toInt())
        assertArrayEquals(padded, P256Rules.derToRaw(P256Rules.rawToDer(padded)))
    }

    @Test fun `DER decoding is strict`() {
        val raw = Vectors.list("notes")[0].bytes("signatureHex")
        val der = P256Rules.rawToDer(raw)
        expect("bad_signature") { P256Rules.derToRaw(der + byteArrayOf(0)) } // trailing byte
        expect("bad_signature") { P256Rules.derToRaw(der.copyOf(der.size - 1)) } // truncated
        expect("bad_signature") { P256Rules.derToRaw(byteArrayOf(0x31) + der.copyOfRange(1, der.size)) } // not a SEQUENCE
        expect("bad_signature") { P256Rules.derToRaw(byteArrayOf(0x30, 0x81.toByte(), der[1]) + der.copyOfRange(2, der.size)) } // long form
        val r = BigInteger(1, raw.copyOfRange(0, 32)).toByteArray()
        val s = BigInteger(1, raw.copyOfRange(32, 64)).toByteArray()
        fun seq(vararg ints: ByteArray): ByteArray {
            val body = ints.fold(ByteArray(0)) { acc, v -> acc + byteArrayOf(0x02, v.size.toByte()) + v }
            return byteArrayOf(0x30, body.size.toByte()) + body
        }
        P256Rules.derToRaw(seq(r, s)) // the canonical form is accepted
        expect("bad_signature") { P256Rules.derToRaw(seq(byteArrayOf(0) + r, s)) } // non-minimal (extra zero)
        expect("bad_signature") { P256Rules.derToRaw(seq(byteArrayOf(0x80.toByte()) + r.copyOfRange(1, r.size), s)) } // negative
        expect("bad_signature") { P256Rules.derToRaw(seq(byteArrayOf(0), s)) } // r = 0
        expect("bad_signature") { P256Rules.derToRaw(seq(P256Rules.ORDER.toByteArray(), s)) } // r = n
        expect("bad_signature") { P256Rules.derToRaw(seq(r)) } // s missing
        expect("bad_signature") { P256Rules.derToRaw(ByteArray(0)) }
    }

    @Test fun `vector keys hash, decompress and compress`() {
        for (name in listOf("payer", "merchantA", "merchantB")) {
            val pub = Vectors.publicKey(name)
            assertArrayEquals(name, Vectors.keyHash(name), P256Rules.keyHash(pub))
            assertArrayEquals(name, pub, P256Rules.compress(P256Rules.decompress(pub)))
        }
        val pub = Vectors.publicKey("payer")
        expect("bad_pubkey") { P256Rules.decompress(byteArrayOf(4) + pub.copyOfRange(1, 33)) }
        expect("bad_pubkey") { P256Rules.decompress(pub.copyOf(32)) }
        expect("bad_pubkey") { P256Rules.decompress(byteArrayOf(2) + ByteArray(32) { 0xff.toByte() }) } // x >= p
        // x = 1 is not on P-256 (1 - 3 + b is not a square mod p; checked with Euler's criterion).
        expect("bad_pubkey") { P256Rules.decompress(byteArrayOf(2) + P256Rules.fixed32(BigInteger.ONE)) }
        // x = 5 is on the curve, so both parities decode.
        P256Rules.decompress(byteArrayOf(2) + P256Rules.fixed32(BigInteger.valueOf(5)))
        P256Rules.decompress(byteArrayOf(3) + P256Rules.fixed32(BigInteger.valueOf(5)))
    }

    @Test fun `a DER signer is converted to low-S r-s and always verifies, including flipped signatures`() {
        val generator = KeyPairGenerator.getInstance("EC").apply { initialize(ECGenParameterSpec("secp256r1")) }
        var flipped = 0
        repeat(200) { i ->
            val pair = generator.generateKeyPair()
            val pub = P256Rules.compress(pair.public as ECPublicKey)
            val message = "message $i".toByteArray()
            val raw = P256Rules.derToRaw(derSign(pair.private, message))
            if (!P256Rules.isLowS(raw)) flipped++
            val low = P256Rules.normalizeLowS(raw)
            assertTrue(P256Rules.isLowS(low))
            P256Rules.verify(low, message, pub)
        }
        // About half of raw platform signatures are high-S; prove the flip path ran.
        assertTrue("only $flipped of 200 raw signatures were high-S", flipped > 20)
    }

    @Test fun `a note signed with the vector payer key through DER validates under section 6`() {
        val key = vectorPrivateKey("payer")
        val deployment = Vectors.deployment
        val payerPub = Vectors.publicKey("payer")
        val n0 = Vectors.list("notes")[0]
        val noteBytes = n0.bytes("noteHex")
        repeat(20) {
            val signed = SignedNote.fromDerSignature(noteBytes, derSign(key, noteBytes), payerPub, deployment)
            assertArrayEquals(n0.bytes("noteIdHex"), signed.noteId)
            assertTrue(P256Rules.isLowS(signed.signature))
            assertArrayEquals(signed.wire, SignedNote.validate(signed.wire, deployment).wire)
        }
        // The same DER under another key is refused, and a malformed DER is refused.
        val der = derSign(key, noteBytes)
        expect("bad_signature") { SignedNote.fromDerSignature(noteBytes, der, Vectors.publicKey("merchantA"), deployment) }
        expect("bad_signature") { SignedNote.fromDerSignature(noteBytes, der + byteArrayOf(0), payerPub, deployment) }
    }
}
