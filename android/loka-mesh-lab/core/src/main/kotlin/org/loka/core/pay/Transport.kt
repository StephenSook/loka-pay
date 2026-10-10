package org.loka.core.pay

import java.math.BigInteger

/** `L1|P|1|<kind>|<base64url>` inside an encrypted LOKA packet (protocol/PAYMENT-V1.md section 5). */
object PaymentTransport {
    enum class Kind(val letter: Char) {
        NOTE('N'), ACK('Y'), CONFIRMATION('S'), MARKER('M'), RECEIPT('X'), ALLOWANCE('A'), MERCHANT('C');

        companion object {
            fun of(text: String): Kind? = entries.firstOrNull { text.length == 1 && it.letter == text[0] }
        }
    }

    class Decoded(val kind: Kind, payload: ByteArray) {
        private val bytes = payload.copyOf()
        val payload: ByteArray get() = bytes.copyOf()
    }

    fun encode(kind: Kind, payload: ByteArray): String = "L1|P|1|${kind.letter}|${Base64Url.encode(payload)}"

    /** The largest valid payload of each kind, from the layouts in sections 4 and 5. */
    fun maxPayloadBytes(kind: Kind): Int = when (kind) {
        Kind.NOTE -> SignedNote.WIRE_SIZE
        Kind.ACK -> Ack.WIRE_SIZE
        Kind.CONFIRMATION -> Confirmation.WIRE_SIZE
        Kind.MARKER -> SignedNote.WIRE_SIZE + Ack.WIRE_SIZE
        Kind.RECEIPT -> SignedNote.WIRE_SIZE + Ack.WIRE_SIZE + 1 + Confirmation.WIRE_SIZE
        // ALLOW_V1 || signature || earmark list with the maximum 16 entries.
        Kind.ALLOWANCE -> AllowanceCertificate.SIZE + 64 + 2 + 16 * 32
        // MERCH_V1 with a 64-byte name || signature.
        Kind.MERCHANT -> 115 + 64 + 64
    }

    /**
     * The longest valid transport text of [kind]: the 9-character `L1|P|1|<kind>|` header plus
     * the unpadded base64url length of the largest payload. Callers refuse longer input before
     * storing or decoding it.
     */
    fun maxTextLength(kind: Kind): Int = 9 + (maxPayloadBytes(kind) * 4 + 2) / 3

    /**
     * Returns null for anything that is not version-1 payment content (callers ignore it and
     * never relay it as payment content); throws `base64url` when it claims to be and the
     * payload is malformed.
     */
    fun decode(text: String): Decoded? {
        val parts = text.split("|")
        if (parts.size < 3 || parts[0] != "L1" || parts[1] != "P" || parts[2] != "1") return null
        if (parts.size != 5) return null
        val kind = Kind.of(parts[3]) ?: return null
        return Decoded(kind, Base64Url.decode(parts[4]))
    }
}

/** RFC 4648 section 5, no padding, canonical only. */
object Base64Url {
    private const val ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_"

    fun encode(data: ByteArray): String = java.util.Base64.getUrlEncoder().withoutPadding().encodeToString(data)

    /** Rejects padding, characters outside the alphabet and non-canonical encodings (decode, re-encode, compare). */
    fun decode(text: String): ByteArray {
        if (text.any { it !in ALPHABET } || text.length % 4 == 1) fail(PaymentError.BASE64URL)
        val bytes = try {
            java.util.Base64.getUrlDecoder().decode(text)
        } catch (e: IllegalArgumentException) {
            throw PaymentException(PaymentError.BASE64URL, e)
        }
        if (encode(bytes) != text) fail(PaymentError.BASE64URL)
        return bytes
    }
}

/** Base58 (Bitcoin alphabet), as used for Solana addresses in config/pins.json. */
object Base58 {
    private const val ALPHABET = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz"
    private val RADIX = BigInteger.valueOf(58)

    fun encode(data: ByteArray): String {
        val zeros = data.takeWhile { it == 0.toByte() }.size
        var n = BigInteger(1, data)
        val out = StringBuilder()
        while (n.signum() > 0) {
            val (q, r) = n.divideAndRemainder(RADIX)
            out.append(ALPHABET[r.toInt()])
            n = q
        }
        repeat(zeros) { out.append('1') }
        return out.reverse().toString()
    }

    /** Throws `base58` on an empty string or a character outside the alphabet. */
    fun decode(text: String): ByteArray {
        if (text.isEmpty()) fail(PaymentError.BASE58)
        var n = BigInteger.ZERO
        for (c in text) {
            val digit = ALPHABET.indexOf(c)
            if (digit < 0) fail(PaymentError.BASE58)
            n = n.multiply(RADIX).add(BigInteger.valueOf(digit.toLong()))
        }
        val zeros = text.takeWhile { it == '1' }.length
        val body = if (n.signum() == 0) ByteArray(0) else n.toByteArray().let { if (it[0] == 0.toByte()) it.copyOfRange(1, it.size) else it }
        return ByteArray(zeros) + body
    }
}

/** Mint base units and display strings (6 decimals; section 4.1 units). Integer math only. */
object Money {
    const val DECIMALS = 6
    private const val SCALE = 1_000_000UL

    /** "1.00" for 1,000,000 base units: two decimals when exact to the cent, otherwise six. */
    fun display(baseUnits: ULong): String {
        val whole = baseUnits / SCALE
        val frac = baseUnits % SCALE
        return if (frac % 10_000UL == 0UL) "$whole.${(frac / 10_000UL).toString().padStart(2, '0')}"
        else "$whole.${frac.toString().padStart(6, '0')}"
    }

    /** Parses "D" or "D.C" (ASCII digits, up to six decimals) into base units; null when invalid or over u64. */
    fun parse(text: String): ULong? {
        val parts = text.split(".")
        if (parts.size !in 1..2 || parts[0].isEmpty() || !parts[0].all { it in '0'..'9' }) return null
        val whole = parts[0].toULongOrNull() ?: return null
        var frac = 0UL
        if (parts.size == 2) {
            val f = parts[1]
            if (f.length !in 1..6 || !f.all { it in '0'..'9' }) return null
            frac = f.padEnd(6, '0').toULong()
        }
        if (whole > (ULong.MAX_VALUE - frac) / SCALE) return null
        return whole * SCALE + frac
    }
}
