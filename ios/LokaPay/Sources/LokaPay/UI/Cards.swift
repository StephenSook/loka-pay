import SwiftUI

// MARK: - Allowance card

/// What this phone knows locally about an allowance, next to the certificate's numbers.
public enum AllowanceUsage: Equatable, Sendable {
    /// Merchant side: value accepted offline and not settled yet (OfflineLedger).
    case unsettledHere(UInt64)
    /// Payer side: serials this phone has reserved (SerialReservations). The package keeps no
    /// durable sum of signed amounts, so the payer card shows notes signed, not dollars spent.
    case notesSigned(Int)
}

/// Cap, offline limit, expiry and bond, all from a verified allowance certificate.
public struct AllowanceCard: View {
    let certificate: AllowanceCertificate
    let usage: AllowanceUsage?

    public init(certificate: AllowanceCertificate, usage: AllowanceUsage? = nil) {
        self.certificate = certificate
        self.usage = usage
    }

    public var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            HStack {
                // String(...) keeps the id verbatim: a localized interpolation would print "1,001".
                Label("Allowance #" + String(certificate.allowanceId), systemImage: "wallet.pass.fill")
                    .font(LokaStyle.headline)
                    .foregroundStyle(LokaColor.ink)
                Spacer()
                Text("Verified").font(LokaStyle.caption).foregroundStyle(LokaColor.muted)
            }
            FactRow(label: "Cap", value: "$\(Money.display(baseUnits: certificate.cap)) sandbox")
            FactRow(label: "Offline limit", value: "$\(Money.display(baseUnits: certificate.offlineLimit)) sandbox")
            switch usage {
            case .unsettledHere(let units)?:
                FactRow(label: "Unsettled at this phone", value: "$\(Money.display(baseUnits: units)) sandbox")
            case .notesSigned(let count)?:
                FactRow(label: "Notes signed on this phone", value: "\(count) of 256")
            case nil:
                EmptyView()
            }
            FactRow(label: "Expires", value: Date(timeIntervalSince1970: TimeInterval(certificate.expiry))
                .formatted(date: .abbreviated, time: .shortened))
            FactRow(label: "Merchants", value: certificate.earmarks.isEmpty ? "Any merchant" : "\(certificate.earmarks.count) named")
            if certificate.bond > 0 {
                FactRow(label: "Bond", value: "$\(Money.display(baseUnits: certificate.bond)) sandbox")
            }
        }
        .lokaCard()
    }
}

// MARK: - Receipt facts and card

/// The difference of two signed clock readings. Any `Int64` can carry a valid signature, so a
/// plain subtraction can trap; a span that is negative or does not fit in 64 bits means the
/// clocks disagree, and the card shows no figure for it.
public enum ClockSpan: Equatable, Sendable {
    case seconds(Int64)
    case clocksDisagree

    public static func between(later: Int64, earlier: Int64) -> ClockSpan {
        let (difference, overflow) = later.subtractingReportingOverflow(earlier)
        return overflow || difference < 0 ? .clocksDisagree : .seconds(difference)
    }

    /// The figure, or nil when the clocks disagree.
    public var seconds: Int64? {
        if case .seconds(let value) = self { return value }
        return nil
    }
}

/// Everything a receipt card shows, computed from verified parts only.
public struct ReceiptFacts: Equatable, Sendable {
    public let amount: UInt64
    /// The merchant's name from a verified merchant certificate whose key hash is the note's
    /// payee; nil when no such certificate is at hand (the card then says it is not verified).
    public let merchantName: String?
    public let status: MoneyStatus
    /// Only from the signed CONF's transaction signature; nil without a CONF or with an all-zero one.
    public let explorer: URL?
    /// The program's error code from a failed CONF (signed).
    public let errorCode: UInt16?
    /// The program's name for `errorCode` (`LokaVaultError`); nil without a code or for a code the
    /// program does not define.
    public let errorName: String?
    /// CONF uploaded at minus ACK received at (server clock minus the merchant phone's clock);
    /// nil without a CONF.
    public let heldOffline: ClockSpan?
    /// CONF block time minus CONF uploaded at (chain time minus server clock), settled only.
    public let settledAfterUpload: ClockSpan?

