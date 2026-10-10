import SwiftUI
#if os(iOS)
import AVFoundation
import UIKit
#endif

/// A text field for a pasted payment code: the fallback when there is no camera (Simulator, Mac) or
/// the camera is not allowed. The text goes through the same parser and checks as a scanned code.
struct CodeEntryField: View {
    let prompt: String
    let onSubmit: (String) -> Void
    @State private var text = ""

    var body: some View {
        HStack(spacing: 8) {
            TextField(prompt, text: $text)
                .font(LokaStyle.mono)
                .textFieldStyle(.roundedBorder)
                .autocorrectionDisabled()
                #if os(iOS)
                .textInputAutocapitalization(.never)
                #endif
                .onSubmit(submit)
            Button("Use", action: submit)
                .font(LokaStyle.label)
                .disabled(text.isEmpty)
        }
    }

    private func submit() {
        guard !text.isEmpty else { return }
        onSubmit(text)
        text = ""
    }
}

#if os(iOS)
/// Camera QR scanner (task 3.70). Kept thin: it only turns QR codes into strings and reports each
/// distinct string once; `ScanParser` and the models do every check. Needs a device camera and the
/// app's NSCameraUsageDescription, so it is not unit-tested.
public struct PaymentScannerView: UIViewControllerRepresentable {
    let onScan: (String) -> Void

    public init(onScan: @escaping (String) -> Void) { self.onScan = onScan }

    public func makeUIViewController(context: Context) -> PaymentScannerController {
        PaymentScannerController(onScan: onScan)
    }

    public func updateUIViewController(_ controller: PaymentScannerController, context: Context) {}

    public static func dismantleUIViewController(_ controller: PaymentScannerController, coordinator: ()) {
        controller.stop()
    }
}

public final class PaymentScannerController: UIViewController, AVCaptureMetadataOutputObjectsDelegate {
    private let session = AVCaptureSession()
    private let queue = DispatchQueue(label: "us.zerobars.lokapay.scanner")
    private let onScan: (String) -> Void
    private var preview: AVCaptureVideoPreviewLayer?
    private var lastValue: String?
    private let label = UILabel()

    init(onScan: @escaping (String) -> Void) {
        self.onScan = onScan
        super.init(nibName: nil, bundle: nil)
    }

    required init?(coder: NSCoder) { nil }

    public override func viewDidLoad() {
        super.viewDidLoad()
        view.backgroundColor = UIColor(red: 0x1F / 255, green: 0x1A / 255, blue: 0x15 / 255, alpha: 1)
        label.textColor = .white
        label.numberOfLines = 0
        label.textAlignment = .center
        label.font = .preferredFont(forTextStyle: .headline)
        label.adjustsFontForContentSizeCategory = true
        label.text = "Point the camera at a LOKA payment code"
        view.addSubview(label)
        AVCaptureDevice.requestAccess(for: .video) { [weak self] granted in
            guard let self else { return }
            if granted {
                self.queue.async { self.configure() }
            } else {
                DispatchQueue.main.async {
                    self.label.text = "Camera access is off. Paste the code instead, or allow the camera in Settings."
                }
            }
        }
    }

    private func configure() {
        guard let camera = AVCaptureDevice.default(for: .video),
              let input = try? AVCaptureDeviceInput(device: camera), session.canAddInput(input) else {
            return showUnavailable()
        }
        session.beginConfiguration()
        session.addInput(input)
        let output = AVCaptureMetadataOutput()
        guard session.canAddOutput(output) else {
            session.commitConfiguration()
            return showUnavailable()
        }
        session.addOutput(output)
        output.setMetadataObjectsDelegate(self, queue: .main)
        guard output.availableMetadataObjectTypes.contains(.qr) else {
            session.commitConfiguration()
            return showUnavailable()
        }
        output.metadataObjectTypes = [.qr]
        session.commitConfiguration()
        DispatchQueue.main.async { [weak self] in
            guard let self else { return }
            let layer = AVCaptureVideoPreviewLayer(session: self.session)
            layer.videoGravity = .resizeAspectFill
            layer.cornerRadius = 22
            layer.masksToBounds = true
            self.view.layer.insertSublayer(layer, at: 0)
            self.preview = layer
            self.view.setNeedsLayout()
        }
        session.startRunning()
    }

    private func showUnavailable() {
        DispatchQueue.main.async { self.label.text = "Camera unavailable. Paste the code instead." }
    }

    public override func viewDidLayoutSubviews() {
        super.viewDidLayoutSubviews()
        let area = view.safeAreaLayoutGuide.layoutFrame
        let side = min(area.width - 32, area.height * 0.7)
        let frame = CGRect(x: area.midX - side / 2, y: area.minY + 16, width: side, height: side)
        preview?.frame = frame
        label.frame = CGRect(x: 16, y: frame.maxY + 12, width: area.width - 32, height: 72)
    }

    public func metadataOutput(_ output: AVCaptureMetadataOutput, didOutput objects: [AVMetadataObject],
                               from connection: AVCaptureConnection) {
        guard let value = objects.compactMap({ $0 as? AVMetadataMachineReadableCodeObject }).first?.stringValue,
              value != lastValue else { return }
        lastValue = value
        UIImpactFeedbackGenerator(style: .light).impactOccurred()
        onScan(value)
    }

    func stop() {
        queue.async { if self.session.isRunning { self.session.stopRunning() } }
    }
}
#endif

/// The scan sheet: the camera on iPhone with a paste field under it; the paste field alone elsewhere.
struct ScanSheet: View {
    let title: String
    /// The screen's latest issue, repeated here so a refused scan is visible over the camera.
    let issue: MoneyIssue?
    let onText: (String) -> Void
    @Environment(\.dismiss) private var dismiss

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 12) {
                HStack {
                    Text(title).font(LokaStyle.title).foregroundStyle(LokaColor.ink)
                    Spacer()
                    Button("Done") { dismiss() }.font(LokaStyle.label)
                }
                #if os(iOS)
                PaymentScannerView(onScan: onText)
                    .frame(minHeight: 360)
                    .clipShape(RoundedRectangle(cornerRadius: LokaStyle.cornerRadius, style: .continuous))
                #endif
                CodeEntryField(prompt: "Or paste a code (L1|P|1|...)", onSubmit: onText)
                if let issue { IssueBanner(issue) }
            }
            .padding(16)
        }
        .background(LokaColor.paper.ignoresSafeArea())
    }
}

#if DEBUG
#Preview("Scan sheet: refused code") {
    ScanSheet(title: "Scan the payer's codes",
              issue: MoneyIssue(.wrongKind(expected: [.allowance, .note], got: .merchant), at: PreviewFixtures.now)) { _ in }
}
#endif
