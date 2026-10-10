import Foundation
import LokaPay
import SwiftUI

/// App-side entry point to the LokaPay package (ios/LokaPay, tasks 1.5 and 1.10).
/// Payment logic stays in the package (D7); this file keeps the app glue small. All app-side
/// payment glue lives in this one file, so the Xcode project needs no new source files.
enum LokaPayBridge {
    /// True when this device can hold a Secure Enclave payment key.
    static var secureEnclaveAvailable: Bool { SecureEnclaveP256Signer.isAvailable }
}

// MARK: - App-level payment store (plan rows 1.10 and 3.71)

/// Everything the payment screens need, for the app's lifetime: the pins from the bundled
/// config/pins.json, this phone's Secure Enclave key, the durable serial and ledger files, one
/// connectivity monitor, one Bluetooth inbox, the settlement client (only when the server key is
/// pinned) and the two certificates from registration.
///
/// Payment state lives in Application Support/LokaPay. LOKA's own data reset removes only
/// top-level `loka-` files, so it leaves this folder alone on purpose: forgetting the serial
/// counters or the ledger would reuse serials or forget value a merchant is carrying. The folder
/// is excluded from backups because everything in it is bound to this phone's enclave key, which
/// never leaves the phone.
@MainActor
final class LokaPayStore: ObservableObject {
    /// The one store for the app's lifetime (it outlives LOKA's view resets).
    static let shared = LokaPayStore()

    /// config/pins.json as this build carries it.
    enum Pins: Equatable {
        case ready(deployment: Deployment, serverPublicKey: Data?)
        /// The file is missing from the bundle or does not parse; the text says which.
        case unreadable(String)
    }

    /// This phone's payment key.
    enum KeyState: Equatable {
        case notLoaded
        case loading
        case ready
        /// No Secure Enclave on this device (the Simulator, for one). Pay stays locked: payments
        /// never fall back to a software key.
        case noSecureEnclave
        /// The enclave or the Keychain refused; the text is the system's error.
        case failed(String)
    }

    /// A stored certificate, checked against the pinned server key and this phone's key.
    enum Certificate: Equatable {
        case none
        /// Stored, but it cannot be checked yet (no server key pinned, or no key on this phone).
        case unchecked
        /// Verified with the pinned server key, and it names this phone's key.
        case verified
        /// Stored, but it does not check out; `name` is the failed check.
        case notValid(name: String)
    }

    /// Thrown when a verified certificate could not be written to the payment folder.
    struct SaveFailed: Error, Equatable {
        let file: String
        let detail: String
    }

    static let keyAccount = "payment-key-v1"
    static let allowanceFile = "allowance.wire"
    static let merchantFile = "merchant.wire"

    let pins: Pins
    let serials: SerialReservations
    let ledger: OfflineLedger
    let connectivity = ConnectivityMonitor()
    /// The one Bluetooth inbox for the app's lifetime. Nothing feeds it yet (the mesh glue is a
    /// later task), so the screens are not given it: Receive mentions Bluetooth only when it is.
    let inbox = PaymentInbox()
    /// Only when config/pins.json pins the server key: without it nothing the server signs can be
    /// checked, so the app does not call the server at all.
    let settlementClient: SettlementClient?

    @Published private(set) var keyState: KeyState = .notLoaded
    private(set) var signer: SecureEnclaveP256Signer?
    @Published private(set) var allowanceWire: Data?
    @Published private(set) var merchantWire: Data?
    @Published private(set) var allowance: Certificate = .none
    @Published private(set) var merchant: Certificate = .none
    /// The name in the verified merchant certificate.
    @Published private(set) var merchantName: String?
    /// A problem with the payment folder, in plain words; nil when there is none.
    @Published private(set) var storageProblem: String?
    /// Changes whenever a stored certificate changes, so the Pay screens rebuild their models.
    @Published private(set) var wiresVersion = 0

    /// Which registration call is running, if any.
    enum SetupStep: Equatable {
        case idle
        case payer
        case merchant
    }

