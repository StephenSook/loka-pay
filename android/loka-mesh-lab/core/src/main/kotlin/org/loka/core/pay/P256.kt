package org.loka.core.pay

import java.math.BigInteger
import java.security.KeyFactory
import java.security.Signature
import java.security.interfaces.ECPublicKey
import java.security.spec.ECFieldFp
import java.security.spec.ECParameterSpec
import java.security.spec.ECPoint
import java.security.spec.ECPublicKeySpec
import java.security.spec.EllipticCurve

/**
 * P-256 helpers shared by every structure (protocol/PAYMENT-V1.md section 3): key hashes,
 * compressed SEC1 keys, the low-S rule, DER and 64-byte r || s conversion, and verification
 * with java.security over the raw message (SHA256withECDSA hashes inside, as the precompile does).
 */
object P256Rules {
    private val P = BigInteger("ffffffff00000001000000000000000000000000ffffffffffffffffffffffff", 16)
    private val A = BigInteger("ffffffff00000001000000000000000000000000fffffffffffffffffffffffc", 16)
    private val B = BigInteger("5ac635d8aa3a93e7b3ebbd55769886bc651d06b0cc53b0f63bce3c3e27d2604b", 16)
    private val GX = BigInteger("6b17d1f2e12c4247f8bce6e563a440f277037d812deb33a0f4a13945d898c296", 16)
    private val GY = BigInteger("4fe342e2fe1a7f9b8ee7eb4a7c0f9e162bce33576b315ececbb6406837bf51f5", 16)

    /** Curve order n. */
    val ORDER = BigInteger("ffffffff00000000ffffffffffffffffbce6faada7179e84f3b9cac2fc632551", 16)

    /** floor(n / 2): a signature is valid only if s <= this (the Solana precompile rule). */
    val HALF_ORDER: BigInteger = ORDER.shiftRight(1)

    /** Explicit secp256r1 parameters, so no platform curve-name lookup is needed. */
    val PARAMS = ECParameterSpec(EllipticCurve(ECFieldFp(P), A, B), ECPoint(GX, GY), ORDER, 1)

    /** sha256 of a 33-byte compressed public key. */
    fun keyHash(compressedPublicKey: ByteArray): ByteArray = sha256(compressedPublicKey)

    /** True when the 64-byte r || s signature has s <= n / 2. */
    fun isLowS(signature: ByteArray): Boolean =
        signature.size == 64 && BigInteger(1, signature.copyOfRange(32, 64)) <= HALF_ORDER

    /**
     * The low-S form of a 64-byte r || s signature: if s > n / 2, s becomes n - s, written as
     * exactly 32 big-endian bytes. The Android Keystore does not promise low-S.
     */
    fun normalizeLowS(signature: ByteArray): ByteArray {
        require(signature.size == 64) { "raw P-256 signature must be 64 bytes" }
        val s = BigInteger(1, signature.copyOfRange(32, 64))
        if (s <= HALF_ORDER) return signature.copyOf()
        return signature.copyOfRange(0, 32) + fixed32(ORDER - s)
    }

    /** 33-byte compressed SEC1 form of a public key on P-256. */
    fun compress(key: ECPublicKey): ByteArray {
        val w = key.w
        val prefix: Byte = if (w.affineY.testBit(0)) 0x03 else 0x02
        return byteArrayOf(prefix) + fixed32(w.affineX)
    }

    /** Decodes a 33-byte compressed key into a point on P-256, or throws `bad_pubkey`. */
    fun decompress(compressed: ByteArray): ECPublicKey {
        if (compressed.size != 33 || (compressed[0] != 0x02.toByte() && compressed[0] != 0x03.toByte())) fail(PaymentError.BAD_PUBKEY)
        val x = BigInteger(1, compressed.copyOfRange(1, 33))
        if (x >= P) fail(PaymentError.BAD_PUBKEY)
        val rhs = (x.pow(3) + A * x + B).mod(P)
        // p = 3 mod 4, so a square root (when one exists) is rhs^((p + 1) / 4).
        var y = rhs.modPow(P.add(BigInteger.ONE).shiftRight(2), P)
        if (y.multiply(y).mod(P) != rhs) fail(PaymentError.BAD_PUBKEY)
        if (y.testBit(0) != (compressed[0] == 0x03.toByte())) y = P - y
        return try {
            KeyFactory.getInstance("EC").generatePublic(ECPublicKeySpec(ECPoint(x, y), PARAMS)) as ECPublicKey
        } catch (e: Exception) {
            throw PaymentException(PaymentError.BAD_PUBKEY, e)
        }
    }

