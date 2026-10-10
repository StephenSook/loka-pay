import Foundation

struct ChatContent {
    let kind: String
    let id: String
    var data = Data()
    var index = 0
    var count = 1
    func acknowledges(messageID: String, recipient: String, sender: String) -> Bool { kind == "A" && id == messageID && recipient == sender }
    func encode() throws -> String {
        let text: String
        switch kind {
        case "A": text = "L1|A|\(id)"
        case "B": guard let at = String(data: data, encoding: .utf8) else { throw LokaProtocolError.invalid }; text = "L1|B|\(id)|\(at)"
        case "H": text = "L1|H|\(id)|\(index)"
        case "R": text = "L1|R|\(id)|\(data.base64EncodedString())"
        case "T": text = "L1|T|\(id)|\(data.base64EncodedString())"
        case "V", "I": text = "L1|\(kind)|\(id)|\(index)|\(count)|\(data.base64EncodedString())"
        default: throw LokaProtocolError.invalid
        }
        _ = try Self.decode(text); return text
    }
    static let reactions = ["", "👍", "❤️", "😂", "😮", "😢", "🙏"]
    static func reactionEmoji(_ state: String?) -> String { state?.components(separatedBy: "|").last ?? "" }
    static func reactionVersion(_ state: String?) throws -> (Int64, String) {
        guard let state else { return (-1, "") }
        let p = state.components(separatedBy: "|")
        guard p.count == 3, let time = Int64(p[0]), time >= 0, String(time) == p[0], UUID(uuidString: p[1])?.uuidString.lowercased() == p[1], reactions.contains(p[2]) else { throw LokaProtocolError.invalid }
        return (time, p[1])
    }
    static func newerReaction(_ old: String?, _ next: String) throws -> Bool {
        let a = try reactionVersion(old), b = try reactionVersion(next)
        return b.0 > a.0 || b.0 == a.0 && b.1 > a.1
    }
    static func decode(_ text: String) throws -> ChatContent? {
        guard text.hasPrefix("L1|") else { return nil }
        let p = text.components(separatedBy: "|")
        guard text.utf8.count <= 2048, p.count >= 3, UUID(uuidString: p[2])?.uuidString.lowercased() == p[2] else { throw LokaProtocolError.invalid }
        func bytes(_ value: String) throws -> Data {
            guard let data = Data(base64Encoded: value), data.base64EncodedString() == value else { throw LokaProtocolError.invalid }; return data
        }
        switch p[1] {
        case "A": guard p.count == 3 else { throw LokaProtocolError.invalid }; return ChatContent(kind: "A", id: p[2])
        case "B": guard p.count == 4, let at = Int64(p[3]), at >= 0, String(at) == p[3] else { throw LokaProtocolError.invalid }; return ChatContent(kind: "B", id: p[2], data: Data(p[3].utf8))
        case "H":
            guard p.count == 4, let hops = Int(p[3]), (1...7).contains(hops), String(hops) == p[3] else { throw LokaProtocolError.invalid }
            return ChatContent(kind: "H", id: p[2], index: hops)
        case "R":
            guard p.count == 4 else { throw LokaProtocolError.invalid }
            let data = try bytes(p[3]); guard let raw = String(data: data, encoding: .utf8) else { throw LokaProtocolError.invalid }
            let r = raw.components(separatedBy: "|")
            guard r.count == 2, UUID(uuidString: r[0])?.uuidString.lowercased() == r[0], reactions.contains(r[1]) else { throw LokaProtocolError.invalid }
            return ChatContent(kind: "R", id: p[2], data: data)
        case "T":
            guard p.count == 4 else { throw LokaProtocolError.invalid }
            let data = try bytes(p[3]); guard (1...1400).contains(data.count), String(data: data, encoding: .utf8) != nil else { throw LokaProtocolError.invalid }
            return ChatContent(kind: "T", id: p[2], data: data)
        case "V", "I":
            guard p.count == 6, let index = Int(p[3]), let count = Int(p[4]), String(index) == p[3], String(count) == p[4], (1...(p[1] == "I" ? 64 : 96)).contains(count), (0..<count).contains(index) else { throw LokaProtocolError.invalid }
            let data = try bytes(p[5]); guard (1...1024).contains(data.count), index == count - 1 || data.count == 1024 else { throw LokaProtocolError.invalid }
            return ChatContent(kind: p[1], id: p[2], data: data, index: index, count: count)
        default: throw LokaProtocolError.invalid
        }
    }
    static func image(id: String, data: Data) throws -> [ChatContent] {
        guard validImage(data) else { throw LokaProtocolError.invalid }
        return try voice(id: id, data: data).map { ChatContent(kind: "I", id: $0.id, data: $0.data, index: $0.index, count: $0.count) }
    }
    static func validImage(_ data: Data) -> Bool {
        let b = [UInt8](data)
        guard (12...65536).contains(b.count), b[0] == 255, b[1] == 216, b[b.count-2] == 255, b.last == 217 else { return false }
        var at = 2
        while at + 4 < b.count {
            guard b[at] == 255 else { return false }; at += 1
            while at < b.count && b[at] == 255 { at += 1 }
            guard at + 2 < b.count else { return false }
            let marker = b[at]; at += 1
            guard marker != 218 && marker != 217 else { return false }
            let length = Int(b[at]) * 256 + Int(b[at+1])
            guard length >= 2, at + length <= b.count else { return false }
            if marker == 192 || marker == 194 {
                guard length >= 8, b[at+2] == 8 else { return false }
                let height = Int(b[at+3]) * 256 + Int(b[at+4]); let width = Int(b[at+5]) * 256 + Int(b[at+6])
                return (1...1024).contains(height) && (1...1024).contains(width)
            }
            at += length
        }
        return false
    }
    static func voice(id: String, data: Data) throws -> [ChatContent] {
        guard (1...98304).contains(data.count) else { throw ContactCodeError(text: "Voice note is too large. Record a shorter one.") }
        let count = (data.count + 1023) / 1024
        return (0..<count).map { ChatContent(kind: "V", id: id, data: data.subdata(in: ($0 * 1024)..<min(data.count, ($0 + 1) * 1024)), index: $0, count: count) }
    }
}
final class VoiceAssembly {
    private struct Parts { let count: Int; var expires: Int64; var chunks: [Int: Data] = [:] }
    private var pending: [String: Parts] = [:]
    func accept(sender: String, part: ChatContent, expires: Int64, now: Int64) throws -> Data? {
        pending = pending.filter { $0.value.expires > now }
        guard ["V", "I"].contains(part.kind), expires > now else { throw LokaProtocolError.invalid }
        let key = sender + ":" + part.kind + ":" + part.id
        if pending[key] == nil { guard pending.count < 8 else { throw LokaProtocolError.invalid }; pending[key] = Parts(count: part.count, expires: expires) }
        guard var item = pending[key], item.count == part.count, item.chunks[part.index] == nil || item.chunks[part.index] == part.data else { throw LokaProtocolError.invalid }
        item.expires = min(item.expires, expires); item.chunks[part.index] = part.data; pending[key] = item
        guard item.chunks.count == item.count else { return nil }
        var result = Data(); for index in 0..<item.count { result.append(item.chunks[index]!) }
        guard result.count <= 98304 else { throw LokaProtocolError.invalid }; pending.removeValue(forKey: key); if part.kind == "I" && !ChatContent.validImage(result) { throw LokaProtocolError.invalid }; return result
    }
}

/// Avoids new receipt envelopes while an admitted destination receipt is live.
struct ReceiptWindow {
    private var expires: [String: Int64] = [:]
    private let capacity: Int
    init(capacity: Int = 500) { self.capacity = capacity }
    mutating func canCreate(sender: String, message: String, now: Int64) -> Bool {
        expires = expires.filter { $0.value > now }
        return expires[sender + ":" + message] == nil && expires.count < capacity
    }
    mutating func remember(sender: String, message: String, deadline: Int64, now: Int64) {
        expires = expires.filter { $0.value > now }
        guard deadline > now, expires.count < capacity else { return }
        expires[sender + ":" + message] = deadline
    }
}
