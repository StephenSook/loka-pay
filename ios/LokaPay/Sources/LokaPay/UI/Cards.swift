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
    /// CONF uploaded at minus ACK received at (server clock minus the merchant phone's clock).
    public let heldOfflineSeconds: Int64?
    /// CONF block time minus CONF uploaded at (chain time minus server clock), settled only.
    public let settledAfterUploadSeconds: Int64?

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
        heldOfflineSeconds = conf.map { $0.uploadedAt - receipt.ack.receivedAt }
        settledAfterUploadSeconds = conf?.status == .settled ? conf.map { $0.blockTime - $0.uploadedAt } : nil
    }

    /// The two signed timing lines (PAYMENT-V1 section 4.3 names the clocks). A negative figure
    /// means the clocks disagree, and it is not shown as a number.
    public var timingLines: [String] {
        var lines: [String] = []
        if let held = heldOfflineSeconds {
            lines.append(held >= 0
                ? "Held offline \(HoldingClock.format(seconds: Int(held))) (server clock minus the merchant phone's clock)"
                : "Held offline: the clocks disagree, so no figure is shown")
        }
        if let settled = settledAfterUploadSeconds {
            lines.append(settled >= 0
                ? "Settled \(settled) s after upload (chain time minus server clock)"
                : "Settled after upload: the clocks disagree, so no figure is shown")
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
            MoneyStatusChip(facts.status)
            FactRow(label: "To", value: facts.merchantName ?? "Merchant name not verified")
            FactRow(label: "Serial", value: "\(receipt.note.note.serial) of allowance #\(receipt.note.note.allowanceId)")
            if let code = facts.errorCode {
                FactRow(label: "Program error code", value: "\(code)")
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
                    Label("Open the transaction on Solana Explorer (\(receipt.note.note.clusterId == 0 ? "devnet" : "mainnet"))",
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
