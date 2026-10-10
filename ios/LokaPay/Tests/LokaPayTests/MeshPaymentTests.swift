import CryptoKit
import Foundation
import Testing
@testable import LokaPay

private typealias F = ScreenFixtures

/// The app glue's routing over LOKA's mesh (tasks 2.1, 2.2 glue, 2.7), in software. ChatStore calls
/// `LokaPayStore.takeMeshText`, which is `MeshPaymentText.route` plus `MeshPaymentRouter.receive`;
/// these tests cover both, and the Receive and Pay models behind them. The radio, LOKA's encryption
/// and ChatStore's own call site are not here.
@Suite("Payment texts over the LOKA mesh")
@MainActor
struct MeshPaymentTests {
    let payer = SoftwareP256Signer()
    let merchant = SoftwareP256Signer()
    /// Built once: CryptoKit's Ed25519 signatures are randomized, so a rebuilt wire differs.
    let allowanceWire: Data
    static let chatUUID = "0f8fad5b-d9cb-469f-a165-70867728950e"

    init() { allowanceWire = F.allowanceWire(payer: payer.keyHash) }

    func note(serial: UInt8 = 0) throws -> SignedNote {
        try F.note(payer: payer, payee: merchant.keyHash, amount: 1_000_000, serial: serial)
    }

    var allowanceText: String { PaymentTransport.encode(.allowance, allowanceWire) }

    func noteText(_ note: SignedNote) -> String { PaymentTransport.encode(.note, note.wire) }

    func ackText(_ note: SignedNote) throws -> String {
        PaymentTransport.encode(.ack, try Ack.sign(note: note, receivedAt: 1_800_000_000, with: merchant).wire)
    }

    func receiveModel(_ router: MeshPaymentRouter) -> ReceiveModel {
        ReceiveModel(merchantWire: F.merchantWire(merchant: merchant.keyHash), signer: merchant,
                     ledger: OfflineLedger(url: F.tempURL("ledger.json")), settlementClient: nil,
                     deployment: F.deployment, serverPublicKey: F.serverKey, inbox: router.receiveInbox, now: { F.now })
    }

    func payModel(meshSend: @escaping @MainActor (String) -> Void) -> PayModel {
        PayModel(allowanceWire: allowanceWire, signer: payer, serials: SerialReservations(url: F.tempURL("serials.json")),
                 deployment: F.deployment, serverPublicKey: F.serverKey, meshSend: meshSend,
                 locale: Locale(identifier: "en_US_POSIX"), now: { F.now })
    }

    // MARK: Routing decision (what ChatStore's receive branch does)

    @Test("a well-formed allowance or note from a contact goes to Receive, an ack or receipt to Pay")
    func routesPaymentContent() throws {
        let signed = try note()
        let ack = try Ack.sign(note: signed, receivedAt: 1_800_000_000, with: merchant)
        #expect(MeshPaymentText.route(noteText(signed), fromContact: true) == .receive)
        #expect(MeshPaymentText.route(allowanceText, fromContact: true) == .receive)
        #expect(MeshPaymentText.route(PaymentTransport.encode(.ack, ack.wire), fromContact: true) == .pay)
        let pending = Bundles.receipt(note: signed, ack: ack, confirmationWire: nil)
        let settled = Bundles.receipt(note: signed, ack: ack, confirmationWire: F.confWire(noteId: signed.noteId, status: 1))
        #expect(MeshPaymentText.route(PaymentTransport.encode(.receipt, pending), fromContact: true) == .pay)
        #expect(MeshPaymentText.route(PaymentTransport.encode(.receipt, settled), fromContact: true) == .pay)
        let earmarked = F.allowanceWire(payer: payer.keyHash, earmarks: [merchant.keyHash, SoftwareP256Signer().keyHash].sorted { $0.lexicographicallyPrecedes($1) })
        #expect(MeshPaymentText.route(PaymentTransport.encode(.allowance, earmarked), fromContact: true) == .receive)
    }

