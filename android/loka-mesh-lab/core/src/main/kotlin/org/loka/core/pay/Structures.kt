package org.loka.core.pay

import java.nio.ByteBuffer
import java.nio.charset.CharacterCodingException
import java.nio.charset.CodingErrorAction
import java.text.Normalizer

/** ACK_V1 (56 bytes), merchant-signed; wire 153 bytes (protocol/PAYMENT-V1.md section 4.2). */
class Ack private constructor(noteId: ByteArray, val receivedAt: Long, signature: ByteArray, merchantPublicKey: ByteArray) {
    private val id = noteId.copyOf()
    private val sig = signature.copyOf()
    private val key = merchantPublicKey.copyOf()

    val noteId: ByteArray get() = id.copyOf()
    val signature: ByteArray get() = sig.copyOf()
    val merchantPublicKey: ByteArray get() = key.copyOf()
    val wire: ByteArray get() = body(id, receivedAt) + sig + key

    companion object {
        const val PREFIX = "LOKA-PAY-ACKN-V1"
        const val SIZE = 56
        const val WIRE_SIZE = 153

        /** The 56 bytes the merchant signs. */
        fun body(noteId: ByteArray, receivedAt: Long): ByteArray =
            ByteWriter().ascii(PREFIX, 16).bytes(noteId, 32).i64(receivedAt).done()

        /**
         * Builds an ack from a merchant signature over [body] (64-byte low-S r || s). Refuses
         * (`payee_mismatch`) when the merchant key is not the note's payee, then verifies.
         */
        fun build(note: SignedNote, receivedAt: Long, signature: ByteArray, merchantPublicKey: ByteArray): Ack =
            verify(body(note.noteId, receivedAt) + signature + merchantPublicKey, note)

        /** Verifies an ack wire against the note it acknowledges (note id and payee key hash must match). */
        fun verify(wire: ByteArray, note: SignedNote): Ack {
            if (wire.size != WIRE_SIZE) fail(PaymentError.LENGTH)
            val r = ByteReader(wire)
            val body = r.read(SIZE)
            val sig = r.read(64)
            val key = r.read(33)
            val b = ByteReader(body)
            if (!b.read(16).contentEquals(PREFIX.toByteArray(Charsets.US_ASCII))) fail(PaymentError.PREFIX)
            val noteId = b.read(32)
            val receivedAt = b.i64()
            if (!noteId.contentEquals(note.noteId) || !P256Rules.keyHash(key).contentEquals(note.note.payeeKeyHash)) {
                fail(PaymentError.PAYEE_MISMATCH)
            }
            P256Rules.verify(sig, body, key)
            return Ack(noteId, receivedAt, sig, key)
        }
    }
}

/** CONF_V1 (139 bytes), server-signed with Ed25519; wire 203 bytes (section 4.3). */
class Confirmation private constructor(
    noteId: ByteArray,
    txSignature: ByteArray,
    val slot: ULong,
    val blockTime: Long,
    /** Server clock when the upload arrived. Copy says "after upload", never "after signal". */
    val uploadedAt: Long,
    val status: Status,
    val errorCode: Int,
) {
    private val id = noteId.copyOf()
    private val tx = txSignature.copyOf()
    val noteId: ByteArray get() = id.copyOf()
    val txSignature: ByteArray get() = tx.copyOf()

    enum class Status(val code: Int) { SETTLED(1), FAILED_ON_CHAIN(2), REFUSED_OFF_CHAIN(3) }

    companion object {
        const val PREFIX = "LOKA-PAY-CONF-V1"
        const val SIZE = 139
        const val WIRE_SIZE = 203

        fun verify(wire: ByteArray, serverPublicKey: ByteArray, verifier: Ed25519Verifier): Confirmation {
            if (wire.size != WIRE_SIZE) fail(PaymentError.LENGTH)
            val body = wire.copyOfRange(0, SIZE)
            verifier.requireValid(wire.copyOfRange(SIZE, WIRE_SIZE), body, serverPublicKey)
            val r = ByteReader(body)
            if (!r.read(16).contentEquals(PREFIX.toByteArray(Charsets.US_ASCII))) fail(PaymentError.PREFIX)
            val noteId = r.read(32)
            val tx = r.read(64)
            val slot = r.u64()
            val blockTime = r.i64()
            val uploadedAt = r.i64()
            // An unknown status is `length`, as in the Swift and JavaScript ports.
            val statusCode = r.u8()
            val status = Status.entries.firstOrNull { it.code == statusCode } ?: fail(PaymentError.LENGTH)
            val errorCode = r.u16()
            return Confirmation(noteId, tx, slot, blockTime, uploadedAt, status, errorCode)
        }
    }
}

