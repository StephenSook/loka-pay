import Foundation
import Testing
@testable import LokaPay

@Suite("config/pins.json reader")
struct LokaPinsTests {
    static var repoRoot: URL {
        URL(fileURLWithPath: #filePath).deletingLastPathComponent().deletingLastPathComponent()
            .deletingLastPathComponent().deletingLastPathComponent().deletingLastPathComponent()
    }

    @Test("config/pins.json parses to the deployed devnet program and mint")
    func pins() throws {
        let data = try Data(contentsOf: Self.repoRoot.appendingPathComponent("config/pins.json"))
        let parsed = try LokaPins.parse(data)
        let raw = try #require(try JSONSerialization.jsonObject(with: data) as? [String: Any])
        #expect(parsed.deployment.clusterId == 0)
        #expect(Base58.encode(parsed.deployment.programId) == raw["programId"] as? String)
        #expect(Base58.encode(parsed.deployment.mint) == raw["mint"] as? String)
        if raw["serverEd25519PublicKey"] is NSNull {
            #expect(parsed.serverPublicKey == nil)
        } else {
            #expect(parsed.serverPublicKey?.count == 32)
        }
        #expect(throws: LokaPins.PinsError.badField("cluster")) {
            try LokaPins.parse(Data(#"{"cluster":"testnet","programId":"x","mint":"y"}"#.utf8))
        }
        #expect(throws: LokaPins.PinsError.notJSON) { try LokaPins.parse(Data("nope".utf8)) }
    }
}