    @Published private(set) var setupStep: SetupStep = .idle
    /// Why the last setup attempt stopped; nil after a clean run.
    @Published private(set) var setupIssue: LokaPaySetupIssue?

    private let directory: URL

    init(bundle: Bundle = .main) {
        pins = Self.loadPins(bundle: bundle)
        let support = FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0]
        directory = support.appendingPathComponent("LokaPay", isDirectory: true)
        serials = SerialReservations(url: directory.appendingPathComponent("serials.json"))
        ledger = OfflineLedger(url: directory.appendingPathComponent("ledger.json"))
        if case .ready(let deployment, let serverKey?) = pins {
            settlementClient = SettlementClient(deployment: deployment, serverPublicKey: serverKey,
                                                baseURL: SettlementClient.defaultBaseURL)
        } else {
            settlementClient = nil
        }
        prepareDirectory()
        allowanceWire = readWire(Self.allowanceFile)
        merchantWire = readWire(Self.merchantFile)
        recheck()
    }

    /// The server's Ed25519 key from config/pins.json; nil while the file holds null.
    var serverPublicKey: Data? {
        if case .ready(_, let key) = pins { return key }
        return nil
    }

    /// Both certificates verified with the pinned server key and naming this phone's key.
    var isReady: Bool { keyState == .ready && allowance == .verified && merchant == .verified }

    /// What `LokaPayHomeView` needs, or nil until setup is complete. Bluetooth stays off in this
    /// build (meshSend and meshInbox nil): camera codes are the transport.
    var homeDependencies: LokaPayDependencies? {
        guard isReady, case .ready(let deployment, let serverKey?) = pins, let signer else { return nil }
        return LokaPayDependencies(deployment: deployment, serverPublicKey: serverKey, signer: signer,
                                   allowanceWire: allowanceWire, merchantWire: merchantWire,
                                   serials: serials, ledger: ledger, settlementClient: settlementClient,
                                   connectivity: connectivity, meshSend: nil, meshInbox: nil, bluetoothOn: nil)
    }

    // MARK: Key

    /// Loads this phone's enclave key, creating it on first use. Loading or creating the key shows
    /// no prompt; each signature asks for Face ID or the passcode.
    func prepareKey() {
        switch keyState {
        case .notLoaded, .failed: break
        case .loading, .ready, .noSecureEnclave: return
        }
        guard SecureEnclaveP256Signer.isAvailable else {
            keyState = .noSecureEnclave
            return
        }
        keyState = .loading
        let account = Self.keyAccount
        Task {
            do {
                let loaded = try await Task.detached(priority: .userInitiated) {
                    try SecureEnclaveP256Signer.loadOrCreate(account: account)
                }.value
                signer = loaded
                keyState = .ready
            } catch {
                signer = nil
                keyState = .failed(Self.systemText(error))
            }
            recheck()
        }
    }

    // MARK: Certificates

    /// Checks both stored certificates against the pinned server key and this phone's key.
    func recheck() {
        allowance = check(allowanceWire) { wire, deployment, serverKey in
            try AllowanceCertificate.verify(wire: wire, deployment: deployment, serverPublicKey: serverKey).payerKeyHash
        }
        var name: String?
        merchant = check(merchantWire) { wire, deployment, serverKey in
            let certificate = try MerchantCertificate.verify(wire: wire, deployment: deployment, serverPublicKey: serverKey)
            name = certificate.displayName
            return certificate.merchantKeyHash
        }
        merchantName = merchant == .verified ? name : nil
    }

    /// Stores an allowance wire that `SettlementClient.registerPayer` returned verified.
    func save(_ registration: VerifiedRegistration) throws {
        try write(registration.allowanceWire, to: Self.allowanceFile)
        allowanceWire = registration.allowanceWire
        recheck()
        wiresVersion += 1
    }

    /// Stores a merchant wire that `SettlementClient.registerMerchant` returned verified.
    func save(_ registration: VerifiedMerchant) throws {
        try write(registration.merchantWire, to: Self.merchantFile)
        merchantWire = registration.merchantWire
        recheck()
        wiresVersion += 1
    }

    private func check(_ wire: Data?, keyHash: (Data, Deployment, Data) throws -> Data) -> Certificate {
        guard let wire else { return .none }
        guard case .ready(let deployment, let serverKey?) = pins, let signer else { return .unchecked }
        do {
            return try keyHash(wire, deployment, serverKey) == signer.keyHash ? .verified : .notValid(name: "key_mismatch")
        } catch let error as PaymentError {
            return .notValid(name: error.rawValue)
        } catch {
            return .notValid(name: Self.systemText(error))
        }
    }

    // MARK: Files

    private func prepareDirectory() {
        do {
            try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
            var url = directory
            var values = URLResourceValues()
            values.isExcludedFromBackup = true
            try url.setResourceValues(values)
        } catch {
            storageProblem = "This phone could not prepare its payment folder (\(Self.systemText(error))). "
                + "Payments that need to save a record will stop and say so."
        }
    }

    /// The stored wire, or nil when none is stored. A file that exists but cannot be read is
    /// reported, never treated as silently empty.
    private func readWire(_ file: String) -> Data? {
        let url = directory.appendingPathComponent(file)
        guard FileManager.default.fileExists(atPath: url.path) else { return nil }
        do {
            return try Data(contentsOf: url)
        } catch {
            storageProblem = "This phone could not read its stored \(file) (\(Self.systemText(error)))."
            return nil
        }
    }

    private func write(_ wire: Data, to file: String) throws {
        do {
            try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
            try wire.write(to: directory.appendingPathComponent(file),
                           options: [.atomic, .completeFileProtectionUntilFirstUserAuthentication])
        } catch {
            throw SaveFailed(file: file, detail: Self.systemText(error))
        }
    }

    // MARK: Pins

    /// Reads config/pins.json from the app bundle with `LokaPins.parse`.
    static func loadPins(bundle: Bundle) -> Pins {
        guard let url = bundle.url(forResource: "pins", withExtension: "json") else {
            return .unreadable("config/pins.json is not in this build of the app.")
        }
        do {
            let parsed = try LokaPins.parse(Data(contentsOf: url))
            return .ready(deployment: parsed.deployment, serverPublicKey: parsed.serverPublicKey)
        } catch LokaPins.PinsError.notJSON {
            return .unreadable("config/pins.json in this build is not JSON.")
        } catch LokaPins.PinsError.badField(let field) {
            return .unreadable("config/pins.json in this build has a missing or invalid \(field).")
        } catch {
            return .unreadable("config/pins.json could not be read (\(systemText(error))).")
        }
    }

    /// The system's own words for an error, for the screens and logs.
    static func systemText(_ error: Error) -> String {
        if let error = error as? PaymentError { return error.rawValue }
        return (error as NSError).localizedDescription
    }
}

