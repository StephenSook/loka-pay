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
