import Foundation

/// Why a money screen stopped (task 2.12: every money screen has an error state). Each case has a
/// stable name for tests and logs and a plain-words message for the screen. PAYMENT-V1 checks keep
/// their spec names (`PaymentError.rawValue`).
public enum MoneyIssueKind: Error, Equatable, Sendable {
    /// A named PAYMENT-V1 check failed (section 6, the structure rules, or the merchant checks).
    case payment(PaymentError)
    /// The amount text is not a number this screen can read ("1", "1.5", "0.25").
    case amountUnreadable
    /// The amount is more than the allowance cap.
    case overCap
    /// The scanned text is not version-1 LOKA payment content.
    case notPaymentCode
    /// A payment code of a kind this step does not use (for example an ack where a note belongs).
    case wrongKind(expected: [PaymentTransport.Kind], got: PaymentTransport.Kind)
    /// The scanned text is longer than any payment code.
    case codeTooLong
    /// A note arrived and no verified allowance certificate for it is on this phone yet.
    case allowanceNeeded
    /// No allowance certificate on this phone (it comes from POST /v1/payers).
    case noAllowance
    /// No merchant certificate on this phone (it comes from POST /v1/merchants).
    case noMerchantCertificate
    /// No signing key was provided.
    case noSigner
    /// The pinned server key is not set (config/pins.json `serverEd25519PublicKey` is null).
    case serverKeyMissing
    /// The certificate names a different key than this phone's signer.
    case keyMismatch
    /// The signer did not produce a signature (Face ID or passcode cancelled or failed).
    case signing(String)
    /// A receipt or ack for a different payment than the one on screen.
    case receiptMismatch
    /// A new note arrived while another payment is still on screen.
    case busy
    /// A different note arrived while one note already waits for its allowance; it was not taken.
    case otherNoteWaiting
    /// This exact note is already in the merchant's offline ledger with nothing to settle here: the
    /// chain decided it (an unsettled one that can be read back comes on screen to settle instead).
    case alreadyReceived
    /// No settlement client is connected in this build.
    case serverNotConnected
    /// The settlement call failed; the note stays held on this phone.
    case settlement(SettlementError)
    /// The chain decided the note (a verified CONF), but this phone could not record that
    /// decision in its offline ledger. `paid` is true for a settled CONF.
    case ledgerNotUpdated(paid: Bool)

    /// A normal next step on the way to a payment, not a failure: the screen shows it in a neutral
    /// banner instead of a red "Stopped" one.
    public var isStep: Bool {
        switch self {
        case .allowanceNeeded, .alreadyReceived, .busy, .otherNoteWaiting, .settlement(.stillPending): return true
        default: return false
        }
    }

    public var name: String {
        switch self {
        case .payment(let e): return e.rawValue
        case .amountUnreadable: return "amount_unreadable"
        case .overCap: return "over_cap"
        case .notPaymentCode: return "not_payment_code"
        case .wrongKind: return "wrong_kind"
        case .codeTooLong: return "code_too_long"
        case .allowanceNeeded: return "allowance_needed"
        case .noAllowance: return "no_allowance"
        case .noMerchantCertificate: return "no_merchant_certificate"
        case .noSigner: return "no_signer"
        case .serverKeyMissing: return "server_key_missing"
        case .keyMismatch: return "key_mismatch"
        case .signing: return "signing"
        case .receiptMismatch: return "receipt_mismatch"
        case .busy: return "busy"
        case .otherNoteWaiting: return "other_note_waiting"
        case .alreadyReceived: return "already_received"
        case .serverNotConnected: return "server_not_connected"
        case .settlement(let e): return "settlement_" + Self.settlementName(e)
        case .ledgerNotUpdated: return "ledger_not_updated"
        }
    }