// MARK: - Registration (plan row 1.10)

/// The merchant name rule of PAYMENT-V1 4.6: 1 to 64 bytes of UTF-8 in Unicode NFC.
enum LokaPayMerchantName {
    static let maxBytes = 64

    /// The name as it is sent: trimmed, in NFC.
    static func normalized(_ text: String) -> String {
        text.trimmingCharacters(in: .whitespacesAndNewlines).precomposedStringWithCanonicalMapping
    }

    static func byteCount(_ text: String) -> Int { normalized(text).utf8.count }

    static func isValid(_ text: String) -> Bool { (1...maxBytes).contains(byteCount(text)) }
}

/// The typed merchant name breaks the 1 to 64 byte rule; nothing was sent.
struct LokaPayMerchantNameInvalid: Error, Equatable {
    let bytes: Int
}

/// Why setup stopped: a stable name for logs and tests, plain words for the screen, and when.
struct LokaPaySetupIssue: Equatable {
    let name: String
    let message: String
    let at: Date

    init(_ error: Error, at: Date = Date()) {
        let described = Self.describe(error)
        name = described.name
        message = described.message
        self.at = at
    }

    static func describe(_ error: Error) -> (name: String, message: String) {
        switch error {
        case let e as SettlementError:
            return (MoneyIssueKind.settlement(e).name, registrationMessage(e))
        case let e as LokaPayMerchantNameInvalid:
            return ("name_length", "The merchant name must be 1 to \(LokaPayMerchantName.maxBytes) bytes of text; "
                    + "this one is \(e.bytes). Nothing was sent.")
        case let e as LokaPayStore.SaveFailed:
            return ("storage", "The certificate verified, but this phone could not save \(e.file) (\(e.detail)). "
                    + "It was not stored. Try again: registering the same key again is safe.")
        case is CancellationError:
            return ("cancelled", "Setup was cancelled before the server answered. The step that was running stored nothing.")
        default:
            return ("unexpected_error", "Setup stopped on an error this screen does not expect (\(error)). "
                    + "The step that was running stored nothing.")
        }
    }

