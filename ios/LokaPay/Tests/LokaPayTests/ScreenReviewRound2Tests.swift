import Foundation
import Observation
import Testing
@testable import LokaPay

private typealias F = ScreenFixtures

/// Review round 2 on the payment screens (3.71). Each suite names the finding it covers.
@Suite("a conflicting spend is shown only for its own allowance (review 2, findings 1 and 4)")
@MainActor
struct ConflictPairingTests {
    let payerA = SoftwareP256Signer()
    let payerB = SoftwareP256Signer()
    let merchant = SoftwareP256Signer()
    let allowanceA: Data
    let allowanceB: Data

    init() {
        allowanceA = F.allowanceWire(payer: payerA.keyHash, id: 77, offlineLimit: 3_000_000)
        allowanceB = F.allowanceWire(payer: payerB.keyHash, id: 88, offlineLimit: 2_000_000)
    }

    func makeModel() -> ReceiveModel {
        ReceiveModel(merchantWire: F.merchantWire(merchant: merchant.keyHash), signer: merchant,
                     ledger: OfflineLedger(url: F.tempURL("ledger.json")), settlementClient: nil,
                     deployment: F.deployment, serverPublicKey: F.serverKey, now: { F.now })
    }

    func text(_ kind: PaymentTransport.Kind, _ wire: Data) -> String { PaymentTransport.encode(kind, wire) }

    /// Payer A pays on serial 4, then signs a second note on serial 4: a proven conflict on 77.
    func conflictOnA(_ model: ReceiveModel) async throws -> AllowanceCertificate {
        await model.accept(text: text(.allowance, allowanceA))
        let first = try F.note(payer: payerA, payee: merchant.keyHash, amount: 1_000_000, serial: 4, allowanceId: 77)
        await model.accept(text: text(.note, first.wire))
        #expect(model.phase == .received)
        model.nextPayment()
        let second = try F.note(payer: payerA, payee: merchant.keyHash, amount: 500_000, serial: 4, allowanceId: 77)
        await model.accept(text: text(.note, second.wire))
        #expect(model.issue?.kind == .payment(.serialSeen))
        #expect(model.conflictAllowanceId == 77)
        #expect(model.conflictingSpend)
        let certA = try #require(model.lastAllowance)
        #expect(model.limitState == .conflictingSpend)
        // One chip, not a status chip and a limit chip saying the same thing.
        #expect(model.limitBadge(for: certA) == .conflictingSpend)
        return certA
    }

    @Test("conflict on A, then B's allowance: B gets no conflict chip")
    func nextPayersAllowance() async throws {
        let model = makeModel()
        let certA = try await conflictOnA(model)
        await model.accept(text: text(.allowance, allowanceB))
        let certB = try #require(model.allowances[88])
        #expect(model.lastAllowance?.allowanceId == 88)
        #expect(model.conflictAllowanceId == nil)
        #expect(!model.conflictingSpend)
        #expect(model.limitState == .withinLimit)
        #expect(model.limitBadge(for: certB) == .limit(.withinLimit))
        #expect(model.limitBadge(for: certA) == nil, "no total was read for A while B is on screen")
        #expect(model.issue == nil)
    }

    @Test("conflict on A, then a note checked against B: B gets no conflict chip")
    func noteCheckedAgainstB() async throws {
        let model = makeModel()
        await model.accept(text: text(.allowance, allowanceB))
        _ = try await conflictOnA(model)
        // 2.50 against B's 2.00 offline limit: refused, and the card now shows B.
        let big = try F.note(payer: payerB, payee: merchant.keyHash, amount: 2_500_000, serial: 0, allowanceId: 88)
        await model.accept(text: text(.note, big.wire))
        #expect(model.issue?.kind == .payment(.offlineLimit))
        #expect(model.lastAllowance?.allowanceId == 88)
        #expect(model.conflictAllowanceId == nil)
        #expect(!model.conflictingSpend)
        #expect(model.limitState == .withinLimit)
    }

    @Test("A's own allowance scanned again keeps A's conflict")
    func sameAllowanceKeepsConflict() async throws {
        let model = makeModel()
        let certA = try await conflictOnA(model)
        await model.accept(text: text(.allowance, allowanceA))
        #expect(model.conflictAllowanceId == 77)
        #expect(model.conflictingSpend)
        #expect(model.limitBadge(for: certA) == .conflictingSpend)
    }

    @Test("the limit chip never carries the conflict state; an unread total gives no chip")
    func badgeKinds() async throws {
        let model = makeModel()
        await model.accept(text: text(.allowance, allowanceA))
        let certA = try #require(model.lastAllowance)
        #expect(model.limitBadge(for: certA) == .limit(.withinLimit))
        let certB = try AllowanceCertificate.verify(wire: allowanceB, deployment: F.deployment, serverPublicKey: F.serverKey)
        #expect(model.limitBadge(for: certB) == nil)
    }
}

