import Foundation

/// A receipt whose every part was verified and bound to the same note (section 4.9).
public struct VerifiedReceipt: Equatable, Sendable {
    public enum Status: Equatable, Sendable {
        case pending
        case settled
        case failedOnChain
        case refusedOffChain
    }

    public let note: SignedNote
    public let ack: Ack
    public let confirmation: Confirmation?

    /// From the signed CONF only; the receipt's flag byte never decides this.
    public var status: Status {
        switch confirmation?.status {
        case nil: return .pending
        case .settled?: return .settled
        case .failedOnChain?: return .failedOnChain
        case .refusedOffChain?: return .refusedOffChain
        }
    }
}

public enum Receipts {
    /// Verifies the note (section 6), the ack (key hash must be the payee, note id must match)
    /// and, when attached, the CONF (server signature, note id must match).
    public static func verify(_ bytes: Data, deployment: Deployment, serverPublicKey: Data) throws -> VerifiedReceipt {
        let parts = try Bundles.splitReceipt(bytes)
        let note = try SignedNote.validate(wire: parts.note, deployment: deployment)
        let ack = try Ack.verify(wire: parts.ack, for: note)
        var confirmation: Confirmation?
        if let wire = parts.confirmation {
            let conf = try Confirmation.verify(wire: wire, serverPublicKey: serverPublicKey)
            guard conf.noteId == note.noteId else { throw PaymentError.confirmationMismatch }
            confirmation = conf
        }
        return VerifiedReceipt(note: note, ack: ack, confirmation: confirmation)
    }
}

public enum Conflicts {
    /// "Conflicting spend seen" only for a real equivocation: both notes already passed
    /// section 6, name the certificate's allowance and the same serial, differ, and BOTH
    /// payer keys hash to the certificate's payer. A valid note from any other key is not
    /// evidence against this payer.
    public static func isEquivocation(_ a: SignedNote, _ b: SignedNote, certificate: AllowanceCertificate) -> Bool {
        a.note.allowanceId == certificate.allowanceId
            && b.note.allowanceId == certificate.allowanceId
            && a.note.serial == b.note.serial
            && a.noteId != b.noteId
            && a.payerKeyHash == certificate.payerKeyHash
            && b.payerKeyHash == certificate.payerKeyHash
    }
}

public enum Acceptance {
    /// The merchant checks of section 6 that need a verified allowance certificate
    /// (items 2 to 5). The offline-limit ledger and seen serials (items 6 and 7) are task 2.20.
    public static func check(note: SignedNote, certificate: AllowanceCertificate,
                             merchantKeyHash: Data, now: Int64) throws {
        guard certificate.allowanceId == note.note.allowanceId else { throw PaymentError.allowanceMismatch }
        guard certificate.payerKeyHash == note.payerKeyHash else { throw PaymentError.payerMismatch }
        guard note.note.payeeKeyHash == merchantKeyHash else { throw PaymentError.payeeMismatch }
        guard certificate.allows(merchantKeyHash: merchantKeyHash) else { throw PaymentError.notEarmarked }
        guard now <= note.note.expiry, note.note.expiry <= certificate.expiry else { throw PaymentError.expired }
    }
}