    /// Plain words for each settlement error during registration. A failed step never stores a
    /// certificate; one stored by an earlier step stays stored.
    static func registrationMessage(_ e: SettlementError) -> String {
        switch e {
        case .badJSON:
            return "The server could not read the registration request. Nothing was registered."
        case .badBase64url:
            return "The server says the key in the request is not canonical base64url. Nothing was registered."
        case .badPubkey:
            return "The server says this phone's key is not a valid compressed P-256 key. Nothing was registered."
        case .nameLength:
            return "The server refused the merchant name: it must be 1 to 64 bytes of UTF-8 after NFC."
        case .unknownNote:
            return "The server answered unknown_note, which registration never expects. Nothing was stored."
        case .refused(let check, _):
            return "The server refused the request (check: \(check)). Nothing was stored."
        case .rateLimited(let retryAfter, _):
            return retryAfter.map { "The server asked to wait \($0) s before trying again. Nothing was stored." }
                ?? "The server asked to wait before trying again. Nothing was stored."
        case .budgetExhausted:
            return "The server's daily sandbox budget for new registrations is spent. Nothing was registered."
        case .chainUnavailable:
            return "The server could not reach Solana devnet and signed nothing. Try again."
        case .http(let status, let name, _):
            return "The settlement server answered HTTP \(status)" + (name.map { " (\($0))" } ?? "")
                + ". It may not be running yet. Nothing was stored."
        case .network(let code):
            return "Could not reach the settlement server (\(networkWords(code))). Setup needs internet; try again with signal."
        case .transport(let detail):
            return "A network error stopped the request (\(detail)). Nothing was stored."
        case .invalidResponse(let detail):
            return "The server's answer was not the certificate this app expects (\(detail)), so nothing was stored. "
                + "If the server is still confirming the registration on chain, try again in a moment."
        case .verification(let check):
            return "The certificate did not verify with the pinned server key (check: \(check.rawValue)), so it was not stored."
        case .confirmationMismatch:
            return "The server's answer named a different request, so nothing was stored."
        case .payerMismatch:
            return "The allowance certificate is signed by the server but names a different key than this phone's, "
                + "so it was not stored."
        case .merchantMismatch:
            return "The merchant certificate is signed by the server but names a different key than this phone's, "
                + "so it was not stored."
        case .protocolViolation(let detail):
            return "The server's answer broke the API contract (\(detail)), so nothing was stored."
        case .stillPending:
            return "The server has not finished yet. Try again in a moment; registering again is safe."
        @unknown default:
            return "The settlement call stopped (\(e)). Nothing was stored."
        }
    }

    static func networkWords(_ code: URLError.Code) -> String {
        switch code {
        case .notConnectedToInternet: return "no internet"
        case .timedOut: return "timed out"
        case .networkConnectionLost: return "connection lost"
        case .cannotFindHost, .dnsLookupFailed: return "server name not found"
        case .cannotConnectToHost: return "server not answering"
        default: return "network error \(code.rawValue)"
        }
    }
}

