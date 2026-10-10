import Foundation
import Security
import CryptoKit

/// Separately keyed, bounded encrypted history. Identity accessibility is unchanged.
final class MessageArchive {
    struct State: Codable, Equatable { var messages: [LokaMessage]; var outbox: [Data]; var replyActions: [String] }
    private let url: URL
    private let key: SymmetricKey
    init(directory: URL? = nil, testKey: Data? = nil) throws {
        let folder = try directory ?? FileManager.default.url(for: .applicationSupportDirectory, in: .userDomainMask, appropriateFor: nil, create: true)
        try FileManager.default.createDirectory(at: folder, withIntermediateDirectories: true)
        url = folder.appendingPathComponent("loka-messages-v1.enc")
        var folderURL = folder; var values = URLResourceValues(); values.isExcludedFromBackup = true; try folderURL.setResourceValues(values)
        if let testKey { key = SymmetricKey(data: testKey); return }
        let query: [String: Any] = [kSecClass as String: kSecClassGenericPassword, kSecAttrService as String: "org.loka.history.v1", kSecAttrAccount as String: "local", kSecReturnData as String: true]
        var found: CFTypeRef?
        let status = SecItemCopyMatching(query as CFDictionary, &found)
        if status == errSecSuccess, let bytes = found as? Data, bytes.count == 32 { key = SymmetricKey(data: bytes) }
        else {
            guard status == errSecItemNotFound, !FileManager.default.fileExists(atPath: url.path) else { throw ContactCodeError(text: "Unlock your iPhone to open saved messages. Existing history was preserved.") }
            var bytes = Data(count: 32)
            let result = bytes.withUnsafeMutableBytes { SecRandomCopyBytes(kSecRandomDefault, 32, $0.baseAddress!) }
            guard result == errSecSuccess else { throw LokaProtocolError.invalid }
            var insert = query; insert.removeValue(forKey: kSecReturnData as String)
            insert[kSecValueData as String] = bytes; insert[kSecAttrAccessible as String] = kSecAttrAccessibleWhenUnlockedThisDeviceOnly
            guard SecItemAdd(insert as CFDictionary, nil) == errSecSuccess else { throw LokaProtocolError.invalid }
            key = SymmetricKey(data: bytes)
        }
    }
    func load() throws -> State {
        guard FileManager.default.fileExists(atPath: url.path) else { return State(messages: [], outbox: [], replyActions: []) }
        let size = try url.resourceValues(forKeys: [.fileSizeKey]).fileSize ?? 0
        guard size <= 40_000_000 else { throw LokaProtocolError.invalid }
        let data = try Data(contentsOf: url)
        let plain = try AES.GCM.open(AES.GCM.SealedBox(combined: data), using: key, authenticating: Data("loka.history.v1".utf8))
        let state = try JSONDecoder().decode(State.self, from: plain); try validate(state); return state
    }
    func save(_ state: State) throws {
        try validate(state)
        let plain = try JSONEncoder().encode(state)
        guard plain.count <= 39_000_000 else { throw LokaProtocolError.invalid }
        let data = try AES.GCM.seal(plain, using: key, authenticating: Data("loka.history.v1".utf8)).combined!
        #if os(iOS)
        try data.write(to: url, options: [.atomic, .completeFileProtection])
        #else
        try data.write(to: url, options: [.atomic]) // Isolated macOS test harness; iOS always uses file protection.
        #endif
    }
    private var gameURL: URL { url.deletingLastPathComponent().appendingPathComponent("loka-game-v1.enc") }
    func loadGame() throws -> String? {
        guard FileManager.default.fileExists(atPath: gameURL.path) else { return nil }
        guard try gameURL.resourceValues(forKeys: [.fileSizeKey]).fileSize ?? 0 <= 16412 else { throw LokaProtocolError.invalid }
        let plain = try AES.GCM.open(AES.GCM.SealedBox(combined: Data(contentsOf: gameURL)), using: key, authenticating: Data("loka.game.v1".utf8))
        guard plain.count <= 16384, let raw = String(data: plain, encoding: .utf8) else { throw LokaProtocolError.invalid }; return raw
    }
    func saveGame(_ raw: String) throws {
        let plain = Data(raw.utf8); guard plain.count <= 16384 else { throw LokaProtocolError.invalid }
        let data = try AES.GCM.seal(plain, using: key, authenticating: Data("loka.game.v1".utf8)).combined!
        #if os(iOS)
        try data.write(to: gameURL, options: [.atomic, .completeFileProtection])
        #else
        try data.write(to: gameURL, options: [.atomic])
        #endif
    }
    private var partyURL: URL { url.deletingLastPathComponent().appendingPathComponent("loka-party-v1.enc") }
    func loadParty() throws -> String? {
        guard FileManager.default.fileExists(atPath: partyURL.path) else { return nil }
        guard try partyURL.resourceValues(forKeys: [.fileSizeKey]).fileSize ?? 0 <= 32796 else { throw LokaProtocolError.invalid }
        let plain = try AES.GCM.open(AES.GCM.SealedBox(combined: Data(contentsOf: partyURL)), using: key, authenticating: Data("loka.party.v1".utf8))
        guard plain.count <= 32768, let raw = String(data: plain, encoding: .utf8) else { throw LokaProtocolError.invalid }; return raw
    }
    func saveParty(_ raw: String) throws {
        let plain = Data(raw.utf8); guard plain.count <= 32768 else { throw LokaProtocolError.invalid }
        let data = try AES.GCM.seal(plain, using: key, authenticating: Data("loka.party.v1".utf8)).combined!
        #if os(iOS)
        try data.write(to: partyURL, options: [.atomic, .completeFileProtection])
        #else
        try data.write(to: partyURL, options: [.atomic])
        #endif
    }
    private var nearbyURL: URL { url.deletingLastPathComponent().appendingPathComponent("loka-nearby-v1.enc") }
    private var encountersURL: URL { url.deletingLastPathComponent().appendingPathComponent("loka-encounters-v1.enc") }
    func loadEncounters(now: Int64) throws -> [EncounterHistory.Record] {
        guard FileManager.default.fileExists(atPath: encountersURL.path) else { return [] }
        guard try encountersURL.resourceValues(forKeys: [.fileSizeKey]).fileSize ?? 0 <= 32796 else { throw LokaProtocolError.invalid }
        let plain = try AES.GCM.open(AES.GCM.SealedBox(combined: Data(contentsOf: encountersURL)), using: key, authenticating: Data("loka.encounters.v1".utf8))
        let records = try JSONDecoder().decode([EncounterHistory.Record].self, from: plain)
        let checked = EncounterHistory(); try checked.restore(records, now: now); return checked.saved(now: now)
    }
    func saveEncounters(_ records: [EncounterHistory.Record], now: Int64) throws {
        let checked = EncounterHistory(); try checked.restore(records, now: now)
        let plain = try JSONEncoder().encode(checked.saved(now: now)); guard plain.count <= 32768 else { throw LokaProtocolError.invalid }
        let sealed = try AES.GCM.seal(plain, using: key, authenticating: Data("loka.encounters.v1".utf8)).combined!
        #if os(iOS)
        try sealed.write(to: encountersURL, options: [.atomic, .completeFileProtection])
        #else
        try sealed.write(to: encountersURL, options: [.atomic])
        #endif
    }
    func loadNearby() throws -> NearbySaved? {
        guard FileManager.default.fileExists(atPath: nearbyURL.path) else { return nil }
        guard try nearbyURL.resourceValues(forKeys: [.fileSizeKey]).fileSize ?? 0 <= 262172 else { throw LokaProtocolError.invalid }
        let bytes = try Data(contentsOf: nearbyURL)
        let plain = try AES.GCM.open(AES.GCM.SealedBox(combined: bytes), using: key, authenticating: Data("loka.nearby.v1".utf8))
        return try JSONDecoder().decode(NearbySaved.self, from: plain)
    }
    func saveNearby(_ state: NearbySaved) throws {
        let plain = try JSONEncoder().encode(state); guard plain.count <= 262144 else { throw LokaProtocolError.invalid }
        let data = try AES.GCM.seal(plain, using: key, authenticating: Data("loka.nearby.v1".utf8)).combined!
        #if os(iOS)
        try data.write(to: nearbyURL, options: [.atomic, .completeFileProtection])
        #else
        try data.write(to: nearbyURL, options: [.atomic])
        #endif
    }
    private var carryURL: URL { url.deletingLastPathComponent().appendingPathComponent("loka-carry-v1.enc") }
    var carryProtection: String {
        let attributes = try? FileManager.default.attributesOfItem(atPath: carryURL.path)
        return (attributes?[.protectionKey] as? FileProtectionType)?.rawValue ?? "unavailable"
    }
    func loadCarry() throws -> [Data] {
        guard FileManager.default.fileExists(atPath: carryURL.path) else { return [] }
        guard try carryURL.resourceValues(forKeys: [.fileSizeKey]).fileSize ?? 0 <= 800000 else { throw LokaProtocolError.invalid }
        let plain = try AES.GCM.open(AES.GCM.SealedBox(combined: Data(contentsOf: carryURL)), using: key, authenticating: Data("loka.carry.v1".utf8))
        let frames = try JSONDecoder().decode([Data].self, from: plain)
        guard frames.count <= 128, frames.reduce(0, { $0 + $1.count }) <= 524288 else { throw LokaProtocolError.invalid }
        return frames
    }
    func saveCarry(_ frames: [Data]) throws {
        guard frames.count <= 128, frames.allSatisfy({ $0.count <= 16384 }), frames.reduce(0, { $0 + $1.count }) <= 524288 else { throw LokaProtocolError.invalid }
        let sealed = try AES.GCM.seal(JSONEncoder().encode(frames), using: key, authenticating: Data("loka.carry.v1".utf8)).combined!
        #if os(iOS)
        // User-approved ciphertext queue access after first unlock; history stays Complete.
        try sealed.write(to: carryURL, options: [.atomic, .completeFileProtectionUntilFirstUserAuthentication])
        #else
        try sealed.write(to: carryURL, options: [.atomic])
        #endif
    }
    private func validate(_ state: State) throws {
        guard state.messages.count <= 500, state.outbox.count <= 128, state.replyActions.count <= 128,
              state.outbox.allSatisfy({ $0.count <= 16384 }), Set(state.messages.map(\.id)).count == state.messages.count,
              state.messages.allSatisfy({ message in
                  (message.route?.valid != false) &&
                  (message.deliveredAt == nil || message.deliveredAt! >= 0) && (message.readAt == nil || message.readAt! >= 0) &&
                  (message.reportedHops == nil || (1...7).contains(message.reportedHops!)) &&
                  (message.myReaction == nil || (try? ChatContent.reactionVersion(message.myReaction)) != nil) &&
                  (message.peerReaction == nil || (try? ChatContent.reactionVersion(message.peerReaction)) != nil) &&
                  (message.reactionPacket == nil || UUID(uuidString: message.reactionPacket!) != nil) &&
                  UUID(uuidString: message.id) != nil && message.friendID.count == 64 && message.text.utf8.count <= 131072 && message.packetIDs.count <= 96 &&
                  (!(message.voice && message.image == true)) &&
                  (message.image != true || Data(base64Encoded: message.text).map { ChatContent.validImage($0) && $0.base64EncodedString() == message.text } == true) &&
                  (!message.voice || Data(base64Encoded: message.text).map { (1...98304).contains($0.count) && $0.base64EncodedString() == message.text } == true)
              }) else { throw LokaProtocolError.invalid }
    }
}