    /// The held-offline figure, or nil without a CONF or when the clocks disagree.
    public var heldOfflineSeconds: Int64? { heldOffline?.seconds }
    /// The settled-after-upload figure, or nil when not settled or when the clocks disagree.
    public var settledAfterUploadSeconds: Int64? { settledAfterUpload?.seconds }

    /// "already spent" only when the signed CONF says failed on chain with the program's
    /// SerialUsed code (the serial was redeemed before). Never from the server's unsigned JSON.
    public var statusDetail: String? {
        errorCode == LokaVaultError.serialUsed ? "already spent" : nil
    }

    /// What the chain decided, in plain words, for a failed CONF; nil otherwise. It claims a reason
    /// only from the signed error code, and points to the explorer only when there is a link.
    public var chainLine: String? {
        guard let code = errorCode else { return nil }
        let look = explorer == nil
            ? "the confirmation carries no transaction signature, so there is no explorer link."
            : "open it on the explorer to see why."
        if code == LokaVaultError.serialUsed {
            return "Solana refused this note: its allowance serial was already spent by an earlier payment "
                + "(program error SerialUsed, code " + String(code) + ", in the server-signed confirmation). "
                + (explorer == nil ? "The confirmation carries no transaction signature, so there is no explorer link."
                                   : "The failed transaction opens on the explorer.")
        }
        if let name = errorName {
            return "Failed on chain. The transaction was refused with program error " + name + " (code "
                + String(code) + ", in the server-signed confirmation); " + look
        }
        if code != 0 {
            return "Failed on chain. The transaction was refused with error code " + String(code)
                + ", which is not one of the program's named errors; " + look
        }
        return "Failed on chain. The transaction was refused; " + look
    }

    /// The error code row's value: the number, with the program's name when it has one.
    public var errorCodeText: String? {
        guard let code = errorCode, code != 0 else { return nil }
        return errorName.map { String(code) + " (" + $0 + ")" } ?? String(code)
    }

    public init(receipt: VerifiedReceipt, merchant: MerchantCertificate?, clusterId: UInt8) {
        amount = receipt.note.note.amount
        if let merchant, merchant.merchantKeyHash == receipt.note.note.payeeKeyHash {
            merchantName = merchant.displayName
        } else {
            merchantName = nil
        }
        status = MoneyStatus(receipt: receipt)
        let conf = receipt.confirmation
        if let conf, conf.txSignature.contains(where: { $0 != 0 }) {
            explorer = SettlementClient.explorerURL(signature: Base58.encode(conf.txSignature), clusterId: clusterId)
        } else {
            explorer = nil
        }
        errorCode = conf?.status == .failedOnChain ? conf?.errorCode : nil
        errorName = errorCode.flatMap(LokaVaultError.name(code:))
        heldOffline = conf.map { ClockSpan.between(later: $0.uploadedAt, earlier: receipt.ack.receivedAt) }
        settledAfterUpload = conf?.status == .settled
            ? conf.map { ClockSpan.between(later: $0.blockTime, earlier: $0.uploadedAt) } : nil
    }

    /// The two signed timing lines (PAYMENT-V1 section 4.3 names the clocks). A negative or
    /// out-of-range span means the clocks disagree, and it is not shown as a number.
    public var timingLines: [String] {
        var lines: [String] = []
        switch heldOffline {
        case .seconds(let held)?:
            lines.append("Held offline \(HoldingClock.format(seconds: Int(clamping: held))) "
                + "(server clock minus the merchant phone's clock)")
        case .clocksDisagree?:
            lines.append("Held offline: the clocks disagree, so no figure is shown")
        case nil:
            break
        }
        switch settledAfterUpload {
        case .seconds(let settled)?:
            lines.append("Settled \(settled) s after upload (chain time minus server clock)")
        case .clocksDisagree?:
            lines.append("Settled after upload: the clocks disagree, so no figure is shown")
        case nil:
            break
        }
        return lines
    }
}

