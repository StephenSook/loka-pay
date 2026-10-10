import Foundation
import Testing
@testable import LokaPay

@Suite("design tokens and status words (3.71)")
struct ThemeTests {
    @Test("every text-on-fill pair the screens use reaches 4.5:1")
    func contrast() {
        let p = LokaPalette.self
        var pairs: [(String, UInt32, UInt32)] = [
            ("ink on paper", p.ink, p.paper), ("muted on paper", p.muted, p.paper), ("ink on card", p.ink, p.card),
            ("muted on card", p.muted, p.card), ("dark ink on dark paper", p.inkDark, p.paperDark),
            ("dark muted on dark paper", p.mutedDark, p.paperDark), ("dark ink on dark card", p.inkDark, p.cardDark),
            ("dark muted on dark card", p.mutedDark, p.cardDark), ("ink on warning", p.ink, p.warningFill),
            ("ink on received", p.ink, p.received), ("ink on pending", p.ink, p.pending),
            ("paper on ink button", p.paper, p.ink), ("dark paper on dark ink button", p.paperDark, p.inkDark),
        ]
        for status in MoneyStatus.allCases {
            pairs.append(("\(status.word) chip", status.textHex, status.fillHex))
        }
        for (name, text, fill) in pairs {
            #expect(LokaPalette.contrastRatio(text, fill) >= 4.5, "\(name): \(LokaPalette.contrastRatio(text, fill))")
        }
        // Why white text is kept off the bright accents.
        #expect(LokaPalette.contrastRatio(p.white, p.paid) < 4.5)
        #expect(LokaPalette.contrastRatio(p.white, p.failed) < 4.5)
    }

    @Test("dark mode is warm and never pure black")
    func warmDark() {
        for rgb in [LokaPalette.paperDark, LokaPalette.cardDark, LokaPalette.shadowDark] {
            #expect(rgb != 0x000000)
            #expect((rgb >> 16) & 0xff > rgb & 0xff, "red above blue")
        }
    }

    @Test("status words, symbols and VoiceOver labels are distinct and present")
    func words() {
        let all = MoneyStatus.allCases
        #expect(Set(all.map(\.word)).count == all.count)
        #expect(Set(all.map(\.symbol)).count == all.count)
        #expect(all.allSatisfy { !$0.accessibilityLabel.isEmpty })
        #expect(MoneyStatus.conflictingSpend.word == "Conflicting spend seen")
    }

    @Test("status comes from the verified CONF: none is Received, 1 is Paid, 2 is Failed")
    func statusFromReceipt() throws {
        let d = Vectors.deployment
        let k = Vectors.serverKey
        let r = Vectors.list("receipts")
        #expect(MoneyStatus(receipt: try Receipts.verify(Vectors.hex(r[0]["wireHex"]), deployment: d, serverPublicKey: k)) == .paid)
        #expect(MoneyStatus(receipt: try Receipts.verify(Vectors.hex(r[1]["wireHex"]), deployment: d, serverPublicKey: k)) == .received)
        let note = try SignedNote.validate(wire: Vectors.hex(Vectors.list("notes")[0]["wireHex"]), deployment: d)
        let ack = try Ack.verify(wire: Vectors.hex(Vectors.list("acks")[0]["wireHex"]), for: note)
        let failed = Bundles.receipt(note: note, ack: ack, confirmationWire: Vectors.hex(APIFixtures.conf("failed_on_chain_serial_used")["wireHex"]))
        #expect(MoneyStatus(receipt: try Receipts.verify(failed, deployment: d, serverPublicKey: k)) == .failed)
    }

    @Test("the offline clock reads m:ss without a 59-minute cap")
    func clock() {
        #expect(HoldingClock.format(seconds: 0) == "0:00")
        #expect(HoldingClock.format(seconds: 42) == "0:42")
        #expect(HoldingClock.format(seconds: 125) == "2:05")
        #expect(HoldingClock.format(seconds: 4325) == "72:05")
        #expect(HoldingClock.format(seconds: -5) == "0:00")
        let start = Date(timeIntervalSince1970: 100)
        #expect(HoldingClock.label(since: start, now: Date(timeIntervalSince1970: 142.9)) == "Holding offline 0:42")
    }