@Suite("Bluetooth texts never replace a payment's issue (review 2, finding 2)")
@MainActor
struct InboxIssueTests {
    let payer = SoftwareP256Signer()
    let stranger = SoftwareP256Signer()
    let merchant = SoftwareP256Signer()

    var allowanceText: String { PaymentTransport.encode(.allowance, F.allowanceWire(payer: payer.keyHash)) }
    /// A spend marker is `note wire || ack wire` (PAYMENT-V1 4.9); this screen never reads its bytes.
    var markerText: String { PaymentTransport.encode(.marker, Data(repeating: 7, count: 238 + 153)) }

    func makeModel(inbox: PaymentInbox, replies: [StubReply] = [],
                   ledgerURL: URL = F.tempURL("ledger.json")) -> ReceiveModel {
        let client = replies.isEmpty ? nil : APIFixtures.client(StubTransport(replies), retry: .never)
        return ReceiveModel(merchantWire: F.merchantWire(merchant: merchant.keyHash), signer: merchant,
                            ledger: OfflineLedger(url: ledgerURL), settlementClient: client, deployment: F.deployment,
                            serverPublicKey: F.serverKey, inbox: inbox, now: { F.now })
    }

    /// A note from a payer whose allowance (88) is not on this phone.
    func strayNote() throws -> (SignedNote, String) {
        let note = try F.note(payer: stranger, payee: merchant.keyHash, amount: 400_000, serial: 1, allowanceId: 88)
        return (note, PaymentTransport.encode(.note, note.wire))
    }

    /// Takes one payment over Bluetooth and returns the accepted note.
    func receiveOverBluetooth(_ model: ReceiveModel, _ inbox: PaymentInbox) async throws -> SignedNote {
        let note = try F.note(payer: payer, payee: merchant.keyHash, amount: 1_000_000, serial: 0)
        model.startInbox()
        inbox.deliver(allowanceText)
        inbox.deliver(PaymentTransport.encode(.note, note.wire))
        await model.inboxDrained()
        #expect(model.phase == .received)
        #expect(model.payment?.ack != nil)
        return note
    }

    @Test("a spend marker over Bluetooth is counted, not shown as Stopped: wrong_kind")
    func markerIsCounted() async throws {
        let inbox = PaymentInbox()
        let model = makeModel(inbox: inbox)
        model.startInbox()
        inbox.deliver(markerText)
        await model.inboxDrained()
        #expect(model.issue == nil)
        #expect(model.inboxIgnored == 1)
        #expect(model.inboxLine == "Bluetooth texts for other steps ignored: 1 (such as spend markers).")
        // The same code from the camera is still refused by name: the merchant chose to scan it.
        await model.accept(text: markerText)
        #expect(model.issue?.kind == .wrongKind(expected: [.note, .allowance], got: .marker))
        #expect(model.inboxIgnored == 1)
    }

    @Test("after a 503, a marker and a stray note leave the 503 on screen; the note is checked after Next payment")
    func strayNoteAfter503() async throws {
        let inbox = PaymentInbox()
        let model = makeModel(inbox: inbox, replies: [StubReply(status: 503, body: Data("Sandbox API not deployed yet.".utf8))])
        _ = try await receiveOverBluetooth(model, inbox)
        await model.settle()
        let down = MoneyIssueKind.settlement(.http(status: 503, error: nil, message: nil))
        #expect(model.issue?.kind == down)

        let (stray, strayText) = try strayNote()
        inbox.deliver(markerText)
        inbox.deliver(strayText)
        await model.inboxDrained()
        #expect(model.issue?.kind == down)
        #expect(model.phase == .received)
        #expect(model.inboxIgnored == 1)
        #expect(inbox.held == [strayText])
        #expect(model.inboxWaiting == 1)
        #expect(model.waitingNote == nil)

        // Next payment: the held note is checked now, like any code for the next payer.
        model.nextPayment()
        await model.inboxDrained()
        #expect(inbox.held.isEmpty)
        #expect(model.waitingNote == stray)
        #expect(model.issue?.kind == .allowanceNeeded)
    }