extension LokaPayStore {
    /// True when setup can run now: the server key is pinned, this phone's key is loaded, nothing
    /// is running, and a certificate is still missing or not valid.
    var canRegister: Bool {
        settlementClient != nil && signer != nil && keyState == .ready && setupStep == .idle && !isReady
    }

    /// Registers this phone's key as a payer (POST /v1/payers), then as a merchant
    /// (POST /v1/merchants), skipping a certificate that is already stored and verified. A wire is
    /// stored only after SettlementClient verified it with the pinned server key and checked that
    /// it names this key. Nothing is retried automatically; both endpoints are idempotent by key,
    /// so tapping again is safe.
    func register(merchantName text: String) async {
        guard let client = settlementClient, let signer, keyState == .ready, setupStep == .idle else { return }
        setupIssue = nil
        let needsMerchant = merchant != .verified
        let name = LokaPayMerchantName.normalized(text)
        if needsMerchant, !LokaPayMerchantName.isValid(name) {
            setupIssue = LokaPaySetupIssue(LokaPayMerchantNameInvalid(bytes: name.utf8.count))
            return
        }
        let publicKey = signer.compressedPublicKey
        do {
            if allowance != .verified {
                setupStep = .payer
                try save(try await client.registerPayer(publicKey: publicKey))
            }
            if needsMerchant {
                setupStep = .merchant
                try save(try await client.registerMerchant(publicKey: publicKey, name: name))
            }
        } catch {
            setupIssue = LokaPaySetupIssue(error)
        }
        setupStep = .idle
    }
}

// MARK: - Set up payments (sandbox)

/// The Pay tab's first screen: registers this phone's key until both certificates are stored and
/// verified. With no server key pinned it says so and keeps the button off.
struct LokaPaySetupView: View {
    @ObservedObject var store: LokaPayStore
    @State private var name = ""

