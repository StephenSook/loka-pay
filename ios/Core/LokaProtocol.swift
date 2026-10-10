import Foundation
import Security
import CryptoKit

enum LokaProtocolError: Error, LocalizedError {
    case invalid
    var errorDescription: String? { "Could not verify this message" }
}

/// Experimental packet-v0 compatibility. No production security or forward-secrecy claim.
struct CarryGrant { var target: String; var key: Data; var signature: Data }

struct LokaPacket {
    var id: String
    var source: String
    var destination: String
    var createdAt: Int64
    var expiresAt: Int64
    var hops: Int32
    var senderKey: Data
    var wrappedKey: Data
    var nonce: Data
    var ciphertext: Data
    var signature: Data
    var version: Int32 = 0
    var carrier: String = ""
    var grants: [CarryGrant] = []
    var returnVia: [String] = []

    func validate(now: Int64) throws {
        let lifetime: Int64 = version > 0 ? 3_600_000 : 300_000
        guard (0...3).contains(version),
              (version == 0 || version == 3) ? carrier.isEmpty : ((version == 2 && carrier.isEmpty) || (carrier.count == 64 && carrier != source && carrier != destination)) else { throw LokaProtocolError.invalid }
        guard version == 3 ? grants.count <= 3 : grants.isEmpty else { throw LokaProtocolError.invalid }
        guard version == 3 ? returnVia.count <= 3 : returnVia.isEmpty,
              Set(returnVia).count == returnVia.count, returnVia.allSatisfy({ $0 != source && $0 != destination }) else { throw LokaProtocolError.invalid }
        let targets = grants.map { $0.target }
        guard Set(targets).count == targets.count, targets.allSatisfy({ $0 != source && $0 != destination }),
              grants.allSatisfy({ (256...1024).contains($0.key.count) && $0.signature.count == 384 }) else { throw LokaProtocolError.invalid }
        let fingerprints = [source, destination] + returnVia + targets + (!carrier.isEmpty ? [carrier] : [])
        guard UUID(uuidString: id)?.uuidString.lowercased() == id,
              fingerprints.allSatisfy({ $0.count == 64 && $0.utf8.allSatisfy({ (48...57).contains($0) || (97...102).contains($0) }) }),
              source == ContactCode.fingerprint(senderKey), (0...6).contains(hops),
              createdAt >= 0, createdAt >= now - lifetime, createdAt <= now + 30_000,
              expiresAt > now, expiresAt > createdAt, expiresAt - createdAt <= lifetime,
              wrappedKey.count == 384, nonce.count == 12, (16...2064).contains(ciphertext.count), signature.count == 384
        else { throw LokaProtocolError.invalid }
        try ContactCode.validate(senderKey)
    }
    func holders() -> [String] { [source] + grants.map { $0.target } }
    func grantData(_ target: String) -> Data {
        var out = PacketWriter()
        out.string("LOKA-CARRY-V3"); out.blob(signedData()); out.blob(signature)
        out.int32(Int32(grants.count))
        for grant in grants { out.string(grant.target); out.blob(grant.key); out.blob(grant.signature) }
        out.string(target); return out.data
    }
    func aad() -> Data {
        var out = PacketWriter()
        out.int32(version); out.string(id); out.string(source); out.string(destination)
        out.int64(createdAt); out.int64(expiresAt)
        if version == 1 { out.string(carrier) }
        if version == 3 { out.int32(Int32(returnVia.count)); for hint in returnVia { out.string(hint) } }
        return out.data
    }
    func signedData() -> Data {
        var out = PacketWriter(data: aad())
        if version == 2 { out.string(carrier) }
        out.blob(senderKey); out.blob(wrappedKey); out.blob(nonce); out.blob(ciphertext)
        return out.data
    }
    func encode() throws -> Data {
        var out = PacketWriter(data: aad())
        if version == 2 { out.string(carrier) }
        out.int32(hops); out.blob(senderKey); out.blob(wrappedKey); out.blob(nonce); out.blob(ciphertext); out.blob(signature)
        if version == 3 {
            out.int32(Int32(grants.count))
            for grant in grants { out.string(grant.target); out.blob(grant.key); out.blob(grant.signature) }
        }
        guard out.data.count <= 16384 else { throw LokaProtocolError.invalid }
        return out.data
    }
    static func decode(_ bytes: Data) throws -> LokaPacket {
        guard (1...16384).contains(bytes.count) else { throw LokaProtocolError.invalid }
        var input = PacketReader(data: Data(bytes))
        let version = try input.int32()
        guard (0...3).contains(version) else { throw LokaProtocolError.invalid }
        let id = try input.string(), source = try input.string(), destination = try input.string()
        let created = try input.int64(), expires = try input.int64()
        let carrier = (1...2).contains(version) ? try input.string() : ""
        var hints: [String] = []
        if version == 3 { let count = try input.int32(); guard (0...3).contains(count) else { throw LokaProtocolError.invalid }; for _ in 0..<count { hints.append(try input.string()) } }
        var value = try LokaPacket(id: id, source: source, destination: destination,
            createdAt: created, expiresAt: expires, hops: input.int32(),
            senderKey: input.blob(limit: 1024), wrappedKey: input.blob(limit: 384), nonce: input.blob(limit: 12),
            ciphertext: input.blob(limit: 2064), signature: input.blob(limit: 384), version: version, carrier: carrier, returnVia: hints)
        if version == 3 {
            let count = try input.int32(); guard (0...3).contains(count) else { throw LokaProtocolError.invalid }
            for _ in 0..<count { value.grants.append(try CarryGrant(target: input.string(), key: input.blob(limit: 1024), signature: input.blob(limit: 384))) }
        }
        guard input.offset == bytes.count else { throw LokaProtocolError.invalid }
        return value
    }
    func verify() throws {
        try ContactCode.validate(senderKey)
        guard let key = SecKeyCreateWithData(Data(senderKey.dropFirst(24)) as CFData,
            [kSecAttrKeyType: kSecAttrKeyTypeRSA, kSecAttrKeyClass: kSecAttrKeyClassPublic, kSecAttrKeySizeInBits: 3072] as CFDictionary, nil),
            SecKeyVerifySignature(key, .rsaSignatureMessagePKCS1v15SHA256, signedData() as CFData, signature as CFData, nil)
        else { throw LokaProtocolError.invalid }
        guard version == 3 ? grants.count <= 3 : grants.isEmpty else { throw LokaProtocolError.invalid }
        for (index, grant) in grants.enumerated() {
            var prefix = self; prefix.grants = Array(grants.prefix(index))
            try ContactCode.validate(grant.key)
            guard ContactCode.fingerprint(grant.key) == prefix.holders().last,
                  !prefix.holders().contains(grant.target), grant.target != destination,
                  let key = SecKeyCreateWithData(Data(grant.key.dropFirst(24)) as CFData,
                    [kSecAttrKeyType: kSecAttrKeyTypeRSA, kSecAttrKeyClass: kSecAttrKeyClassPublic, kSecAttrKeySizeInBits: 3072] as CFDictionary, nil),
                  SecKeyVerifySignature(key, .rsaSignatureMessagePKCS1v15SHA256, prefix.grantData(grant.target) as CFData, grant.signature as CFData, nil)
            else { throw LokaProtocolError.invalid }
        }
    }
}

