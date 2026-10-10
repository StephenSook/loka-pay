import Foundation
import SwiftUI

struct LokaContact: Codable, Identifiable {
    var id: String { ContactCode.fingerprint(publicKey) }
    let publicKey: Data
    var name: String
}
@MainActor final class ContactStore: ObservableObject {
    @Published private(set) var contacts: [LokaContact] = []
    @Published private(set) var publicKey: Data?
    @Published var error: String?
    private var loadingIdentity = false
    private var stopped = false
    private var identityTask: Task<Void, Never>?
    private var identity: ContactIdentity?
    var messageIdentity: ContactIdentity? { identity }
    var beforeRemove: ((String) throws -> Void)?
    private var canModify = true
    private let defaults: UserDefaults
    init(defaults: UserDefaults = .standard) {
        self.defaults = defaults
        if let data = defaults.data(forKey: "loka.contacts.v1") {
            do {
                guard data.count <= 256 * 1024 else { throw ContactCodeError(text: "Saved contact list exceeds its limit") }
                let loaded = try JSONDecoder().decode([LokaContact].self, from: data)
                guard loaded.count <= 128 else { throw ContactCodeError(text: "Too many saved contacts") }
                for contact in loaded { try ContactCode.validate(contact.publicKey) }
                guard Set(loaded.map(\.id)).count == loaded.count else { throw ContactCodeError(text: "Duplicate saved contacts") }
                contacts = loaded
            } catch { canModify = false; self.error = "Could not read saved contacts. Existing data was preserved." }
        }
        reloadIdentity()
    }
    func reloadIdentity() {
        guard !stopped, identity == nil, !loadingIdentity else { return }
        loadingIdentity = true
        identityTask = Task {
            defer { loadingIdentity = false }
            do {
                let loaded = try await Task.detached(priority: .userInitiated) { try ContactIdentity() }.value
                guard !stopped else { return }
                identity = loaded; publicKey = loaded.publicKey
            } catch { self.error = error.localizedDescription }
        }
    }
    func stopForReset() async {
        stopped = true; canModify = false
        await identityTask?.value
        identity = nil; publicKey = nil; contacts = []
    }
    func add(_ key: Data, name: String) throws {
        guard canModify else { throw ContactCodeError(text: "Existing contacts could not be loaded; they were preserved") }
        try ContactCode.validate(key)
        guard let own = publicKey else { throw ContactCodeError(text: "Your identity is still loading") }
        guard key != own else { throw ContactCodeError(text: "This is your own contact code") }
        let id = ContactCode.fingerprint(key)
        guard contacts.count < 128 || contacts.contains(where: { $0.id == id }) else { throw ContactCodeError(text: "Contact limit reached") }
        let contact = LokaContact(publicKey: key, name: String(name.trimmingCharacters(in: .whitespacesAndNewlines).prefix(40)))
        let updated = contacts.filter { $0.id != id } + [contact]
        defaults.set(try JSONEncoder().encode(updated), forKey: "loka.contacts.v1")
        contacts = updated
    }
    func remove(_ id: String) {
        guard canModify else { return }
        do { try beforeRemove?(id) } catch { self.error = "Could not remove this friend safely. Please try again."; return }
        let updated = contacts.filter { $0.id != id }
        guard let encoded = try? JSONEncoder().encode(updated) else { return }
        defaults.set(encoded, forKey: "loka.contacts.v1"); contacts = updated
    }
}
