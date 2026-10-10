import CryptoKit
import Foundation
import Testing
@testable import LokaPay

private typealias F = ScreenFixtures

/// The app glue's routing over LOKA's mesh (tasks 2.1, 2.2 glue, 2.7), in software. ChatStore calls
/// `LokaPayStore.takeMeshText`, which is `MeshPaymentText.route` plus `MeshPaymentRouter.receive`;
/// these tests cover both. The radio, LOKA's encryption and ChatStore's own call site are not here.
@Suite("Payment texts over the LOKA mesh")
@MainActor
struct MeshPaymentTests {
    let payer = SoftwareP256Signer()
    let merchant = SoftwareP256Signer()
    static let chatUUID = "0f8fad5b-d9cb-469f-a165-70867728950e"

    func note(serial: UInt8 = 0) throws -> SignedNote {
        try F.note(payer: payer, payee: merchant.keyHash, amount: 1_000_000, serial: serial)
    }

    // MARK: Routing decision (what ChatStore's receive branch does)

    @Test("exactly L1|P|1| from a contact is payment content; Y and X go to Pay, the rest to Receive")
    func routesPaymentContent() throws {
        let noteText = PaymentTransport.encode(.note, try note().wire)
        #expect(MeshPaymentText.route(noteText, fromContact: true) == .receive)
        #expect(MeshPaymentText.route("L1|P|1|A|AAAA", fromContact: true) == .receive)
        #expect(MeshPaymentText.route("L1|P|1|M|AAAA", fromContact: true) == .receive)
        #expect(MeshPaymentText.route("L1|P|1|Q|AAAA", fromContact: true) == .receive)
        #expect(MeshPaymentText.route("L1|P|1|Y|AAAA", fromContact: true) == .pay)
        #expect(MeshPaymentText.route("L1|P|1|X|AAAA", fromContact: true) == .pay)
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

    // MARK: Router

    @Test("a note from a contact lands in the Receive inbox only; chat and games are not taken")
    func noteReachesReceiveInboxOnly() throws {
        let router = MeshPaymentRouter()
        let text = PaymentTransport.encode(.note, try note().wire)
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

    @Test("the mesh's retried delivery of one packet reaches the screens once")
    func retriedPacketDeliveredOnce() throws {
        let router = MeshPaymentRouter()
        let text = PaymentTransport.encode(.note, try note().wire)
        #expect(router.receive(text, from: "payer-phone", fromContact: true, packetID: "p1"))
        #expect(router.receive(text, from: "payer-phone", fromContact: true, packetID: "p1"))
        #expect(router.receiveInbox.held == [text])
        // A second packet with the same text is a second send (the payer tapped again): Receive's own
        // rule treats the same note as one payment.
        #expect(router.receive(text, from: "payer-phone", fromContact: true, packetID: "p2"))
        #expect(router.receiveInbox.held == [text, text])
    }

    @Test("acks and receipts land in the Pay inbox; non-contact and other-version texts are dropped and counted")
    func returnsAndDrops() throws {
        let router = MeshPaymentRouter()
        let signed = try note()
        let ackText = PaymentTransport.encode(.ack, try Ack.sign(note: signed, receivedAt: 1_800_000_000, with: merchant).wire)
        #expect(router.receive(ackText, from: "merchant-phone", fromContact: true, packetID: "y1"))
        #expect(router.payInbox.held == [ackText])
        #expect(router.receiveInbox.held.isEmpty)

        #expect(router.receive(PaymentTransport.encode(.note, signed.wire), from: "stranger", fromContact: false, packetID: "s1"))
        #expect(router.receive("L1|P|2|N|AAAA", from: "payer-phone", fromContact: true, packetID: "v2"))
        #expect(router.dropped == 2)
        #expect(router.receiveInbox.held.isEmpty)
        #expect(router.payInbox.held == [ackText])
    }

    @Test("replies go to the peer the note arrived from, and only for notes that came over the mesh")
    func replyPeerFollowsTheNote() throws {
        let router = MeshPaymentRouter()
        let first = try note(serial: 0), other = try note(serial: 1)
        router.receive(PaymentTransport.encode(.note, first.wire), from: "payer-phone", fromContact: true, packetID: "n1")
        // A later copy of the same note from someone else never redirects the replies.
        router.receive(PaymentTransport.encode(.note, first.wire), from: "someone-else", fromContact: true, packetID: "n2")

        let ack = try Ack.sign(note: first, receivedAt: 1_800_000_000, with: merchant)
        let ackText = PaymentTransport.encode(.ack, ack.wire)
        #expect(router.replyPeer(for: ackText) == "payer-phone")
        let conf = F.confWire(noteId: first.noteId, status: 1)
        let receiptText = PaymentTransport.encode(.receipt, Bundles.receipt(note: first, ack: ack, confirmationWire: conf))
        #expect(router.replyPeer(for: receiptText) == "payer-phone")

        // The other note came by camera: no peer, so the glue sends nothing for it.
        let otherAck = PaymentTransport.encode(.ack, try Ack.sign(note: other, receivedAt: 1_800_000_000, with: merchant).wire)
        #expect(router.replyPeer(for: otherAck) == nil)
        // Only acks and receipts are replies.
        #expect(router.replyPeer(for: PaymentTransport.encode(.note, first.wire)) == nil)
    }

    @Test("note ids are read from N, Y and X texts, and from nothing else")
    func noteIds() throws {
        let signed = try note()
        let ack = try Ack.sign(note: signed, receivedAt: 1_800_000_000, with: merchant)
        #expect(MeshPaymentText.noteId(of: PaymentTransport.encode(.note, signed.wire)) == signed.noteId)
        #expect(MeshPaymentText.noteId(of: PaymentTransport.encode(.ack, ack.wire)) == signed.noteId)
        let pending = Bundles.receipt(note: signed, ack: ack, confirmationWire: nil)
        #expect(MeshPaymentText.noteId(of: PaymentTransport.encode(.receipt, pending)) == signed.noteId)
        #expect(MeshPaymentText.noteId(of: PaymentTransport.encode(.allowance, F.allowanceWire(payer: payer.keyHash))) == nil)
        #expect(MeshPaymentText.noteId(of: "L1|P|1|N|AAAA") == nil)
        #expect(MeshPaymentText.noteId(of: "hello") == nil)
    }

    @Test("the sender's packets are released only by an ack that verifies for its note")
    func answeredOnlyByAVerifiedAck() throws {
        let router = MeshPaymentRouter()
        let signed = try note()
        router.sent(noteText: PaymentTransport.encode(.note, signed.wire), packetIDs: ["allowance-packet", "note-packet"])

        // An ack signed by a key that is not the payee's proves nothing.
        let stranger = SoftwareP256Signer()
        let body = Ack.encode(noteId: signed.noteId, receivedAt: 1_800_000_000)
        let strangerSignature = try stranger.sign(body)
        let forged = body + strangerSignature + stranger.compressedPublicKey
        #expect(router.answered(by: PaymentTransport.encode(.ack, forged)).isEmpty)
        #expect(router.answered(by: "hello").isEmpty)

        let ack = try Ack.sign(note: signed, receivedAt: 1_800_000_000, with: merchant)
        #expect(router.answered(by: PaymentTransport.encode(.ack, ack.wire)) == ["allowance-packet", "note-packet"])
        // Released once.
        #expect(router.answered(by: PaymentTransport.encode(.ack, ack.wire)).isEmpty)

        // A receipt carries the ack too.
        let next = try note(serial: 1)
        router.sent(noteText: PaymentTransport.encode(.note, next.wire), packetIDs: ["n2"])
        let nextAck = try Ack.sign(note: next, receivedAt: 1_800_000_001, with: merchant)
        let receipt = Bundles.receipt(note: next, ack: nextAck, confirmationWire: nil)
        #expect(router.answered(by: PaymentTransport.encode(.receipt, receipt)) == ["n2"])
    }

    @Test("each merchant reply goes once, ack first")
    func repliesDue() {
        #expect(MeshReturns.repliesDue(ack: nil, receipt: nil, sent: []).isEmpty)
        #expect(MeshReturns.repliesDue(ack: "Y1", receipt: nil, sent: []) == ["Y1"])
        #expect(MeshReturns.repliesDue(ack: "Y1", receipt: nil, sent: ["Y1"]).isEmpty)
        #expect(MeshReturns.repliesDue(ack: "Y1", receipt: "X1", sent: ["Y1"]) == ["X1"])
        #expect(MeshReturns.repliesDue(ack: "Y1", receipt: "X1", sent: []) == ["Y1", "X1"])
    }

    // MARK: One Bluetooth hop, both ways, in software

    @Test("payer to merchant and back: the note is received, the ack returns to the payer, Pay shows it")
    func roundTrip() async throws {
        let payerRouter = MeshPaymentRouter(), merchantRouter = MeshPaymentRouter()
        var wire: [String] = []
        let pay = PayModel(allowanceWire: F.allowanceWire(payer: payer.keyHash), signer: payer,
                           serials: SerialReservations(url: F.tempURL("serials.json")), deployment: F.deployment,
                           serverPublicKey: F.serverKey, meshSend: { wire.append($0) },
                           locale: Locale(identifier: "en_US_POSIX"), now: { F.now })
        let merchantWire = F.merchantWire(merchant: merchant.keyHash)
        let receive = ReceiveModel(merchantWire: merchantWire, signer: merchant,
                                   ledger: OfflineLedger(url: F.tempURL("ledger.json")), settlementClient: nil,
                                   deployment: F.deployment, serverPublicKey: F.serverKey,
                                   inbox: merchantRouter.receiveInbox, now: { F.now })
        MeshReturns.attach(payerRouter.payInbox, to: pay)
        receive.startInbox()

        pay.acceptMerchant(text: PaymentTransport.encode(.merchant, merchantWire))
        pay.amountText = "1.00"
        await pay.pay()
        #expect(pay.phase == .showNote)
        #expect(pay.canSendOverBluetooth)
        pay.sendOverBluetooth()
        let payment = try #require(pay.payment)
        #expect(wire == [payment.allowanceText, payment.noteText])
        payerRouter.sent(noteText: payment.noteText, packetIDs: ["a-packet", "n-packet"])

        // The merchant's phone decrypts both texts from the payer's contact id.
        for (index, text) in wire.enumerated() {
            #expect(merchantRouter.receive(text, from: "payer-contact", fromContact: true, packetID: "out-\(index)"))
        }
        await receive.inboxDrained()
        #expect(receive.phase == .received)
        let ackText = try #require(receive.payment?.ackText)

        // Receive's ack goes back to the contact the note came from, and to nobody else.
        #expect(merchantRouter.replyPeer(for: ackText) == "payer-contact")
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
        #expect(merchantRouter.replyPeer(for: receiptText) == "payer-contact")
        payerRouter.receive(receiptText, from: "merchant-contact", fromContact: true, packetID: "back-2")
        #expect(pay.receipt?.status == .settled)
    }

    @Test("an ack for another note reaching Pay over Bluetooth is not this payment's and raises no error")
    func strayReturnIgnored() async throws {
        let router = MeshPaymentRouter()
        let pay = PayModel(allowanceWire: F.allowanceWire(payer: payer.keyHash), signer: payer,
                           serials: SerialReservations(url: F.tempURL("serials.json")), deployment: F.deployment,
                           serverPublicKey: F.serverKey, meshSend: { _ in },
                           locale: Locale(identifier: "en_US_POSIX"), now: { F.now })
        MeshReturns.attach(router.payInbox, to: pay)
        pay.acceptMerchant(text: PaymentTransport.encode(.merchant, F.merchantWire(merchant: merchant.keyHash)))
        pay.amountText = "1.00"
        await pay.pay()
        #expect(pay.phase == .showNote)

        let stray = try note(serial: 200)
        let strayAck = PaymentTransport.encode(.ack, try Ack.sign(note: stray, receivedAt: 1_800_000_000, with: merchant).wire)
        router.receive(strayAck, from: "merchant-contact", fromContact: true, packetID: "y-stray")
        #expect(pay.phase == .showNote)
        #expect(pay.issue == nil)
        #expect(pay.receipt == nil)
        // Taken, not held: nothing waits to surprise a later payment.
        #expect(router.payInbox.held.isEmpty)
    }
}