    @Test("malformed texts and kinds no screen takes over the mesh are dropped before any inbox")
    func dropsMalformedAndUnusedKinds() throws {
        let signed = try note()
        var badSignature = Data(signed.wire)
        badSignature[150] ^= 0xFF
        var badPrefix = Data(signed.wire)
        badPrefix[0] ^= 0xFF
        var shortAllowance = Data(allowanceWire)
        shortAllowance.removeLast()
        let ack = try Ack.sign(note: signed, receivedAt: 1_800_000_000, with: merchant)
        let otherNote = try note(serial: 3)
        let otherAck = try Ack.sign(note: otherNote, receivedAt: 1_800_000_000, with: merchant)
        let mismatched = signed.wire + otherAck.wire + Data([0])
        let unused = [
            PaymentTransport.encode(.marker, Bundles.marker(note: signed, ack: ack)),
            PaymentTransport.encode(.confirmation, F.confWire(noteId: signed.noteId, status: 1)),
            PaymentTransport.encode(.merchant, F.merchantWire(merchant: merchant.keyHash)),
        ]
        let malformed = [
            "L1|P|1|Q|AAAA", "L1|P|1|N", "L1|P|1|N|", "L1|P|1|N|A=A=", "L1|P|1|N|AAAA|extra", "L1|P|1|N|AAAA",
            PaymentTransport.encode(.note, badSignature), PaymentTransport.encode(.note, badPrefix),
            PaymentTransport.encode(.note, signed.wire + Data([0])), PaymentTransport.encode(.allowance, shortAllowance),
            PaymentTransport.encode(.ack, Data(ack.wire.prefix(152))), PaymentTransport.encode(.receipt, mismatched),
            noteText(signed) + "=",
        ]
        for text in unused + malformed {
            #expect(MeshPaymentText.route(text, fromContact: true) == .drop, "\(text.prefix(24))")
        }
        let router = MeshPaymentRouter()
        for (index, text) in (unused + malformed).enumerated() {
            #expect(router.receive(text, from: "contact", fromContact: true, packetID: "junk-\(index)"))
        }
        #expect(router.dropped == unused.count + malformed.count)
        #expect(router.receiveInbox.held.isEmpty)
        #expect(router.payInbox.held.isEmpty)
    }

    @Test("any other L1|P text, and L1|P from a non-contact, is dropped, never chat")
    func dropsOtherPaymentText() {
        for text in ["L1|P|2|N|AAAA", "L1|P|1", "L1|P", "L1|P|", "L1|Pay me back"] {
            #expect(MeshPaymentText.route(text, fromContact: true) == .drop, "\(text)")
        }
        #expect(MeshPaymentText.route("L1|P|1|N|AAAA", fromContact: false) == .drop)
    }

    @Test("games, chat content and plain text are untouched, from contacts and others alike")
    func leavesLokaContentAlone() {
        let loka = ["L1|G|2|I|session", "L1|G|1|quiz", "L1|T|\(Self.chatUUID)|aGk=", "L1|A|\(Self.chatUUID)",
                    "L1|B|\(Self.chatUUID)|1800000000000", "L1|R|\(Self.chatUUID)|eA==", "hello", "", "L1|"]
        for text in loka {
            #expect(MeshPaymentText.route(text, fromContact: true) == .loka, "\(text)")
            #expect(MeshPaymentText.route(text, fromContact: false) == .loka, "\(text)")
        }
    }

    // MARK: Delivery

    @Test("a note from a contact lands in the Receive inbox only; chat and games are not taken")
    func noteReachesReceiveInboxOnly() throws {
        let router = MeshPaymentRouter()
        let text = noteText(try note())
        #expect(router.receive(text, from: "payer-phone", fromContact: true, packetID: "p1"))
        #expect(router.receiveInbox.held == [text])
        #expect(router.payInbox.held.isEmpty)
        #expect(router.dropped == 0)

        #expect(!router.receive("L1|G|2|I|session", from: "payer-phone", fromContact: true, packetID: "p2"))
        #expect(!router.receive("L1|T|\(Self.chatUUID)|aGk=", from: "payer-phone", fromContact: true, packetID: "p3"))
        #expect(!router.receive("hello", from: "payer-phone", fromContact: true, packetID: "p4"))
        #expect(router.receiveInbox.held == [text])
        #expect(router.payInbox.held.isEmpty)
    }