/** Earmark list: u16 count || sorted unique 32-byte merchant key hashes, at most 16 (section 4.4). */
object Earmarks {
    fun encode(keyHashes: List<ByteArray>): ByteArray {
        if (keyHashes.size > 16 || keyHashes.any { it.size != 32 }) fail(PaymentError.EARMARK_LIST)
        val sorted = keyHashes.sortedWith { a, b -> compareUnsigned(a, b) }
        for (i in 1 until sorted.size) if (sorted[i].contentEquals(sorted[i - 1])) fail(PaymentError.EARMARK_LIST)
        val w = ByteWriter().u16(sorted.size)
        sorted.forEach { w.bytes(it, 32) }
        return w.done()
    }

    fun hash(list: ByteArray): ByteArray = sha256(list)

    /** Parses and checks canonical form (sorted, unique, at most 16, exact length). */
    fun decode(list: ByteArray): List<ByteArray> {
        val r = ByteReader(list)
        val n = r.u16()
        if (n > 16 || r.remaining != n * 32) fail(PaymentError.EARMARK_LIST)
        val hashes = List(n) { r.read(32) }
        if (!encode(hashes).contentEquals(list)) fail(PaymentError.EARMARK_LIST)
        return hashes
    }
}

/** ALLOW_V1 (185 bytes), the allowance certificate, server-signed (section 4.5). */
class AllowanceCertificate private constructor(
    val allowanceId: ULong,
    payerKeyHash: ByteArray,
    /** Base units: the most this allowance can ever settle. */
    val cap: ULong,
    /** Base units: the most unsettled value one merchant should accept from this allowance. */
    val offlineLimit: ULong,
    val expiry: Long,
    earmarks: List<ByteArray>,
    val bond: ULong,
) {
    private val payer = payerKeyHash.copyOf()
    private val marks = earmarks.map { it.copyOf() }
    val payerKeyHash: ByteArray get() = payer.copyOf()
    val earmarks: List<ByteArray> get() = marks.map { it.copyOf() }

    /** True when the allowance can pay [merchantKeyHash] (an empty list means any merchant). */
    fun allows(merchantKeyHash: ByteArray): Boolean = marks.isEmpty() || marks.any { it.contentEquals(merchantKeyHash) }

    companion object {
        const val PREFIX = "LOKA-PAY-ALLW-V1"
        const val SIZE = 185

        /** Verifies `ALLOW_V1 || signature || earmark list` against the deployment and the pinned server key. */
        fun verify(wire: ByteArray, deployment: Deployment, serverPublicKey: ByteArray, verifier: Ed25519Verifier): AllowanceCertificate {
            if (wire.size < SIZE + 64 + 2) fail(PaymentError.LENGTH)
            val body = wire.copyOfRange(0, SIZE)
            verifier.requireValid(wire.copyOfRange(SIZE, SIZE + 64), body, serverPublicKey)
            val list = wire.copyOfRange(SIZE + 64, wire.size)
            val r = ByteReader(body)
            if (!r.read(16).contentEquals(PREFIX.toByteArray(Charsets.US_ASCII))) fail(PaymentError.PREFIX)
            if (!deployment.sameProgram(r.read(32))) fail(PaymentError.WRONG_PROGRAM)
            if (r.u8() != deployment.clusterId) fail(PaymentError.CLUSTER)
            if (!deployment.sameMint(r.read(32))) fail(PaymentError.WRONG_MINT)
            val allowanceId = r.u64()
            val payer = r.read(32)
            val cap = r.u64()
            val offline = r.u64()
            val expiry = r.i64()
            val earmarkHash = r.read(32)
            val bond = r.u64()
            if (!Earmarks.hash(list).contentEquals(earmarkHash)) fail(PaymentError.EARMARK_MISMATCH)
            return AllowanceCertificate(allowanceId, payer, cap, offline, expiry, Earmarks.decode(list), bond)
        }
    }
}

/** MERCH_V1 (115 + name bytes), the merchant certificate, server-signed (section 4.6). */
class MerchantCertificate private constructor(merchantKeyHash: ByteArray, val displayName: String) {
    private val hash = merchantKeyHash.copyOf()
    val merchantKeyHash: ByteArray get() = hash.copyOf()