    @Test("a ledger write that failed after a decision stays on screen when a Bluetooth note arrives")
    func ledgerNotUpdatedStays() async throws {
        let url = F.tempURL("ledger.json")
        let note = try F.note(payer: payer, payee: merchant.keyHash, amount: 1_000_000, serial: 0)
        let conf = F.confWire(noteId: note.noteId, status: 1)
        let inbox = PaymentInbox()
        let model = makeModel(inbox: inbox, replies: [
            StubReply(status: 200, body: F.decisionBody(conf: conf, noteId: note.noteId, jsonStatus: "settled")),
        ], ledgerURL: url)
        let accepted = try await receiveOverBluetooth(model, inbox)
        #expect(accepted.noteId == note.noteId)
        try Data("damaged".utf8).write(to: url)
        await model.settle()
        #expect(model.phase == .settled)
        #expect(model.issue?.kind == .ledgerNotUpdated(paid: true))

        let (_, strayText) = try strayNote()
        inbox.deliver(strayText)
        inbox.deliver("not a payment code")
        await model.inboxDrained()
        #expect(model.issue?.kind == .ledgerNotUpdated(paid: true))
        #expect(inbox.held == [strayText, "not a payment code"])
    }

    @Test("a screen that cannot receive leaves Bluetooth codes in the inbox")
    func unavailableScreenDoesNotAttach() {
        let inbox = PaymentInbox()
        let model = ReceiveModel(merchantWire: nil, signer: merchant, ledger: OfflineLedger(url: F.tempURL("ledger.json")),
                                 settlementClient: nil, deployment: F.deployment, serverPublicKey: F.serverKey,
                                 inbox: inbox, now: { F.now })
        #expect(model.phase == .unavailable)
        model.startInbox()
        #expect(!inbox.isAttached)
        // Built once: CryptoKit's Ed25519 signatures are randomized, so a rebuilt wire differs.
        let allowance = allowanceText
        inbox.deliver(allowance)
        #expect(inbox.held == [allowance])
    }
}

@Suite("one note waits for its allowance at a time (review 2, finding 3)")
@MainActor
struct WaitingNoteTests {
    let payerA = SoftwareP256Signer()
    let payerB = SoftwareP256Signer()
    let merchant = SoftwareP256Signer()

    func makeModel() -> ReceiveModel {
        ReceiveModel(merchantWire: F.merchantWire(merchant: merchant.keyHash), signer: merchant,
                     ledger: OfflineLedger(url: F.tempURL("ledger.json")), settlementClient: nil,
                     deployment: F.deployment, serverPublicKey: F.serverKey, now: { F.now })
    }

    func noteText(_ note: SignedNote) -> String { PaymentTransport.encode(.note, note.wire) }

    @Test("a second note before its allowance is refused by name; the first keeps waiting")
    func secondNoteRefused() async throws {
        let model = makeModel()
        let first = try F.note(payer: payerA, payee: merchant.keyHash, amount: 1_000_000, serial: 0, allowanceId: 77)
        let second = try F.note(payer: payerB, payee: merchant.keyHash, amount: 700_000, serial: 0, allowanceId: 88)
        await model.accept(text: noteText(first))
        #expect(model.waitingNote == first)
        await model.accept(text: noteText(second))
        #expect(model.issue?.kind == .otherNoteWaiting)
        #expect(model.waitingNote == first)
        // The waiting note itself again is not another note.
        await model.accept(text: noteText(first))
        #expect(model.issue?.kind == .allowanceNeeded)
        #expect(model.waitingNote == first)
        await model.accept(text: PaymentTransport.encode(.allowance, F.allowanceWire(payer: payerA.keyHash, id: 77)))
        #expect(model.phase == .received)
        #expect(model.payment?.note == first)
    }

    @Test("Clear the waiting note lets another note wait")
    func clearWaitingNote() async throws {
        let model = makeModel()
        let first = try F.note(payer: payerA, payee: merchant.keyHash, amount: 1_000_000, serial: 0, allowanceId: 77)
        let second = try F.note(payer: payerB, payee: merchant.keyHash, amount: 700_000, serial: 0, allowanceId: 88)
        await model.accept(text: noteText(first))
        model.clearWaitingNote()
        #expect(model.waitingNote == nil)
        #expect(model.issue == nil)
        #expect(model.readyStep == .waitingForBoth(bluetooth: false))
        await model.accept(text: noteText(second))
        #expect(model.issue?.kind == .allowanceNeeded)
        #expect(model.waitingNote == second)
    }

    @Test("the refusal is a named next step in plain words")
    func refusalWords() {
        let kind = MoneyIssueKind.otherNoteWaiting
        #expect(kind.name == "other_note_waiting")
        #expect(kind.isStep)
        #expect(kind.message.contains("Clear the waiting note"))
        #expect(!kind.message.contains("_"))
        #expect(!kind.message.contains("\u{2014}") && !kind.message.contains("\u{2013}"))
    }
}