    private struct Blocker: Identifiable {
        let id: String
        let title: String
        let detail: String
    }

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 18) {
                SandboxBanner()
                Text("Set up payments (sandbox)")
                    .font(LokaPay.LokaStyle.title)
                    .foregroundStyle(LokaColor.ink)
                    .accessibilityAddTraits(.isHeader)
                Text("Setup registers this phone's own key with the settlement server: you get a sandbox allowance to pay "
                     + "with and a merchant certificate to get paid. It needs internet; the tokens are Solana devnet test "
                     + "tokens with no value.")
                    .font(LokaPay.LokaStyle.body)
                    .foregroundStyle(LokaColor.muted)
                    .fixedSize(horizontal: false, vertical: true)
                ForEach(blockers) { blocker in
                    notice(title: blocker.title, detail: blocker.detail, warning: true)
                }
                if case .failed = store.keyState {
                    Button("Load the payment key again") { store.prepareKey() }
                        .buttonStyle(LokaPaySetupButtonStyle(primary: false))
                }
                if let problem = store.storageProblem {
                    notice(title: "Payment folder problem", detail: problem, warning: true)
                }
                certificates
                if store.merchant != .verified { nameField }
                registerButton
                if let issue = store.setupIssue { issueCard(issue) }
            }
            .padding(16)
            .frame(maxWidth: 720)
            .frame(maxWidth: .infinity)
        }
        .background(LokaColor.paper.ignoresSafeArea())
        .onChange(of: store.setupIssue) { _, issue in
            guard let issue else { return }
            AccessibilityNotification.Announcement("Setup stopped. " + issue.message).post()
        }
    }

    /// Everything that keeps setup off, in plain words. The server key comes first: without it
    /// nothing the server signs can be checked.
    private var blockers: [Blocker] {
        var list: [Blocker] = []
        switch store.pins {
        case .unreadable(let reason):
            list.append(Blocker(id: "pins", title: "Payments cannot start in this build", detail: reason))
        case .ready(_, nil):
            list.append(Blocker(
                id: "server-key", title: "Payments are waiting for the settlement server's public key",
                detail: "config/pins.json in this build has no serverEd25519PublicKey yet, so this phone cannot check "
                    + "anything the server signs. Setup and every money screen stay off until a build carries the key."))
        case .ready:
            break
        }
        switch store.keyState {
        case .noSecureEnclave:
            list.append(Blocker(
                id: "enclave", title: "No Secure Enclave on this device",
                detail: "Payments are signed by a key that never leaves the Secure Enclave. This device has none "
                    + "(the Simulator has none), so Pay stays locked. No software key is used instead."))
        case .failed(let text):
            list.append(Blocker(id: "key", title: "The payment key could not be loaded",
                                detail: "The system said: \(text). Unlock the phone, then load it again."))
        case .notLoaded, .loading, .ready:
            break
        }
        return list
    }

    private var certificates: some View {
        VStack(alignment: .leading, spacing: 12) {
            Text("This phone's certificates")
                .font(LokaPay.LokaStyle.headline)
                .foregroundStyle(LokaColor.ink)
            certificateRow(title: "Allowance to pay with", route: "POST /v1/payers", status: store.allowance,
                           running: store.setupStep == .payer, extra: nil)
            certificateRow(title: "Merchant certificate to get paid", route: "POST /v1/merchants", status: store.merchant,
                           running: store.setupStep == .merchant, extra: store.merchantName.map { "Name: " + $0 })
        }
        .modifier(LokaPayCard(warning: false))
    }

    private func certificateRow(title: String, route: String, status: LokaPayStore.Certificate, running: Bool,
                                extra: String?) -> some View {
        let (symbol, words): (String, String) = {
            if running { return ("arrow.triangle.2.circlepath", "Registering with the server now.") }
            switch status {
            case .none: return ("circle", "Not registered yet.")
            case .unchecked: return ("clock", "Stored. It is checked once the server key and this phone's key are both available.")
            case .verified: return ("checkmark.seal.fill", "Stored and verified with the pinned server key.")
            case .notValid(let check):
                return ("exclamationmark.triangle.fill",
                        "Stored, but it does not check out (\(check)). Setting up again fetches a fresh one.")
            }
        }()
        return HStack(alignment: .top, spacing: 10) {
            Image(systemName: symbol)
                .foregroundStyle(status == .verified ? LokaColor.paidStrong : LokaColor.ink)
                .frame(width: 22)
                .accessibilityHidden(true)
            VStack(alignment: .leading, spacing: 3) {
                Text(title).font(LokaPay.LokaStyle.label).foregroundStyle(LokaColor.ink)
                Text(words).font(LokaPay.LokaStyle.caption).foregroundStyle(LokaColor.muted)
                    .fixedSize(horizontal: false, vertical: true)
                if let extra { Text(extra).font(LokaPay.LokaStyle.caption).foregroundStyle(LokaColor.ink) }
                Text(route).font(LokaPay.LokaStyle.mono).foregroundStyle(LokaColor.muted)
            }
        }
        .accessibilityElement(children: .combine)
    }

    private var nameField: some View {
        let bytes = LokaPayMerchantName.byteCount(name)
        return VStack(alignment: .leading, spacing: 6) {
            Text("Merchant display name")
                .font(LokaPay.LokaStyle.label)
                .foregroundStyle(LokaColor.ink)
            TextField("For example: Corner shop", text: $name)
                .textInputAutocapitalization(.words)
                .submitLabel(.done)
                .font(LokaPay.LokaStyle.body)
                .padding(12)
                .background(RoundedRectangle(cornerRadius: 12, style: .continuous).fill(LokaColor.card))
                .overlay(RoundedRectangle(cornerRadius: 12, style: .continuous)
                    .strokeBorder(LokaColor.ink, lineWidth: LokaPay.LokaStyle.borderWidth))
                .accessibilityLabel("Merchant display name")
            Text("\(bytes) of \(LokaPayMerchantName.maxBytes) bytes. Payers see this name before they pay. "
                 + "The first name registered for this phone's key stays on the certificate.")
                .font(LokaPay.LokaStyle.caption)
                .foregroundStyle(bytes > LokaPayMerchantName.maxBytes ? LokaColor.failedStrong : LokaColor.muted)
                .fixedSize(horizontal: false, vertical: true)
        }
    }

    private var nameReady: Bool { store.merchant == .verified || LokaPayMerchantName.isValid(name) }

    private var registerButton: some View {
        let running = store.setupStep != .idle
        let partial = store.allowance == .verified || store.merchant == .verified
        let title = running ? "Registering with the server" : partial ? "Finish setup (sandbox)" : "Register this phone (sandbox)"
        return VStack(alignment: .leading, spacing: 6) {
            Button {
                let typed = name
                Task { await store.register(merchantName: typed) }
            } label: {
                HStack(spacing: 8) {
                    if running { ProgressView().tint(LokaColor.paper) }
                    Text(title)
                }
            }
            .buttonStyle(LokaPaySetupButtonStyle(primary: true))
            .disabled(!store.canRegister || !nameReady)
            if let reason = offReason {
                Text(reason)
                    .font(LokaPay.LokaStyle.caption)
                    .foregroundStyle(LokaColor.muted)
                    .fixedSize(horizontal: false, vertical: true)
            }
        }
    }

    /// Why the button is off, when it is off for a reason other than a running request.
    private var offReason: String? {
        guard store.setupStep == .idle else { return nil }
        if let first = blockers.first { return "Setup is off: " + first.title + "." }
        if store.keyState == .loading || store.keyState == .notLoaded { return "Loading this phone's payment key." }
        if !nameReady { return "Enter a merchant name of 1 to \(LokaPayMerchantName.maxBytes) bytes." }
        return nil
    }

    private func notice(title: String, detail: String, warning: Bool) -> some View {
        VStack(alignment: .leading, spacing: 6) {
            Label(title, systemImage: warning ? "exclamationmark.octagon.fill" : "info.circle.fill")
                .font(LokaPay.LokaStyle.label)
            Text(detail)
                .font(LokaPay.LokaStyle.body)
                .fixedSize(horizontal: false, vertical: true)
        }
        .foregroundStyle(warning ? LokaColor.inkFixed : LokaColor.ink)
        .modifier(LokaPayCard(warning: warning))
        .accessibilityElement(children: .combine)
    }

    private func issueCard(_ issue: LokaPaySetupIssue) -> some View {
        VStack(alignment: .leading, spacing: 6) {
            Label("Stopped: " + issue.name, systemImage: "exclamationmark.octagon.fill")
                .font(LokaPay.LokaStyle.label)
            Text(issue.message)
                .font(LokaPay.LokaStyle.body)
                .fixedSize(horizontal: false, vertical: true)
            Text("At \(issue.at.formatted(date: .omitted, time: .standard)) (this phone's clock)")
                .font(LokaPay.LokaStyle.caption)
        }
        .foregroundStyle(LokaColor.inkFixed)
        .modifier(LokaPayCard(warning: true))
        .accessibilityElement(children: .combine)
    }
}