    @Test("the zero-bars line names Bluetooth only when the mesh layer reports it")
    func zeroBars() {
        #expect(ZeroBarsMeter.offlineText(bluetoothOn: true) == "Zero bars: no Wi-Fi, no cellular, Bluetooth on")
        #expect(ZeroBarsMeter.offlineText(bluetoothOn: false) == "Zero bars: no Wi-Fi, no cellular, Bluetooth off")
        #expect(ZeroBarsMeter.offlineText(bluetoothOn: nil) == "Zero bars: no Wi-Fi, no cellular")
        #expect(InternetState.none.accessibilityLabel == "Zero bars, no internet")
        #expect(SandboxBanner.text == "Sandbox: test tokens with no value")
    }

    @Test("the acceptance chip is Near limit from 80 percent of the offline limit")
    func limit() {
        #expect(LimitState.from(unsettled: 0, offlineLimit: 3_000_000, conflict: false) == .withinLimit)
        #expect(LimitState.from(unsettled: 2_399_999, offlineLimit: 3_000_000, conflict: false) == .withinLimit)
        #expect(LimitState.from(unsettled: 2_400_000, offlineLimit: 3_000_000, conflict: false) == .nearLimit)
        #expect(LimitState.from(unsettled: 0, offlineLimit: 3_000_000, conflict: true) == .conflictingSpend)
        let line = LimitState.riskLine(unsettled: 1_000_000, offlineLimit: 3_000_000, allowanceId: 7)
        #expect(line.contains("$1.00"))
        #expect(line.contains("$3.00"))
        #expect(line.contains("Sandbox"))
    }

    @Test("issue messages are plain and carry no dashes")
    func messages() {
        let kinds: [MoneyIssueKind] = PaymentErrorList.all.map { .payment($0) } + [
            .amountUnreadable, .overCap, .notPaymentCode, .wrongKind(expected: [.note], got: .ack), .codeTooLong,
            .allowanceNeeded, .noAllowance, .noMerchantCertificate, .noSigner, .serverKeyMissing, .keyMismatch,
            .signing("x"), .receiptMismatch, .busy, .alreadyReceived, .serverNotConnected,
            .settlement(.refused(check: "bad_ack", message: "")), .settlement(.network(.timedOut)),
            .settlement(.http(status: 503, error: nil, message: nil)), .settlement(.chainUnavailable(message: "")),
            .settlement(.rateLimited(retryAfter: 3, message: "")), .settlement(.verification(.badSignature)),
            .ledgerNotUpdated(paid: true), .ledgerNotUpdated(paid: false),
        ]
        for kind in kinds {
            #expect(!kind.message.isEmpty && !kind.name.isEmpty)
            #expect(!kind.message.contains("\u{2014}") && !kind.message.contains("\u{2013}"), "\(kind.name)")
        }
    }
}

/// Every PaymentError case, so a new case cannot slip past the message test.
enum PaymentErrorList {
    static let all: [PaymentError] = [
        .length, .prefix, .cluster, .currency, .amountZero, .wrongProgram, .wrongMint, .badPubkey, .highS,
        .badSignature, .base64url, .transport, .earmarkMismatch, .earmarkList, .nameLength, .receiptFlag,
        .payeeMismatch, .serialsExhausted, .confirmationMismatch, .allowanceMismatch, .payerMismatch,
        .notEarmarked, .expired, .serialSeen, .offlineLimit, .storage,
    ]
}

@Suite("receipt card facts (3.71, 3.53)")
struct ReceiptFactsTests {
    let d = Vectors.deployment
    let k = Vectors.serverKey

    func receipt(_ index: Int) throws -> VerifiedReceipt {
        try Receipts.verify(Vectors.hex(Vectors.list("receipts")[index]["wireHex"]), deployment: d, serverPublicKey: k)
    }

    func merchant(_ index: Int) throws -> MerchantCertificate {
        try MerchantCertificate.verify(wire: Vectors.hex(Vectors.list("merchants")[index]["wireHex"]), deployment: d,
                                       serverPublicKey: k)
    }

