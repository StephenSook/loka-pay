import Combine
import CoreBluetooth
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

// MARK: - Key trust after a reinstall

/// Decides whether this install may sign with a payment key. The Keychain item holding the enclave
/// key's handle survives deleting the app, but the serial counters and the ledger in Application
/// Support do not. A surviving key would get its same open allowance back (registration is
/// idempotent by key) while the serial counter restarted at 0, so it could sign a serial it had
/// already used. A marker file, written in the payment folder when a new key is created, ties the
/// key to that folder; a key without a matching marker is never used. Foundation only, so the
/// cases can be checked without a phone.
enum LokaPayKeyTrust {
    /// The payment folder's record of which key its files belong to.
    struct Marker: Codable, Equatable {
        /// The Keychain account holding the key's handle.
        let account: String
        /// sha256 of the key's compressed public key, lowercase hex.
        let keyHash: String
    }

    enum MarkerRead: Equatable {
        case absent
        /// The file exists but could not be read just now (data protection before the first
        /// unlock, or another passing error); the text is the system's. Says nothing about the
        /// key, so it never locks: the decision runs again on retry.
        case unavailable(String)
        /// The file was read and its contents are not a marker.
        case malformed
        case present(Marker)
    }

    /// The accounts of the payment key items in the Keychain, or the OSStatus of a failed listing.
    enum KeychainRead: Equatable {
        case accounts([String])
        case unreadable(Int32)
    }

    enum LockReason: Equatable {
        /// A payment key is in the Keychain but this install has no marker for it.
        case keySurvivedReinstall
        /// The marker names a key that is not in the Keychain.
        case keyMissing
        /// The marker's key loaded, but its hash is not the marker's.
        case keyMismatch
        /// The marker file was read, and its contents are not a marker.
        case markerMalformed
    }

    enum Decision: Equatable {
        /// No marker and no payment key in the Keychain: first use on this install.
        case createFresh
        /// Load the marker's key, then require `confirms` before trusting it.
        case load(Marker)
        case locked(LockReason)
        /// The Keychain could not be listed, so a surviving key cannot be ruled out. Retry.
        case cannotCheck(Int32)
        /// The marker exists but could not be read just now. Nothing is decided or deleted. Retry.
        case markerUnavailable(String)
    }

    static func decide(marker: MarkerRead, keychain: KeychainRead) -> Decision {
        let accounts: [String]
        switch keychain {
        case .unreadable(let status): return .cannotCheck(status)
        case .accounts(let list): accounts = list
        }
        switch marker {
        case .unavailable(let detail): return .markerUnavailable(detail)
        case .malformed: return .locked(.markerMalformed)
        case .absent: return accounts.isEmpty ? .createFresh : .locked(.keySurvivedReinstall)
        case .present(let marker): return accounts.contains(marker.account) ? .load(marker) : .locked(.keyMissing)
        }
    }

    /// The loaded key is trusted only when its hash is the one the marker recorded.
    static func confirms(loadedKeyHash: String, marker: Marker) -> Bool {
        loadedKeyHash.lowercased() == marker.keyHash.lowercased()
    }

    /// A new Keychain account for each new key, so a key that failed to delete can never be
    /// loaded again by name.
    static func freshAccount(_ id: UUID = UUID()) -> String {
        "payment-key-" + id.uuidString.lowercased()
    }

    /// Reads the marker file. A read that throws is `unavailable` (retry), never `malformed`:
    /// only contents that were actually read and do not decode can lock.
    static func readMarker(exists: Bool, read: () throws -> Data) -> MarkerRead {
        guard exists else { return .absent }
        let data: Data
        do {
            data = try read()
        } catch {
            var text = (error as NSError).localizedDescription
            while text.hasSuffix(".") { text.removeLast() }
            return .unavailable(text)
        }
        return parseMarker(data)
    }

    static func parseMarker(_ data: Data) -> MarkerRead {
        guard let marker = try? JSONDecoder().decode(Marker.self, from: data), !marker.account.isEmpty,
              marker.keyHash.count == 64, marker.keyHash.allSatisfy(\.isHexDigit) else { return .malformed }
        return .present(marker)
    }
}