/// The money screens' card look (ink border, 22 pt corners), app side.
private struct LokaPayCard: ViewModifier {
    let warning: Bool

    func body(content: Content) -> some View {
        let shape = RoundedRectangle(cornerRadius: LokaPay.LokaStyle.cornerRadius, style: .continuous)
        return content
            .padding(16)
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(shape.fill(warning ? LokaColor.warningFill : LokaColor.card))
            .overlay(shape.strokeBorder(warning ? LokaColor.warningBorder : LokaColor.ink,
                                        lineWidth: LokaPay.LokaStyle.borderWidth))
    }
}

/// A full-width button in the money screens' style. Disabled, it is dimmed so it never looks
/// tappable; the tap target is at least 50 pt tall.
private struct LokaPaySetupButtonStyle: ButtonStyle {
    let primary: Bool

    func makeBody(configuration: Configuration) -> some View {
        LokaPaySetupButtonBody(configuration: configuration, primary: primary)
    }
}

private struct LokaPaySetupButtonBody: View {
    let configuration: ButtonStyleConfiguration
    let primary: Bool
    @Environment(\.isEnabled) private var isEnabled

    var body: some View {
        let shape = RoundedRectangle(cornerRadius: 16, style: .continuous)
        configuration.label
            .font(LokaPay.LokaStyle.headline)
            .foregroundStyle(primary ? LokaColor.paper : LokaColor.ink)
            .frame(maxWidth: .infinity, minHeight: 50)
            .padding(.horizontal, 12)
            .background(shape.fill(primary ? LokaColor.ink : LokaColor.card))
            .overlay(shape.strokeBorder(LokaColor.ink, lineWidth: LokaPay.LokaStyle.borderWidth))
            .opacity(isEnabled ? (configuration.isPressed ? 0.8 : 1) : 0.4)
    }
}

