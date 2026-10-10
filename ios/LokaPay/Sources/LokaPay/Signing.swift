import CryptoKit
import Foundation
import LocalAuthentication
import Security

/// Anything that can sign payment structures with a P-256 key.
/// `sign` returns a 64-byte r || s signature already normalized to low-S.
public protocol PaymentSigner: Sendable {
    var compressedPublicKey: Data { get }
    func sign(_ message: Data) throws -> Data
}

public extension PaymentSigner {
    var keyHash: Data { P256Rules.keyHash(compressedPublicKey) }
}

/// Software key. For tests, CI and the documented fallback when the Secure Enclave is not
/// available (PLAN.md miss branch); the app labels which kind of key is in use.
public struct SoftwareP256Signer: PaymentSigner {
    public let privateKey: P256.Signing.PrivateKey  // gitleaks:allow (a type annotation, not a key)

    public init(privateKey: P256.Signing.PrivateKey = P256.Signing.PrivateKey()) {  // gitleaks:allow (a type annotation, not a key)
        self.privateKey = privateKey
    }

    public var compressedPublicKey: Data { privateKey.publicKey.compressedRepresentation }

    public func sign(_ message: Data) throws -> Data {
        // The data API hashes with SHA-256, matching the precompile. Never the digest overload.
        let raw = try privateKey.signature(for: message).rawRepresentation
        return P256Rules.normalizeLowS(raw)
    }
}

/// A Secure Enclave key that signs only after its owner's Face ID, Touch ID or passcode
/// (`.privateKeyUsage` + `.userPresence`). The key never leaves the enclave; the app keeps
/// its encrypted `dataRepresentation` in the Keychain (this device only) to restore it.
public final class SecureEnclaveP256Signer: PaymentSigner, @unchecked Sendable {
    private let key: SecureEnclave.P256.Signing.PrivateKey
    private let context: LAContext?

    private init(key: SecureEnclave.P256.Signing.PrivateKey, context: LAContext?) {
        self.key = key
        self.context = context
    }

    public static var isAvailable: Bool { SecureEnclave.isAvailable }

    /// Restores the key stored under `account`, or creates and stores a new one.
    public static func loadOrCreate(account: String, context: LAContext? = nil) throws -> SecureEnclaveP256Signer {
        if let stored = try Keychain.read(account: account) {
            let key = try SecureEnclave.P256.Signing.PrivateKey(dataRepresentation: stored, authenticationContext: context)
            return SecureEnclaveP256Signer(key: key, context: context)
        }
        var error: Unmanaged<CFError>?
        guard let access = SecAccessControlCreateWithFlags(
            nil, kSecAttrAccessibleWhenUnlockedThisDeviceOnly, [.privateKeyUsage, .userPresence], &error)
        else { throw error!.takeRetainedValue() as Error }
        let key = try SecureEnclave.P256.Signing.PrivateKey(
            compactRepresentable: false, accessControl: access, authenticationContext: context)
        try Keychain.write(account: account, data: key.dataRepresentation)
        return SecureEnclaveP256Signer(key: key, context: context)
    }

    public var compressedPublicKey: Data { key.publicKey.compressedRepresentation }

    public func sign(_ message: Data) throws -> Data {
        // Triggers the owner's Face ID or passcode prompt. Raw bytes in, SHA-256 inside.
        let raw = try key.signature(for: message).rawRepresentation
        return P256Rules.normalizeLowS(raw)
    }
}

/// Minimal Keychain storage for opaque blobs (enclave key handles), this device only.
enum Keychain {
    static let service = "us.zerobars.lokapay.keys"

    static func read(account: String) throws -> Data? {
        let query: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: service,
            kSecAttrAccount as String: account,
            kSecReturnData as String: true,
            kSecMatchLimit as String: kSecMatchLimitOne,
        ]
        var out: CFTypeRef?
        let status = SecItemCopyMatching(query as CFDictionary, &out)
        if status == errSecItemNotFound { return nil }
        guard status == errSecSuccess, let data = out as? Data else { throw PaymentError.storage }
        return data
    }

    static func write(account: String, data: Data) throws {
        let query: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: service,
            kSecAttrAccount as String: account,
        ]
        SecItemDelete(query as CFDictionary)
        var add = query
        add[kSecValueData as String] = data
        add[kSecAttrAccessible as String] = kSecAttrAccessibleWhenUnlockedThisDeviceOnly
        guard SecItemAdd(add as CFDictionary, nil) == errSecSuccess else { throw PaymentError.storage }
    }
}
