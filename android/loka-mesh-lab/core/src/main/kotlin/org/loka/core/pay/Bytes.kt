package org.loka.core.pay

import java.security.MessageDigest

/**
 * Errors named exactly as in protocol/PAYMENT-V1.md (section 6 and the structure rules), with
 * the same spellings as the Swift (ios/LokaPay) and JavaScript (protocol/lib) ports. The last
 * group is payer-side and storage refusals used by the Android pay screen.
 */
enum class PaymentError(val code: String) {
    LENGTH("length"),
    PREFIX("prefix"),
    CLUSTER("cluster"),
    CURRENCY("currency"),
    AMOUNT_ZERO("amount_zero"),
    WRONG_PROGRAM("wrong_program"),
    WRONG_MINT("wrong_mint"),
    BAD_PUBKEY("bad_pubkey"),
    HIGH_S("high_s"),
    BAD_SIGNATURE("bad_signature"),
    BASE64URL("base64url"),
    BASE58("base58"),
    EARMARK_MISMATCH("earmark_mismatch"),
    EARMARK_LIST("earmark_list"),
    NAME_LENGTH("name_length"),
    RECEIPT_FLAG("receipt_flag"),
    PAYEE_MISMATCH("payee_mismatch"),
    CONFIRMATION_MISMATCH("confirmation_mismatch"),
    PAYER_MISMATCH("payer_mismatch"),
    NOT_EARMARKED("not_earmarked"),
    EXPIRED("expired"),
    OFFLINE_LIMIT("offline_limit"),
    OVER_CAP("over_cap"),
    SERIALS_EXHAUSTED("serials_exhausted"),
    STORAGE("storage"),
}

/** A refusal carrying its spec name in [error] (and as the message). */
class PaymentException(val error: PaymentError, cause: Throwable? = null) : Exception(error.code, cause)

internal fun fail(error: PaymentError): Nothing = throw PaymentException(error)

internal fun sha256(vararg parts: ByteArray): ByteArray =
    MessageDigest.getInstance("SHA-256").run { parts.forEach { update(it) }; digest() }

/** Lowercase hex. */
fun ByteArray.toHex(): String = joinToString("") { "%02x".format(it.toInt() and 0xff) }

/** Parses hex (either case). Throws IllegalArgumentException on odd length or a non-hex character. */
fun hexToBytes(hex: String): ByteArray {
    require(hex.length % 2 == 0) { "hex must have an even length" }
    return ByteArray(hex.length / 2) { i ->
        val hi = Character.digit(hex[2 * i], 16)
        val lo = Character.digit(hex[2 * i + 1], 16)
        require(hi >= 0 && lo >= 0) { "not hex" }
        ((hi shl 4) or lo).toByte()
    }
}

/** Big-endian writer for the fixed binary layouts. Every fixed-size field is length-checked. */
internal class ByteWriter {
    private val out = java.io.ByteArrayOutputStream()

    fun u8(v: Int) = apply { require(v in 0..0xff) { "u8 out of range" }; out.write(v) }
    fun u16(v: Int) = apply { require(v in 0..0xffff) { "u16 out of range" }; out.write(v ushr 8); out.write(v and 0xff) }
    fun u64(v: ULong) = apply { for (shift in 56 downTo 0 step 8) out.write(((v shr shift) and 0xffUL).toInt()) }
    fun i64(v: Long) = u64(v.toULong())
    fun bytes(b: ByteArray, size: Int) = apply { require(b.size == size) { "field must be $size bytes, got ${b.size}" }; out.write(b) }
    fun ascii(s: String, size: Int) = bytes(s.toByteArray(Charsets.US_ASCII), size)
    fun done(): ByteArray = out.toByteArray()
}

/** Big-endian reader that copies every field out. A short read is `length`. */
internal class ByteReader(private val data: ByteArray) {
    private var offset = 0
    val remaining: Int get() = data.size - offset

    fun read(n: Int): ByteArray {
        if (n < 0 || remaining < n) fail(PaymentError.LENGTH)
        return data.copyOfRange(offset, offset + n).also { offset += n }
    }

    fun u8(): Int = read(1)[0].toInt() and 0xff
    fun u16(): Int = read(2).let { ((it[0].toInt() and 0xff) shl 8) or (it[1].toInt() and 0xff) }
    fun u64(): ULong = read(8).fold(0UL) { acc, b -> (acc shl 8) or (b.toULong() and 0xffUL) }
    fun i64(): Long = u64().toLong()
}

/** Unsigned big-endian comparison of equal-length byte strings. */
internal fun compareUnsigned(a: ByteArray, b: ByteArray): Int {
    require(a.size == b.size)
    for (i in a.indices) {
        val x = a[i].toInt() and 0xff
        val y = b[i].toInt() and 0xff
        if (x != y) return if (x < y) -1 else 1
    }
    return 0
}
