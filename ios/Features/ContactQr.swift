import SwiftUI
import CoreImage.CIFilterBuiltins
import AVFoundation
import PhotosUI
import Vision
import ImageIO
import Contacts

enum PhoneContactName {
    static func normalize(_ value: String) -> String? {
        guard value.count <= 40, value.allSatisfy({ "+0123456789 ()-.".contains($0) }) else { return nil }
        let number = value.filter { $0 == "+" || ("0"..."9").contains($0) }
        return number.range(of: #"^\+[1-9][0-9]{6,14}$"#, options: .regularExpression) == nil ? nil : number
    }
    static func lookup(_ value: String) throws -> String? {
        guard let number = normalize(value) else { throw ContactCodeError(text: "Include the country code, for example +1.") }
        let store = CNContactStore()
        let contacts = try store.unifiedContacts(matching: CNContact.predicateForContacts(matching: CNPhoneNumber(stringValue: number)),
            keysToFetch: [CNContactFormatter.descriptorForRequiredKeys(for: .fullName), CNContactPhoneNumbersKey as CNKeyDescriptor])
        let names = Set(contacts.filter { $0.phoneNumbers.contains { normalize($0.value.stringValue) == number } }
            .compactMap { CNContactFormatter.string(from: $0, style: .fullName)?.trimmingCharacters(in: .whitespacesAndNewlines) }
            .filter { !$0.isEmpty }.map { String($0.prefix(40)) })
        guard names.count <= 1 else { throw ContactCodeError(text: "More than one contact matches. Enter the name yourself.") }
        return names.first
    }
}

struct PhoneContactNameField: View {
    @Binding var name: String
    @State private var phone = ""
    @State private var busy = false
    @State private var status: String?
    @State private var request: Task<Void, Never>?
    var body: some View {
      Group {
        TextField("Phone number with country code (optional)", text: $phone).keyboardType(.phonePad)
            .disabled(busy).onChange(of: phone) { _, value in phone = String(value.prefix(40)); status = nil }
        Text("Use your phone’s contacts to fill a name. Contacts stay on this device; only the name you save is kept in LOKA.").font(.footnote).foregroundStyle(.secondary)
        Button(busy ? "Looking up name…" : "Use phone contacts") {
            let number = phone; busy = true
            request = Task { @MainActor in
                defer { busy = false }
                do {
                    let store = CNContactStore()
                    if CNContactStore.authorizationStatus(for: .contacts) == .notDetermined { _ = try await store.requestAccess(for: .contacts) }
                    let authorization = CNContactStore.authorizationStatus(for: .contacts)
                    var permitted = authorization == .authorized
                    if #available(iOS 18, *) { permitted = permitted || authorization == .limited }
                    guard permitted else { status = "Contacts access is off. You can still enter a name."; return }
                    let result = try await Task.detached(priority: .userInitiated) { try PhoneContactName.lookup(number) }.value
                    guard !Task.isCancelled else { return }
                    if let result { name = result; status = "Name filled from your contacts. You can edit it." }
                    else { status = "No exact match in accessible contacts. Check the country code or enter a name." }
                } catch { if !Task.isCancelled { status = "Could not read an unambiguous contact name. Check access in Settings or enter a name." } }
            }
        }.disabled(busy || PhoneContactName.normalize(phone) == nil)
        if let status { Text(status).font(.footnote).foregroundStyle(.secondary) }
      }.onDisappear { request?.cancel() }
    }
}

func contactQrImage(_ text: String) -> UIImage? {
    guard let image = ContactQrCodec.render(text) else { return nil }
    return UIImage(cgImage: image)
}
struct MyContactCodeView: View {
    @EnvironmentObject private var store: ContactStore
    @AppStorage("loka.profile.displayName") private var displayName = ""
    @State private var scanMode = false
    var body: some View {
        VStack(spacing: 0) {
            Picker("Contact code", selection: $scanMode) {
                Text("My code").tag(false)
                Text("Scan code").tag(true)
            }.pickerStyle(.segmented).padding(20)
            if scanMode {
                AddFriendView(startWithCamera: true).navigationTitle("My LOKA")
            } else {
                ScrollView {
                    VStack(spacing: 18) {
                        LokaAvatar(name: displayName.isEmpty ? "You" : displayName, size: 64)
                        Text(displayName.isEmpty ? "Your LOKA code" : displayName).font(.title2.bold())
                        Text("A new conversation starts here").foregroundStyle(LokaStyle.green)
                        if let key = store.publicKey, let link = try? ContactCode.encode(key), let image = contactQrImage(link) {
                            Image(uiImage: image).interpolation(.none).resizable().scaledToFit()
                                .padding(20).background(.white).frame(maxWidth: 232)
                                .accessibilityLabel("Your LOKA contact QR code")
                            Text("Let a friend scan your code. Your phone number stays private.")
                                .font(.subheadline).foregroundStyle(.secondary).multilineTextAlignment(.center)
                            ShareLink(item: link) { Label("Share My LOKA", systemImage: "square.and.arrow.up").frame(maxWidth: .infinity) }.buttonStyle(.borderedProminent)
                            DisclosureGroup("Your verification code") {
                                Text(ContactCode.fingerprint(key)).font(.system(.footnote, design: .monospaced)).textSelection(.enabled)
                            }
                        } else { ProgressView("Preparing your contact code…") }
                    }.padding(24).background(LokaStyle.surface).clipShape(RoundedRectangle(cornerRadius: 28)).padding(.horizontal, 20)
                    Text("Both people add each other. A nearby relay does not need your contact code.")
                        .font(.footnote).foregroundStyle(.secondary).padding(24)
                }
            }
        }.background(LokaStyle.background).navigationTitle("My LOKA").navigationBarTitleDisplayMode(.inline)
    }
}
private struct Candidate: Identifiable { let id = UUID(); let key: Data }
struct AddFriendView: View {
    var initialLink = ""
    var startWithCamera = false
    @State private var openedCamera = false
    @EnvironmentObject private var store: ContactStore
    @State private var link = ""
    @State private var scanning = false
    @State private var image: PhotosPickerItem?
    @State private var candidate: Candidate?
    @State private var error: String?
    @State private var busy = false
    @State private var friendSaved = false
    var body: some View {
        Form {
            if friendSaved {
                Section {
                    Label("Friend saved", systemImage: "checkmark.circle.fill").font(.headline)
                    Text("They’re saved on this iPhone. Share your LOKA QR so they can add you too.").foregroundStyle(.secondary)
                    NavigationLink { MyContactCodeView() } label: { Label("Share My LOKA", systemImage: "qrcode") }
                    Text("Keep both apps open while testing messages.").font(.footnote).foregroundStyle(.secondary)
                    Button("Add another friend") { friendSaved = false; link = "" }
                }
            } else {
            Section {
                Button { scanning = true } label: { Label("Scan QR", systemImage: "qrcode.viewfinder") }
                PhotosPicker(selection: $image, matching: .images) { Label("Choose QR image", systemImage: "photo") }.disabled(busy)
                NavigationLink { MyContactCodeView() } label: { Label("Share My LOKA", systemImage: "square.and.arrow.up") }
            }
            Section("Contact link") {
                TextField("Paste a LOKA contact link", text: $link).textInputAutocapitalization(.never).autocorrectionDisabled()
                Button("Review contact") { review(link) }.disabled(link.isEmpty)
            }

            if busy { ProgressView("Reading contact code…") }
            if let error = error { Text(error).foregroundStyle(.red) }
            Section {
                DisclosureGroup("More about adding friends") {
                    Text("Check the codes with your friend before adding them. Friends are saved on this phone; your friend needs to add you too. LOKA Number search and contact syncing aren’t available yet.").foregroundStyle(.secondary)
                }
            }
            }
        }.navigationTitle("Add someone").navigationBarTitleDisplayMode(.inline)
        .task { if !initialLink.isEmpty { link = initialLink }; if startWithCamera && !openedCamera { openedCamera = true; scanning = true } }
        .sheet(isPresented: $scanning) {
            NavigationStack {
                CameraQrView { value in scanning = false; review(value) }
                    .navigationTitle("Scan contact code")
                    .toolbar { ToolbarItem(placement: .cancellationAction) { Button { scanning = false } label: { Image(systemName: "chevron.left").frame(width: 44, height: 44) }.accessibilityLabel("Go back") } }
            }
        }
        .sheet(item: $candidate) { value in NavigationStack { VerifyContactView(key: value.key) { friendSaved = true } }.environmentObject(store) }
        .onChange(of: image) { _, value in
            guard let value = value else { return }
            busy = true; error = nil
            Task {
                do {
                    guard let data = try await value.loadTransferable(type: Data.self), data.count <= 16 * 1024 * 1024 else { throw ContactCodeError(text: "Choose a QR image smaller than 16 MB") }
                    let payload = try await Task.detached(priority: .userInitiated) { () -> String in
                        try ContactQrCodec.decodeImage(data)
                    }.value
                    review(payload)
                } catch { self.error = error.localizedDescription }
                busy = false; image = nil
            }
        }
    }
    private func review(_ value: String) {
        do {
            let key = try ContactCode.decode(value)
            guard let own = store.publicKey else { throw ContactCodeError(text: "Your identity is still loading") }
            guard key != own else { throw ContactCodeError(text: "This is your own contact code") }
            error = nil; candidate = Candidate(key: key)
        } catch { self.error = error.localizedDescription }
    }
}
struct VerifyContactView: View {
    let key: Data
    var onSaved: () -> Void = {}
    @EnvironmentObject private var store: ContactStore
    @Environment(\.dismiss) private var dismiss
    @State private var name = ""
    @State private var compared = false
    @State private var error: String?
    var body: some View {
        Form {
            Section("Verification code") {
                Text(ContactCode.fingerprint(key)).font(.system(.body, design: .monospaced)).textSelection(.enabled)
                Text("Ask your friend to open My LOKA. Check that every character matches.").foregroundStyle(.secondary)
            }
            Section { TextField("Friend’s name", text: $name).onChange(of: name) { _, value in if value.count > 40 { name = String(value.prefix(40)) } }
                PhoneContactNameField(name: $name)
                Toggle("The codes match", isOn: $compared)
            }
            if let error = error { Text(error).foregroundStyle(.red) }
            Section {
                Button("Add friend") {
                    do { try store.add(key, name: name); onSaved(); dismiss() } catch { self.error = error.localizedDescription }
                }.disabled(!compared)
            }
        }.navigationTitle("Verify friend").navigationBarTitleDisplayMode(.inline)
        .toolbar { ToolbarItem(placement: .cancellationAction) { Button("Cancel") { dismiss() } } }
    }
}
struct CameraQrView: UIViewControllerRepresentable {
    let scanned: (String) -> Void
    func makeUIViewController(context: Context) -> QrCameraController { QrCameraController(scanned: scanned) }
    func updateUIViewController(_ controller: QrCameraController, context: Context) {}
    static func dismantleUIViewController(_ controller: QrCameraController, coordinator: ()) { controller.stop() }
}
final class QrCameraController: UIViewController, AVCaptureMetadataOutputObjectsDelegate {
    private let session = AVCaptureSession()
    private let queue = DispatchQueue(label: "org.loka.qr.camera")
    private let scanned: (String) -> Void
    private var preview: AVCaptureVideoPreviewLayer?
    private var finished = false
    private var cancelled = false
    private let label = UILabel()
    private let frameLayer = CAShapeLayer()
    private let scanLine = CALayer()
    init(scanned: @escaping (String) -> Void) { self.scanned = scanned; super.init(nibName: nil, bundle: nil) }
    required init?(coder: NSCoder) { fatalError("init(coder:) unavailable") }
    override func viewDidLoad() {
        super.viewDidLoad(); view.backgroundColor = .black
        label.textColor = .white; label.numberOfLines = 0; label.textAlignment = .center
        label.text = "Point your camera at a friend’s LOKA QR code"; view.addSubview(label)
        frameLayer.fillColor = UIColor.clear.cgColor
        frameLayer.strokeColor = UIColor(red: 0.51, green: 0.86, blue: 0.72, alpha: 1).cgColor
        frameLayer.lineWidth = 3; view.layer.addSublayer(frameLayer)
        scanLine.backgroundColor = frameLayer.strokeColor; scanLine.isHidden = true; view.layer.addSublayer(scanLine)
        AVCaptureDevice.requestAccess(for: .video) { [weak self] granted in
            guard let self = self else { return }
            if granted { self.queue.async { self.configure() } }
            else { DispatchQueue.main.async { self.label.text = "Camera access is unavailable. Close this screen and choose a QR image or paste a contact link." } }
        }
    }
    private func configure() {
        guard !cancelled, let camera = AVCaptureDevice.default(for: .video), let input = try? AVCaptureDeviceInput(device: camera), session.canAddInput(input) else { showError(); return }
        session.beginConfiguration(); session.addInput(input)
        let output = AVCaptureMetadataOutput()
        guard session.canAddOutput(output) else { session.commitConfiguration(); showError(); return }
        session.addOutput(output); output.setMetadataObjectsDelegate(self, queue: .main)
        guard output.availableMetadataObjectTypes.contains(.qr) else { session.commitConfiguration(); showError(); return }
        output.metadataObjectTypes = [.qr]; session.commitConfiguration()
        DispatchQueue.main.async { [weak self] in
            guard let self = self else { return }
            let layer = AVCaptureVideoPreviewLayer(session: self.session); layer.videoGravity = .resizeAspectFill
            self.preview = layer; layer.cornerRadius = 24; layer.masksToBounds = true; self.view.layer.insertSublayer(layer, at: 0); self.scanLine.isHidden = false; self.view.setNeedsLayout()
        }
        if !cancelled { session.startRunning() }
    }
    private func showError() { DispatchQueue.main.async { self.label.text = "Camera unavailable. Use a QR image or contact link instead." } }
    override func viewDidLayoutSubviews() {
        super.viewDidLayoutSubviews()
        let area = view.safeAreaLayoutGuide.layoutFrame
        let size = min(320, area.width - 48, area.height * 0.58)
        let frame = CGRect(x: area.midX - size / 2, y: area.midY - size / 2 - 30, width: size, height: size)
        preview?.frame = frame
        frameLayer.path = UIBezierPath(roundedRect: frame, cornerRadius: 24).cgPath
        label.frame = CGRect(x: 24, y: frame.maxY + 24, width: area.width - 48, height: 90)
        scanLine.removeAllAnimations()
        scanLine.frame = CGRect(x: frame.minX + 16, y: frame.minY + 24, width: size - 32, height: 2)
        if !UIAccessibility.isReduceMotionEnabled && !scanLine.isHidden {
            let animation = CABasicAnimation(keyPath: "position.y")
            animation.fromValue = frame.minY + 24; animation.toValue = frame.maxY - 24
            animation.duration = 1.8; animation.autoreverses = true; animation.repeatCount = .infinity
            scanLine.add(animation, forKey: "scanning")
        }
    }
    func metadataOutput(_ output: AVCaptureMetadataOutput, didOutput objects: [AVMetadataObject], from connection: AVCaptureConnection) {
        guard !finished, let preview = preview,
              let object = objects.compactMap({ $0 as? AVMetadataMachineReadableCodeObject }).first,
              let visible = preview.transformedMetadataObject(for: object),
              preview.bounds.contains(CGPoint(x: visible.bounds.midX, y: visible.bounds.midY)),
              let value = object.stringValue else { return }
        guard (try? ContactCode.decode(value)) != nil else { label.text = "That is not a supported LOKA contact code"; return }
        finished = true; stop(); scanned(value)
    }
    func stop() { queue.async { self.cancelled = true; if self.session.isRunning { self.session.stopRunning() } } }
}