// MARK: - Pay tab (plan rows 3.71 entry point and 3.1)

/// The Pay tab: Set up payments until both certificates are stored and verified, then Pay and
/// Receive. The games stay one tap away in the Offline corner, which is kept alive underneath so
/// a game in progress survives a trip back to Pay.
struct LokaPayTab<OfflineCorner: View>: View {
    @ObservedObject var store: LokaPayStore
    @Binding var showOfflineCorner: Bool
    private let offlineCorner: OfflineCorner

    init(store: LokaPayStore, showOfflineCorner: Binding<Bool>, @ViewBuilder offlineCorner: () -> OfflineCorner) {
        self.store = store
        _showOfflineCorner = showOfflineCorner
        self.offlineCorner = offlineCorner()
    }

    var body: some View {
        ZStack {
            VStack(spacing: 0) {
                payBar
                payments
            }
            .background(LokaColor.paper.ignoresSafeArea())
            .opacity(showOfflineCorner ? 0 : 1)
            .allowsHitTesting(!showOfflineCorner)
            .accessibilityHidden(showOfflineCorner)
            VStack(spacing: 0) {
                cornerBar
                offlineCorner
            }
            .opacity(showOfflineCorner ? 1 : 0)
            .allowsHitTesting(showOfflineCorner)
            .accessibilityHidden(!showOfflineCorner)
        }
        .onAppear { store.prepareKey() }
    }

    /// Pay and Receive once setup is complete; until then, setup (which says what is missing).
    @ViewBuilder private var payments: some View {
        if let dependencies = store.homeDependencies {
            LokaPayHomeView(dependencies: dependencies).id(store.wiresVersion)
        } else {
            LokaPaySetupView(store: store)
        }
    }

    private var payBar: some View {
        HStack(spacing: 12) {
            Text("LOKA Pay (sandbox)")
                .font(LokaPay.LokaStyle.label)
                .foregroundStyle(LokaColor.muted)
            Spacer()
            Button { showOfflineCorner = true } label: {
                Label("Offline corner", systemImage: "gamecontroller")
                    .font(LokaPay.LokaStyle.label)
                    .foregroundStyle(LokaColor.ink)
                    .padding(.horizontal, 14)
                    .frame(minHeight: 44)
                    .background(Capsule().fill(LokaColor.card))
                    .overlay(Capsule().strokeBorder(LokaColor.ink, lineWidth: 2))
            }
            .buttonStyle(.plain)
            .accessibilityHint("Games to play with people nearby")
        }
        .padding(.horizontal, 16)
        .padding(.top, 8)
    }

    private var cornerBar: some View {
        HStack {
            Button { showOfflineCorner = false } label: {
                Label("Back to Pay", systemImage: "chevron.left")
                    .font(.system(size: 15, weight: .semibold))
                    .foregroundStyle(LokaStyle.green)
                    .frame(minHeight: 44)
                    .contentShape(Rectangle())
            }
            .buttonStyle(.plain)
            Spacer()
        }
        .padding(.horizontal, 16)
        .background(LokaStyle.background)
    }
}
