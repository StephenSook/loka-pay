import Foundation

/// The receipt link of PAYMENT-V1 section 4.9: `https://zerobars.us/verify#r=<base64url>` (task 3.86).
/// The receipt bytes ride in the URL fragment, which a browser never sends to a server, so the
/// receipt never reaches a server log. /verify reads it with `readFragment` and `parseReceiptText`
/// (web/lib/receipt.ts): the text after "r=" up to the next "&", decoded as canonical unpadded
/// base64url. The base64url alphabet has no "&", "#" or "%", so the link needs no percent-encoding
/// and the fragment reaches the page byte for byte.
///
/// This is also the smallest link /verify accepts for a receipt: the transport form
/// (`L1|P|1|X|...`) is 9 characters longer, and hex is half again as long as base64url.
public enum ReceiptLink {
    /// The page, as the spec writes it. No trailing slash: Next.js serves /verify at this path.
    public static let verifyPage = "https://zerobars.us/verify"

    /// The link for a receipt wire (`note || ack || flag || conf`).
    public static func verifyURL(receiptWire: Data) -> String {
        verifyPage + "#r=" + Base64URL.encode(receiptWire)
    }

    /// The link for the receipt code `L1|P|1|X|...`, carrying exactly the bytes that code carries;
    /// nil for text that is not a well-formed receipt code.
    public static func verifyURL(receiptText: String) -> String? {
        guard let decoded = try? PaymentTransport.decode(receiptText), decoded.kind == .receipt else { return nil }
        return verifyURL(receiptWire: decoded.payload)
    }
}
