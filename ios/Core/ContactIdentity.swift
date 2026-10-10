import Foundation
import Security
import CryptoKit

struct ContactCodeError: Error, LocalizedError {
    let text: String
    var errorDescription: String? { text }
}
struct ContactCode {
    static let prefix = "loka://contact/v1#"
    static let spkiHeader = Data([0x30,0x82,0x01,0xa2,0x30,0x0d,0x06,0x09,0x2a,0x86,0x48,0x86,0xf7,0x0d,0x01,0x01,0x01,0x05,0x00,0x03,0x82,0x01,0x8f,0])
    static func validate(_ key: Data) throws {
        guard key.count == 422, key.prefix(24) == spkiHeader else { throw ContactCodeError(text: "Unsupported contact key") }
        let raw = Data(key.dropFirst(24))
        guard raw.prefix(9) == Data([0x30,0x82,0x01,0x8a,0x02,0x82,0x01,0x81,0]), raw[9] & 0x80 != 0,
              raw.suffix(5) == Data([2,3,1,0,1]),
              SecKeyCreateWithData(raw as CFData, [kSecAttrKeyType: kSecAttrKeyTypeRSA, kSecAttrKeyClass: kSecAttrKeyClassPublic, kSecAttrKeySizeInBits: 3072] as CFDictionary, nil) != nil else { throw ContactCodeError(text: "Invalid contact key") }
    }
    static func fingerprint(_ key: Data) -> String { SHA256.hash(data: key).map { String(format: "%02x", $0) }.joined() }
    static func encode(_ key: Data) throws -> String {
        try validate(key)
        return prefix + key.base64EncodedString().replacingOccurrences(of: "+", with: "-").replacingOccurrences(of: "/", with: "_").replacingOccurrences(of: "=", with: "")
    }
    static func decode(_ text: String) throws -> Data {
        let value = text.trimmingCharacters(in: .whitespacesAndNewlines)
        guard value.utf8.count <= 2048, value.hasPrefix(prefix) else { throw ContactCodeError(text: "Scan or paste a LOKA contact code") }
        let fragment = String(value.dropFirst(prefix.count))
        guard !fragment.isEmpty, fragment.utf8.allSatisfy({ (65...90).contains($0) || (97...122).contains($0) || (48...57).contains($0) || $0 == 45 || $0 == 95 }) else { throw ContactCodeError(text: "Invalid contact link") }
        var base64 = fragment.replacingOccurrences(of: "-", with: "+").replacingOccurrences(of: "_", with: "/")
        base64 += String(repeating: "=", count: (4 - base64.count % 4) % 4)
        guard let key = Data(base64Encoded: base64) else { throw ContactCodeError(text: "Invalid contact link") }
        try validate(key)
        guard try encode(key) == value else { throw ContactCodeError(text: "Noncanonical contact link") }
        return key
    }
}

/// Native Keychain identity. Private operations use Security; only its public key is exported.
final class ContactIdentity {
    let publicKey: Data
    private let privateKey: SecKey
    static let tag = Data("org.loka.ios.identity.v0".utf8)
    func signMessage(_ data: Data) throws -> Data {
        guard let result = SecKeyCreateSignature(privateKey, .rsaSignatureMessagePKCS1v15SHA256, data as CFData, nil) as Data? else { throw LokaProtocolError.invalid }
        return result
    }
    func unwrapMessageKey(_ data: Data) throws -> Data {
        guard data.count == 384,
              let result = SecKeyCreateDecryptedData(privateKey, .rsaEncryptionRaw, data as CFData, nil) as Data?
        else { throw LokaProtocolError.invalid }
        return try LokaOAEP.decode(result)
    }
    init(persistent: Bool = true) throws {
        var item: CFTypeRef?
        let query: [String: Any] = [kSecClass as String: kSecClassKey, kSecAttrApplicationTag as String: Self.tag,
            kSecAttrKeyType as String: kSecAttrKeyTypeRSA, kSecAttrKeyClass as String: kSecAttrKeyClassPrivate, kSecReturnRef as String: true]
        let status = persistent ? SecItemCopyMatching(query as CFDictionary, &item) : errSecItemNotFound
        if status == errSecSuccess { privateKey = item as! SecKey }
        else {
            guard status == errSecItemNotFound else { throw ContactCodeError(text: "Could not access your identity. Existing keys were preserved.") }
            var attrs: [String: Any] = [kSecAttrKeyType as String: kSecAttrKeyTypeRSA, kSecAttrKeySizeInBits as String: 3072]
            if persistent { attrs[kSecPrivateKeyAttrs as String] = [kSecAttrIsPermanent as String: true, kSecAttrApplicationTag as String: Self.tag, kSecAttrAccessible as String: kSecAttrAccessibleWhenUnlockedThisDeviceOnly] }
            guard let key = SecKeyCreateRandomKey(attrs as CFDictionary, nil) else { throw ContactCodeError(text: "Could not create your contact identity") }
            privateKey = key
        }
        guard let key = SecKeyCopyPublicKey(privateKey), let raw = SecKeyCopyExternalRepresentation(key, nil) as Data? else { throw ContactCodeError(text: "Could not read your public contact key") }
        publicKey = ContactCode.spkiHeader + raw
        try ContactCode.validate(publicKey)
    }
}