    @Test("LOKA's retry of a packet still waiting is not delivered twice; a resend (new packet) is")
    func retriedPacketDeliveredOnce() throws {
        let router = MeshPaymentRouter()
        let text = noteText(try note())
        #expect(router.receive(text, from: "payer-phone", fromContact: true, packetID: "p1"))
        #expect(router.receive(text, from: "payer-phone", fromContact: true, packetID: "p1"))
        #expect(router.receiveInbox.held == [text])
        #expect(router.repeatsSkipped == 1)
        #expect(router.receive(text, from: "payer-phone", fromContact: true, packetID: "p2"))
        #expect(router.receiveInbox.held == [text, text])
    }

    @Test("a retry or a resend after the inbox dropped the first copy is delivered again")
    func resendAfterDrop() throws {
        var clock = F.now
        let inbox = PaymentInbox(now: { clock })
        let router = MeshPaymentRouter(receiveInbox: inbox, now: { clock })
        let text = noteText(try note())
        router.receive(text, from: "payer-phone", fromContact: true, packetID: "p1")

        // The inbox fills (no Receive screen attached) and drops the oldest text: the note.
        for index in 0..<PaymentInbox.capacity {
            router.receive(allowanceText, from: "busy-contact", fromContact: true, packetID: "fill-\(index)")
        }
        #expect(!inbox.held.contains(text))
        #expect(inbox.droppedWhileDetached == 1)

        // LOKA retries the same packet: delivered again, not skipped as a repeat.
        router.receive(text, from: "payer-phone", fromContact: true, packetID: "p1")
        #expect(inbox.held.last == text)
        #expect(router.repeatsSkipped == 0)
        // While that copy waits, another retry is a repeat.
        router.receive(text, from: "payer-phone", fromContact: true, packetID: "p1")
        #expect(router.repeatsSkipped == 1)

        // Past the inbox's age limit the copy is dropped again, and the payer's resend gets through.
        clock = clock.addingTimeInterval(PaymentInbox.defaultMaxAge + 1)
        router.receive(text, from: "payer-phone", fromContact: true, packetID: "p2")
        #expect(inbox.held == [text])
        // Two capacity drops (the note, then the oldest filler) and 16 age drops.
        #expect(inbox.droppedWhileDetached == 2 + PaymentInbox.capacity)
    }

    @Test("a drop is remembered for as long as its packet is, however many drops follow")
    func dropOutlivesLaterDrops() throws {
        let router = MeshPaymentRouter()
        let text = noteText(try note())
        router.receive(text, from: "payer-phone", fromContact: true, packetID: "p1")
        // 100 more texts while no screen is attached: the note goes first, then 84 fillers.
        for index in 0..<100 {
            router.receive(allowanceText, from: "busy-contact", fromContact: true, packetID: "fill-\(index)")
        }
        #expect(router.receiveInbox.droppedWhileDetached == 85)
        #expect(!router.receiveInbox.held.contains(text))
        // The note's retry still finds its drop recorded, so it is delivered, not taken as a repeat.
        router.receive(text, from: "payer-phone", fromContact: true, packetID: "p1")
        #expect(router.receiveInbox.held.last == text)
        #expect(router.repeatsSkipped == 0)
    }