    @Test("a settled receipt links its signed transaction and states both signed timings")
    func settled() throws {
        let facts = ReceiptFacts(receipt: try receipt(0), merchant: try merchant(0), clusterId: 0)
        #expect(facts.status == .paid)
        #expect(facts.amount == 1_000_000)
        #expect(facts.merchantName == "Campus Coffee Cart")
        #expect(facts.explorer?.absoluteString == APIFixtures.settledExplorer)
        #expect(facts.heldOfflineSeconds == 1)
        #expect(facts.settledAfterUploadSeconds == 2)
        #expect(facts.errorCode == nil)
        #expect(facts.timingLines.count == 2)
    }

    @Test("a pending receipt has no link and no timings; another merchant's certificate gives no name")
    func pending() throws {
        let facts = ReceiptFacts(receipt: try receipt(1), merchant: try merchant(1), clusterId: 0)
        #expect(facts.status == .received)
        #expect(facts.merchantName == nil)
        #expect(facts.explorer == nil)
        #expect(facts.heldOfflineSeconds == nil)
        #expect(facts.timingLines.isEmpty)
    }

    @Test("a failed receipt shows the signed error code; a refused one with a zero signature has no link")
    func failedAndRefused() throws {
        let note = try SignedNote.validate(wire: Vectors.hex(Vectors.list("notes")[0]["wireHex"]), deployment: d)
        let ack = try Ack.verify(wire: Vectors.hex(Vectors.list("acks")[0]["wireHex"]), for: note)
        func facts(_ conf: String) throws -> ReceiptFacts {
            let bytes = Bundles.receipt(note: note, ack: ack, confirmationWire: Vectors.hex(APIFixtures.conf(conf)["wireHex"]))
            return ReceiptFacts(receipt: try Receipts.verify(bytes, deployment: d, serverPublicKey: k), merchant: nil, clusterId: 0)
        }
        let failed = try facts("failed_on_chain_serial_used")
        #expect(failed.status == .failed)
        #expect(failed.errorCode == 6001)
        #expect(failed.explorer != nil)
        #expect(failed.settledAfterUploadSeconds == nil)
        let refused = try facts("refused_off_chain")
        #expect(refused.status == .failed)
        #expect(refused.explorer == nil)
    }
}

@Suite("preview fixtures")
struct PreviewFixtureTests {
    @Test("preview fixtures are the vector keys and every one still verifies")
    @MainActor
    func previews() throws {
        let keys = Vectors.keys
        #expect(PreviewFixtures.payerSigner.compressedPublicKey == Vectors.hex((keys["payer"] as! [String: Any])["publicKeyHex"]))
        #expect(PreviewFixtures.merchantSigner.compressedPublicKey == Vectors.hex((keys["merchantA"] as! [String: Any])["publicKeyHex"]))
        #expect(PreviewFixtures.serverKey == Vectors.serverKey)
        #expect(PreviewFixtures.deployment == Vectors.deployment)
        _ = try AllowanceCertificate.verify(wire: PreviewFixtures.allowanceWire, deployment: PreviewFixtures.deployment,
                                            serverPublicKey: PreviewFixtures.serverKey)
        _ = try MerchantCertificate.verify(wire: PreviewFixtures.merchantWire, deployment: PreviewFixtures.deployment,
                                           serverPublicKey: PreviewFixtures.serverKey)
        _ = try SignedNote.validate(wire: PreviewFixtures.note1Wire, deployment: PreviewFixtures.deployment)
        #expect(PreviewFixtures.receipt(conf: PreviewFixtures.confSettledWire).status == .settled)
        #expect(PreviewFixtures.receipt(conf: PreviewFixtures.confFailedWire).status == .failedOnChain)
        #expect(PayModel.preview(.enterAmount, merchant: PreviewFixtures.merchant).phase == .enterAmount)
        #expect(PayModel.preview(.scanMerchant, serverKey: nil).phase == .unavailable)
        #expect(ReceiveModel.preview(.ready).phase == .ready)
    }
}
