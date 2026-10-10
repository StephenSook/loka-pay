package org.loka.core.pay

/** The values every signed structure binds (config/pins.json at runtime, `constants` in the vectors). */
class Deployment(programId: ByteArray, val clusterId: Int, mint: ByteArray) {
    init {
        require(programId.size == 32 && mint.size == 32) { "program id and mint are 32 bytes" }
        require(clusterId == 0 || clusterId == 1) { "cluster id is 0 (devnet) or 1 (mainnet)" }
    }

    private val programIdBytes = programId.copyOf()
    private val mintBytes = mint.copyOf()
    val programId: ByteArray get() = programIdBytes.copyOf()
    val mint: ByteArray get() = mintBytes.copyOf()

    internal fun sameProgram(other: ByteArray) = programIdBytes.contentEquals(other)
    internal fun sameMint(other: ByteArray) = mintBytes.contentEquals(other)
}

/** NOTE_V1, 141 bytes (protocol/PAYMENT-V1.md section 4.1). */
data class NoteV1(
    val programId: ByteArray,
    val clusterId: Int,
    val mint: ByteArray,
    val allowanceId: ULong,
    val payeeKeyHash: ByteArray,
    val amount: ULong,
    /** The three raw currency bytes; `USD` for every valid note. */
    val currency: ByteArray,
    val serial: Int,
    val expiry: Long,
) {
    /** The exact 141 bytes the payer signs. */
    fun encode(): ByteArray = ByteWriter()
        .ascii(PREFIX, 16)
        .bytes(programId, 32)
        .u8(clusterId)
        .bytes(mint, 32)
        .u64(allowanceId)
        .bytes(payeeKeyHash, 32)
        .u64(amount)
        .bytes(currency, 3)
        .u8(serial)
        .i64(expiry)
        .done()

    /** sha256 of the 141 note bytes. */
    val noteId: ByteArray get() = sha256(encode())

    override fun equals(other: Any?): Boolean = other is NoteV1 && encode().contentEquals(other.encode())
    override fun hashCode(): Int = encode().contentHashCode()

    companion object {
        const val PREFIX = "LOKA-PAY-NOTE-V1"
        const val SIZE = 141
        val USD: ByteArray get() = "USD".toByteArray(Charsets.US_ASCII)

        /** A note for [deployment] in currency USD. */
        fun create(deployment: Deployment, allowanceId: ULong, payeeKeyHash: ByteArray, amount: ULong,
                   serial: Int, expiry: Long): NoteV1 {
            require(serial in 0..255) { "serial is 0 to 255" }
            require(payeeKeyHash.size == 32) { "payee key hash is 32 bytes" }
            return NoteV1(deployment.programId, deployment.clusterId, deployment.mint, allowanceId,
                payeeKeyHash.copyOf(), amount, USD, serial, expiry)
        }

        /** Structural decode of exactly 141 bytes (`length`, `prefix`). Field rules are in [SignedNote.validate]. */
        fun decode(bytes: ByteArray): NoteV1 {
            if (bytes.size != SIZE) fail(PaymentError.LENGTH)
            val r = ByteReader(bytes)
            if (!r.read(16).contentEquals(PREFIX.toByteArray(Charsets.US_ASCII))) fail(PaymentError.PREFIX)
            return NoteV1(
                programId = r.read(32), clusterId = r.u8(), mint = r.read(32), allowanceId = r.u64(),
                payeeKeyHash = r.read(32), amount = r.u64(), currency = r.read(3), serial = r.u8(), expiry = r.i64(),
            )
        }
    }
}

/** A note with its signature and the payer's key: the 238-byte note wire. */
class SignedNote private constructor(
    val note: NoteV1,
    noteBytes: ByteArray,
    signature: ByteArray,
    payerPublicKey: ByteArray,
) {
    private val noteBytesCopy = noteBytes.copyOf()
    private val signatureCopy = signature.copyOf()
    private val payerKeyCopy = payerPublicKey.copyOf()

    val noteBytes: ByteArray get() = noteBytesCopy.copyOf()
    val signature: ByteArray get() = signatureCopy.copyOf()
    val payerPublicKey: ByteArray get() = payerKeyCopy.copyOf()
    val noteId: ByteArray get() = sha256(noteBytesCopy)
    val payerKeyHash: ByteArray get() = P256Rules.keyHash(payerKeyCopy)
    val wire: ByteArray get() = noteBytesCopy + signatureCopy + payerKeyCopy

    override fun equals(other: Any?): Boolean = other is SignedNote && wire.contentEquals(other.wire)
    override fun hashCode(): Int = wire.contentHashCode()

    companion object {
        const val WIRE_SIZE = 238
        private val USD = NoteV1.USD

        /**
         * Runs the checks of protocol/PAYMENT-V1.md section 6 in order and throws the first
         * failure by name: length, prefix, cluster, currency, amount_zero, wrong_program,
         * wrong_mint, bad_pubkey, high_s, bad_signature. Time, allowance and offline-limit
         * checks come after this.
         */
        fun validate(wire: ByteArray, deployment: Deployment): SignedNote {
            if (wire.size != WIRE_SIZE) fail(PaymentError.LENGTH)
            val noteBytes = wire.copyOfRange(0, NoteV1.SIZE)
            val note = NoteV1.decode(noteBytes)
            if (note.clusterId != deployment.clusterId) fail(PaymentError.CLUSTER)
            if (!note.currency.contentEquals(USD)) fail(PaymentError.CURRENCY)
            if (note.amount == 0UL) fail(PaymentError.AMOUNT_ZERO)
            if (!deployment.sameProgram(note.programId)) fail(PaymentError.WRONG_PROGRAM)
            if (!deployment.sameMint(note.mint)) fail(PaymentError.WRONG_MINT)
            val signature = wire.copyOfRange(141, 205)
            val key = wire.copyOfRange(205, 238)
            P256Rules.verify(signature, noteBytes, key)
            return SignedNote(note, noteBytes, signature, key)
        }

        /**
         * Finishes a note signed by a platform key that returns DER (the Android Keystore):
         * DER to 64-byte r || s, low-S normalization, then the full section 6 validation, so
         * a note is only ever returned after it verifies with [payerPublicKey].
         */
        fun fromDerSignature(noteBytes: ByteArray, derSignature: ByteArray, payerPublicKey: ByteArray,
                             deployment: Deployment): SignedNote {
            if (noteBytes.size != NoteV1.SIZE) fail(PaymentError.LENGTH)
            val raw = P256Rules.normalizeLowS(P256Rules.derToRaw(derSignature))
            return validate(noteBytes + raw + payerPublicKey, deployment)
        }
    }
}