    @Test("acks and receipts land in the Pay inbox; non-contact and other-version texts are dropped, counted once each")
    func returnsAndDrops() throws {
        let router = MeshPaymentRouter()
        let signed = try note()
        let ack = try ackText(signed)
        #expect(router.receive(ack, from: "merchant-phone", fromContact: true, packetID: "y1"))
        #expect(router.payInbox.held == [ack])
        #expect(router.receiveInbox.held.isEmpty)

        #expect(router.receive(noteText(signed), from: "stranger", fromContact: false, packetID: "s1"))
        #expect(router.receive(noteText(signed), from: "stranger", fromContact: false, packetID: "s1"))
        #expect(router.receive("L1|P|2|N|AAAA", from: "payer-phone", fromContact: true, packetID: "v2"))
        #expect(router.dropped == 2)
        #expect(router.receiveInbox.held.isEmpty)
        #expect(router.payInbox.held == [ack])
    }

    // MARK: Where replies go

    @Test("the same note text from two contacts: each delivered once, and the reply goes to neither")
    func sameTextFromTwoContacts() async throws {
        let router = MeshPaymentRouter()
        let receive = receiveModel(router)
        let signed = try note()
        let text = noteText(signed)
        // Even with the same packet id, two senders are two deliveries.
        router.receive(allowanceText, from: "contact-a", fromContact: true, packetID: "a-1")
        router.receive(text, from: "contact-a", fromContact: true, packetID: "n-1")
        router.receive(text, from: "contact-b", fromContact: true, packetID: "n-1")
        router.receive(text, from: "contact-b", fromContact: true, packetID: "n-1")
        #expect(router.receiveInbox.held == [allowanceText, text, text])
        #expect(router.repeatsSkipped == 1)

        receive.startInbox()
        await receive.inboxDrained()
        #expect(receive.phase == .received)
        let payment = try #require(receive.payment)
        #expect({ if case .delivery = payment.meshOrigin { return true }; return false }())
        let ack = try #require(payment.ackText)
        // Who paid is unclear: the reply is withheld and the code is the way back.
        #expect(router.replyTarget(for: ack, origin: payment.meshOrigin) == .ambiguous)
    }

    @Test("two contacts with two notes: each reply goes to its own sender")
    func twoContactsTwoNotes() async throws {
        let router = MeshPaymentRouter()
        let receive = receiveModel(router)
        receive.startInbox()
        let first = try note(serial: 0), second = try note(serial: 1)
        router.receive(allowanceText, from: "contact-a", fromContact: true, packetID: "a-1")
        router.receive(noteText(first), from: "contact-a", fromContact: true, packetID: "n-1")
        await receive.inboxDrained()
        let paymentA = try #require(receive.payment)
        let ackA = try #require(paymentA.ackText)
        #expect(router.replyTarget(for: ackA, origin: paymentA.meshOrigin) == .peer("contact-a"))

        receive.nextPayment()
        router.receive(noteText(second), from: "contact-b", fromContact: true, packetID: "n-1")
        await receive.inboxDrained()
        let paymentB = try #require(receive.payment)
        #expect(paymentB.note.noteId == second.noteId)
        let ackB = try #require(paymentB.ackText)
        #expect(router.replyTarget(for: ackB, origin: paymentB.meshOrigin) == .peer("contact-b"))
        // B's text never moved A's reply, and a delivery never answers for another note.
        #expect(router.replyTarget(for: ackA, origin: paymentA.meshOrigin) == .peer("contact-a"))
        #expect(router.replyTarget(for: ackA, origin: paymentB.meshOrigin) == .unknown)
    }

    @Test("a note accepted by camera gets no Bluetooth reply, even after a contact sends a copy")
    func cameraNoteNeverRedirected() async throws {
        let router = MeshPaymentRouter()
        let receive = receiveModel(router)
        let signed = try note()
        await receive.accept(text: allowanceText)
        await receive.accept(text: noteText(signed))
        let payment = try #require(receive.payment)
        #expect(payment.meshOrigin == .notOverBluetooth)
        receive.startInbox()
        router.receive(noteText(signed), from: "someone", fromContact: true, packetID: "n-1")
        await receive.inboxDrained()
        let ack = try #require(receive.payment?.ackText)
        #expect(router.replyTarget(for: ack, origin: try #require(receive.payment?.meshOrigin)) == .notOverBluetooth)
    }

