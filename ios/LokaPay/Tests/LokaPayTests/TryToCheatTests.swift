import CryptoKit
import Foundation
import SwiftUI
import Testing
@testable import LokaPay

private typealias F = ScreenFixtures

/// Signs like its inner key until `failing` is set, then fails the way a cancelled Face ID does.
private final class SwitchableSigner: PaymentSigner, @unchecked Sendable {
    let inner: SoftwareP256Signer
    private let lock = NSLock()
    private var shouldFail = false

    init(inner: SoftwareP256Signer) { self.inner = inner }

    var failing: Bool {
        get { lock.withLock { shouldFail } }
        set { lock.withLock { shouldFail = newValue } }
    }

    var compressedPublicKey: Data { inner.compressedPublicKey }

    func sign(_ message: Data) throws -> Data {
        if failing {
            throw NSError(domain: "com.apple.LocalAuthentication", code: -2,
                          userInfo: [NSLocalizedDescriptionKey: "Authentication canceled."])
        }
        return try inner.sign(message)
    }
}

/// Holds the signature of chosen notes (payee `heldPayee`, by serial) until the test releases it,
/// then fails it like a cancelled Face ID or signs it. Everything else signs at once. Lets a test
/// make an old attempt's result arrive after a newer attempt started.
private final class HeldSigner: PaymentSigner, @unchecked Sendable {
    enum Outcome { case fail, pass }

    let inner: SoftwareP256Signer
    let heldPayee: Data
    private let lock = NSLock()
    private var gates: [UInt8: (gate: DispatchSemaphore, outcome: Outcome)] = [:]

    init(inner: SoftwareP256Signer, heldPayee: Data) {
        self.inner = inner
        self.heldPayee = heldPayee
    }

    /// Holds the note to `heldPayee` with `serial` until the returned semaphore is signalled.
    func hold(serial: UInt8, then outcome: Outcome) -> DispatchSemaphore {
        let gate = DispatchSemaphore(value: 0)
        lock.withLock { gates[serial] = (gate, outcome) }
        return gate
    }

    var compressedPublicKey: Data { inner.compressedPublicKey }

    func sign(_ message: Data) throws -> Data {
        let start = message.startIndex
        let payee = message.subdata(in: (start + 89)..<(start + 121))
        let serial = message[start + 132]
        if payee == heldPayee, let held = lock.withLock({ gates[serial] }) {
            // Bounded, so a broken test fails instead of hanging.
            guard held.gate.wait(timeout: .now() + 10) == .success else {
                throw NSError(domain: "HeldSigner", code: 1, userInfo: [NSLocalizedDescriptionKey: "never released"])
            }
            if held.outcome == .fail {
                throw NSError(domain: "com.apple.LocalAuthentication", code: -2,
                              userInfo: [NSLocalizedDescriptionKey: "Authentication canceled."])
            }
        }
        return try inner.sign(message)
    }
}

/// A merchant certificate for another deployment's program id, signed by the real server key.
private func merchantWire(merchant: Data, programId: Data) -> Data {
    let name = Data("Elsewhere".utf8)
    var w = ByteWriter()
    w.ascii(MerchantCertificate.prefix, count: 16)
    w.bytes(programId, count: 32)
    w.u8(F.deployment.clusterId)
    w.bytes(F.deployment.mint, count: 32)
    w.bytes(merchant, count: 32)
    w.u16(UInt16(name.count))
    w.bytes(name, count: name.count)
    return w.data + F.sign(w.data, nil)
}

@Suite("Try to cheat: the payer signs the same allowance and serial for merchant B (2.13)")
@MainActor
struct TryToCheatPayerTests {
    let payer = SoftwareP256Signer()
    let merchantA = SoftwareP256Signer()
    let merchantB = SoftwareP256Signer()

    var merchantAText: String { PaymentTransport.encode(.merchant, F.merchantWire(merchant: merchantA.keyHash, name: "Stall A")) }
    var merchantBText: String { PaymentTransport.encode(.merchant, F.merchantWire(merchant: merchantB.keyHash, name: "Stall B")) }

