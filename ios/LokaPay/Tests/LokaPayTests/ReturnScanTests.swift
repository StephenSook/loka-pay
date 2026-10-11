import Foundation
import Testing
@testable import LokaPay

private typealias F = ScreenFixtures

/// The merchant's Paid screen shows the receipt code with the verify link under it (task 3.86).
/// A refused scan of the link must not close the payer's sheet before the receipt code is read.
@Suite("Pay: the receipt scan sheet closes only on a scan that was taken")
@MainActor
struct ReturnScanSheetTests {
    let payer = SoftwareP256Signer()
    let merchant = SoftwareP256Signer()

    /// A payer whose note the merchant has acked: the receipt is on screen, waiting for its CONF.
    func ackedModel() async throws -> (PayModel, SignedNote, Ack) {
        let model = PayModel(allowanceWire: F.allowanceWire(payer: payer.keyHash), signer: payer,
                             serials: SerialReservations(url: F.tempURL("serials.json")),
                             deployment: F.deployment, serverPublicKey: F.serverKey,
                             locale: Locale(identifier: "en_US_POSIX"), now: { F.now })
        model.acceptMerchant(text: PaymentTransport.encode(.merchant, F.merchantWire(merchant: merchant.keyHash)))
        model.amountText = "2"
        await model.pay()
        let note = try #require(model.payment?.note)
        // Before any ack: a refused scan keeps the sheet open, as it always did.
        model.acceptReturn(text: "hello")
        #expect(!PayView.returnScanTaken(model))
        let ack = try Ack.sign(note: note, receivedAt: 1_800_000_010, with: merchant)
        model.acceptReturn(text: PaymentTransport.encode(.ack, ack.wire))
        #expect(model.phase == .receipt)
        #expect(PayView.returnScanTaken(model))
        return (model, note, ack)
    }

    @Test("the verify link, read first on the Paid screen, is refused and leaves the sheet open")
    func linkKeepsSheetOpen() async throws {
        let (model, note, ack) = try await ackedModel()
        let settled = Bundles.receipt(note: note, ack: ack, confirmationWire: F.confWire(noteId: note.noteId, status: 1))
        model.acceptReturn(text: ReceiptLink.verifyURL(receiptWire: settled))
        #expect(model.issue?.kind == .notPaymentCode)
        #expect(model.phase == .receipt)
        #expect(!PayView.returnScanTaken(model))
        #expect(MoneyStatus(receipt: try #require(model.receipt)) == .received)

        // The receipt code, read next, attaches the CONF and closes the sheet.
        model.acceptReturn(text: PaymentTransport.encode(.receipt, settled))
        #expect(PayView.returnScanTaken(model))
        #expect(MoneyStatus(receipt: try #require(model.receipt)) == .paid)
    }

    @Test("both Paid screen codes in one frame: the scanner hands over the receipt and the CONF attaches")
    func bothCodesInOneFrame() async throws {
        let (model, note, ack) = try await ackedModel()
        let settled = Bundles.receipt(note: note, ack: ack, confirmationWire: F.confWire(noteId: note.noteId, status: 1))
        let receiptText = PaymentTransport.encode(.receipt, settled)
        var choice = ScanChoice()
        let picked = choice.report([ReceiptLink.verifyURL(receiptWire: settled), receiptText])
        let reported = try #require(picked)
        #expect(reported == receiptText)
        model.acceptReturn(text: reported)
        #expect(PayView.returnScanTaken(model))
        #expect(MoneyStatus(receipt: try #require(model.receipt)) == .paid)
    }
}