    /**
     * Strict DER `SEQUENCE { INTEGER r, INTEGER s }` to 64-byte r || s (no low-S change).
     * Rejects non-minimal or negative integers, long-form lengths, trailing bytes and values
     * outside [1, n - 1]. Malformed input is `bad_signature`.
     */
    fun derToRaw(der: ByteArray): ByteArray {
        val r = ByteReader(der)
        try {
            if (r.u8() != 0x30) fail(PaymentError.BAD_SIGNATURE)
            val total = r.u8()
            if (total > 0x7f || total != r.remaining) fail(PaymentError.BAD_SIGNATURE)
            val rInt = derInteger(r)
            val sInt = derInteger(r)
            if (r.remaining != 0) fail(PaymentError.BAD_SIGNATURE)
            return fixed32(rInt) + fixed32(sInt)
        } catch (e: PaymentException) {
            throw PaymentException(PaymentError.BAD_SIGNATURE, e)
        }
    }

    /** 64-byte r || s to canonical DER (what java.security and the Keystore use). */
    fun rawToDer(raw: ByteArray): ByteArray {
        require(raw.size == 64) { "raw P-256 signature must be 64 bytes" }
        val r = derIntegerBytes(raw.copyOfRange(0, 32))
        val s = derIntegerBytes(raw.copyOfRange(32, 64))
        val body = byteArrayOf(0x02, r.size.toByte()) + r + byteArrayOf(0x02, s.size.toByte()) + s
        return byteArrayOf(0x30, body.size.toByte()) + body
    }

    /**
     * Verifies a 64-byte signature over the raw message. Order, as in section 6 steps 8 to 10:
     * `bad_pubkey`, then `high_s` (the platform verifier alone accepts high-S), then
     * `bad_signature` (wrong length, r or s out of range, or ECDSA failure).
     */
    fun verify(signature: ByteArray, message: ByteArray, compressedPublicKey: ByteArray) {
        val key = decompress(compressedPublicKey)
        if (signature.size != 64) fail(PaymentError.BAD_SIGNATURE)
        if (!isLowS(signature)) fail(PaymentError.HIGH_S)
        val r = BigInteger(1, signature.copyOfRange(0, 32))
        val s = BigInteger(1, signature.copyOfRange(32, 64))
        if (r.signum() == 0 || r >= ORDER || s.signum() == 0 || s >= ORDER) fail(PaymentError.BAD_SIGNATURE)
        val ok = try {
            Signature.getInstance("SHA256withECDSA").run {
                initVerify(key)
                update(message)
                verify(rawToDer(signature))
            }
        } catch (e: Exception) {
            false
        }
        if (!ok) fail(PaymentError.BAD_SIGNATURE)
    }

    /** Big-endian, exactly 32 bytes, leading zeros kept. */
    internal fun fixed32(v: BigInteger): ByteArray {
        require(v.signum() >= 0 && v.bitLength() <= 256) { "value does not fit 32 bytes" }
        val b = v.toByteArray()
        return when {
            b.size == 32 -> b
            b.size > 32 -> b.copyOfRange(b.size - 32, b.size)
            else -> ByteArray(32 - b.size) + b
        }
    }

    private fun derInteger(r: ByteReader): BigInteger {
        if (r.u8() != 0x02) fail(PaymentError.BAD_SIGNATURE)
        val len = r.u8()
        if (len < 1 || len > 33) fail(PaymentError.BAD_SIGNATURE)
        val v = r.read(len)
        if (v[0].toInt() and 0x80 != 0) fail(PaymentError.BAD_SIGNATURE) // negative
        if (len > 1 && v[0] == 0.toByte() && v[1].toInt() and 0x80 == 0) fail(PaymentError.BAD_SIGNATURE) // not minimal
        val n = BigInteger(1, v)
        if (n.signum() == 0 || n >= ORDER) fail(PaymentError.BAD_SIGNATURE)
        return n
    }

    private fun derIntegerBytes(fixed: ByteArray): ByteArray {
        var i = 0
        while (i < fixed.size - 1 && fixed[i] == 0.toByte()) i++
        val trimmed = fixed.copyOfRange(i, fixed.size)
        return if (trimmed[0].toInt() and 0x80 != 0) byteArrayOf(0) + trimmed else trimmed
    }
}