    /// A Pay model that has signed $1.25 to merchant A.
    func paid(signer: any PaymentSigner, serials: SerialReservations, allowanceWire: Data) async throws -> PayModel {
        let model = PayModel(allowanceWire: allowanceWire, signer: signer, serials: serials, deployment: F.deployment,
                             serverPublicKey: F.serverKey, locale: Locale(identifier: "en_US_POSIX"), now: { F.now })
        model.acceptMerchant(text: merchantAText)
        model.amountText = "1.25"
        await model.pay()
        try #require(model.phase == .showNote)
        return model
    }

    @Test("the cheat note keeps allowance, serial, amount and expiry, pays merchant B, and the serial store is byte for byte unchanged")
    func signsSameSerial() async throws {
        let url = F.tempURL("serials.json")
        let serials = SerialReservations(url: url)
        let recorder = RecordingSigner(inner: payer, serials: serials, allowanceId: F.allowanceId)
        let allowanceWire = F.allowanceWire(payer: payer.keyHash)
        let model = try await paid(signer: recorder, serials: serials, allowanceWire: allowanceWire)
        let original = try #require(model.payment?.note)
        let storeBefore = try Data(contentsOf: url)

        #expect(model.canTryToCheat)
        model.startCheat()
        #expect(model.cheatStep == .scanMerchant)
        #expect(model.cheatOriginal == original)
        model.acceptCheatMerchant(text: merchantBText)
        #expect(model.issue == nil)
        #expect(model.cheatStep == .confirm)
        #expect(model.cheatMerchant?.merchantKeyHash == merchantB.keyHash)
        await model.signCheat()
        #expect(model.issue == nil)
        #expect(model.cheatStep == .showNote)

        let cheat = try #require(model.cheat)
        let checked = try SignedNote.validate(wire: cheat.payment.note.wire, deployment: F.deployment)
        #expect(checked.note.allowanceId == original.note.allowanceId)
        #expect(checked.note.serial == original.note.serial)
        #expect(checked.note.amount == original.note.amount)
        #expect(checked.note.currency == original.note.currency)
        #expect(checked.note.expiry == original.note.expiry)
        #expect(checked.note.payeeKeyHash == merchantB.keyHash)
        #expect(checked.payerKeyHash == payer.keyHash)
        #expect(checked.noteId != original.noteId)
        #expect(cheat.original == original)
        // The pair the chain refuses: two valid notes from the certificate's payer on one serial.
        let certificate = try #require(model.allowance?.certificate)
        #expect(Conflicts.isEquivocation(original, checked, certificate: certificate))

        // No reservation: the file is byte for byte what it was, and 255 serials are still free.
        #expect(try Data(contentsOf: url) == storeBefore)
        #expect(try serials.remaining(allowanceId: F.allowanceId) == 255)
        #expect(model.notesSigned == 1)
        // The owner's signer signed it (Face ID on a phone), with nothing reserved before it.
        #expect(recorder.remainingAtSign == [255, 255])

        // Shown like a normal note: the allowance, then the cheat note.
        let a = try #require(try PaymentTransport.decode(cheat.payment.allowanceText))
        #expect(a.kind == .allowance)
        #expect(a.payload == allowanceWire)
        let n = try #require(try PaymentTransport.decode(cheat.payment.noteText))
        #expect(n.kind == .note)
        #expect(n.payload == cheat.payment.note.wire)
        #expect(model.currentCheatCodeText == cheat.payment.allowanceText)
        model.showCheatCode(.note)
        #expect(model.currentCheatCodeText == cheat.payment.noteText)
        #expect(cheat.banner == "Cheat note: serial 0 of allowance #77 signed again for Stall B. Merchant B will "
                + "accept it offline; Solana should refuse it. Sandbox only.")
    }

    @Test("merchant B is checked like any merchant; the original merchant is refused by name")
    func merchantChecks() async throws {
        let url = F.tempURL("serials.json")
        let serials = SerialReservations(url: url)
        let model = try await paid(signer: payer, serials: serials, allowanceWire: F.allowanceWire(payer: payer.keyHash))
        let storeBefore = try Data(contentsOf: url)
        model.startCheat()

        model.acceptCheatMerchant(text: merchantAText)
        #expect(model.issue?.kind == .cheatSameMerchant)
        #expect(model.issue?.name == "cheat_same_merchant")
        #expect(model.issue?.message.contains("Scan a different merchant's code") == true)
        #expect(model.issue?.kind.refusedBy == .thisPhone)
        #expect(model.cheatStep == .scanMerchant)
        #expect(model.cheatMerchant == nil)

        let rogue = Curve25519.Signing.PrivateKey()
        model.acceptCheatMerchant(text: PaymentTransport.encode(.merchant, F.merchantWire(merchant: merchantB.keyHash,
                                                                                           signedBy: rogue)))
        #expect(model.issue?.kind == .payment(.badSignature))
        #expect(model.cheatMerchant == nil)

        let otherProgram = Data(repeating: 0xAB, count: 32)
        model.acceptCheatMerchant(text: PaymentTransport.encode(.merchant, merchantWire(merchant: merchantB.keyHash,
                                                                                         programId: otherProgram)))
        #expect(model.issue?.kind == .payment(.wrongProgram))
        #expect(model.cheatMerchant == nil)

        model.acceptCheatMerchant(text: PaymentTransport.encode(.note, Data(repeating: 1, count: 238)))
        #expect(model.issue?.kind == .wrongKind(expected: [.merchant], got: .note))
        #expect(model.cheatStep == .scanMerchant)

        // Nothing is signed without a verified merchant B.
        await model.signCheat()
        #expect(model.cheat == nil)
        #expect(try Data(contentsOf: url) == storeBefore)
    }

    @Test("a merchant the allowance is not earmarked for is refused, as in merchant selection")
    func earmarks() async throws {
        let wire = F.allowanceWire(payer: payer.keyHash, earmarks: [merchantA.keyHash])
        let model = try await paid(signer: payer, serials: SerialReservations(url: F.tempURL("s.json")), allowanceWire: wire)
        model.startCheat()
        model.acceptCheatMerchant(text: merchantBText)
        #expect(model.issue?.kind == .payment(.notEarmarked))
        #expect(model.cheatMerchant == nil)
        #expect(model.cheatStep == .scanMerchant)
    }

    @Test("the original payment's card, receipt and status are unchanged by the cheat")
    func originalUnchanged() async throws {
        let model = try await paid(signer: payer, serials: SerialReservations(url: F.tempURL("s.json")),
                                   allowanceWire: F.allowanceWire(payer: payer.keyHash))
        let note = try #require(model.payment?.note)

        // On the note card (codes on screen).
        model.showCode(.note)
        let shownPayment = model.payment
        model.startCheat()
        model.acceptCheatMerchant(text: merchantBText)
        await model.signCheat()
        #expect(model.cheat != nil)
        #expect(model.phase == .showNote)
        #expect(model.payment == shownPayment)
        #expect(model.codeStep == .note)
        #expect(model.currentCodeText == shownPayment?.noteText)
        #expect(model.merchant?.merchantKeyHash == merchantA.keyHash)
        model.cancelCheat()
        #expect(model.cheatStep == .off)
        #expect(model.cheat == nil)

        // On the receipt, after merchant A's ack.
        let ack = try Ack.sign(note: note, receivedAt: 1_800_000_010, with: merchantA)
        model.acceptReturn(text: PaymentTransport.encode(.ack, ack.wire))
        #expect(model.phase == .receipt)
        let before = (model.payment, model.receipt, model.merchant, model.codeStep, model.notesSigned)
        model.startCheat()
        model.acceptCheatMerchant(text: merchantBText)
        await model.signCheat()
        let cheat = try #require(model.cheat)
        #expect(model.phase == .receipt)
        #expect(model.payment == before.0)
        #expect(model.receipt == before.1)
        #expect(model.merchant == before.2)
        #expect(model.codeStep == before.3)
        #expect(model.notesSigned == before.4)

        // Merchant B's receipt for the cheat note never relabels the original.
        let ackB = try Ack.sign(note: cheat.payment.note, receivedAt: 1_800_000_020, with: merchantB)
        let failed = F.confWire(noteId: cheat.payment.note.noteId, status: 2, errorCode: LokaVaultError.serialUsed)
        model.acceptReturn(text: PaymentTransport.encode(.receipt, Bundles.receipt(note: cheat.payment.note, ack: ackB,
                                                                                    confirmationWire: failed)))
        #expect(model.issue?.kind == .receiptMismatch)
        #expect(model.receipt == before.1)

        // The original still settles from merchant A's receipt.
        let paidConf = F.confWire(noteId: note.noteId, status: 1)
        model.acceptReturn(text: PaymentTransport.encode(.receipt, Bundles.receipt(note: note, ack: ack,
                                                                                    confirmationWire: paidConf)))
        #expect(MoneyStatus(receipt: try #require(model.receipt)) == .paid)
        #expect(model.receipt?.note.noteId == note.noteId)
    }

    @Test("the cheat is bound to this phone's last signed note: none before a payment, closed by New payment")
    func boundToLastPayment() async throws {
        let serials = SerialReservations(url: F.tempURL("s.json"))
        let model = PayModel(allowanceWire: F.allowanceWire(payer: payer.keyHash), signer: payer, serials: serials,
                             deployment: F.deployment, serverPublicKey: F.serverKey,
                             locale: Locale(identifier: "en_US_POSIX"), now: { F.now })
        model.acceptMerchant(text: merchantAText)
        #expect(model.canTryToCheat == false)
        model.startCheat()
        #expect(model.cheatStep == .off)

        model.amountText = "1"
        await model.pay()
        model.startCheat()
        model.acceptCheatMerchant(text: merchantBText)
        #expect(model.cheatStep == .confirm)
        model.newPayment()
        #expect(model.cheatStep == .off)
        #expect(model.cheatOriginal == nil)
        await model.signCheat()
        #expect(model.cheat == nil)

        // The next payment takes serial 1; the cheat signs that one, the last one this phone signed.
        model.amountText = "0.50"
        await model.pay()
        #expect(model.payment?.note.note.serial == 1)
        model.startCheat()
        model.acceptCheatMerchant(text: merchantBText)
        await model.signCheat()
        #expect(model.cheat?.payment.note.note.serial == 1)
        #expect(model.cheat?.payment.note.note.amount == 500_000)
        #expect(try serials.remaining(allowanceId: F.allowanceId) == 254)
    }

    @Test("a cancelled Face ID on the cheat signs nothing and reserves nothing")
    func cheatSignerCancelled() async throws {
        let url = F.tempURL("serials.json")
        let serials = SerialReservations(url: url)
        let signer = SwitchableSigner(inner: payer)
        let model = try await paid(signer: signer, serials: serials, allowanceWire: F.allowanceWire(payer: payer.keyHash))
        let storeBefore = try Data(contentsOf: url)
        model.startCheat()
        model.acceptCheatMerchant(text: merchantBText)
        signer.failing = true
        await model.signCheat()
        #expect(model.cheat == nil)
        #expect(model.cheatStep == .confirm)
        #expect(model.issue?.name == "signing")
        #expect(model.issue?.message.contains("no serial was reserved") == true)
        #expect(try Data(contentsOf: url) == storeBefore)
        #expect(model.phase == .showNote)
    }

    /// Yields to the main actor until `condition` holds (bounded).
    func waitUntil(_ condition: () -> Bool) async throws {
        var turns = 0
        while !condition(), turns < 10_000 {
            await Task.yield()
            turns += 1
        }
        try #require(condition())
    }

    @Test("a superseded attempt's late failure or success never touches the newer attempt (Codex round 1)")
    func supersededAttemptIgnored() async throws {
        for late in [HeldSigner.Outcome.fail, .pass] {
            let serials = SerialReservations(url: F.tempURL("s.json"))
            let signer = HeldSigner(inner: payer, heldPayee: merchantB.keyHash)
            let model = try await paid(signer: signer, serials: serials, allowanceWire: F.allowanceWire(payer: payer.keyHash))
            let firstGate = signer.hold(serial: 0, then: late)
            let secondGate = signer.hold(serial: 1, then: .pass)

            // Attempt 1 (serial 0) waits for the signer; New payment closes the control meanwhile.
            model.startCheat()
            model.acceptCheatMerchant(text: merchantBText)
            let first = Task { await model.signCheat() }
            try await waitUntil { model.cheatStep == .signing }
            model.newPayment()
            #expect(model.cheatStep == .off)

            // Attempt 2 for the next payment (serial 1) is signing when attempt 1's result arrives.
            model.amountText = "0.50"
            await model.pay()
            #expect(model.payment?.note.note.serial == 1)
            model.startCheat()
            model.acceptCheatMerchant(text: merchantBText)
            let second = Task { await model.signCheat() }
            try await waitUntil { model.cheatStep == .signing }
            firstGate.signal()
            await first.value
            #expect(model.cheatStep == .signing, "late \(late)")
            #expect(model.issue == nil, "late \(late)")
            #expect(model.cheat == nil, "late \(late)")

            // Attempt 2 finishes and is shown, bound to the payment on screen.
            secondGate.signal()
            await second.value
            #expect(model.cheatStep == .showNote, "late \(late)")
            #expect(model.issue == nil, "late \(late)")
            #expect(model.cheat?.payment.note.note.serial == 1, "late \(late)")
            #expect(model.cheat?.original == model.payment?.note, "late \(late)")
            #expect(try serials.remaining(allowanceId: F.allowanceId) == 254)
        }
    }

    @Test("a damaged receipt scanned after settlement names the receipt check and claims nothing about the chain (Codex round 1)")
    func damagedReceiptAfterSettlement() async throws {
        let model = try await paid(signer: payer, serials: SerialReservations(url: F.tempURL("s.json")),
                                   allowanceWire: F.allowanceWire(payer: payer.keyHash))
        let note = try #require(model.payment?.note)
        let ack = try Ack.sign(note: note, receivedAt: 1_800_000_010, with: merchantA)
        let settled = Bundles.receipt(note: note, ack: ack, confirmationWire: F.confWire(noteId: note.noteId, status: 1))
        model.acceptReturn(text: PaymentTransport.encode(.receipt, settled))
        let paidReceipt = try #require(model.receipt)
        #expect(MoneyStatus(receipt: paidReceipt) == .paid)

        // The same receipt with one byte of the server's signature changed.
        var damaged = settled
        damaged[damaged.index(before: damaged.endIndex)] ^= 0x01
        model.acceptReturn(text: PaymentTransport.encode(.receipt, damaged))
        let issue = try #require(model.issue)
        #expect(issue.kind == .payment(.badSignature))
        #expect(issue.refusedBy == .receiptCheck)
        let line = try #require(issue.refusedBy?.text)
        #expect(line.contains("the receipt did not verify"))
        #expect(line.contains("says nothing about whether the payment settled"))
        #expect(!line.contains("sent nothing to Solana"))
        #expect(!line.contains("before anything reached Solana"))
        #expect(model.receipt == paidReceipt)

        // Damaged text in the receipt step is the receipt check too; a valid receipt for another
        // note names no layer.
        model.acceptReturn(text: "L1|P|1|X|AAA=")
        #expect(model.issue?.refusedBy == .receiptCheck)
        let other = try F.note(payer: payer, payee: merchantA.keyHash, amount: 1, serial: 9)
        let otherAck = try Ack.sign(note: other, receivedAt: 1, with: merchantA)
        model.acceptReturn(text: PaymentTransport.encode(.receipt, Bundles.receipt(note: other, ack: otherAck,
                                                                                    confirmationWire: nil)))
        #expect(model.issue?.kind == .receiptMismatch)
        #expect(model.issue?.refusedBy == nil)

        // The same check failure on a payment step (a forged merchant B) is this phone's payment check.
        model.startCheat()
        let rogue = Curve25519.Signing.PrivateKey()
        model.acceptCheatMerchant(text: PaymentTransport.encode(.merchant, F.merchantWire(merchant: merchantB.keyHash,
                                                                                           signedBy: rogue)))
        #expect(model.issue?.kind == .payment(.badSignature))
        #expect(model.issue?.refusedBy == .thisPhone)
    }
}