    @Test("a later text from another contact never redirects the reply: other notes leave it, a copy withholds it")
    func laterTextsNeverRedirect() async throws {
        let router = MeshPaymentRouter()
        let receive = receiveModel(router)
        receive.startInbox()
        let signed = try note()
        router.receive(allowanceText, from: "contact-a", fromContact: true, packetID: "a-1")
        router.receive(noteText(signed), from: "contact-a", fromContact: true, packetID: "n-1")
        await receive.inboxDrained()
        let payment = try #require(receive.payment)
        let ack = try #require(payment.ackText)
        #expect(router.replyTarget(for: ack, origin: payment.meshOrigin) == .peer("contact-a"))

        // Another note, a reply text and a copy with a broken signature from B change nothing.
        router.receive(noteText(try note(serial: 9)), from: "contact-b", fromContact: true, packetID: "b-1")
        router.receive(ack, from: "contact-b", fromContact: true, packetID: "b-2")
        var broken = Data(signed.wire)
        broken[150] ^= 0xFF
        router.receive(PaymentTransport.encode(.note, broken), from: "contact-b", fromContact: true, packetID: "b-3")
        #expect(router.replyTarget(for: ack, origin: payment.meshOrigin) == .peer("contact-a"))

        // A valid copy of the same note from B: who paid is now unclear, so nothing goes to anyone.
        router.receive(noteText(signed), from: "contact-b", fromContact: true, packetID: "b-4")
        #expect(router.replyTarget(for: ack, origin: payment.meshOrigin) == .ambiguous)
    }

    @Test("a note brought back keeps its first sender; after a relaunch a copy from B never gets the reply")
    func bringBackKeepsFirstOrigin() async throws {
        let ledgerURL = F.tempURL("ledger.json")
        func model(_ router: MeshPaymentRouter) -> ReceiveModel {
            ReceiveModel(merchantWire: F.merchantWire(merchant: merchant.keyHash), signer: merchant,
                         ledger: OfflineLedger(url: ledgerURL), settlementClient: nil, deployment: F.deployment,
                         serverPublicKey: F.serverKey, inbox: router.receiveInbox, now: { F.now })
        }
        let signed = try note()
        let router = MeshPaymentRouter()
        let first = model(router)
        first.startInbox()
        router.receive(allowanceText, from: "contact-a", fromContact: true, packetID: "a-1")
        router.receive(noteText(signed), from: "contact-a", fromContact: true, packetID: "n-1")
        await first.inboxDrained()
        let ack = try #require(first.payment?.ackText)
        #expect(router.replyTarget(for: ack, origin: try #require(first.payment?.meshOrigin)) == .peer("contact-a"))

        // Same session: A resends after Next payment; the note comes back bound to A's first delivery.
        first.nextPayment()
        router.receive(noteText(signed), from: "contact-a", fromContact: true, packetID: "n-2")
        await first.inboxDrained()
        #expect(first.payment?.note.noteId == signed.noteId)
        #expect(router.replyTarget(for: ack, origin: try #require(first.payment?.meshOrigin)) == .peer("contact-a"))
        first.stopInbox()

        // Relaunch: a new screen and a new router over the same ledger. B sends the identical note.
        let relaunched = MeshPaymentRouter()
        let second = model(relaunched)
        second.startInbox()
        relaunched.receive(noteText(signed), from: "contact-b", fromContact: true, packetID: "n-1")
        await second.inboxDrained()
        let back = try #require(second.payment)
        #expect(back.note.noteId == signed.noteId)
        #expect(back.meshOrigin == .unknown)
        let backAck = try #require(back.ackText)
        #expect(relaunched.replyTarget(for: backAck, origin: back.meshOrigin) == .unknown)
        #expect(relaunched.replyTarget(for: backAck, origin: back.meshOrigin) != .peer("contact-b"))
    }

