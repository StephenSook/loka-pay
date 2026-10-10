import Foundation
import SwiftUI
import Testing
@testable import LokaPay

private typealias F = ScreenFixtures

@Suite("Stage-safe merchant screens (2.23)")
@MainActor
struct StageSafeScreenTests {
    /// The rendered height in points when offered a 390 pt phone width.
    func height(_ view: some View) throws -> Int {
        let renderer = ImageRenderer(content: view)
        renderer.proposedSize = ProposedViewSize(width: 390, height: nil)
        renderer.scale = 1
        let image = try #require(renderer.cgImage)
        return image.height
    }

    // MARK: (b) the screen stays awake on money screens

    @Test("the screen stays awake while any money screen holds it; the last to go puts back the earlier setting")
    func screenAwakeIsCounted() {
        var system = false
        var writes: [Bool] = []
        let awake = ScreenAwake(read: { system }, write: { system = $0; writes.append($0) })
        awake.hold()
        #expect(system)
        #expect(awake.isHeld)
        // A tab switch where the new screen appears before the old one goes.
        awake.hold()
        awake.release()
        #expect(system, "one money screen is still shown")
        awake.release()
        #expect(!system, "back to the setting found before")
        #expect(!awake.isHeld)
        awake.release()  // an unmatched release changes nothing
        #expect(writes == [true, false])
        // An app that already kept the screen on keeps it on afterwards.
        system = true
        awake.hold()
        awake.release()
        #expect(system)
    }

    // MARK: (c) the holding clock stays until settled, then freezes into the receipt line

    @Test("the holding clock stays on the Received card when signal returns, on every internet path")
    func holdingClockStaysOnline() throws {
        let since = Date().addingTimeInterval(-65)
        for internet in [InternetState.none, .cellular, .wifiOrOther] {
            #expect(ZeroBarsMeter.showsHoldingClock(internet: internet, holdingSince: since), "\(internet)")
            #expect(!ZeroBarsMeter.showsHoldingClock(internet: internet, holdingSince: nil), "\(internet)")
            let with = try height(ZeroBarsMeter(internet: internet, holdingSince: since, bluetoothOn: true))
            let without = try height(ZeroBarsMeter(internet: internet, bluetoothOn: true))
            #expect(with > without, "\(internet): the clock line is drawn (\(with) pt with it, \(without) pt without)")
        }
    }

    @Test("once a verified CONF lands, the clock gives way to the receipt's Held offline line from the signed times")
    func clockFreezesIntoTheReceiptLine() async throws {
        let payer = SoftwareP256Signer()
        let merchant = SoftwareP256Signer()
        let note = try F.note(payer: payer, payee: merchant.keyHash, amount: 1_000_000, serial: 0)
        // The ACK signs F.now (1_800_000_000); the server uploaded the note 65 s later.
        let conf = F.confWire(noteId: note.noteId, status: 1, blockTime: 1_800_000_067, uploadedAt: 1_800_000_065)
        let stub = StubTransport([StubReply(status: 200, body: F.decisionBody(conf: conf, noteId: note.noteId,
                                                                              jsonStatus: "settled"))])
        let model = ReceiveModel(merchantWire: F.merchantWire(merchant: merchant.keyHash), signer: merchant,
                                 ledger: OfflineLedger(url: F.tempURL("ledger.json")),
                                 settlementClient: APIFixtures.client(stub, retry: .never), deployment: F.deployment,
                                 serverPublicKey: F.serverKey, now: { F.now })
        await model.accept(text: PaymentTransport.encode(.allowance, F.allowanceWire(payer: payer.keyHash)))
        await model.accept(text: PaymentTransport.encode(.note, note.wire))
        #expect(model.phase == .received, "the Received card, with its ticking clock")
        await model.settle()
        #expect(model.phase == .settled, "the Received card and its clock are gone")
        let facts = try #require(model.settlement).facts(clusterId: F.deployment.clusterId)
        #expect(facts.timingLines.first == "Held offline 1:05 (server clock minus the merchant phone's clock)")
    }
}