public struct ReceiptCard: View {
    let receipt: VerifiedReceipt
    let facts: ReceiptFacts
    let receivedWithZeroBars: Bool

    /// `merchant` is a verified certificate (it names the merchant only when its key hash is the
    /// note's payee). `receivedWithZeroBars` is the merchant phone's own report at receipt time.
    public init(receipt: VerifiedReceipt, merchant: MerchantCertificate?, clusterId: UInt8,
                receivedWithZeroBars: Bool = false) {
        self.receipt = receipt
        self.facts = ReceiptFacts(receipt: receipt, merchant: merchant, clusterId: clusterId)
        self.receivedWithZeroBars = receivedWithZeroBars
    }

    public var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            HStack(alignment: .firstTextBaseline) {
                Text("$\(Money.display(baseUnits: facts.amount))")
                    .font(LokaStyle.display)
                    .foregroundStyle(LokaColor.ink)
                Text("sandbox").font(LokaStyle.label).foregroundStyle(LokaColor.muted)
                Spacer()
            }
            .accessibilityElement(children: .combine)
            MoneyStatusChip(facts.status, detail: facts.statusDetail)
            FactRow(label: "To", value: facts.merchantName ?? "Merchant name not verified")
            FactRow(label: "Serial", value: "\(receipt.note.note.serial) of allowance #\(receipt.note.note.allowanceId)")
            if let code = facts.errorCodeText {
                FactRow(label: "Program error code", value: code)
            }
            if let line = facts.chainLine {
                Text(line).font(LokaStyle.body).foregroundStyle(LokaColor.ink)
                    .fixedSize(horizontal: false, vertical: true)
            }
            ForEach(facts.timingLines, id: \.self) { line in
                Text(line).font(LokaStyle.caption).foregroundStyle(LokaColor.muted)
            }
            if receivedWithZeroBars {
                Label("Received with zero bars (phone-reported)", systemImage: "wifi.slash")
                    .font(LokaStyle.caption)
                    .foregroundStyle(LokaColor.muted)
            }
            if let explorer = facts.explorer {
                Link(destination: explorer) {
                    Label("Open the \(facts.errorCode == nil ? "" : "failed ")transaction on Solana Explorer "
                          + "(\(receipt.note.note.clusterId == 0 ? "devnet" : "mainnet"))",
                          systemImage: "arrow.up.right.square")
                        .font(LokaStyle.label)
                }
                .foregroundStyle(LokaColor.ink)
            }
        }
        .lokaCard()
    }
}

#if DEBUG
/// PREVIEW ONLY: the cards with test-vector data.
private struct CardGallery: View {
    var body: some View {
        ScrollView {
            VStack(spacing: 18) {
                AllowanceCard(certificate: PreviewFixtures.allowance, usage: .notesSigned(3))
                AllowanceCard(certificate: PreviewFixtures.allowance, usage: .unsettledHere(1_250_000))
                ReceiptCard(receipt: PreviewFixtures.receipt(conf: nil), merchant: PreviewFixtures.merchant, clusterId: 0,
                            receivedWithZeroBars: true)
                ReceiptCard(receipt: PreviewFixtures.receipt(conf: PreviewFixtures.confSettledWire),
                            merchant: PreviewFixtures.merchant, clusterId: 0, receivedWithZeroBars: true)
                ReceiptCard(receipt: PreviewFixtures.receipt(conf: PreviewFixtures.confFailedWire), merchant: nil, clusterId: 0)
            }
            .padding(16)
        }
        .background(LokaColor.paper)
    }
}

#Preview("Cards") { CardGallery() }
#Preview("Cards, dark") { CardGallery().preferredColorScheme(.dark) }
#endif
