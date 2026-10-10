import Foundation
import ImageIO
import UniformTypeIdentifiers

@main struct ContactCodeChecks {
    static func main() throws {
        // Fresh ephemeral test key. No production Keychain identity or private key export.
        let identity = try ContactIdentity(persistent: false)
        let key = identity.publicKey, link = try ContactCode.encode(key), id = ContactCode.fingerprint(key)
        precondition(tryEqual(try ContactCode.decode(link), key))
        func reject(_ text: String) {
            do { _ = try ContactCode.decode(text); fatalError("Malformed link accepted") } catch { }
        }
        reject(""); reject(link.replacingOccurrences(of: "/v1#", with: "/v2#")); reject(link + "="); reject(link + "%")
        reject(ContactCode.prefix + String(repeating: "A", count: 2049)); reject(ContactCode.prefix + "AA")
        var wrong = key; wrong[wrong.count - 1] = 3
        do { try ContactCode.validate(wrong); fatalError("Wrong exponent accepted") } catch { }
        do { try ContactCode.validate(key + Data([0])); fatalError("Trailing key accepted") } catch { }
        guard let image = ContactQrCodec.render(link) else { fatalError("QR generation failed") }
        let png = NSMutableData()
        guard let destination = CGImageDestinationCreateWithData(png, UTType.png.identifier as CFString, 1, nil) else { fatalError("PNG unavailable") }
        CGImageDestinationAddImage(destination, image, nil); precondition(CGImageDestinationFinalize(destination))
        let decoded = try ContactQrCodec.decodeImage(png as Data)
        precondition(decoded == link)
        precondition(tryEqual(try ContactCode.decode(decoded), key))
        let fixture: [String: String] = ["source": "Apple Security ephemeral RSA-3072 public key; no private key included", "publicKeyBase64": key.base64EncodedString(), "contactLink": link, "fingerprint": id]
        let data = try JSONSerialization.data(withJSONObject: fixture, options: [.prettyPrinted, .sortedKeys])
        try data.write(to: URL(fileURLWithPath: "/tmp/loka-ios-contact-vector.json"))
        print("Native contact checks passed: SPKI/link fingerprint, malformed links/keys, actual QR PNG → Vision → exact key")
    }
    static func tryEqual(_ value: @autoclosure () throws -> Data, _ expected: Data) -> Bool {
        do { return try value() == expected } catch { fatalError("Valid contact failed: \(error)") }
    }
}
