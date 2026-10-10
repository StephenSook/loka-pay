import CoreGraphics
import Foundation
import Testing
@testable import LokaPay

/// The scanner's camera math. Inputs here are round numbers chosen to check the formulas by hand,
/// not measurements of any phone.
@Suite("Scanner camera math: zoom, scan square, rect of interest")
struct ScanGeometryTests {
    static func close(_ a: Double, _ b: Double, _ tolerance: Double = 1e-9) -> Bool { abs(a - b) <= tolerance }

    @Test("Apple's subject distance: a 50 mm code filling half of a 90 degree view is 100 mm away")
    func appleSubjectDistance() {
        // tan(45 degrees) = 1, so the distance is (50 / 0.5) / 1.
        #expect(Self.close(ScanGeometry.minimumSubjectDistance(fieldOfView: 90, codeSize: 50, fill: 0.5), 100))
    }

    @Test("a single camera zooms by minimum focus distance over subject distance, and not at all when it focuses close enough")
    func singleCamera() {
        let zoom = ScanGeometry.recommendedZoom(fieldOfView: 90, baseZoom: 1, minimumFocusDistance: 200,
                                                codeSize: 50, fill: 0.5, range: 1...10)
        #expect(Self.close(zoom, 2))
        let none = ScanGeometry.recommendedZoom(fieldOfView: 90, baseZoom: 1, minimumFocusDistance: 80,
                                                codeSize: 50, fill: 0.5, range: 1...10)
        #expect(Self.close(none, 1))
    }

    @Test("a virtual device starts from its wide camera's framing, never its ultra wide's, and zooms from there")
    func virtualDevice() {
        // At base zoom 2 the wide camera sees tan(half angle) = 0.5, so the subject distance is 200 mm.
        let zoom = ScanGeometry.recommendedZoom(fieldOfView: 90, baseZoom: 2, minimumFocusDistance: 300,
                                                codeSize: 50, fill: 0.5, range: 1...20)
        #expect(Self.close(zoom, 3))
        // The wide camera focuses close enough: the zoom stays at its framing, not at the ultra wide's 1.
        let base = ScanGeometry.recommendedZoom(fieldOfView: 90, baseZoom: 2, minimumFocusDistance: 150,
                                                codeSize: 50, fill: 0.5, range: 1...20)
        #expect(Self.close(base, 2))
    }

    @Test("an unknown focus distance or field of view keeps the base zoom; a broken base zoom counts as 1")
    func unknownInputs() {
        #expect(ScanGeometry.recommendedZoom(fieldOfView: 90, baseZoom: 2, minimumFocusDistance: -1,
                                             fill: 0.5, range: 1...20) == 2)
        #expect(ScanGeometry.recommendedZoom(fieldOfView: 0, baseZoom: 1, minimumFocusDistance: 200,
                                             fill: 0.5, range: 1...20) == 1)
        // A NaN base counts as 1: the single-camera answer for these inputs is 2.
        #expect(Self.close(ScanGeometry.recommendedZoom(fieldOfView: 90, baseZoom: .nan, minimumFocusDistance: 200,
                                                        codeSize: 50, fill: 0.5, range: 1...20), 2))
    }

    @Test("the zoom always lies inside the device's range")
    func clamped() {
        #expect(ScanGeometry.recommendedZoom(fieldOfView: 90, baseZoom: 1, minimumFocusDistance: 1000,
                                             codeSize: 50, fill: 0.5, range: 1...2.5) == 2.5)
        #expect(ScanGeometry.recommendedZoom(fieldOfView: 90, baseZoom: 1, minimumFocusDistance: 10,
                                             codeSize: 50, fill: 0.5, range: 1.5...4) == 1.5)
    }

    @Test("at the minimum focus distance, the recommended zoom shows the code across half the scan square")
    func halfTheScanSquare() {
        let fieldOfView = 100.0, distance = 200.0, code = ScanGeometry.codeWidthMM
        let fill = ScanGeometry.squareShare(width: 1920, height: 1080)
        let zoom = ScanGeometry.recommendedZoom(fieldOfView: fieldOfView, baseZoom: 2, minimumFocusDistance: distance,
                                                fill: fill, range: 1...20)
        #expect(zoom > 2, "this camera cannot focus near enough without zoom")
        // The frame's long side at that distance and zoom, and the code's share of the scan square.
        let frameWidth = 2 * distance * tan(fieldOfView / 2 * Double.pi / 180) / zoom
        #expect(Self.close(code / frameWidth / fill, 0.5))
    }

    @Test("a square preview shows the short side over the long side of the frame")
    func squareShare() {
        #expect(ScanGeometry.squareShare(width: 1920, height: 1080) == 0.5625)
        #expect(ScanGeometry.squareShare(width: 1080, height: 1920) == 0.5625)
        #expect(ScanGeometry.squareShare(width: 4032, height: 3024) == 0.75)
        #expect(ScanGeometry.squareShare(width: 0, height: 1080) == 1)
    }

    @Test("the wide camera's base zoom and the next switch-over come from the constituent order")
    func wideCameraZooms() {
        // Ultra wide, wide, telephoto.
        let triple = ScanGeometry.wideCameraZooms(wideIndex: 1, switchOvers: [2, 6])
        #expect(triple.base == 2 && triple.next == 6)
        // Ultra wide, wide.
        let dualWide = ScanGeometry.wideCameraZooms(wideIndex: 1, switchOvers: [2])
        #expect(dualWide.base == 2 && dualWide.next == nil)
        // Wide, telephoto.
        let dual = ScanGeometry.wideCameraZooms(wideIndex: 0, switchOvers: [2])
        #expect(dual.base == 1 && dual.next == 2)
        // A single camera, or an index that does not fit the factors.
        for (index, factors) in [(nil, [Double]()), (Optional(5), [2.0, 6.0]), (Optional(-1), [2.0])] {
            let single = ScanGeometry.wideCameraZooms(wideIndex: index, switchOvers: factors)
            #expect(single.base == 1 && single.next == nil)
        }
    }

    @Test("the rect of interest is the preview's rect when usable, and the whole frame otherwise")
    func rectOfInterest() {
        let visible = CGRect(x: 0.21875, y: 0, width: 0.5625, height: 1)
        #expect(ScanGeometry.rectOfInterest(visible) == visible)
        #expect(ScanGeometry.rectOfInterest(CGRect(x: -0.1, y: 0, width: 0.6, height: 1.2))
                == CGRect(x: 0, y: 0, width: 0.5, height: 1))
        #expect(ScanGeometry.rectOfInterest(.zero) == nil)
        #expect(ScanGeometry.rectOfInterest(CGRect(x: 0.4, y: 0.4, width: 0.1, height: 0.1)) == nil)
        #expect(ScanGeometry.rectOfInterest(CGRect(x: 2, y: 2, width: 1, height: 1)) == nil)
        #expect(ScanGeometry.rectOfInterest(CGRect(x: CGFloat.nan, y: 0, width: 1, height: 1)) == nil)
    }
}
