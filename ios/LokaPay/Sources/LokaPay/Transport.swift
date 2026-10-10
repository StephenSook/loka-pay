import Foundation

/// `L1|P|1|<kind>|<base64url>` inside an encrypted LOKA packet (protocol/PAYMENT-V1.md section 5).
public enum PaymentTransport {
    public enum Kind: String, CaseIterable, Sendable {
        case note = "N"
        case ack = "Y"
        case confirmation = "S"
        case marker = "M"
        case receipt = "X"
        case allowance = "A"
        case merchant = "C"
    }

    public static func encode(_ kind: Kind, _ payload: Data) -> String {
        "L1|P|1|\(kind.rawValue)|\(Base64URL.encode(payload))"
    }

    /// Returns nil for anything that is not version-1 payment content (callers ignore it and
    /// never relay it as payment content); throws when it claims to be and is malformed.
    public static func decode(_ text: String) throws -> (kind: Kind, payload: Data)? {
        let parts = text.split(separator: "|", omittingEmptySubsequences: false)
        guard parts.count >= 3, parts[0] == "L1", parts[1] == "P" else { return nil }
        guard parts[2] == "1" else { return nil }
        guard parts.count == 5, let kind = Kind(rawValue: String(parts[3])) else { return nil }
        return (kind, try Base64URL.decode(String(parts[4])))
    }
}

/// RFC 4648 section 5, no padding, canonical only.
public enum Base64URL {
    public static func encode(_ data: Data) -> String {
        data.base64EncodedString()
            .replacingOccurrences(of: "+", with: "-")
            .replacingOccurrences(of: "/", with: "_")
            .replacingOccurrences(of: "=", with: "")
    }

    public static func decode(_ text: String) throws -> Data {
        let alphabet = Set("ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_")
        guard text.allSatisfy({ alphabet.contains($0) }), text.count % 4 != 1 else { throw PaymentError.base64url }
        var b64 = text.replacingOccurrences(of: "-", with: "+").replacingOccurrences(of: "_", with: "/")
        b64 += String(repeating: "=", count: (4 - b64.count % 4) % 4)
        guard let data = Data(base64Encoded: b64), encode(data) == text else { throw PaymentError.base64url }
        return data
    }
}

/// Mint base units and display strings (6 decimals; section 4.1 units).
public enum Money {
    public static let decimals = 6
    static let scale: UInt64 = 1_000_000

    /// "1.00" for 1,000,000 base units. Two decimals when exact to the cent, otherwise six.
    public static func display(baseUnits: UInt64) -> String {
        let whole = baseUnits / scale
        let frac = baseUnits % scale
        if frac % 10_000 == 0 { return String(format: "%llu.%02llu", whole, frac / 10_000) }
        return String(format: "%llu.%06llu", whole, frac)
    }

    /// Parses "D", "D.C" up to six decimals into base units with integer math only.
    public static func baseUnits(_ text: String) -> UInt64? {
        let parts = text.split(separator: ".", omittingEmptySubsequences: false)
        guard (1...2).contains(parts.count), !parts[0].isEmpty, parts[0].allSatisfy(\.isNumber),
              let whole = UInt64(parts[0]) else { return nil }
        var frac: UInt64 = 0
        if parts.count == 2 {
            let f = parts[1]
            guard (1...6).contains(f.count), f.allSatisfy(\.isNumber),
                  let v = UInt64(f + String(repeating: "0", count: 6 - f.count)) else { return nil }
            frac = v
        }
        let (w, overflow) = whole.multipliedReportingOverflow(by: scale)
        guard !overflow else { return nil }
        let (total, overflow2) = w.addingReportingOverflow(frac)
        return overflow2 ? nil : total
    }
}