private struct PacketWriter {
    var data = Data()
    mutating func int32(_ value: Int32) { var value = value.bigEndian; withUnsafeBytes(of: &value) { data.append(contentsOf: $0) } }
    mutating func int64(_ value: Int64) { var value = value.bigEndian; withUnsafeBytes(of: &value) { data.append(contentsOf: $0) } }
    // Protocol strings are canonical ASCII; Java modified UTF-8 and UTF-8 agree for these fields.
    mutating func string(_ value: String) {
        let bytes = Data(value.utf8); var count = UInt16(bytes.count).bigEndian
        withUnsafeBytes(of: &count) { data.append(contentsOf: $0) }; data.append(bytes)
    }
    mutating func blob(_ value: Data) { int32(Int32(value.count)); data.append(value) }
}
private struct PacketReader {
    let data: Data
    var offset = 0
    mutating func take(_ count: Int) throws -> Data {
        guard count >= 0, count <= data.count - offset else { throw LokaProtocolError.invalid }
        defer { offset += count }; return Data(data[offset..<offset + count])
    }
    mutating func int32() throws -> Int32 { Int32(bitPattern: try take(4).reduce(UInt32(0)) { ($0 << 8) | UInt32($1) }) }
    mutating func int64() throws -> Int64 { Int64(bitPattern: try take(8).reduce(UInt64(0)) { ($0 << 8) | UInt64($1) }) }
    mutating func string() throws -> String {
        let count = try take(2).reduce(0) { ($0 << 8) | Int($1) }
        guard count <= 64 else { throw LokaProtocolError.invalid }
        let bytes = try take(count)
        guard bytes.allSatisfy({ $0 < 128 }), let text = String(data: bytes, encoding: .utf8) else { throw LokaProtocolError.invalid }
        return text
    }
    mutating func blob(limit: Int) throws -> Data {
        let count = Int(try int32()); guard count >= 0, count <= limit else { throw LokaProtocolError.invalid }
        return try take(count)
    }
}