    @Test("note ids are read from N, Y and X texts, and from nothing else")
    func noteIds() throws {
        let signed = try note()
        let ack = try Ack.sign(note: signed, receivedAt: 1_800_000_000, with: merchant)
        #expect(MeshPaymentText.noteId(of: noteText(signed)) == signed.noteId)
        #expect(MeshPaymentText.noteId(of: PaymentTransport.encode(.ack, ack.wire)) == signed.noteId)
        let pending = Bundles.receipt(note: signed, ack: ack, confirmationWire: nil)
        #expect(MeshPaymentText.noteId(of: PaymentTransport.encode(.receipt, pending)) == signed.noteId)
        #expect(MeshPaymentText.noteId(of: allowanceText) == nil)
        #expect(MeshPaymentText.noteId(of: "L1|P|1|N|AAAA") == nil)
        #expect(MeshPaymentText.noteId(of: "hello") == nil)
    }

    // MARK: The payer's sends

    @Test("the sender's packets are released only by an ack that verifies for its note")
    func answeredOnlyByAVerifiedAck() throws {
        let router = MeshPaymentRouter()
        let signed = try note()
        router.sent(noteText: noteText(signed), packetIDs: ["allowance-packet", "note-packet"])

        // An ack signed by a key that is not the payee's proves nothing.
        let stranger = SoftwareP256Signer()
        let body = Ack.encode(noteId: signed.noteId, receivedAt: 1_800_000_000)
        let strangerSignature = try stranger.sign(body)
        let forged = body + strangerSignature + stranger.compressedPublicKey
        #expect(router.answered(by: PaymentTransport.encode(.ack, forged)).isEmpty)
        #expect(router.answered(by: "hello").isEmpty)

        let ack = try ackText(signed)
        #expect(router.answered(by: ack) == ["allowance-packet", "note-packet"])
        // Released once.
        #expect(router.answered(by: ack).isEmpty)

        // A receipt carries the ack too.
        let next = try note(serial: 1)
        router.sent(noteText: noteText(next), packetIDs: ["n2"])
        let nextAck = try Ack.sign(note: next, receivedAt: 1_800_000_001, with: merchant)
        let receipt = Bundles.receipt(note: next, ack: nextAck, confirmationWire: nil)
        #expect(router.answered(by: PaymentTransport.encode(.receipt, receipt)) == ["n2"])
    }

    @Test("resends keep a bounded, live list of packet ids per payment")
    func packetIdsStayBounded() throws {
        var clock = F.now
        let router = MeshPaymentRouter(now: { clock })
        let signed = try note()
        let text = noteText(signed)
        for index in 0..<40 { router.sent(noteText: text, packetIDs: ["a-\(index)", "n-\(index)"]) }
        let ack = try ackText(signed)
        #expect(router.answered(by: ack) == (32..<40).flatMap { ["a-\($0)", "n-\($0)"] })

        // Ids older than the packet lifetime are forgotten; a payment with none left is gone.
        router.sent(noteText: text, packetIDs: ["old-a", "old-n"])
        clock = clock.addingTimeInterval(MeshPaymentRouter.repeatWindow + 1)
        router.sent(noteText: text, packetIDs: ["new-a", "new-n"])
        #expect(router.answered(by: ack) == ["new-a", "new-n"])
        router.sent(noteText: text, packetIDs: ["late-a"])
        clock = clock.addingTimeInterval(MeshPaymentRouter.repeatWindow + 1)
        #expect(router.answered(by: ack).isEmpty)
    }

