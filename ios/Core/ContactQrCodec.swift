import Foundation
import CoreImage.CIFilterBuiltins
import Vision
import ImageIO

struct ContactQrCodec {
    static func render(_ link: String) -> CGImage? {
        guard (try? ContactCode.decode(link)) != nil else { return nil }
        let filter = CIFilter.qrCodeGenerator()
        filter.message = Data(link.utf8); filter.correctionLevel = "M"
        guard let output = filter.outputImage else { return nil }
        let framed = output.composited(over: CIImage(color: .white).cropped(to: output.extent.insetBy(dx: -4, dy: -4)))
        let scaled = framed.transformed(by: CGAffineTransform(scaleX: 8, y: 8))
        return CIContext().createCGImage(scaled, from: scaled.extent)
    }
    static func decodeImage(_ data: Data) throws -> String {
        guard data.count <= 16 * 1024 * 1024, let source = CGImageSourceCreateWithData(data as CFData, nil),
              let image = CGImageSourceCreateThumbnailAtIndex(source, 0, [kCGImageSourceCreateThumbnailFromImageAlways: true, kCGImageSourceCreateThumbnailWithTransform: true, kCGImageSourceThumbnailMaxPixelSize: 2048] as CFDictionary) else { throw ContactCodeError(text: "Could not read that QR image") }
        let request = VNDetectBarcodesRequest(); request.symbologies = [.qr]
        try VNImageRequestHandler(cgImage: image).perform([request])
        let values = (request.results ?? []).compactMap(\.payloadStringValue).filter { (try? ContactCode.decode($0)) != nil }
        guard Set(values).count == 1, let found = values.first else { throw ContactCodeError(text: "Choose an image with one LOKA contact QR code") }
        return found
    }
}