/// RFC 8017 OAEP with SHA-256 / MGF1-SHA1, matching Android v0 exactly.
/// Only wraps 32-byte AES keys. Native Security performs RSA; no private key export.
enum LokaOAEP {
    static func random(_ count: Int) throws -> Data {
        var bytes = Data(count: count)
        let status = bytes.withUnsafeMutableBytes { SecRandomCopyBytes(kSecRandomDefault, count, $0.baseAddress!) }
        guard status == errSecSuccess else { throw LokaProtocolError.invalid }; return bytes
    }
    private static func mask(_ seed: Data, count: Int) -> Data {
        var result = Data()
        for index in 0..<((count + 19) / 20) {
            var counter = UInt32(index).bigEndian; var input = seed
            withUnsafeBytes(of: &counter) { input.append(contentsOf: $0) }
            result.append(contentsOf: Insecure.SHA1.hash(data: input))
        }
        return Data(result.prefix(count))
    }
    private static func xor(_ lhs: Data, _ rhs: Data) -> Data { Data(zip(lhs, rhs).map { $0 ^ $1 }) }
    static func encode(_ key: Data) throws -> Data {
        guard key.count == 32 else { throw LokaProtocolError.invalid }
        let seed = try random(32)
        let db = Data(SHA256.hash(data: Data())) + Data(repeating: 0, count: 286) + Data([1]) + key
        let maskedDB = xor(db, mask(seed, count: 351))
        return Data([0]) + xor(seed, mask(maskedDB, count: 32)) + maskedDB
    }
    static func decode(_ encoded: Data) throws -> Data {
        guard encoded.count == 384 else { throw LokaProtocolError.invalid }
        let em = Data(encoded)
        let maskedDB = Data(em.dropFirst(33))
        let seed = xor(Data(em[1..<33]), mask(maskedDB, count: 32))
        let db = xor(maskedDB, mask(seed, count: 351))
        let hash = Data(SHA256.hash(data: Data()))
        var mismatch = em[0]
        for i in 0..<32 { mismatch |= db[i] ^ hash[i] }
        for i in 32..<318 { mismatch |= db[i] }
        mismatch |= db[318] ^ 1
        guard mismatch == 0 else { throw LokaProtocolError.invalid }
        return Data(db.suffix(32))
    }
    static func wrap(_ aes: Data, recipient: Data) throws -> Data {
        try ContactCode.validate(recipient)
        guard let key = SecKeyCreateWithData(Data(recipient.dropFirst(24)) as CFData,
            [kSecAttrKeyType: kSecAttrKeyTypeRSA, kSecAttrKeyClass: kSecAttrKeyClassPublic, kSecAttrKeySizeInBits: 3072] as CFDictionary, nil),
            let result = SecKeyCreateEncryptedData(key, .rsaEncryptionRaw, try encode(aes) as CFData, nil) as Data?, result.count == 384
        else { throw LokaProtocolError.invalid }; return result
    }
}

