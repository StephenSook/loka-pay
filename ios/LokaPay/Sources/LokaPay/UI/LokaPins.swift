import Foundation

/// The values config/pins.json pins for the app (AGENTS.md: read by every build). `parse` reads the
/// file's JSON; nothing here invents a value the file does not hold.
public enum LokaPins {
    public enum PinsError: Error, Equatable {
        case notJSON
        case badField(String)
    }

    /// Reads `cluster`, `programId`, `mint` (base58) and `serverEd25519PublicKey` from
    /// config/pins.json. The server key is nil while the file holds null; when present it may be
    /// 64 hex characters or base58, and must decode to 32 bytes.
    public static func parse(_ json: Data) throws -> (deployment: Deployment, serverPublicKey: Data?) {
        guard let object = try? JSONSerialization.jsonObject(with: json), let pins = object as? [String: Any] else {
            throw PinsError.notJSON
        }
        let clusterId: UInt8
        switch pins["cluster"] as? String {
        case "devnet": clusterId = 0
        case "mainnet": clusterId = 1
        default: throw PinsError.badField("cluster")
        }
        guard let programText = pins["programId"] as? String, let programId = Base58.decode(programText, maxBytes: 32),
              programId.count == 32 else { throw PinsError.badField("programId") }
        guard let mintText = pins["mint"] as? String, let mint = Base58.decode(mintText, maxBytes: 32),
              mint.count == 32 else { throw PinsError.badField("mint") }
        let serverKey: Data?
        switch pins["serverEd25519PublicKey"] {
        case nil, is NSNull:
            serverKey = nil
        case let text as String:
            if text.count == 64, let raw = Data(hex: text) {
                serverKey = raw
            } else if let raw = Base58.decode(text, maxBytes: 32), raw.count == 32 {
                serverKey = raw
            } else {
                throw PinsError.badField("serverEd25519PublicKey")
            }
        default:
            throw PinsError.badField("serverEd25519PublicKey")
        }
        return (Deployment(programId: programId, clusterId: clusterId, mint: mint), serverKey)
    }
}