@Suite("Try to cheat screens fit a 390 pt phone width (2.13)")
@MainActor
struct TryToCheatLayoutTests {
    func renderedWidth(_ view: some View) throws -> Int {
        let renderer = ImageRenderer(content: view)
        renderer.proposedSize = ProposedViewSize(width: ReceiveLayoutTests.phoneWidth, height: nil)
        renderer.scale = 1
        let image = try #require(renderer.cgImage)
        #expect(image.height > 0)
        return image.width
    }

    @Test("the preview fixtures for the cheat verify, and every cheat state renders no wider than 390 pt")
    func statesFit() throws {
        let cheat = PreviewFixtures.cheat
        #expect(cheat.payment.note.note.serial == PreviewFixtures.note0.note.serial)
        #expect(cheat.payment.note.note.payeeKeyHash == PreviewFixtures.merchantB.merchantKeyHash)
        _ = try SignedNote.validate(wire: cheat.payment.note.wire, deployment: PreviewFixtures.deployment)

        let settledReceipt = PreviewFixtures.receipt(conf: PreviewFixtures.confSettledWire)
        let pay: [(String, PayModel)] = [
            ("control", .preview(.receipt, merchant: PreviewFixtures.merchant, payment: PreviewFixtures.payment,
                                 receipt: settledReceipt)),
            ("scan merchant B", .preview(.showNote, merchant: PreviewFixtures.merchant, payment: PreviewFixtures.payment,
                                         issue: .cheatSameMerchant, cheatStep: .scanMerchant)),
            ("confirm", .preview(.receipt, merchant: PreviewFixtures.merchant, payment: PreviewFixtures.payment,
                                 receipt: settledReceipt, cheatStep: .confirm, cheatMerchant: PreviewFixtures.merchantB)),
            ("cheat note", .preview(.receipt, merchant: PreviewFixtures.merchant, payment: PreviewFixtures.payment,
                                    receipt: settledReceipt, cheatStep: .showNote, cheat: cheat)),
        ]
        for (name, model) in pay {
            #expect(model.canTryToCheat, "\(name)")
            let width = try renderedWidth(PayView(model: model).screenContent)
            #expect(width <= Int(ReceiveLayoutTests.phoneWidth), "\(name): \(width) pt")
            #expect(width > 300, "\(name) rendered almost nothing: \(width) pt")
        }

        let spent = F.confWire(noteId: PreviewFixtures.note0.noteId, status: 2, errorCode: LokaVaultError.serialUsed)
        let receive = ReceiveModel.preview(.settled, payment: PreviewFixtures.received(),
                                           settlement: PreviewFixtures.settled(conf: spent), unsettled: 0)
        #expect(receive.settlement?.facts(clusterId: 0).statusDetail == "already spent")
        let width = try renderedWidth(ReceiveView(model: receive, connectivity: ConnectivityMonitor()).screenContent)
        #expect(width <= Int(ReceiveLayoutTests.phoneWidth), "failed, already spent: \(width) pt")
        #expect(width > 300)
    }
}