struct LokaCrypto {
    let identity: ContactIdentity
    var deviceID: String { ContactCode.fingerprint(identity.publicKey) }
    func encrypt(recipient: Data, text: String, now: Int64, carrier: String = "", automatic: Bool = false, multiCarry: Bool = false, returnVia: [String] = [], lifetimeMs: Int64? = nil) throws -> LokaPacket {
        let maximum: Int64 = carrier.isEmpty && !automatic ? 300000 : 3600000
        let lifetime = lifetimeMs ?? maximum
        guard (1...maximum).contains(lifetime) else { throw LokaProtocolError.invalid }
        let plain = Data(text.utf8)
        guard (1...2048).contains(plain.count), ContactCode.fingerprint(recipient) != deviceID else { throw LokaProtocolError.invalid }
        var aes = try LokaOAEP.random(32)
        defer { aes.resetBytes(in: 0..<aes.count) }
        let nonce = try LokaOAEP.random(12)
        var packet = LokaPacket(id: UUID().uuidString.lowercased(), source: deviceID, destination: ContactCode.fingerprint(recipient),
            createdAt: now, expiresAt: now + lifetime, hops: 6, senderKey: identity.publicKey,
            wrappedKey: try LokaOAEP.wrap(aes, recipient: recipient), nonce: nonce, ciphertext: Data(), signature: Data(), version: automatic ? (multiCarry ? 3 : 2) : carrier.isEmpty ? 0 : 1, carrier: automatic && multiCarry ? "" : carrier, returnVia: automatic && multiCarry ? returnVia : [])
        let box = try AES.GCM.seal(plain, using: SymmetricKey(data: aes), nonce: AES.GCM.Nonce(data: nonce), authenticating: packet.aad())
        packet.ciphertext = box.ciphertext + box.tag
        packet.signature = try identity.signMessage(packet.signedData())
        try packet.validate(now: now)
        return packet
    }
    func authorizeCarrier(_ packet: LokaPacket, carrier: String) throws -> LokaPacket {
        guard packet.version == 2, packet.source == deviceID, packet.carrier.isEmpty,
              carrier.count == 64, carrier != deviceID, carrier != packet.destination else { throw LokaProtocolError.invalid }
        var updated = packet; updated.carrier = carrier
        updated.signature = try identity.signMessage(updated.signedData())
        return updated
    }
    func delegate(_ packet: LokaPacket, target: String) throws -> LokaPacket {
        guard packet.version == 3, packet.grants.count < 3, packet.holders().last == deviceID,
              !packet.holders().contains(target), target != packet.destination else { throw LokaProtocolError.invalid }
        try packet.verify()
        var updated = packet
        updated.grants.append(CarryGrant(target: target, key: identity.publicKey, signature: try identity.signMessage(packet.grantData(target))))
        return updated
    }
    func decrypt(_ packet: LokaPacket) throws -> String {
        guard packet.destination == deviceID else { throw LokaProtocolError.invalid }
        try packet.verify()
        var aes = try identity.unwrapMessageKey(packet.wrappedKey)
        defer { aes.resetBytes(in: 0..<aes.count) }
        let box = try AES.GCM.SealedBox(nonce: AES.GCM.Nonce(data: packet.nonce), ciphertext: packet.ciphertext.dropLast(16), tag: packet.ciphertext.suffix(16))
        let plain = try AES.GCM.open(box, using: SymmetricKey(data: aes), authenticating: packet.aad())
        guard (1...2048).contains(plain.count), let text = String(data: plain, encoding: .utf8) else { throw LokaProtocolError.invalid }
        return text
    }
}
