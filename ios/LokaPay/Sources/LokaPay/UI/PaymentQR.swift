import CoreImage
import CoreImage.CIFilterBuiltins
import Foundation
import SwiftUI

/// QR codes for the camera path (task 3.70). Every code is the plain transport text
/// `L1|P|1|<kind>|<base64url>` (PAYMENT-V1 section 5), so a scanned code goes through the same
/// decoder and the same checks as a Bluetooth packet. Error correction level M: level L would draw
/// the payer's two codes one or two versions smaller (`PaymentQRTests` measures it), modules at most
/// about 12 percent larger on the same screen, which is not worth half of M's recovery margin.
public enum PaymentQR {
    public static let correctionLevel = "M"

    /// The unscaled code (one pixel per module, with the generator's one-module margin).
    public static func ciImage(for text: String, correctionLevel level: String = correctionLevel) -> CIImage? {
        let filter = CIFilter.qrCodeGenerator()
        filter.message = Data(text.utf8)
        filter.correctionLevel = level
        return filter.outputImage
    }

    /// The QR version (1 to 40) Core Image draws for `text` at a correction level. A version-v symbol
    /// is 17 + 4v modules wide, and the generator adds one module of margin on each side.
    public static func version(for text: String, correctionLevel level: String = correctionLevel) -> Int? {
        guard let width = ciImage(for: text, correctionLevel: level)?.extent.width else { return nil }
        let modules = Int(width) - 2
        guard modules >= 21, (modules - 17) % 4 == 0 else { return nil }
        return (modules - 17) / 4
    }

    /// A crisp bitmap: each module becomes `scale` x `scale` pixels (no smoothing).
    public static func cgImage(for text: String, scale: CGFloat = 8) -> CGImage? {
        guard let image = ciImage(for: text) else { return nil }
        let scaled = image.transformed(by: CGAffineTransform(scaleX: scale, y: scale))
        return context.createCGImage(scaled, from: scaled.extent)
    }

    private static let context = CIContext(options: [.useSoftwareRenderer: false])
}

/// Turns camera or pasted text into a payment payload, or says exactly why not. Built on
/// `PaymentTransport.decode`, so the rules (version 1 only, canonical base64url, known kinds) are
/// the same as for mesh packets. Each screen says which kinds its current step accepts.
public enum ScanParser {
    /// Longer than any payment code: a receipt with a confirmation is 803 characters and an
    /// allowance with 16 earmarks (763 bytes) is 1,027.
    public static let maxLength = 2048

    public static func parse(_ text: String, accepting kinds: Set<PaymentTransport.Kind>)
        -> Result<(kind: PaymentTransport.Kind, payload: Data), MoneyIssueKind> {
        // A scanner may hand over a trailing newline; nothing else is forgiven.
        let trimmed = text.trimmingCharacters(in: .whitespacesAndNewlines)
        guard trimmed.utf8.count <= maxLength else { return .failure(.codeTooLong) }
        let decoded: (kind: PaymentTransport.Kind, payload: Data)?
        do {
            decoded = try PaymentTransport.decode(trimmed)
        } catch let error as PaymentError {
            return .failure(.payment(error))
        } catch {
            return .failure(.payment(.transport))
        }
        guard let decoded else { return .failure(.notPaymentCode) }
        guard kinds.contains(decoded.kind) else {
            let expected = PaymentTransport.Kind.allCases.filter { kinds.contains($0) }
            return .failure(.wrongKind(expected: expected, got: decoded.kind))
        }
        return .success(decoded)
    }
}

/// Shows one transport text as a QR code, with what it is underneath for VoiceOver and sighted
/// readers. The code is drawn on white with a quiet zone so phone cameras read it in dark mode.
struct PaymentQRView: View {
    let text: String
    let caption: String

    var body: some View {
        VStack(spacing: 10) {
            if let image = PaymentQR.cgImage(for: text) {
                Image(image, scale: 1, label: Text(caption))
                    .interpolation(.none)
                    .resizable()
                    .scaledToFit()
                    .padding(14)
                    .background(Color.white, in: RoundedRectangle(cornerRadius: 16, style: .continuous))
                    .overlay(RoundedRectangle(cornerRadius: 16, style: .continuous)
                        .strokeBorder(LokaColor.ink, lineWidth: LokaStyle.borderWidth))
                    .frame(maxWidth: 320)
                    .accessibilityLabel(Text("QR code: \(caption)"))
            } else {
                Text("This phone could not draw the QR code.")
                    .font(LokaStyle.body)
                    .foregroundStyle(LokaColor.ink)
            }
            Text(caption)
                .font(LokaStyle.label)
                .foregroundStyle(LokaColor.ink)
                .multilineTextAlignment(.center)
        }
        .frame(maxWidth: .infinity)
    }
}