@Suite("wrong-kind messages use the right article (review 2, finding 5)")
struct WrongKindArticleTests {
    @Test("an allowance, a payment note")
    func articles() {
        #expect(MoneyIssueKind.wrongKind(expected: [.note], got: .allowance).message
                == "That is an allowance code. This step needs a payment note code.")
        #expect(MoneyIssueKind.wrongKind(expected: [.allowance], got: .marker).message
                == "That is a spend marker code. This step needs an allowance code.")
        #expect(MoneyIssueKind.wrongKind(expected: [.note, .allowance], got: .ack).message
                == "That is a merchant receipt code. This step needs a payment note or allowance code.")
    }

    @Test("no kind pair reads 'a' before a vowel or 'an' before a consonant")
    func everyPair() throws {
        let wrong = try Regex(#"\ba [aeiou]|\ban [^aeiou ]"#)
        for got in PaymentTransport.Kind.allCases {
            for expected in PaymentTransport.Kind.allCases where expected != got {
                let message = MoneyIssueKind.wrongKind(expected: [expected], got: got).message
                #expect(message.firstMatch(of: wrong) == nil, "\(message)")
            }
        }
    }
}

/// A clock a test can move.
@MainActor
final class TestClock {
    var now = F.now
}

@Suite("the inbox drops stale texts and the Receive screen shows every drop (review 2, finding 6)")
@MainActor
struct InboxDropTests {
    let payer = SoftwareP256Signer()
    let merchant = SoftwareP256Signer()

    @Test("a held text older than the age limit is dropped and counted, never handed over")
    func staleTextsDropped() throws {
        let clock = TestClock()
        let inbox = PaymentInbox(maxAge: 300, now: { clock.now })
        inbox.deliver("old")
        clock.now += 301
        inbox.deliver("new")
        #expect(inbox.held == ["new"])
        #expect(inbox.droppedWhileDetached == 1)

        // A screen that appears after the age limit gets nothing stale.
        let allowance = PaymentTransport.encode(.allowance, F.allowanceWire(payer: payer.keyHash))
        inbox.deliver(allowance)
        clock.now += 301
        let model = ReceiveModel(merchantWire: F.merchantWire(merchant: merchant.keyHash), signer: merchant,
                                 ledger: OfflineLedger(url: F.tempURL("ledger.json")), settlementClient: nil,
                                 deployment: F.deployment, serverPublicKey: F.serverKey, inbox: inbox, now: { F.now })
        model.startInbox()
        #expect(inbox.held.isEmpty)
        #expect(model.lastAllowance == nil)
        #expect(model.inboxDropped == 3)
        #expect(model.inboxLine == "Bluetooth codes dropped before this screen could check them: 3 "
                + "(too many waiting, or held longer than 5 min). Ask the payer to send again.")
    }

    @Test("a text within the age limit is handed over")
    func freshTextKept() async throws {
        let clock = TestClock()
        let inbox = PaymentInbox(maxAge: 300, now: { clock.now })
        let allowance = PaymentTransport.encode(.allowance, F.allowanceWire(payer: payer.keyHash))
        inbox.deliver(allowance)
        clock.now += 299
        let model = ReceiveModel(merchantWire: F.merchantWire(merchant: merchant.keyHash), signer: merchant,
                                 ledger: OfflineLedger(url: F.tempURL("ledger.json")), settlementClient: nil,
                                 deployment: F.deployment, serverPublicKey: F.serverKey, inbox: inbox, now: { F.now })
        model.startInbox()
        await model.inboxDrained()
        #expect(model.lastAllowance?.allowanceId == F.allowanceId)
        #expect(model.inboxDropped == 0)
        #expect(model.inboxLine == nil)
    }

    @Test("a change in the drop count reaches an observer of the Receive model")
    func dropCountIsObserved() {
        final class Flag: @unchecked Sendable { var fired = false }
        let inbox = PaymentInbox()
        let model = ReceiveModel(merchantWire: F.merchantWire(merchant: merchant.keyHash), signer: merchant,
                                 ledger: OfflineLedger(url: F.tempURL("ledger.json")), settlementClient: nil,
                                 deployment: F.deployment, serverPublicKey: F.serverKey, inbox: inbox, now: { F.now })
        let flag = Flag()
        withObservationTracking { _ = model.inboxLine } onChange: { flag.fired = true }
        for i in 0..<PaymentInbox.capacity { inbox.deliver("text \(i)") }
        #expect(!flag.fired, "holding without a drop changes nothing the line shows")
        inbox.deliver("one too many")
        #expect(flag.fired)
        #expect(model.inboxDropped == 1)
    }

    @Test("both counts in one line; nothing when both are zero")
    func lineWording() {
        #expect(ReceiveModel.inboxLine(dropped: 0, ignored: 0, maxAge: 300) == nil)
        #expect(ReceiveModel.inboxLine(dropped: 2, ignored: 5, maxAge: 120)
                == "Bluetooth codes dropped before this screen could check them: 2 (too many waiting, or held longer "
                + "than 2 min). Ask the payer to send again. Bluetooth texts for other steps ignored: 5 (such as spend markers).")
    }
}
