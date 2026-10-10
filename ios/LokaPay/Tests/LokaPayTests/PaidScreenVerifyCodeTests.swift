import CoreImage
import Foundation
import SwiftUI
import Testing
@testable import LokaPay

/// The Paid screen's verify-on-your-phone code (task 3.86). The codes are read back from a 3x
/// rendering of the screen, the pixel density of the phones it runs on.
@Suite("The Paid screen shows the verify-link code (3.86)")
@MainActor
struct PaidScreenVerifyCodeTests {
    func codes(on model: ReceiveModel) throws -> Set<String> {
        let screen = ReceiveView(model: model, connectivity: ConnectivityMonitor(), bluetoothOn: true).screenContent
        let renderer = ImageRenderer(content: screen)
        renderer.proposedSize = ProposedViewSize(width: ReceiveLayoutTests.phoneWidth, height: nil)
        renderer.scale = 3
        let image = try #require(renderer.cgImage)
        let detector = try #require(CIDetector(ofType: CIDetectorTypeQRCode, context: nil,
                                               options: [CIDetectorAccuracy: CIDetectorAccuracyHigh]))
        return Set(detector.features(in: CIImage(cgImage: image)).compactMap { ($0 as? CIQRCodeFeature)?.messageString })
    }

    @Test("Paid and Failed settlements link the same bytes as the receipt code beside it")
    func settledPaymentLink() throws {
        for conf in [PreviewFixtures.confSettledWire, PreviewFixtures.confFailedWire] {
            let settlement = PreviewFixtures.settled(conf: conf)
            let link = try #require(settlement.verifyLink)
            let fromCode = try #require(try PaymentTransport.decode(settlement.receiptText)).payload
            #expect(try ReceiptLinkTests.readAsVerifyDoes(link) == fromCode)
        }
        let paid = try #require(PreviewFixtures.settled(conf: PreviewFixtures.confSettledWire).verifyLink)
        #expect(paid == "https://zerobars.us/verify#" + ReceiptLinkTests.settledVector.fragment)
    }

    @Test("Paid and Failed: the receipt code and the verify link are both on screen and readable")
    func settledScreens() throws {
        for conf in [PreviewFixtures.confSettledWire, PreviewFixtures.confFailedWire] {
            let settlement = PreviewFixtures.settled(conf: conf)
            let model = ReceiveModel.preview(.settled, payment: PreviewFixtures.received(), settlement: settlement,
                                             unsettled: 0)
            let link = try #require(settlement.verifyLink)
            #expect(try codes(on: model) == [settlement.receiptText, link])
        }
    }

    @Test("Received (not settled yet) shows no verify link")
    func receivedHasNone() throws {
        let model = ReceiveModel.preview(.received, payment: PreviewFixtures.received(), unsettled: 1_000_000)
        let found = try codes(on: model)
        #expect(!found.contains { $0.hasPrefix(ReceiptLink.verifyPage) })
        #expect(!found.isEmpty, "the ack code is drawn, so the detector ran on a real screen")
    }
}