    public var message: String {
        switch self {
        case .payment(let e): return Self.paymentMessage(e)
        case .amountUnreadable: return "Enter an amount like 1, 1.50 or 0.25."
        case .overCap: return "That is more than this allowance can ever pay."
        case .notPaymentCode: return "That code is not a LOKA payment code."
        case .wrongKind(let expected, let got):
            let want = expected.map(Self.kindName).joined(separator: " or ")
            return "That is \(Self.article(Self.kindName(got))) \(Self.kindName(got)) code. "
                + "This step needs \(Self.article(want)) \(want) code."
        case .codeTooLong: return "That code is longer than any LOKA payment code."
        case .allowanceNeeded: return "The note checked out. Now scan the payer's allowance code (code 1 of 2)."
        case .noAllowance:
            return "This phone has no allowance certificate yet. It comes from the settlement server (POST /v1/payers)."
        case .noMerchantCertificate:
            return "This phone has no merchant certificate yet. It comes from the settlement server (POST /v1/merchants)."
        case .noSigner: return "No signing key is set up on this phone."
        case .serverKeyMissing:
            return "The server's public key is not pinned yet, so no certificate can be checked. Nothing is trusted until it is."
        case .keyMismatch: return "The certificate belongs to a different key than this phone's."
        case .signing(let detail):
            return "The phone did not sign (Face ID or passcode did not finish). Nothing was sent. (\(detail))"
        case .receiptMismatch: return "That receipt is for a different payment."
        case .busy: return "Finish the payment on screen first (Next payment), then scan this note."
        case .otherNoteWaiting:
            return "Another payment note is already waiting for its allowance (code 1 of 2), so this note was not taken. "
                + "Scan that allowance, or tap Clear the waiting note, then send this note again."
        case .alreadyReceived:
            return "This exact note was already received on this phone and is recorded in its ledger, so nothing new was accepted."
        case .serverNotConnected: return "No settlement server is connected in this build. The note stays held on this phone."
        case .settlement(let e): return Self.settlementMessage(e)
        case .ledgerNotUpdated(let paid):
            return (paid ? "Paid on chain" : "Failed on chain")
                + ", but this phone could not record it in its offline ledger, so the ledger may still count "
                + "this note as unsettled. The signed receipt above is the record."
        }
    }

    /// "an" before a vowel sound, "a" otherwise, for the code names in `kindName`.
    static func article(_ phrase: String) -> String {
        guard let first = phrase.lowercased().first else { return "a" }
        return "aeiou".contains(first) ? "an" : "a"
    }

    public static func kindName(_ kind: PaymentTransport.Kind) -> String {
        switch kind {
        case .note: return "payment note"
        case .ack: return "merchant receipt"
        case .confirmation: return "confirmation"
        case .marker: return "spend marker"
        case .receipt: return "settled receipt"
        case .allowance: return "allowance"
        case .merchant: return "merchant"
        }
    }

    static func paymentMessage(_ e: PaymentError) -> String {
        switch e {
        case .length: return "The code is the wrong length. It may be cut off; scan it again."
        case .prefix: return "This is not the LOKA structure this step expects."
        case .cluster: return "This is for a different Solana cluster."
        case .currency: return "This note is not in USD."
        case .amountZero: return "The amount must be more than 0."
        case .wrongProgram: return "This is for a different LOKA program."
        case .wrongMint: return "This is for a different token."
        case .badPubkey: return "The key in this code is not a valid P-256 key."
        case .highS: return "The signature is not in the low-S form the chain requires."
        case .badSignature: return "The signature does not match. The code was changed or signed by another key."
        case .base64url: return "The code text is damaged (not canonical base64url)."
        case .transport: return "The code is not well formed."
        case .earmarkMismatch: return "The allowance's merchant list does not match its signature."
        case .earmarkList: return "The allowance's merchant list is malformed."
        case .nameLength: return "The merchant name in the certificate is not valid."
        case .receiptFlag: return "The receipt is malformed."
        case .payeeMismatch: return "This payment is addressed to a different merchant."
        case .serialsExhausted: return "This allowance has used all 256 payment serials. A new allowance is needed."
        case .confirmationMismatch: return "The confirmation is for a different payment."
        case .allowanceMismatch: return "The allowance certificate does not match this note."
        case .payerMismatch: return "The note was not signed by the allowance's payer."
        case .notEarmarked: return "This allowance cannot pay this merchant."
        case .expired: return "This note or allowance has expired."
        case .serialSeen: return "This payment serial was already used with this merchant, so the note was refused."
        case .offlineLimit: return "Accepting this would take the allowance past its offline limit, so it was refused."
        case .storage: return "The phone could not save the payment record, so nothing was accepted."
        }
    }

