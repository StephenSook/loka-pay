package org.loka.core.pay

/**
 * The deployment and server key from config/pins.json. A null or blank server key means
 * "not published yet" (PLAN.md shared contracts): certificates cannot be verified, so a payer
 * must refuse to sign rather than pretend.
 */
class Pins private constructor(val deployment: Deployment, serverPublicKey: ByteArray?) {
    private val server = serverPublicKey?.copyOf()

    /** The pinned server Ed25519 key (32 bytes), or null while it is not published. */
    val serverPublicKey: ByteArray? get() = server?.copyOf()

    companion object {
        private val HEX_64 = Regex("^[0-9a-fA-F]{64}$")

        /**
         * Parses the pins fields: `cluster` ("devnet" or "mainnet"), `programId` and `mint`
         * (base58, 32 bytes each) and `serverEd25519PublicKey` (64 hex characters or base58 of
         * 32 bytes; null or blank when not published). Throws IllegalArgumentException with the
         * field name when a present field is malformed.
         */
        fun parse(cluster: String, programIdBase58: String, mintBase58: String, serverEd25519PublicKey: String?): Pins {
            val clusterId = when (cluster) {
                "devnet" -> 0
                "mainnet" -> 1
                else -> throw IllegalArgumentException("pins: cluster must be \"devnet\" or \"mainnet\"")
            }
            val program = base58Field("programId", programIdBase58)
            val mint = base58Field("mint", mintBase58)
            val key = serverEd25519PublicKey?.takeIf { it.isNotBlank() }?.let { text ->
                if (HEX_64.matches(text)) hexToBytes(text) else base58Field("serverEd25519PublicKey", text)
            }
            return Pins(Deployment(program, clusterId, mint), key)
        }

        private fun base58Field(name: String, text: String): ByteArray {
            val bytes = try {
                Base58.decode(text)
            } catch (e: PaymentException) {
                throw IllegalArgumentException("pins: $name is not base58", e)
            }
            require(bytes.size == 32) { "pins: $name must decode to 32 bytes, not ${bytes.size}" }
            return bytes
        }
    }
}

/**
 * Payer-side checks before signing: everything a merchant (section 6, "Merchant checks") or the
 * program (section 8) would refuse that the payer can already see from the two verified
 * certificates. Serial uniqueness is [SerialReservations]; signing is the platform key.
 */
object PayerChecks {
    /**
     * Returns the note to sign, with the reserved [serial], or throws the first refusal:
     * `amount_zero`, `payer_mismatch` (the allowance names a different payer key),
     * `not_earmarked`, `expired` (the allowance expired), `over_cap`, `offline_limit`.
     * The note expires with the allowance (a note's expiry must be at most the allowance's).
     */
    fun noteFor(
        deployment: Deployment,
        allowance: AllowanceCertificate,
        merchant: MerchantCertificate,
        payerKeyHash: ByteArray,
        amount: ULong,
        serial: Int,
        now: Long,
    ): NoteV1 {
        check(allowance, merchant, payerKeyHash, amount, now)
        return NoteV1.create(deployment, allowance.allowanceId, merchant.merchantKeyHash, amount, serial, allowance.expiry)
    }

    /**
     * The same refusals as [noteFor], without building a note (for showing them before a serial
     * is reserved). Both certificates must already be verified against the deployment.
     */
    fun check(
        allowance: AllowanceCertificate,
        merchant: MerchantCertificate,
        payerKeyHash: ByteArray,
        amount: ULong,
        now: Long,
    ) {
        if (amount == 0UL) fail(PaymentError.AMOUNT_ZERO)
        if (!allowance.payerKeyHash.contentEquals(payerKeyHash)) fail(PaymentError.PAYER_MISMATCH)
        if (!allowance.allows(merchant.merchantKeyHash)) fail(PaymentError.NOT_EARMARKED)
        if (now > allowance.expiry) fail(PaymentError.EXPIRED)
        if (amount > allowance.cap) fail(PaymentError.OVER_CAP)
        if (amount > allowance.offlineLimit) fail(PaymentError.OFFLINE_LIMIT)
    }
}

/**
 * A signed note together with the verified merchant certificate it pays, captured when it was
 * signed. A screen renders only this snapshot, so editing an input afterwards cannot relabel a
 * payment. Refuses (`payee_mismatch`) when the certificate is not the note's payee.
 */
class SignedPayment(val note: SignedNote, merchant: MerchantCertificate) {
    val merchantName: String = merchant.displayName
    private val merchantHash = merchant.merchantKeyHash

    init {
        if (!merchantHash.contentEquals(note.note.payeeKeyHash)) fail(PaymentError.PAYEE_MISMATCH)
    }

    val merchantKeyHash: ByteArray get() = merchantHash.copyOf()

    /** The `L1|P|1|N|...` text of exactly this note (what the QR code and the copy button carry). */
    val transport: String = PaymentTransport.encode(PaymentTransport.Kind.NOTE, note.wire)
}
