import CoreImage
import CryptoKit
import Foundation
import Testing
@testable import LokaPay

@Suite("QR codes and scanned text (3.70)")
struct PaymentQRTests {
    /// Reads a QR image back with Core Image's own detector.
    static func read(_ text: String) throws -> CIQRCodeFeature {
        let image = try #require(PaymentQR.ciImage(for: text))
        let scaled = image.transformed(by: CGAffineTransform(scaleX: 8, y: 8))
        let detector = try #require(CIDetector(ofType: CIDetectorTypeQRCode, context: nil,
                                               options: [CIDetectorAccuracy: CIDetectorAccuracyHigh]))
        return try #require(detector.features(in: scaled).compactMap { $0 as? CIQRCodeFeature }.first)
    }

    @Test("the note and receipt round-trip through the transport and read back from a level-M QR code")
    func noteAndReceipt() throws {
        let noteWire = Vectors.hex(Vectors.list("notes")[0]["wireHex"])
        let receiptWire = Vectors.hex(Vectors.list("receipts")[0]["wireHex"])
        #expect(noteWire.count == 238)
        #expect(receiptWire.count == 595)
        let cases: [(PaymentTransport.Kind, Data, Int)] = [(.note, noteWire, 327), (.receipt, receiptWire, 803)]
        for (kind, wire, length) in cases {
            let text = PaymentTransport.encode(kind, wire)
            #expect(text.utf8.count == length)
            let decoded = try #require(try PaymentTransport.decode(text))
            #expect(decoded.kind == kind)
            #expect(decoded.payload == wire)
            let feature = try Self.read(text)
            #expect(feature.messageString == text)
            #expect(feature.symbolDescriptor?.errorCorrectionLevel == .levelM)
            let bitmap = try #require(PaymentQR.cgImage(for: text, scale: 8))
            let modules = try #require(PaymentQR.ciImage(for: text)).extent.width
            #expect(bitmap.width == Int(modules) * 8)
        }
    }

    @Test("the largest allowance code (16 earmarks) and a merchant code also read back at level M")
    func largestAllowance() throws {
        let earmarks = (0..<16).map { Data(SHA256.hash(data: Data([UInt8($0)]))) }
        let wire = ScreenFixtures.allowanceWire(payer: Data(repeating: 1, count: 32), earmarks: earmarks)
        #expect(wire.count == 763)
        let text = PaymentTransport.encode(.allowance, wire)
        let feature = try Self.read(text)
        #expect(feature.messageString == text)
        #expect(feature.symbolDescriptor?.errorCorrectionLevel == .levelM)
        let merchant = PaymentTransport.encode(.merchant, Vectors.hex(Vectors.list("merchants")[1]["wireHex"]))
        #expect(try Self.read(merchant).messageString == merchant)
    }

    @Test("the payer's codes stay at level M: level L saves at most two versions on each")
    func correctionLevelChoice() throws {
        let transport = { (key: String) in try #require(Vectors.list(key)[0]["transport"] as? String) }
        let allowance = try transport("allowances"), note = try transport("notes"), merchant = try transport("merchants")
        #expect(PaymentQR.correctionLevel == "M")
        // Measured from Core Image: (text, version at M, version at L).
        let measured: [(String, Int, Int)] = [(allowance, 14, 12), (note, 13, 12), (merchant, 12, 11)]
        for (text, atM, atL) in measured {
            #expect(PaymentQR.version(for: text) == atM, "\(text.prefix(9)) at M")
            #expect(PaymentQR.version(for: text, correctionLevel: "L") == atL, "\(text.prefix(9)) at L")
            // The decoder agrees with the width-based version.
            #expect(try Self.read(text).symbolDescriptor?.symbolVersion == atM)
        }
        // The rule behind M: if a payer code grows until L would save three or more versions, revisit it.
        for text in [allowance, note] {
            let saved = try #require(PaymentQR.version(for: text)) - #require(PaymentQR.version(for: text, correctionLevel: "L"))
            #expect(saved <= 2, "\(text.prefix(9)) saves \(saved) versions at L")
        }
    }

    @Test("the parser accepts only the kinds the step asks for")
    func kinds() throws {
        let wire = Vectors.hex(Vectors.list("notes")[0]["wireHex"])
        let text = PaymentTransport.encode(.note, wire)
        guard case .success(let ok) = ScanParser.parse(text + "\n", accepting: [.note, .allowance]) else {
            Issue.record("a note with a trailing newline should parse")
            return
        }
        #expect(ok.kind == .note)
        #expect(ok.payload == wire)
        #expect(ScanParser.parse(text, accepting: [.ack, .receipt]).failure == .wrongKind(expected: [.ack, .receipt], got: .note))
        #expect(ScanParser.parse(text, accepting: [.merchant]).failure == .wrongKind(expected: [.merchant], got: .note))
    }

    @Test("the parser rejects malformed, non-payment, other-version and oversized text")
    func rejects() {
        let all = Set(PaymentTransport.Kind.allCases)
        #expect(ScanParser.parse("L1|P|1|N|AAA=", accepting: all).failure == .payment(.base64url))
        #expect(ScanParser.parse("L1|P|1|N|AA+/", accepting: all).failure == .payment(.base64url))
        #expect(ScanParser.parse("L1|P|1|N|AB", accepting: all).failure == .payment(.base64url))
        #expect(ScanParser.parse("L1|P|1|N|A A", accepting: all).failure == .payment(.base64url))
        #expect(ScanParser.parse("hello", accepting: all).failure == .notPaymentCode)
        #expect(ScanParser.parse("https://zerobars.us/verify#r=AAAA", accepting: all).failure == .notPaymentCode)
        #expect(ScanParser.parse("L1|T|abc|aGk", accepting: all).failure == .notPaymentCode)
        #expect(ScanParser.parse("L1|P|2|N|AAAA", accepting: all).failure == .notPaymentCode)
        #expect(ScanParser.parse("L1|P|1|Z|AAAA", accepting: all).failure == .notPaymentCode)
        #expect(ScanParser.parse("L1|P|1|N", accepting: all).failure == .notPaymentCode)
        #expect(ScanParser.parse("", accepting: all).failure == .notPaymentCode)
        let long = "L1|P|1|N|" + String(repeating: "A", count: ScanParser.maxLength)
        #expect(ScanParser.parse(long, accepting: all).failure == .codeTooLong)
    }
}

private extension Result {
    var failure: Failure? {
        if case .failure(let error) = self { return error }
        return nil
    }
}