    static func settlementName(_ e: SettlementError) -> String {
        switch e {
        case .badJSON: return "bad_json"
        case .badBase64url: return "bad_base64url"
        case .badPubkey: return "bad_pubkey"
        case .nameLength: return "name_length"
        case .unknownNote: return "unknown_note"
        case .refused(let check, _): return "refused_" + check
        case .rateLimited: return "rate_limited"
        case .budgetExhausted: return "budget_exhausted"
        case .chainUnavailable: return "chain_unavailable"
        case .http(let status, _, _): return "http_\(status)"
        case .network: return "network"
        case .transport: return "transport"
        case .invalidResponse: return "invalid_response"
        case .verification(let p): return "verification_" + p.rawValue
        case .confirmationMismatch: return "confirmation_mismatch"
        case .payerMismatch: return "payer_mismatch"
        case .merchantMismatch: return "merchant_mismatch"
        case .protocolViolation: return "protocol_violation"
        case .stillPending: return "still_pending"
        }
    }

    /// "Nothing was decided" only where API v1 says the chain was not reached; where no answer this
    /// phone can trust came back (`SettlementError.leavesOutcomeUnknown`), the outcome is unknown.
    static func settlementMessage(_ e: SettlementError) -> String {
        let held = "Nothing was decided on chain; the note stays held on this phone."
        let unknown = "The note stays held on this phone; Check again asks the server by note id."
        switch e {
        case .refused(let check, _):
            return "The server refused this note before it reached the chain (check: \(check)). \(held)"
        case .network(let code):
            return "The connection to the settlement server failed (\(networkWords(code))). The server may have "
                + "settled the note before the answer was lost, so the outcome is unknown. \(unknown)"
        case .chainUnavailable:
            return "The server could not reach Solana devnet and signed nothing. Try again."
        case .rateLimited(let retryAfter, _):
            return retryAfter.map { "The server asked to wait \($0) s before trying again." }
                ?? "The server asked to wait before trying again."
        case .budgetExhausted: return "Today's sandbox budget on the server is spent. \(held)"
        case .http(let status, _, _):
            return "The settlement server answered HTTP \(status). It may not be running yet; this phone cannot "
                + "tell whether it settled the note, so the outcome is unknown. \(unknown)"
        case .transport:
            return "A network error stopped the exchange with the settlement server. The server may have settled "
                + "the note before the answer was lost, so the outcome is unknown. \(unknown)"
        case .invalidResponse, .verification, .confirmationMismatch, .payerMismatch, .merchantMismatch,
             .protocolViolation:
            return "The server's answer did not verify, so it was not trusted and the outcome is unknown. \(unknown)"
        case .stillPending: return "The chain has not decided yet. Check again in a moment."
        case .unknownNote:
            return "The server has no record of this note, so nothing was decided on chain. Settle it again to "
                + "upload it; the note stays held on this phone."
        case .badJSON, .badBase64url, .badPubkey, .nameLength:
            return "The server rejected the request (\(settlementName(e))). \(held)"
        }
    }

    static func networkWords(_ code: URLError.Code) -> String {
        switch code {
        case .notConnectedToInternet: return "no internet"
        case .timedOut: return "timed out"
        case .networkConnectionLost: return "connection lost"
        case .cannotFindHost, .dnsLookupFailed: return "server name not found"
        case .cannotConnectToHost: return "server not answering"
        default: return "network error \(code.rawValue)"
        }
    }
}

/// An issue with the phone-clock time it happened, so the screen can say when.
public struct MoneyIssue: Equatable, Sendable {
    public let kind: MoneyIssueKind
    public let at: Date

    public init(_ kind: MoneyIssueKind, at: Date) {
        self.kind = kind
        self.at = at
    }

    public var name: String { kind.name }
    public var message: String { kind.message }
}