    @Test("the pick is for one payment: after New payment nothing old is sent and the payer picks again")
    func stalePickAfterNewPayment() async throws {
        let router = MeshPaymentRouter()
        let pay = payModel(meshSend: { router.queueOutgoing($0) })
        pay.acceptMerchant(text: PaymentTransport.encode(.merchant, F.merchantWire(merchant: merchant.keyHash)))
        pay.amountText = "1.00"
        await pay.pay()
        let first = try #require(pay.payment)
        pay.sendOverBluetooth()
        #expect(router.outgoing == first.transportTexts)
        #expect(router.takeOutgoing(for: "merchant-a") == first.transportTexts)
        #expect(router.pick == MeshPick(noteId: first.note.noteId, peer: "merchant-a"))

        pay.newPayment()
        pay.amountText = "2.00"
        await pay.pay()
        let second = try #require(pay.payment)
        #expect(second.note.noteId != first.note.noteId)
        // A double tap hands the texts over twice; only one copy of this payment's texts waits.
        pay.sendOverBluetooth()
        pay.sendOverBluetooth()
        #expect(router.pick == nil)
        #expect(router.outgoing == second.transportTexts)
        #expect(router.outgoingNoteId == second.note.noteId)
        #expect(!router.outgoing.contains(first.noteText))
        #expect(router.takeOutgoing(for: "merchant-b") == second.transportTexts)
        #expect(router.pick == MeshPick(noteId: second.note.noteId, peer: "merchant-b"))
        // Nothing waits, so nothing more can be sent to anyone.
        #expect(router.takeOutgoing(for: "merchant-a").isEmpty)
    }

    @Test("each merchant reply goes once per presentation of its payment, ack first")
    func repliesDue() {
        let y1 = MeshReturns.replyKey("Y1", presentation: 1)
        #expect(MeshReturns.repliesDue(ack: nil, receipt: nil, presentation: 1, sent: []).isEmpty)
        #expect(MeshReturns.repliesDue(ack: "Y1", receipt: nil, presentation: 1, sent: []) == ["Y1"])
        #expect(MeshReturns.repliesDue(ack: "Y1", receipt: nil, presentation: 1, sent: [y1]).isEmpty)
        #expect(MeshReturns.repliesDue(ack: "Y1", receipt: "X1", presentation: 1, sent: [y1]) == ["X1"])
        #expect(MeshReturns.repliesDue(ack: "Y1", receipt: "X1", presentation: 1, sent: []) == ["Y1", "X1"])
        // The same ack bytes on a new presentation (a resend brought the payment back) go again.
        #expect(MeshReturns.repliesDue(ack: "Y1", receipt: nil, presentation: 2, sent: [y1]) == ["Y1"])
    }

    @Test("a reply that failed for a passing reason is retried on a short, bounded timer")
    func replyRetryIsBounded() {
        #expect(MeshReturns.replyRetryDelay(attempt: 0) == 5)
        #expect(MeshReturns.replyRetryDelay(attempt: 1) == 20)
        #expect(MeshReturns.replyRetryDelay(attempt: 2) == 60)
        #expect(MeshReturns.replyRetryDelay(attempt: 3) == nil)
        #expect(MeshReturns.replyRetryDelay(attempt: -1) == nil)
    }

