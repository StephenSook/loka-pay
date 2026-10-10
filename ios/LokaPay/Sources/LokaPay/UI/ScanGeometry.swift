import CoreGraphics
import Foundation

/// The camera math behind the payment-code scanner, kept free of AVFoundation so `swift test`
/// checks it on a Mac. `PaymentScannerController` feeds it the camera's own values.
public enum ScanGeometry {
    /// The width of a payment code on the other phone's screen, in millimeters. `PaymentQRView`
    /// draws at most 292 pt (320 pt less 14 pt of white on each side): about 48 mm on a 460 ppi
    /// iPhone at 3x, and 283 pt, about 44 mm, on a 375 pt wide iPhone at 2x and 326 ppi. The smaller
    /// end is used, so the zoom never overshoots the code.
    public static let codeWidthMM: Double = 45

    /// Apple's helper from "What's new in camera capture" (WWDC21) and its AVCamBarcode sample: the
    /// subject distance, in millimeters, at which a code `codeSize` mm wide fills `fill` of a camera
    /// whose horizontal field of view is `fieldOfView` degrees. Kept as Apple publishes it: it
    /// divides the full filled width by the tangent of half the angle, so at that distance the code
    /// spans half of `fill`, which leaves room to aim.
    public static func minimumSubjectDistance(fieldOfView: Double, codeSize: Double, fill: Double) -> Double {
        let radians = fieldOfView / 2 * Double.pi / 180
        let filledCodeSize = codeSize / fill
        return filledCodeSize / tan(radians)
    }

    /// The zoom factor Apple recommends for scanning codes: when the code would have to be held
    /// nearer than the camera's minimum focus distance to fill the scan square, zoom in by that ratio,
    /// so the code fills it from a distance the lens can focus at.
    ///
    /// - Parameters:
    ///   - fieldOfView: the device's horizontal field of view at zoom 1, in degrees.
    ///   - baseZoom: the zoom at which the camera that focuses takes over: 1 for a single camera, the
    ///     first switch-over factor for a virtual device that starts at its ultra wide camera.
    ///   - minimumFocusDistance: that camera's minimum focus distance in mm; zero or less is unknown.
    ///   - codeSize: the code's width in mm.
    ///   - fill: the share of the frame's long side that the scan square shows (`squareShare`).
    ///   - range: the zoom factors the device allows; the answer always lies in it.
    public static func recommendedZoom(fieldOfView: Double, baseZoom: Double, minimumFocusDistance: Double,
                                       codeSize: Double = codeWidthMM, fill: Double,
                                       range: ClosedRange<Double>) -> Double {
        let base = baseZoom.isFinite && baseZoom >= 1 ? baseZoom : 1
        var zoom = base
        if fieldOfView > 0, fieldOfView < 180, minimumFocusDistance > 0, codeSize > 0, fill > 0, fill <= 1 {
            // The horizontal field of view of the camera that takes over at the base zoom.
            let halfAngle = atan(tan(fieldOfView / 2 * Double.pi / 180) / base)
            let distance = minimumSubjectDistance(fieldOfView: 2 * halfAngle * 180 / Double.pi,
                                                  codeSize: codeSize, fill: fill)
            if distance < minimumFocusDistance { zoom = base * minimumFocusDistance / distance }
        }
        return min(max(zoom, range.lowerBound), range.upperBound)
    }

    /// The share of the camera frame's long side that a square preview shows when it fills itself
    /// with the frame (aspect fill): the short side over the long side, 0.5625 for 1920 x 1080.
    public static func squareShare(width: Double, height: Double) -> Double {
        guard width > 0, height > 0 else { return 1 }
        return min(width, height) / max(width, height)
    }

    /// For a virtual device: the zoom at which its wide angle camera takes over (`base`) and the zoom
    /// at which the next camera, a telephoto that focuses farther away, may take over (`next`).
    /// `wideIndex` is the wide camera's place in the device's constituent devices; the switch-over
    /// factors come in the same order, one fewer. A single camera answers (1, nil).
    public static func wideCameraZooms(wideIndex: Int?, switchOvers: [Double]) -> (base: Double, next: Double?) {
        guard let index = wideIndex, index >= 0, index <= switchOvers.count else { return (1, nil) }
        let base = index == 0 ? 1 : switchOvers[index - 1]
        let next = index < switchOvers.count ? switchOvers[index] : nil
        return (base, next)
    }

    /// The metadata rect of interest for what the preview shows, or nil to keep scanning the whole
    /// frame. The preview layer's conversion can answer an empty or out-of-range rect before the
    /// session has a format; the whole frame is then the safe answer, never a sliver that hides the
    /// code. A usable rect is at least a fifth of the frame on each side.
    public static func rectOfInterest(_ converted: CGRect) -> CGRect? {
        let values = [converted.origin.x, converted.origin.y, converted.width, converted.height]
        guard values.allSatisfy({ $0.isFinite }) else { return nil }
        let clipped = converted.standardized.intersection(CGRect(x: 0, y: 0, width: 1, height: 1))
        guard !clipped.isNull, clipped.width >= 0.2, clipped.height >= 0.2 else { return nil }
        return clipped
    }
}

/// The rect of interest the scanner gives its metadata output, decided here so it is tested
/// without a camera. Each update takes the preview's converted rect when it is usable
/// (`ScanGeometry.rectOfInterest`) and the whole frame otherwise (no rect, or an unusable one),
/// never the rect from before: one made for an earlier layout or camera format can leave the code
/// outside it.
struct ScanArea {
    static let wholeFrame = CGRect(x: 0, y: 0, width: 1, height: 1)

    /// The metadata output's own default.
    private(set) var rect = wholeFrame

    mutating func update(converted: CGRect?) {
        rect = converted.flatMap(ScanGeometry.rectOfInterest) ?? Self.wholeFrame
    }
}