    companion object {
        const val PREFIX = "LOKA-PAY-MRCH-V1"

        fun verify(wire: ByteArray, deployment: Deployment, serverPublicKey: ByteArray, verifier: Ed25519Verifier): MerchantCertificate {
            if (wire.size < 115 + 1 + 64) fail(PaymentError.LENGTH)
            val body = wire.copyOfRange(0, wire.size - 64)
            verifier.requireValid(wire.copyOfRange(wire.size - 64, wire.size), body, serverPublicKey)
            val r = ByteReader(body)
            if (!r.read(16).contentEquals(PREFIX.toByteArray(Charsets.US_ASCII))) fail(PaymentError.PREFIX)
            if (!deployment.sameProgram(r.read(32))) fail(PaymentError.WRONG_PROGRAM)
            if (r.u8() != deployment.clusterId) fail(PaymentError.CLUSTER)
            if (!deployment.sameMint(r.read(32))) fail(PaymentError.WRONG_MINT)
            val keyHash = r.read(32)
            val n = r.u16()
            if (n < 1 || n > 64 || r.remaining != n) fail(PaymentError.NAME_LENGTH)
            val nameBytes = r.read(n)
            val name = try {
                Charsets.UTF_8.newDecoder()
                    .onMalformedInput(CodingErrorAction.REPORT)
                    .onUnmappableCharacter(CodingErrorAction.REPORT)
                    .decode(ByteBuffer.wrap(nameBytes)).toString()
            } catch (e: CharacterCodingException) {
                throw PaymentException(PaymentError.NAME_LENGTH, e)
            }
            // Compare bytes, so a decomposed (non-NFC) spelling is refused.
            if (!Normalizer.normalize(name, Normalizer.Form.NFC).toByteArray(Charsets.UTF_8).contentEquals(nameBytes)) {
                fail(PaymentError.NAME_LENGTH)
            }
            return MerchantCertificate(keyHash, name)
        }
    }
}

/** Spend marker and receipt bundles (section 4.9): unsigned wrappers around signed parts. */
object Bundles {
    /** Marker: note wire (238) || ack wire (153). */
    fun marker(note: SignedNote, ack: Ack): ByteArray = note.wire + ack.wire

    /** Receipt: note wire || ack wire || flag || conf wire when one is attached. */
    fun receipt(note: SignedNote, ack: Ack, confirmationWire: ByteArray?): ByteArray =
        if (confirmationWire == null) note.wire + ack.wire + byteArrayOf(0)
        else note.wire + ack.wire + byteArrayOf(1) + confirmationWire
}

/** A receipt whose every part verified and is bound to the same note. Status comes only from the CONF. */
class VerifiedReceipt(val note: SignedNote, val ack: Ack, val confirmation: Confirmation?) {
    enum class Status { PENDING, SETTLED, FAILED_ON_CHAIN, REFUSED_OFF_CHAIN }

    val status: Status
        get() = when (confirmation?.status) {
            null -> Status.PENDING
            Confirmation.Status.SETTLED -> Status.SETTLED
            Confirmation.Status.FAILED_ON_CHAIN -> Status.FAILED_ON_CHAIN
            Confirmation.Status.REFUSED_OFF_CHAIN -> Status.REFUSED_OFF_CHAIN
        }

    companion object {
        /** Verifies the note (section 6), the ack (payee key, note id) and, when attached, the CONF (server key, note id). */
        fun verify(bytes: ByteArray, deployment: Deployment, serverPublicKey: ByteArray, verifier: Ed25519Verifier): VerifiedReceipt {
            val r = ByteReader(bytes)
            val noteWire = r.read(SignedNote.WIRE_SIZE)
            val ackWire = r.read(Ack.WIRE_SIZE)
            val confWire = when (r.u8()) {
                0 -> { if (r.remaining != 0) fail(PaymentError.LENGTH); null }
                1 -> { if (r.remaining != Confirmation.WIRE_SIZE) fail(PaymentError.LENGTH); r.read(Confirmation.WIRE_SIZE) }
                else -> fail(PaymentError.RECEIPT_FLAG)
            }
            val note = SignedNote.validate(noteWire, deployment)
            val ack = Ack.verify(ackWire, note)
            val conf = confWire?.let { Confirmation.verify(it, serverPublicKey, verifier) }
            if (conf != null && !conf.noteId.contentEquals(note.noteId)) fail(PaymentError.CONFIRMATION_MISMATCH)
            return VerifiedReceipt(note, ack, conf)
        }
    }
}