    @Test("a resend that brings a payment back re-offers its stored ack to the first sender")
    func resendReoffersStoredAck() async throws {
        let router = MeshPaymentRouter()
        let receive = receiveModel(router)
        receive.startInbox()
        let signed = try note()
        router.receive(allowanceText, from: "contact-a", fromContact: true, packetID: "a-1")
        router.receive(noteText(signed), from: "contact-a", fromContact: true, packetID: "n-1")
        await receive.inboxDrained()
        let ack = try #require(receive.payment?.ackText)
        let first = receive.paymentPresentation
        let sent = [MeshReturns.replyKey(ack, presentation: first)]
        #expect(MeshReturns.repliesDue(ack: ack, receipt: nil, presentation: first, sent: sent).isEmpty)

        // The ack expired undelivered; the merchant tapped Next payment and the payer resent.
        receive.nextPayment()
        router.receive(noteText(signed), from: "contact-a", fromContact: true, packetID: "n-2")
        await receive.inboxDrained()
        #expect(receive.payment?.ackText == ack)
        #expect(receive.paymentPresentation == first + 1)
        #expect(MeshReturns.repliesDue(ack: receive.payment?.ackText, receipt: nil,
                                       presentation: receive.paymentPresentation, sent: sent) == [ack])
        #expect(router.replyTarget(for: ack, origin: try #require(receive.payment?.meshOrigin)) == .peer("contact-a"))
    }

    // MARK: One Bluetooth hop, both ways, in software

    @Test("payer to merchant and back: the note is received, the ack returns to the payer, Pay shows it")
    func roundTrip() async throws {
        let payerRouter = MeshPaymentRouter(), merchantRouter = MeshPaymentRouter()
        let pay = payModel(meshSend: { payerRouter.queueOutgoing($0) })
        let merchantWire = F.merchantWire(merchant: merchant.keyHash)
        let receive = receiveModel(merchantRouter)
        MeshReturns.attach(payerRouter.payInbox, to: pay)
        receive.startInbox()

        pay.acceptMerchant(text: PaymentTransport.encode(.merchant, merchantWire))
        pay.amountText = "1.00"
        await pay.pay()
        #expect(pay.phase == .showNote)
        #expect(pay.canSendOverBluetooth)
        pay.sendOverBluetooth()
        let payment = try #require(pay.payment)
        let wire = payerRouter.takeOutgoing(for: "merchant-contact")
        #expect(wire == [payment.allowanceText, payment.noteText])
        payerRouter.sent(noteText: payment.noteText, packetIDs: ["a-packet", "n-packet"])

        // The merchant's phone decrypts both texts from the payer's contact id.
        for (index, text) in wire.enumerated() {
            #expect(merchantRouter.receive(text, from: "payer-contact", fromContact: true, packetID: "out-\(index)"))
        }
        await receive.inboxDrained()
        #expect(receive.phase == .received)
        let origin = try #require(receive.payment?.meshOrigin)
        let ackText = try #require(receive.payment?.ackText)

        // Receive's ack goes back to the contact the accepted note came from, and to nobody else.
        #expect(merchantRouter.replyTarget(for: ackText, origin: origin) == .peer("payer-contact"))
        #expect(payerRouter.receive(ackText, from: "merchant-contact", fromContact: true, packetID: "back-1"))
        #expect(payerRouter.answered(by: ackText) == ["a-packet", "n-packet"])
        #expect(pay.phase == .receipt)
        #expect(pay.issue == nil)
        #expect(pay.receipt?.note.noteId == payment.note.noteId)
        #expect(pay.receipt?.status == .pending)

        // Later the receipt with the CONF comes back the same way and Pay shows the chain's decision.
        let ack = try #require(receive.payment?.ack)
        let receiptText = PaymentTransport.encode(.receipt, Bundles.receipt(
            note: payment.note, ack: ack, confirmationWire: F.confWire(noteId: payment.note.noteId, status: 1)))
        #expect(merchantRouter.replyTarget(for: receiptText, origin: origin) == .peer("payer-contact"))
        payerRouter.receive(receiptText, from: "merchant-contact", fromContact: true, packetID: "back-2")
        #expect(pay.receipt?.status == .settled)
    }

    @Test("an ack for another note reaching Pay over Bluetooth is not this payment's and raises no error")
    func strayReturnIgnored() async throws {
        let router = MeshPaymentRouter()
        let pay = payModel(meshSend: { _ in })
        MeshReturns.attach(router.payInbox, to: pay)
        pay.acceptMerchant(text: PaymentTransport.encode(.merchant, F.merchantWire(merchant: merchant.keyHash)))
        pay.amountText = "1.00"
        await pay.pay()
        #expect(pay.phase == .showNote)

        router.receive(try ackText(try note(serial: 200)), from: "merchant-contact", fromContact: true, packetID: "y-stray")
        #expect(pay.phase == .showNote)
        #expect(pay.issue == nil)
        #expect(pay.receipt == nil)
        // Taken, not held: nothing waits to surprise a later payment.
        #expect(router.payInbox.held.isEmpty)
    }
}
