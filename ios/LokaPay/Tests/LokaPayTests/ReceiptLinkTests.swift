import CoreImage
import Foundation
import Testing
@testable import LokaPay

/// The verify-on-your-phone code on the Paid screen (task 3.86). The contract is the web side:
/// protocol/PAYMENT-V1.md section 4.9 names the link, web/lib/receipt.ts reads it, and
/// web/e2e/verify.spec.ts opens the vectors file's `verifyUrlFragment` on /verify and expects the
/// settled vector receipt. These tests tie the Swift link to that same fragment.
@Suite("Receipt links for /verify (3.86)")
struct ReceiptLinkTests {
    static let repo = URL(fileURLWithPath: #filePath)
        .deletingLastPathComponent().deletingLastPathComponent().deletingLastPathComponent()
        .deletingLastPathComponent().deletingLastPathComponent()

    static func source(_ path: String) throws -> String {
        try String(contentsOf: repo.appendingPathComponent(path), encoding: .utf8)
    }

    static var settledVector: (wire: Data, transport: String, fragment: String) {
        let r = Vectors.list("receipts")[0]
        return (Vectors.hex(r["wireHex"]), r["transport"] as! String, r["verifyUrlFragment"] as! String)
    }

    /// web/lib/receipt.ts `readFragment` and the link branch of `parseReceiptText`, line for line:
    /// from the first "#", the first "&"-separated part that starts with "r=", then base64url.
    static func readAsVerifyDoes(_ link: String) throws -> Data? {
        guard let hashAt = link.firstIndex(of: "#") else { return nil }
        let body = link[link.index(after: hashAt)...]
        for part in body.split(separator: "&", omittingEmptySubsequences: false) where part.hasPrefix("r=") {
            return try Base64URL.decode(String(part.dropFirst(2)))
        }
        return nil
    }

    @Test("the link for the settled vector receipt is the vectors file's verifyUrlFragment on /verify")
    func matchesVector() throws {
        let v = Self.settledVector
        #expect(v.wire.count == 595)
        let expected = "https://zerobars.us/verify#" + v.fragment
        #expect(ReceiptLink.verifyURL(receiptWire: v.wire) == expected)
        #expect(ReceiptLink.verifyURL(receiptText: v.transport) == expected)
        // 26 characters of page, "#r=", and 794 base64url characters for 595 bytes.
        #expect(expected.utf8.count == 823)
        #expect(v.transport.utf8.count == 803)
    }

    @Test("the spec's link template and the web parser still read the link this way")
    func contractSources() throws {
        let spec = try Self.source("protocol/PAYMENT-V1.md")
        #expect(spec.contains("`" + ReceiptLink.verifyPage + "#r=<base64url>`"))
        let web = try Self.source("web/lib/receipt.ts")
        // The two lines `readAsVerifyDoes` mirrors, and the link branch that calls readFragment.
        #expect(web.contains(#"for (const part of body.split("&")) {"#))
        #expect(web.contains(#"if (part.startsWith("r=")) return part.slice(2);"#))
        #expect(web.contains(##"const hashAt = text.indexOf("#");"##))
        #expect(web.contains("bytes: base64urlDecode(text)"))
    }

    @Test("/verify's reading of the link gives back the exact receipt, which verifies as settled")
    func roundTrip() throws {
        let v = Self.settledVector
        let link = ReceiptLink.verifyURL(receiptWire: v.wire)
        let bytes = try #require(try Self.readAsVerifyDoes(link))
        #expect(bytes == v.wire)
        let receipt = try Receipts.verify(bytes, deployment: Vectors.deployment, serverPublicKey: Vectors.serverKey)
        #expect(receipt.status == .settled)
    }

    @Test("the receipt is in the fragment only, with no character that needs percent-encoding")
    func fragmentOnly() throws {
        let v = Self.settledVector
        let link = ReceiptLink.verifyURL(receiptWire: v.wire)
        let url = try #require(URL(string: link))
        #expect(url.scheme == "https")
        #expect(url.host == "zerobars.us")
        #expect(url.path == "/verify")
        #expect(url.query == nil)
        #expect(url.fragment == v.fragment)
        let payload = link.dropFirst((ReceiptLink.verifyPage + "#r=").count)
        let alphabet = Set("ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_")
        #expect(payload.allSatisfy { alphabet.contains($0) })
        #expect(link.filter { $0 == "#" }.count == 1)
    }

    @Test("only a well-formed receipt code makes a link")
    func onlyReceipts() {
        let note = PaymentTransport.encode(.note, Vectors.hex(Vectors.list("notes")[0]["wireHex"]))
        #expect(ReceiptLink.verifyURL(receiptText: note) == nil)
        #expect(ReceiptLink.verifyURL(receiptText: "L1|P|1|X|AAA=") == nil)
        #expect(ReceiptLink.verifyURL(receiptText: "hello") == nil)
    }

    @Test("the link draws at QR version 23 at level M, the same version as the receipt code, and reads back")
    func qrSize() throws {
        let v = Self.settledVector
        let link = ReceiptLink.verifyURL(receiptWire: v.wire)
        // Measured from Core Image: 823 bytes in byte mode need version 23 at M (capacity 857);
        // the 803-character receipt code the payer's app scans is also version 23.
        #expect(PaymentQR.version(for: link) == 23)
        #expect(PaymentQR.version(for: v.transport) == 23)
        #expect(PaymentQR.version(for: link, correctionLevel: "L") == 20)
        let feature = try PaymentQRTests.read(link)
        #expect(feature.messageString == link)
        #expect(feature.symbolDescriptor?.errorCorrectionLevel == .levelM)
        #expect(feature.symbolDescriptor?.symbolVersion == 23)
    }
}