// MARK: - Payment key items in the Keychain

/// Lists and deletes the package's enclave key handles. `SecureEnclaveP256Signer` stores each one
/// as a generic password under this service (ios/LokaPay/Sources/LokaPay/Signing.swift) and
/// exposes only `loadOrCreate`, so the app needs its own view to find a key left by an earlier
/// install and to delete it.
enum LokaPayKeyItems {
    /// Must equal `Keychain.service` in Signing.swift. Creating a key checks it: the new account
    /// must then appear in `list()`, so a wrong value fails closed instead of hiding a key.
    static let service = "us.zerobars.lokapay.keys"

    static func list() -> LokaPayKeyTrust.KeychainRead {
        let query: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: service,
            kSecReturnAttributes as String: true,
            kSecMatchLimit as String: kSecMatchLimitAll,
        ]
        var out: CFTypeRef?
        let status = SecItemCopyMatching(query as CFDictionary, &out)
        if status == errSecItemNotFound { return .accounts([]) }
        guard status == errSecSuccess, let items = out as? [[String: Any]] else { return .unreadable(status) }
        return .accounts(items.compactMap { $0[kSecAttrAccount as String] as? String })
    }

    /// Deletes every payment key item; success or "not found" both leave none.
    static func deleteAll() -> OSStatus {
        let status = SecItemDelete([kSecClass as String: kSecClassGenericPassword,
                                    kSecAttrService as String: service] as CFDictionary)
        return status == errSecItemNotFound ? errSecSuccess : status
    }

    @discardableResult
    static func delete(account: String) -> OSStatus {
        SecItemDelete([kSecClass as String: kSecClassGenericPassword, kSecAttrService as String: service,
                       kSecAttrAccount as String: account] as CFDictionary)
    }

    #if DEBUG && targetEnvironment(simulator)
    /// Simulator check only (launch argument `--lokapay-plant-key-item`): adds a payment key item
    /// with no payment folder behind it, the state a reinstall leaves, so the lock can be seen
    /// without a real enclave key. Not compiled into device or Release builds.
    static func plantForSimulatorCheck() {
        guard ProcessInfo.processInfo.arguments.contains("--lokapay-plant-key-item") else { return }
        SecItemAdd([kSecClass as String: kSecClassGenericPassword, kSecAttrService as String: service,
                    kSecAttrAccount as String: "payment-key-planted-by-simulator-check",
                    kSecValueData as String: Data("planted".utf8),
                    kSecAttrAccessible as String: kSecAttrAccessibleWhenUnlockedThisDeviceOnly] as CFDictionary, nil)
    }
    #endif
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
/// never leaves the phone. Deleting the app does remove the folder while the key's Keychain item
/// stays, so the key is used only when the folder's marker names it (`LokaPayKeyTrust`), and the
/// serial and ledger stores are built only after that check passes.
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
        /// `SecureEnclave.isAvailable` is false on this device. Pay stays locked: payments never
        /// fall back to a software key. (An Apple silicon Simulator can report true and then fail
        /// at the Keychain instead, which is `failed`.)
        case noSecureEnclave
        /// A key exists that this install cannot trust (see `LokaPayKeyTrust`). It is never used;
        /// `startFresh()` replaces it.
        case locked(LokaPayKeyTrust.LockReason)
        /// The marker exists but could not be read just now; the text is the system's error.
        /// Nothing signs and nothing is deleted; `prepareKey()` runs the whole check again.
        case paused(String)
        /// The enclave or the Keychain refused; the text is the system's error.
        case failed(String)
    }

    /// What opening or replacing the key came to, off the main actor.
    enum KeyOutcome {
        case ready(SecureEnclaveP256Signer)
        case locked(LokaPayKeyTrust.LockReason)
        case paused(String)
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

    nonisolated static let allowanceFile = "allowance.wire"
    nonisolated static let merchantFile = "merchant.wire"
    nonisolated static let markerFile = "key-marker.json"

    let pins: Pins
    /// Built only once the key is trusted, so nothing can reserve a serial for a key whose serial
    /// record this install does not hold.
    private(set) var serials: SerialReservations?
    private(set) var ledger: OfflineLedger?
    let connectivity = ConnectivityMonitor()
    /// Payment texts over LOKA's Bluetooth mesh (PAYMENT-V1 section 5): the Receive inbox, the Pay
    /// returns inbox, and which contact each note came from. One for the app's lifetime, so it
    /// outlives LOKA's view resets like this store.
    let mesh = MeshPaymentRouter()
    /// The LOKA side of the glue, set by `LokaPayTab` when it appears (a LOKA reset rebuilds it).
    weak var meshChat: ChatStore?
    weak var meshContacts: ContactStore?
    /// The picker and the status line. Kept out of this store's published state, so a status
    /// change never rebuilds the Pay and Receive models.
    let meshNotes = LokaPayMeshNotes()
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
        #if DEBUG && targetEnvironment(simulator)
        LokaPayKeyItems.plantForSimulatorCheck()
        #endif
    }

    /// The server's Ed25519 key from config/pins.json; nil while the file holds null.
    var serverPublicKey: Data? {
        if case .ready(_, let key) = pins { return key }
        return nil
    }

    /// Both certificates verified with the pinned server key and naming this phone's key.
    var isReady: Bool { keyState == .ready && allowance == .verified && merchant == .verified }

    /// What `LokaPayHomeView` needs, or nil until setup is complete. Camera codes always work; the
    /// Bluetooth glue sends over LOKA's mesh to one contact at a time (`queueMeshSend`,
    /// `sendMeshReply`). `bluetoothOn` is the radio state LOKA's BleLink reports, or nil.
    func homeDependencies(bluetoothOn: Bool?) -> LokaPayDependencies? {
        guard isReady, case .ready(let deployment, let serverKey?) = pins, let signer, let serials, let ledger else {
            return nil
        }
        return LokaPayDependencies(deployment: deployment, serverPublicKey: serverKey, signer: signer,
                                   allowanceWire: allowanceWire, merchantWire: merchantWire,
                                   serials: serials, ledger: ledger, settlementClient: settlementClient,
                                   connectivity: connectivity,
                                   meshSend: { [weak self] text in self?.queueMeshSend(text) },
                                   meshInbox: mesh.receiveInbox, bluetoothOn: bluetoothOn,
                                   meshReturns: mesh.payInbox,
                                   meshReply: { [weak self] text, origin in self?.sendMeshReply(text, origin: origin) ?? true })
    }

    // MARK: Bluetooth over LOKA's mesh (tasks 2.1, 2.2 glue, 2.7)

    /// How the status lines name the transport: LOKA picks Bluetooth or local Wi-Fi per link.
    static let meshWords = "over LOKA (Bluetooth or local Wi-Fi)"

    /// ChatStore calls this with every decrypted text before LOKA's own handling. True: it was
    /// payment family text (`L1|P`), delivered, skipped as a retry or dropped here, so ChatStore must
    /// not show, store or notify it. False: not payment content; LOKA handles it as before.
    static func takeMeshText(_ text: String, from peer: String, packetID: String, fromContact: Bool) -> Bool {
        // Chat, games and receipts never touch the payment store.
        guard MeshPaymentText.isPaymentFamily(text) else { return false }
        let store = shared
        guard store.mesh.receive(text, from: peer, fromContact: fromContact, packetID: packetID) else { return false }
        // An ack that verifies for a note this phone sent: LOKA stops retrying that payment's packets.
        let answered = store.mesh.answered(by: text)
        if !answered.isEmpty {
            store.meshChat?.discardPaymentPackets(answered)
            store.meshNotes.status = "A signed ack for the payment this phone sent arrived from "
                + store.contactName(peer) + " " + meshWords + "."
        }
        return true
    }

    /// Pay's Bluetooth button hands over the allowance, then the note, in one go. They wait in the
    /// router while the payer picks the one LOKA contact (the merchant's phone) for this payment.
    func queueMeshSend(_ text: String) {
        mesh.queueOutgoing(text)
        if meshNotes.picker == nil { meshNotes.picker = LokaPayMeshPickerRequest() }
    }

    /// Sends what Pay handed over for this payment to `contactID` only, in order, through ChatStore.
    /// If any text cannot be queued, the ones already queued are withdrawn, so "not sent" is true.
    func sendQueuedMesh(to contactID: String) {
        let texts = mesh.takeOutgoing(for: contactID)
        meshNotes.picker = nil
        let name = contactName(contactID)
        guard !texts.isEmpty else { return }
        guard let chat = meshChat else {
            meshNotes.status = "Nothing was sent: LOKA's mesh is not running. Show the two codes instead."
            return
        }
        var packetIDs: [String] = []
        for text in texts {
            switch chat.sendPayment(to: contactID, text: text) {
            case .success(let id):
                packetIDs.append(id)
            case .failure(let problem):
                chat.discardPaymentPackets(packetIDs)
                meshNotes.status = "Not sent to " + name + ": " + problem.text + " Show the two codes instead."
                return
            }
        }
        if let note = texts.last(where: { $0.hasPrefix(MeshPaymentText.prefix + "N|") }) {
            mesh.sent(noteText: note, packetIDs: packetIDs)
        }
        meshNotes.status = "Allowance and note queued for " + name + " " + Self.meshWords
            + " (sandbox). LOKA tries for 5 minutes while " + name
            + "'s phone is in reach; Pay shows Received when the signed ack comes back. The codes still work."
    }

    /// The picker closed without a choice: nothing is sent.
    func cancelMeshSend() {
        guard !mesh.outgoing.isEmpty || meshNotes.picker != nil else { return }
        mesh.cancelOutgoing()
        meshNotes.picker = nil
        meshNotes.status = "Not sent over Bluetooth. Show the two codes instead."
    }

    /// Receive's replies (the ack, then the receipt) for the payment on screen go only to the
    /// sender of the one Bluetooth delivery its note was first accepted from (`MeshPaymentRouter.replyTarget`).
    /// Camera, an unknown delivery or the same note from two contacts: nothing is sent, and the
    /// status says why so the merchant shows the code. Returns false only for a passing failure
    /// (locked phone, full queue), so the reply is offered again later.
    func sendMeshReply(_ text: String, origin: MeshOrigin) -> Bool {
        let what = text.hasPrefix(MeshPaymentText.prefix + "X|") ? "Receipt" : "Ack"
        let peer: String
        switch mesh.replyTarget(for: text, origin: origin) {
        case .peer(let id):
            peer = id
        case .notOverBluetooth:
            meshNotes.status = what + " not sent over Bluetooth: this payment's note came by camera. Show the code to the payer."
            return true
        case .ambiguous:
            meshNotes.status = what + " not sent over Bluetooth: the same payment note arrived from more than one contact, "
                + "so it is not clear who paid. Show the code to the payer."
            return true
        case .unknown:
            meshNotes.status = what + " not sent over Bluetooth: this note was accepted before the app restarted, and this "
                + "phone does not know which contact first sent it. Show the code to the payer."
            return true
        }
        let name = contactName(peer)
        guard let chat = meshChat else {
            meshNotes.status = what + " not sent: LOKA's mesh is not running. Show the code to the payer."
            return false
        }
        switch chat.sendPayment(to: peer, text: text) {
        case .success:
            meshNotes.status = what + " queued for " + name + " " + Self.meshWords
                + " (sandbox), the contact this payment's note came from. LOKA tries for 5 minutes."
            return true
        case .failure(let problem):
            meshNotes.status = what + " not sent to " + name + ": " + problem.text + " Show the code to the payer."
            return false
        }
    }

    /// A contact's LOKA name, or a neutral word when it is not known here.
    func contactName(_ id: String) -> String {
        meshContacts?.contacts.first(where: { $0.id == id })?.name ?? "the other phone"
    }

    // MARK: Key

    /// Opens this phone's enclave key: the one the payment folder's marker names, or a new one
    /// when neither a marker nor any payment key exists. Any other combination locks (see
    /// `LokaPayKeyTrust`). Loading or creating the key shows no prompt; each signature asks for
    /// Face ID or the passcode. From `paused` or `failed` this is the non-destructive retry.
    func prepareKey() {
        switch keyState {
        case .notLoaded, .failed, .paused: break
        case .loading, .ready, .noSecureEnclave, .locked: return
        }
        guard SecureEnclaveP256Signer.isAvailable else {
            keyState = .noSecureEnclave
            return
        }
        keyState = .loading
        let directory = directory
        Task {
            let outcome = await Task.detached(priority: .userInitiated) {
                Self.openKey(directory: directory)
            }.value
            apply(outcome)
        }
    }

    /// The only way out of a lock: deletes every payment key item, clears the stored certificates
    /// and the marker, then creates a new enclave key and its marker. Setup then registers the new
    /// key, whose new key hash gets a new allowance and a new merchant record. The serial and
    /// ledger files stay: they hold past records, and a new allowance id never shares a counter.
    func startFresh() {
        guard case .locked = keyState else { return }
        keyState = .loading
        let directory = directory
        Task {
            let (outcome, note) = await Task.detached(priority: .userInitiated) {
                Self.replaceKey(directory: directory)
            }.value
            storageProblem = note
            allowanceWire = readWire(Self.allowanceFile)
            merchantWire = readWire(Self.merchantFile)
            setupIssue = nil
            wiresVersion += 1
            apply(outcome)
        }
    }

    private func apply(_ outcome: KeyOutcome) {
        switch outcome {
        case .ready(let loaded):
            signer = loaded
            serials = SerialReservations(url: directory.appendingPathComponent("serials.json"))
            ledger = OfflineLedger(url: directory.appendingPathComponent("ledger.json"))
            keyState = .ready
        case .locked(let reason):
            signer = nil
            serials = nil
            ledger = nil
            keyState = .locked(reason)
        case .paused(let text):
            signer = nil
            serials = nil
            ledger = nil
            keyState = .paused(text)
        case .failed(let text):
            signer = nil
            serials = nil
            ledger = nil
            keyState = .failed(text)
        }
        recheck()
    }

    nonisolated private static func openKey(directory: URL) -> KeyOutcome {
        let markerURL = directory.appendingPathComponent(markerFile)
        // A marker that exists is never treated as absent: a failed read pauses, and only
        // contents that were read and do not decode lock.
        let marker = LokaPayKeyTrust.readMarker(exists: FileManager.default.fileExists(atPath: markerURL.path)) {
            try Data(contentsOf: markerURL)
        }
        switch LokaPayKeyTrust.decide(marker: marker, keychain: LokaPayKeyItems.list()) {
        case .cannotCheck(let status):
            return .failed("the Keychain could not be listed (OSStatus \(status)), so this phone cannot rule out "
                           + "a payment key left by an earlier install")
        case .markerUnavailable(let detail):
            return .paused(detail)
        case .locked(let reason):
            return .locked(reason)
        case .createFresh:
            return createKey(directory: directory)
        case .load(let marker):
            do {
                let loaded = try SecureEnclaveP256Signer.loadOrCreate(account: marker.account)
                return LokaPayKeyTrust.confirms(loadedKeyHash: loaded.keyHash.hex, marker: marker)
                    ? .ready(loaded) : .locked(.keyMismatch)
            } catch {
                return .failed(keyErrorText(error))
            }
        }
    }

    /// A new key under a new account, then the marker that ties it to this folder. The key is
    /// returned only after the marker is on disk.
    nonisolated private static func createKey(directory: URL) -> KeyOutcome {
        let account = LokaPayKeyTrust.freshAccount()
        let created: SecureEnclaveP256Signer
        do {
            created = try SecureEnclaveP256Signer.loadOrCreate(account: account)
        } catch {
            return .failed(keyErrorText(error))
        }
        // Checks `LokaPayKeyItems.service`: if this build cannot list the key it just made, it
        // could not see a key left by an earlier install either.
        guard case .accounts(let accounts) = LokaPayKeyItems.list(), accounts.contains(account) else {
            LokaPayKeyItems.delete(account: account)
            return .failed("this build cannot find the payment key it just created in the Keychain, so it cannot "
                           + "detect a key left by an earlier install")
        }
        let marker = LokaPayKeyTrust.Marker(account: account, keyHash: created.keyHash.hex)
        do {
            try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
            try JSONEncoder().encode(marker).write(to: directory.appendingPathComponent(markerFile),
                                                   options: [.atomic, .completeFileProtectionUntilFirstUserAuthentication])
        } catch {
            LokaPayKeyItems.delete(account: account)
            return .failed("the payment folder could not record the new key (\(systemText(error))), so it is not used")
        }
        return .ready(created)
    }

    nonisolated private static func replaceKey(directory: URL) -> (KeyOutcome, String?) {
        let status = LokaPayKeyItems.deleteAll()
        guard status == errSecSuccess else {
            return (.failed("the old payment key could not be deleted (OSStatus \(status)), so payments stay locked"), nil)
        }
        // The old marker names a deleted key. If it cannot be removed, the next launch locks
        // (key missing) rather than trusting anything; a new key's marker replaces it anyway.
        try? FileManager.default.removeItem(at: directory.appendingPathComponent(markerFile))
        var note: String?
        for file in [allowanceFile, merchantFile] {
            let url = directory.appendingPathComponent(file)
            guard FileManager.default.fileExists(atPath: url.path) else { continue }
            do {
                try FileManager.default.removeItem(at: url)
            } catch {
                note = "This phone could not clear \(file) (\(systemText(error))). A stored certificate for the old "
                    + "key does not match the new key, so setup registers the new key anyway."
            }
        }
        return (createKey(directory: directory), note)
    }

    nonisolated private static func keyErrorText(_ error: Error) -> String {
        if case PaymentError.storage = error { return "the Keychain refused to read or store the key (storage)" }
        return systemText(error)
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
    nonisolated static func systemText(_ error: Error) -> String {
        if let error = error as? PaymentError { return error.rawValue }
        // The screens add their own full stop.
        var text = (error as NSError).localizedDescription
        while text.hasSuffix(".") { text.removeLast() }
        return text
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
                if case .paused = store.keyState {
                    Button("Try again") { store.prepareKey() }
                        .buttonStyle(LokaPaySetupButtonStyle(primary: true))
                }
                if case .locked = store.keyState {
                    VStack(alignment: .leading, spacing: 6) {
                        Button("Start fresh with a new key") { store.startFresh() }
                            .buttonStyle(LokaPaySetupButtonStyle(primary: true))
                        Text("This deletes the old key, makes a new one in the Secure Enclave and clears the stored "
                             + "certificates. Setup then registers the new key, which gets a new allowance and a new "
                             + "merchant record. Serial and ledger records already on this phone are kept.")
                            .font(LokaPay.LokaStyle.caption)
                            .foregroundStyle(LokaColor.muted)
                            .fixedSize(horizontal: false, vertical: true)
                    }
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
                detail: "Payments are signed by a key that never leaves the Secure Enclave. This device reports "
                    + "none, so Pay stays locked. No software key is used instead."))
        case .failed(let text):
            list.append(Blocker(
                id: "key", title: "The payment key could not be loaded",
                detail: "The system said: \(text). Pay stays locked; no software key is used instead. On a phone, "
                    + "unlock it and load the key again. A build without code signing may have no Keychain access at all."))
        case .locked(let reason):
            list.append(Blocker(id: "locked", title: "Payments are locked on this phone", detail: Self.lockText(reason)))
        case .paused(let text):
            list.append(Blocker(
                id: "paused", title: "Payments are paused on this phone",
                detail: "This phone could not read its payment key record just now (\(text)). Nothing was deleted, and "
                    + "nothing is signed until it can. Unlock the phone, then tap Try again."))
        case .notLoaded, .loading, .ready:
            break
        }
        return list
    }

    static func lockText(_ reason: LokaPayKeyTrust.LockReason) -> String {
        switch reason {
        case .keySurvivedReinstall:
            return "This phone's payment key survived a reinstall, but its record of used serials did not. To stay "
                + "safe it will not sign again with that key. Payments this phone had received but not settled were "
                + "in the same record, so it no longer holds them."
        case .keyMissing:
            return "This phone's payment records belong to a key that is no longer in the Keychain. To stay safe it "
                + "will not sign with another key against those records."
        case .keyMismatch:
            return "The payment key in the Keychain is not the key this phone's payment records belong to. To stay "
                + "safe it will not sign with it."
        case .markerMalformed:
            return "The record that ties this phone's payment key to its serial counters is damaged. To stay safe it "
                + "will not sign until it starts fresh with a new key."
        }
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
    /// LOKA's own stores (LokaRootView puts them in the environment): the Bluetooth glue sends
    /// payment texts through ChatStore and names contacts from ContactStore.
    @EnvironmentObject private var chat: ChatStore
    @EnvironmentObject private var contacts: ContactStore
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
                LokaPayMeshBanner(notes: store.meshNotes, store: store, contacts: contacts, chat: chat)
                LokaPayHomeHost(store: store, link: chat.link)
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
        .onAppear {
            store.meshChat = chat
            store.meshContacts = contacts
            store.prepareKey()
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

// MARK: - Bluetooth over LOKA's mesh (tasks 2.1, 2.2 glue, 2.7)

/// Pay and Receive once setup is complete, with the Bluetooth radio state LOKA's BleLink reports
/// (the zero-bars meter follows it); until then, setup (which says what is missing).
private struct LokaPayHomeHost: View {
    @ObservedObject var store: LokaPayStore
    /// Only its radio state is read: observing all of BleLink would rebuild the payment models on
    /// every signal-strength update.
    let link: BleLink
    @State private var bluetoothOn: Bool?

    var body: some View {
        Group {
            if let dependencies = store.homeDependencies(bluetoothOn: bluetoothOn) {
                LokaPayHomeView(dependencies: dependencies).id(store.wiresVersion)
            } else {
                LokaPaySetupView(store: store)
            }
        }
        .onReceive(link.$bluetoothState.map(LokaPayHomeHost.bluetoothOn).removeDuplicates()) { bluetoothOn = $0 }
    }

    /// On or off only when the radio says so; unknown and resetting leave Bluetooth unmentioned.
    static func bluetoothOn(_ state: CBManagerState) -> Bool? {
        switch state {
        case .poweredOn: return true
        case .poweredOff, .unauthorized, .unsupported: return false
        default: return nil
        }
    }
}

/// One open contact picker for a Bluetooth payment.
struct LokaPayMeshPickerRequest: Identifiable {
    let id = UUID()
}

/// The Bluetooth glue's picker and status line, observed only by the views that show them.
@MainActor
final class LokaPayMeshNotes: ObservableObject {
    /// Non-nil while the contact picker for a Bluetooth payment is open.
    @Published var picker: LokaPayMeshPickerRequest?
    /// The last thing the Bluetooth glue did, in plain words; nil when there is nothing to say.
    @Published var status: String?
    /// The router's drop count when the banner was last dismissed; it shows drops after that.
    @Published var droppedSeen = 0
}

/// What the Bluetooth glue last did (queued, not sent and why, an ack arrived) and how many payment
/// texts it dropped, shown only when there is something to say; and the contact picker.
private struct LokaPayMeshBanner: View {
    @ObservedObject var notes: LokaPayMeshNotes
    let store: LokaPayStore
    let contacts: ContactStore
    let chat: ChatStore

    var body: some View {
        let dropped = max(0, store.mesh.dropped - notes.droppedSeen)
        Group {
            if notes.status != nil || dropped > 0 {
                banner(dropped: dropped)
            } else {
                Color.clear.frame(height: 0)
            }
        }
        // Pay's "Send both over Bluetooth": pick the one contact that gets this payment's texts.
        .sheet(item: $notes.picker, onDismiss: { store.cancelMeshSend() }) { _ in
            LokaPayMeshPicker(mesh: store.mesh, contacts: contacts, chat: chat,
                              send: { store.sendQueuedMesh(to: $0) }, cancel: { store.cancelMeshSend() })
        }
    }

    private func banner(dropped: Int) -> some View {
        HStack(alignment: .top, spacing: 10) {
            Image(systemName: "dot.radiowaves.left.and.right")
                .foregroundStyle(LokaColor.ink)
                .accessibilityHidden(true)
            VStack(alignment: .leading, spacing: 4) {
                if let status = notes.status { Text(status) }
                if dropped > 0 {
                    Text("Payment texts dropped (another version, or not from a contact): " + String(dropped) + ".")
                }
            }
            .font(LokaPay.LokaStyle.caption)
            .foregroundStyle(LokaColor.ink)
            .fixedSize(horizontal: false, vertical: true)
            Spacer(minLength: 0)
            Button("OK") {
                notes.status = nil
                notes.droppedSeen = store.mesh.dropped
            }
            .font(LokaPay.LokaStyle.label)
            .foregroundStyle(LokaColor.ink)
            .frame(minWidth: 44, minHeight: 44)
            .accessibilityLabel("Dismiss the Bluetooth note")
        }
        .padding(12)
        .background(RoundedRectangle(cornerRadius: 12, style: .continuous).fill(LokaColor.card))
        .overlay(RoundedRectangle(cornerRadius: 12, style: .continuous).strokeBorder(LokaColor.ink, lineWidth: 1.5))
        .padding(.horizontal, 16)
        .padding(.top, 8)
    }
}

/// Pay's "Send both over Bluetooth": the payer picks the one LOKA contact (the merchant's phone)
/// for THIS payment. The pick never carries to the next payment (`MeshPaymentRouter.pick`). With no
/// contacts it says so and the two codes stay on screen.
struct LokaPayMeshPicker: View {
    let mesh: MeshPaymentRouter
    @ObservedObject var contacts: ContactStore
    @ObservedObject var chat: ChatStore
    let send: (String) -> Void
    let cancel: () -> Void

    /// The contact already picked for the payment that is waiting (a resend), if any.
    private var pickedForThisPayment: String? {
        guard let pick = mesh.pick, pick.noteId == mesh.outgoingNoteId else { return nil }
        return pick.peer
    }

    /// Contacts nearby now first, then by name.
    private var rows: [LokaContact] {
        let nearby = Set(chat.nearbyPeople.map(\.id))
        return contacts.contacts.sorted { a, b in
            let an = nearby.contains(a.id), bn = nearby.contains(b.id)
            if an != bn { return an }
            return a.name.localizedCaseInsensitiveCompare(b.name) == .orderedAscending
        }
    }

    var body: some View {
        NavigationStack {
            List {
                if contacts.contacts.isEmpty {
                    Text("No LOKA contacts on this phone yet. Add the merchant's phone as a contact in Chats, or show the two codes instead.")
                        .font(LokaPay.LokaStyle.body)
                } else {
                    Section {
                        ForEach(rows) { contact in
                            Button { send(contact.id) } label: { row(contact) }
                        }
                    } footer: {
                        Text("Only this contact can read the allowance and the note. Other nearby LOKA phones may carry the sealed packets toward them. Sandbox: no real money moves.")
                    }
                }
            }
            .navigationTitle("Send to which contact?")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button("Cancel") { cancel() } }
            }
        }
    }

    private func row(_ contact: LokaContact) -> some View {
        let notes = [chat.nearbyPeople.contains(where: { $0.id == contact.id }) ? "Nearby now" : nil,
                     contact.id == pickedForThisPayment ? "Picked for this payment" : nil].compactMap { $0 }
        return VStack(alignment: .leading, spacing: 2) {
            Text(contact.name).font(LokaPay.LokaStyle.label).foregroundStyle(LokaColor.ink)
            if !notes.isEmpty {
                Text(notes.joined(separator: ", ")).font(LokaPay.LokaStyle.caption).foregroundStyle(LokaColor.muted)
            }
        }
        .frame(minHeight: 44, alignment: .leading)
    }
}
