import SwiftUI
import PhotosUI
import Network
import CoreBluetooth
import UserNotifications
import Security

@main
struct LokaApp: App {
    @UIApplicationDelegateAdaptor(LokaAppDelegate.self) private var delegate
    @AppStorage("loka.appearance.theme") private var theme = "System"
    init() {
        #if DEBUG && targetEnvironment(simulator)
        if ProcessInfo.processInfo.arguments.contains("--reset-card-age") {
            UserDefaults.standard.removeObject(forKey:"loka.cards.eligible18")
            UserDefaults.standard.removeObject(forKey:"loka.cards.eligible21")
        }
        #endif
        let nav = UINavigationBarAppearance()
        nav.configureWithOpaqueBackground()
        nav.backgroundColor = UIColor(LokaStyle.surface)
        nav.titleTextAttributes = [.foregroundColor: UIColor(LokaStyle.ink), .font: UIFont.systemFont(ofSize:19,weight:.semibold)]
        nav.largeTitleTextAttributes = [.foregroundColor: UIColor(LokaStyle.ink), .font: UIFontMetrics(forTextStyle: .largeTitle).scaledFont(for: UIFont(name: "LilitaOne", size: 34) ?? UIFont.systemFont(ofSize: 34, weight: .heavy))]
        UINavigationBar.appearance().standardAppearance = nav
        UINavigationBar.appearance().scrollEdgeAppearance = nav
        let tabs = UITabBarAppearance()
        tabs.configureWithOpaqueBackground()
        tabs.backgroundColor = UIColor(LokaStyle.surface)
        UITabBar.appearance().standardAppearance = tabs
        UITabBar.appearance().scrollEdgeAppearance = tabs
        let directory = FileManager.default.temporaryDirectory
        for file in (try? FileManager.default.contentsOfDirectory(at: directory, includingPropertiesForKeys: nil)) ?? [] where file.lastPathComponent.hasPrefix("loka-voice-") {
            try? FileManager.default.removeItem(at: file)
        }
    }
    var body: some Scene {
        WindowGroup {
            #if DEBUG && targetEnvironment(simulator)
            if ProcessInfo.processInfo.arguments.contains("--quiz-ui-fixture") {
                QuickQuizSimulatorFixture(guest: ProcessInfo.processInfo.arguments.contains("--quiz-guest"))
            } else if ProcessInfo.processInfo.arguments.contains("--party-ui-fixture") {
                PartySimulatorFixture()
            } else {
                ResettableLokaRoot(runtime: delegate.runtime).scrollIndicators(.hidden).preferredColorScheme(theme == "Dark" ? .dark : theme == "Light" ? .light : nil)
            }
            #else
            ResettableLokaRoot(runtime: delegate.runtime).scrollIndicators(.hidden).preferredColorScheme(theme == "Dark" ? .dark : theme == "Light" ? .light : nil)
            #endif
        }
    }
}

/// Deletion is journaled before cleanup and retried before constructing any stores.
@MainActor enum LokaReset {
    static let marker = "loka.reset.pending"
    static func finish() throws {
        let queries: [[String: Any]] = [
            [kSecClass as String: kSecClassKey, kSecAttrApplicationTag as String: ContactIdentity.tag, kSecAttrKeyType as String: kSecAttrKeyTypeRSA],
            [kSecClass as String: kSecClassGenericPassword, kSecAttrService as String: "org.loka.history.v1", kSecAttrAccount as String: "local"]
        ]
        for query in queries {
            let status = SecItemDelete(query as CFDictionary)
            guard status == errSecSuccess || status == errSecItemNotFound else { throw ContactCodeError(text: "Unlock your iPhone and retry deleting LOKA data.") }
        }
        let manager = FileManager.default
        for directory in [manager.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0], manager.temporaryDirectory, manager.urls(for: .cachesDirectory, in: .userDomainMask)[0]] {
            if manager.fileExists(atPath: directory.path) {
                for file in try manager.contentsOfDirectory(at: directory, includingPropertiesForKeys: nil) where file.lastPathComponent.hasPrefix("loka-") { try manager.removeItem(at: file) }
            }
        }
        let defaults = UserDefaults.standard
        for key in defaults.dictionaryRepresentation().keys where key.hasPrefix("loka.") && key != marker { defaults.removeObject(forKey: key) }
        // Preserve a deliberate off state until onboarding enables the radio.
        defaults.set(false, forKey: "loka.localConnection.enabled")
        UNUserNotificationCenter.current().removeAllPendingNotificationRequests()
        UNUserNotificationCenter.current().removeAllDeliveredNotifications()
        defaults.removeObject(forKey: marker)
    }
}
/// Construct the central manager during launch, including Bluetooth background relaunch.
/// SwiftUI onAppear is not guaranteed when no scene is brought to the foreground.
@MainActor final class LokaAppDelegate: NSObject, UIApplicationDelegate {
    let runtime = LokaRuntime()
    func application(_ application: UIApplication, didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]? = nil) -> Bool {
        #if DEBUG && targetEnvironment(simulator)
        if ProcessInfo.processInfo.arguments.contains("--quiz-ui-fixture") || ProcessInfo.processInfo.arguments.contains("--party-ui-fixture") { return true }
        #endif
        runtime.prepare()
        return true
    }
}
@MainActor final class LokaRuntime: ObservableObject {
    @Published private(set) var generation = UUID()
    @Published private(set) var error: String?
    private(set) var contacts: ContactStore?
    private(set) var chat: ChatStore?
    func prepare(reset: Bool = false) {
        if chat != nil && !reset { return }
        contacts = nil; chat = nil
        do {
            if UserDefaults.standard.bool(forKey: LokaReset.marker) { try LokaReset.finish() }
            let contacts = ContactStore()
            self.contacts = contacts
            self.chat = ChatStore(contacts: contacts)
            error = nil; generation = UUID()
        } catch { self.error = error.localizedDescription }
    }
}
private struct ResettableLokaRoot: View {
    @ObservedObject var runtime: LokaRuntime
    var body: some View {
        Group {
            if let contacts = runtime.contacts, let chat = runtime.chat {
                LokaRootView(contacts: contacts, chat: chat).id(runtime.generation)
            } else if let error = runtime.error {
                VStack(spacing: 20) { Text(error); Button("Retry deletion") { runtime.prepare() } }.padding()
            } else { ProgressView() }
        }
        .onReceive(NotificationCenter.default.publisher(for: Notification.Name("loka.reset.finished"))) { _ in runtime.prepare(reset: true) }
    }
}

enum LokaStyle {
    static func adaptive(_ light: UInt32, _ dark: UInt32) -> Color {
        Color(UIColor { traits in
            let hex = traits.userInterfaceStyle == .dark ? dark : light
            return UIColor(red: CGFloat((hex >> 16) & 255) / 255, green: CGFloat((hex >> 8) & 255) / 255, blue: CGFloat(hex & 255) / 255, alpha: 1)
        })
    }
    static let green = adaptive(0x7825E8, 0xBA84FF)
    static let onGreen = adaptive(0xFFFFFF, 0x26004C)
    static let background = adaptive(0xFFFBF3, 0x130E20)
    static let surface = adaptive(0xFFFEFC, 0x23192F)
    static let pendingBubble = adaptive(0xF1E7F6, 0x292039)
    static let mint = adaptive(0xEDDDFF, 0x392052)
    static let ink = adaptive(0x2C0C40, 0xFBF7FF)
    static let muted = adaptive(0x765889, 0xC1A6DC)
    static let yellow = Color(red: 1, green: 0.85, blue: 0.24)
}

struct LokaWordmark: View {
    var compact = false
    var body: some View {
        HStack(spacing: 0) {
            rays(mirrored: true)
            Text("L").font(.custom("LilitaOne", size: compact ? 35 : 44, relativeTo: .largeTitle)).rotationEffect(.degrees(-3))
            Text("O").font(.custom("LilitaOne", size: compact ? 33 : 41, relativeTo: .largeTitle)).rotationEffect(.degrees(2))
            Text("K").font(.custom("LilitaOne", size: compact ? 36 : 45, relativeTo: .largeTitle)).rotationEffect(.degrees(-2))
            Text("A").font(.custom("LilitaOne", size: compact ? 34 : 43, relativeTo: .largeTitle)).rotationEffect(.degrees(2))
            rays(mirrored: false)
        }.foregroundStyle(LokaStyle.ink).accessibilityElement(children: .ignore).accessibilityLabel("LOKA")
    }
    private func rays(mirrored: Bool) -> some View {
        Canvas { context, size in
            for ray in [(0.22, 0.08, 0.12, 0.31), (0.76, 0.31, 0.43, 0.45), (0.81, 0.68, 0.47, 0.63)] {
                var path = Path()
                path.move(to: CGPoint(x: size.width * (mirrored ? 1-ray.0 : ray.0), y: size.height * ray.1))
                path.addLine(to: CGPoint(x: size.width * (mirrored ? 1-ray.2 : ray.2), y: size.height * ray.3))
                context.stroke(path, with: .color(LokaStyle.yellow), style: StrokeStyle(lineWidth: compact ? 4 : 6, lineCap: .round))
            }
        }.frame(width: compact ? 24 : 32, height: compact ? 36 : 44)
    }
}

private struct LokaHeroTitle: View {
    let text: String
    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            ForEach(Array(text.components(separatedBy: "\n").enumerated()), id: \.offset) { index, line in
                Text(line).font(.custom("LilitaOne", size: index == 0 ? 36 : 34, relativeTo: .largeTitle))
            }
        }
    }
}

private let lokaGreen = LokaStyle.green

struct LokaAvatar: View {
    let name: String
    var size: CGFloat = 54
    var own = false
    var avatarID: String? = nil
    var peerID: String? = nil
    @AppStorage("loka.appearance.remoteAvatars") private var remoteAvatars = Data()
    @AppStorage("loka.appearance.avatar") private var selected = 0
    @AppStorage("loka.appearance.photo") private var photo = Data()
    private var index: Int {
        if own { return max(0,min(41,selected)) }
        let cached=peerID.flatMap { (try? JSONDecoder().decode([String:String].self,from:remoteAvatars))?[$0] }
        if let id=NearbyPeople.avatarID(avatarID ?? cached), let value=Int(id.dropFirst(7)) { return value }
        return name.utf8.reduce(0) { ($0 * 31 + Int($1)) % 6 }
    }
    var body: some View {
        Group {
            if own && selected == -1, let image = UIImage(data: photo) { Image(uiImage: image).resizable().scaledToFill() }
            else { Image("avatar_\(index)").resizable().scaledToFill() }
        }.frame(width: size, height: size).clipShape(Circle())
            .overlay(Circle().stroke(LokaStyle.green.opacity(0.4), lineWidth: 2)).accessibilityHidden(true)
    }
}

struct ProfileAvatarChoices: View {
    @AppStorage("loka.appearance.avatar") private var selected = 0
    @AppStorage("loka.appearance.photo") private var photo = Data()
    var chosen: () -> Void = {}
    @State private var picked: PhotosPickerItem?
    @State private var error: String?
    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            ForEach(Array([( "Community", 6..<18), ("3D portraits", 18..<30), ("Fantasy", 30..<42), ("Classic", 0..<6)].enumerated()), id: \.offset) { _, group in
                Text(group.0).font(.subheadline.bold()).foregroundStyle(LokaStyle.muted)
                LazyVGrid(columns: Array(repeating: GridItem(.flexible()), count: 4), spacing: 14) {
                    ForEach(group.1, id: \.self) { index in
                        Button { selected = index; chosen() } label: {
                            Image("avatar_\(index)").resizable().scaledToFill().aspectRatio(1, contentMode: .fit).clipShape(Circle())
                                .overlay(Circle().stroke(LokaStyle.green, lineWidth: selected == index ? 3 : 1))
                        }.buttonStyle(.plain).accessibilityLabel("Choose profile illustration \(index+1)").accessibilityAddTraits(selected == index ? .isSelected : [])
                    }
                }
            }
            PhotosPicker(selection: $picked, matching: .images) { Label("Choose a photo", systemImage: "photo") }
            if let error { Text(error).font(.caption).foregroundStyle(.red) }
        }.onChange(of: picked) { _, item in
            Task {
                do {
                    guard let data = try await item?.loadTransferable(type: Data.self), let image = UIImage(data: data) else { throw CocoaError(.fileReadCorruptFile) }
                    let scale = min(1, 640 / max(image.size.width, image.size.height))
                    let format = UIGraphicsImageRendererFormat(); format.scale = 1
                    let resized = UIGraphicsImageRenderer(size: CGSize(width: image.size.width * scale, height: image.size.height * scale), format: format).image { _ in image.draw(in: CGRect(origin: .zero, size: CGSize(width: image.size.width * scale, height: image.size.height * scale))) }
                    guard let jpg = resized.jpegData(compressionQuality: 0.88) else { throw CocoaError(.fileReadCorruptFile) }
                    photo = jpg; selected = -1; error = nil; chosen()
                } catch { self.error = "Couldn’t open this photo. Choose another image." }
            }
        }
    }
}

struct NearbyConstellation: View {
    let people: [NearbyProfile]
    private var names: [String] { people.map(\.name) }
    let active: Bool
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @Environment(\.lokaTabActive) private var tabActive
    var body: some View {
        GeometryReader { geometry in
            let width = geometry.size.width
            TimelineView(.animation(minimumInterval: 1.0 / 30, paused: !active || reduceMotion || !tabActive)) { time in
                let pulse = time.date.timeIntervalSinceReferenceDate / 6.0
                ZStack {
                    Canvas { context, size in
                        let center = CGPoint(x: size.width / 2, y: size.height / 2)
                        func circle(_ radius: Double) -> Path { Path(ellipseIn: CGRect(x: center.x-radius, y: center.y-radius, width: radius*2, height: radius*2)) }
                        context.fill(circle(width*0.40), with: .color(LokaStyle.green.opacity(0.18)))
                        for index in 0..<5 {
                            let phase = active && !reduceMotion ? (pulse+Double(index)*0.2).truncatingRemainder(dividingBy: 1) : Double(index)*0.2
                            let radius = width*(0.09+phase*0.31)
                            // Each band fades to zero at both ends of its cycle, so wrapping
                            // is invisible while the other staggered bands continue outward.
                            let fade = min(1, min(phase/0.18, (1-phase)/0.22))
                            let envelope = active && !reduceMotion ? fade*fade*(3-2*fade) : 0.7
                            context.stroke(circle(radius), with: .color(LokaStyle.green.opacity(envelope*0.24)), lineWidth: width*0.045)
                            context.stroke(circle(radius+width*0.023), with: .color(LokaStyle.green.opacity(envelope*0.34)), lineWidth: 1)
                        }
                        for index in 0..<min(names.count, 6) {
                            let angle = Double(index * 60 - 120) * .pi / 180
                            let point = CGPoint(x: center.x+cos(angle)*width*0.34, y: center.y+sin(angle)*width*0.34)
                            var line = Path(); line.move(to: center); line.addLine(to: point)
                            context.stroke(line, with: .color(LokaStyle.green.opacity(0.35)), lineWidth: 1)
                            let r = width*0.105
                            var arc = Path(); arc.addArc(center: point, radius: r, startAngle: .degrees(Double(index*55+120)), endAngle: .degrees(Double(index*55+190)), clockwise: false)
                            context.stroke(arc, with: .color(index%2 == 0 ? LokaStyle.green : .mint), style: StrokeStyle(lineWidth: 5, lineCap: .round))
                            var accent = Path(); accent.move(to: CGPoint(x: point.x+r*0.8, y: point.y-r*0.8)); accent.addLine(to: CGPoint(x: point.x+r*1.05, y: point.y-r*1.12))
                            context.stroke(accent, with: .color(LokaStyle.yellow), style: StrokeStyle(lineWidth: 4, lineCap: .round))
                            context.fill(Path(ellipseIn: CGRect(x: point.x-r*0.8-3, y: point.y+r*0.8-3, width: 6, height: 6)), with: .color(.mint))
                        }
                    }
                    Image(systemName: "location.circle.fill").font(.system(size: width*0.12)).foregroundStyle(LokaStyle.green)
                    ForEach(Array(names.prefix(6).enumerated()), id: \.offset) { index, name in
                        let angle = Double(index * 60 - 120) * .pi / 180
                        LokaAvatar(name: name, size: width*0.17, avatarID: people[index].avatarID).offset(x: cos(angle)*width*0.34, y: sin(angle)*width*0.34)
                    }
                }
            }
        }.aspectRatio(1, contentMode: .fit).frame(maxWidth: 420).frame(maxWidth: .infinity).accessibilityHidden(true)
    }
}

@MainActor private final class DevicePathStatus: ObservableObject {
    @Published var connected: Bool?
    @Published var wifi = false
    private var monitor: NWPathMonitor?
    func start() {
        guard monitor == nil else { return }
        let observer = NWPathMonitor()
        observer.pathUpdateHandler = { [weak self] path in
            let connected = path.status == .satisfied
            let wifi = path.usesInterfaceType(.wifi)
            Task { @MainActor [weak self] in self?.connected = connected; self?.wifi = wifi }
        }
        monitor = observer; observer.start(queue: DispatchQueue(label: "loka.ui.network-path"))
    }
    func stop() { monitor?.cancel(); monitor = nil; connected = nil }
}

private struct DeviceNetworkBadge: View {
    @StateObject private var path = DevicePathStatus()
    @State private var explain = false
    private var label: String { path.connected == nil ? "Checking mode" : path.connected == false ? "Offline mode" : path.wifi ? "Wi-Fi connected" : "Network connected" }
    var body: some View {
        Button { explain = true } label: {
            Label(label, systemImage: path.connected == true ? "wifi" : "wifi.slash").font(.system(size: 10, weight: .bold))
                .padding(.horizontal, 9).padding(.vertical, 6).background(path.connected == true ? Color.mint : LokaStyle.yellow, in: RoundedRectangle(cornerRadius: 12)).foregroundStyle(Color(red: 0.17, green: 0.05, blue: 0.25))
        }.buttonStyle(.plain).onAppear { path.start() }.onDisappear { path.stop() }
            .alert(label, isPresented: $explain) { Button("Got it", role: .cancel) {} } message: { Text("This shows your phone’s network connection. Internet access isn’t verified. Nearby chats use local connections independently.") }
    }
}

struct ConnectionStatusIcon: View {
    @ObservedObject var link: BleLink
    @EnvironmentObject private var chat: ChatStore
    var body: some View {
        Image(systemName: !link.enabled ? "antenna.radiowaves.left.and.right.slash" : "antenna.radiowaves.left.and.right")
            .foregroundStyle(chat.localConnectionReady ? LokaStyle.green : Color.secondary)
            .accessibilityLabel(!link.enabled ? "Local connection off" : chat.localConnectionReady ? "Local connection active" : "Local connection on, no checked connection")
    }
}

struct LokaRootView: View {
    @Environment(\.scenePhase) private var scenePhase
    @StateObject private var contacts: ContactStore
    @StateObject private var chat: ChatStore
    @AppStorage("loka.onboarding.complete") private var onboardingComplete = false
    @State private var incoming: IncomingContactLink?
    @State private var selectedTab = 0
    @State private var gameInvitation = false
    @State private var partyInvitation = false
    /// The games, reached from the Pay tab (tag 3) through its Offline corner link.
    @State private var showOfflineCorner = false
    @State private var hideTabs = false
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    init(contacts: ContactStore, chat: ChatStore) {
        _contacts = StateObject(wrappedValue: contacts)
        _chat = StateObject(wrappedValue: chat)
    }
    var body: some View {
        VStack(spacing:0) {
        Group {
        if !onboardingComplete { WelcomeView(link: chat.link).frame(maxWidth: 560).frame(maxWidth: .infinity) } else {
        TabView(selection:$selectedTab) {
            ChatsWorkspace().environment(\.lokaTabActive, selectedTab == 0).tag(0).toolbar(.hidden,for:.tabBar)
            NavigationStack { ChatsView(nearbyOnly: true) }.environment(\.lokaTabActive, selectedTab == 2).tag(2).toolbar(.hidden,for:.tabBar)
            NavigationStack {
                LokaPayTab(store: .shared, showOfflineCorner: $showOfflineCorner) {
                    LokaPlayShelf(chat: chat, contacts: contacts).environment(\.lokaTabActive, selectedTab == 3 && showOfflineCorner)
                }
            }.environment(\.lokaTabActive, selectedTab == 3).tag(3).toolbar(.hidden,for:.tabBar)
            NavigationStack { SettingsView().frame(maxWidth:720).frame(maxWidth:.infinity) }.environment(\.lokaTabActive, selectedTab == 1).tag(1).toolbar(.hidden,for:.tabBar)
        }.toolbar(.hidden,for:.tabBar)
        }
        }
        .frame(maxWidth:.infinity,maxHeight:.infinity)
        if onboardingComplete && !hideTabs { LokaBottomTabs(selection:$selectedTab) }
        }
        .animation(reduceMotion ? nil : .easeInOut(duration:0.22), value:selectedTab)
        .background(LokaStyle.background.ignoresSafeArea())
        .onPreferenceChange(LokaTabsHiddenKey.self) { hideTabs=$0 }
        .foregroundStyle(LokaStyle.ink)
        .tint(lokaGreen)
        .environmentObject(contacts)
        .environmentObject(chat)
        .task { chat.link.resume() }
        .onChange(of: chat.partySession?.phase) { _, phase in if phase == "invited", !(selectedTab == 3 && showOfflineCorner) { partyInvitation = true } }
        .alert("Party cards invitation", isPresented: $partyInvitation) {
            Button("View invitation") { selectedTab = 3; showOfflineCorner = true }
            Button("Decline", role: .cancel) { chat.endCards() }
        } message: { Text("Someone nearby invited you to play. View the game and its settings before joining.") }
        .onChange(of: chat.quizSession?.phase) { _, phase in if phase == "invited", !(selectedTab == 3 && showOfflineCorner) { gameInvitation = true } }
        .alert("Quick Quiz invitation", isPresented: $gameInvitation) {
            Button("Accept and play") { selectedTab = 3; showOfflineCorner = true; chat.acceptQuiz() }
            Button("Decline", role: .cancel) { chat.endQuiz() }
        } message: { Text("A verified friend invited you to an untimed quiz.") }
        .onChange(of: chat.openFriend) { _, id in if id != nil { selectedTab = 0 } }
        .onChange(of: scenePhase) { _, phase in if phase == .active { chat.link.resume() } }
        .onOpenURL { url in
            guard url.scheme == "loka", url.host == "contact" else { return }
            incoming = IncomingContactLink(value: url.absoluteString)
        }
        .sheet(item: $incoming) { item in NavigationStack { AddFriendView(initialLink: item.value) }.environmentObject(contacts) }
        .alert("LOKA", isPresented: Binding(get: { contacts.error != nil }, set: { if !$0 { contacts.error = nil } })) {
            Button("OK") { contacts.error = nil }
        } message: { Text(contacts.error ?? "") }
    }
}

private struct WelcomeView: View {
    @ObservedObject var link: BleLink
    @EnvironmentObject private var chat: ChatStore
    @AppStorage("loka.aware.enabled") private var awareEnabled = false
    @State private var awareEnableFailed = false
    @AppStorage("loka.wifi.explained") private var wifiExplained = false
    @AppStorage("loka.profile.displayName") private var displayName = ""
    @AppStorage("loka.onboarding.complete") private var complete = false
    @AppStorage("loka.nearby.explained") private var explainedNearby = false
    @Environment(\.scenePhase) private var scenePhase
    @Environment(\.openURL) private var openURL
    @State private var nearbyAllowed = false
    @State private var nearbyDenied = false
    @State private var notificationsAllowed = false
    @State private var notificationsDenied = false
    @State private var requestingNotifications = false
    @State private var step = 0
    @State private var name = ""
    private enum Step: String {
        case name = "Your name", nearby = "Nearby messaging", localWifi = "Local Wi-Fi"
        case phoneWifi = "Phone-to-phone Wi-Fi", notifications = "Notifications", community = "Community sharing", backup = "Backup"
    }
    private var steps: [Step] {
        [.name, .nearby, .localWifi] + (chat.aware.available ? [.phoneWifi] : []) + [.notifications, .community, .backup]
    }
    private var current: Step { steps[min(step, steps.count - 1)] }
    private var required: Bool { current == .nearby || current == .phoneWifi || current == .community }
    private var heading: String {
        switch current {
        case .name: return "Your people.\nCloser together."
        case .nearby: return "Stay close,\neven offline."
        case .localWifi: return "Chat on the same Wi-Fi."
        case .phoneWifi: return "Connect phone to phone."
        case .notifications: return "Don’t miss\na message."
        case .community: return "Community sharing"
        case .backup: return "Your backup\nchoice."
        }
    }
    private var nearbySupported: Bool { link.bluetoothState != .unsupported }
    private var nearbyReady: Bool { nearbyAllowed && link.bluetoothState == .poweredOn }
    private func refreshPermissions() async {
        nearbyAllowed = CBManager.authorization == .allowedAlways
        nearbyDenied = CBManager.authorization == .denied || CBManager.authorization == .restricted
        let settings = await UNUserNotificationCenter.current().notificationSettings()
        notificationsAllowed = [.authorized, .provisional, .ephemeral].contains(settings.authorizationStatus)
        notificationsDenied = settings.authorizationStatus == .denied
    }
    private func openSettings() { if let url = URL(string: UIApplication.openSettingsURLString) { openURL(url) } }
    private func enabled(_ index: Int) -> Bool {
        (steps[index] == .nearby && (nearbyReady || !nearbySupported)) ||
        (steps[index] == .phoneWifi && awareEnabled) || (steps[index] == .notifications && notificationsAllowed)
    }
    private func advance() {
        if current == .name && nearbyReady && !link.enabled { link.start() }
        repeat { step = min(steps.count - 1, step + 1) } while step < steps.count - 1 && enabled(step)
    }
    private func back() {
        repeat { step = max(0, step - 1) } while step > 0 && enabled(step)
    }
    private func advanceGranted() {
        if enabled(step) { advance() }
    }
    private func finish(wantsBackup: Bool = false) {
        guard !nearbySupported || nearbyReady else { step = 1; return }
        if chat.aware.available && !awareEnabled { step = steps.firstIndex(of: .phoneWifi)!; return }
        if nearbySupported && !link.enabled { link.start() }
        UserDefaults.standard.set(wantsBackup, forKey: "loka.backup.wanted")
        complete = true
    }
    private var explanation: String {
        switch current {
        case .name: return "What would you like to be called? You can change this later."
        case .nearby:
            if CBManager.authorization == .restricted { return "Bluetooth access is restricted on this iPhone. Check Screen Time or ask whoever manages this phone to allow access for LOKA." }
            if nearbyDenied { return "In Settings, turn on Bluetooth access for LOKA, then return here to continue." }
            if nearbyAllowed && link.bluetoothState == .poweredOff { return "Turn on Bluetooth in Control Center so LOKA can find phones around you. Return here to continue." }
            return "Let LOKA find phones around you and send messages without Internet. Choose Allow when your iPhone asks for Bluetooth access."
        case .localWifi:
            return chat.localWifiAccessBlocked
                ? "In Settings, turn on Local Network access for LOKA, then return here."
                : "When both phones are on the same Wi-Fi, LOKA can send messages between them—even if that Wi-Fi has no Internet. Choose Allow if your iPhone asks for Local Network access."
        case .notifications:
            return notificationsDenied
                ? "In Settings, open Notifications and turn on Allow Notifications for LOKA. Return here afterward."
                : "Get an alert when a message arrives, even when you’re not looking at LOKA."
        case .phoneWifi:
            return awareEnableFailed
                ? "Turn on nearby messaging, then try again."
                : "Connect nearby phones without Internet. When you connect to someone new, your iPhone will guide you through pairing."
        case .community: return "Help relay encrypted messages when you’re online. Sharing is optional."
        case .backup: return "Messages are encrypted on this iPhone. Cloud backup and iPhone backup export are still being built. You can save your preference for later."
        }
    }
    var body: some View {
        VStack(spacing: 0) {
            VStack(alignment: .leading, spacing: 12) {
                ZStack {
                    LokaWordmark()
                    HStack {
                        if step > 0 {
                            Button { back() } label: {
                                Image(systemName: "chevron.left").font(.title3.weight(.semibold)).frame(width: 48, height: 48)
                            }.accessibilityLabel("Go back")
                        }
                        Spacer()
                    }
                }.frame(maxWidth: .infinity, minHeight: 60)
                VStack(alignment: .leading, spacing: 12) {
                    Text("Step \(step + 1) of \(steps.count) · \(current.rawValue)").font(.subheadline).foregroundStyle(LokaStyle.muted)
                    HStack(spacing: 12) {
                        HStack(spacing: 6) { ForEach(0..<steps.count, id: \.self) { index in Capsule().fill(index <= step ? LokaStyle.green : LokaStyle.mint).frame(height: 7) } }.frame(maxWidth: .infinity)
                            .accessibilityLabel("Setup progress").accessibilityValue("Step \(step + 1) of \(steps.count)")
                        if !required {
                            Button { if current == .backup { finish() } else { advance() } } label: {
                                Image(systemName: "chevron.right").font(.body.weight(.semibold)).frame(width: 48, height: 48)
                                    .background(LokaStyle.mint, in: Circle())
                            }.accessibilityLabel(current == .backup ? "Finish setup" : "Skip \(current.rawValue)")
                        }
                    }
                }
            }.padding(.horizontal, 28).padding(.vertical, 12).frame(maxWidth: 560, alignment: .leading).frame(maxWidth: .infinity)
            if current == .name {
                CompactNameSetup(name: $name) { displayName = name.trimmingCharacters(in: .whitespacesAndNewlines); advance() }
            } else if current == .community {
                CommunitySharingView(onboarding: true, saved: { advance() })
            } else {
            ScrollView {
                VStack(alignment: .leading, spacing: 24) {
                    Image(current == .name ? "welcome_people" : current == .notifications ? "notification_people" : current == .backup ? "backup_art" : "nearby_people")
                        .resizable().scaledToFit().frame(maxHeight: 240).clipShape(RoundedRectangle(cornerRadius: 28)).accessibilityHidden(true)
                    LokaHeroTitle(text: heading)
                    Text(explanation).foregroundStyle(LokaStyle.muted)
                    if current == .nearby {
                        Button {
                            if nearbyDenied { openSettings() }
                            else { explainedNearby = true; link.start(); Task { await refreshPermissions(); advanceGranted() } }
                        } label: {
                            Text(nearbyDenied ? "Open app settings" : nearbyAllowed && link.bluetoothState == .poweredOff ? "Check Bluetooth" : "Enable nearby messaging").frame(maxWidth: .infinity, minHeight: 44)
                        }.buttonStyle(LokaPrimaryButtonStyle()).foregroundStyle(LokaStyle.onGreen)
                    } else if current == .localWifi {
                        Button {
                            if chat.localWifiAccessBlocked { openSettings() }
                            else if wifiExplained { advance() }
                            else { chat.enableLocalWifi() }
                        } label: {
                            Text(chat.localWifiAccessBlocked ? "Open app settings" : wifiExplained ? "Continue" : "Enable local Wi-Fi").frame(maxWidth: .infinity, minHeight: 44)
                        }.buttonStyle(LokaPrimaryButtonStyle()).foregroundStyle(LokaStyle.onGreen)
                    } else if current == .notifications {
                        Button {
                            if notificationsDenied { openSettings() }
                            else {
                                requestingNotifications = true
                                Task { await LocalNotifications.shared.requestPermission(); await refreshPermissions(); requestingNotifications = false; advanceGranted() }
                            }
                        } label: {
                            Text(notificationsDenied ? "Open app settings" : "Enable notifications").frame(maxWidth: .infinity, minHeight: 44)
                        }.buttonStyle(LokaPrimaryButtonStyle()).foregroundStyle(LokaStyle.onGreen).disabled(requestingNotifications)
                    } else if current == .backup {
                        Button { finish(wantsBackup: true) } label: { Text("I’d like backups").frame(maxWidth: .infinity, minHeight: 44) }.buttonStyle(LokaPrimaryButtonStyle())
                        Text("Preference saved only. Your messages are not backed up yet.").font(.footnote).foregroundStyle(LokaStyle.muted)
                    }
                    if current != .phoneWifi {
                        Text("Good chats. Your community, closer.").font(.footnote).foregroundStyle(LokaStyle.muted)
                            .multilineTextAlignment(.center).frame(maxWidth: .infinity)
                    }
                }.padding(28).frame(maxWidth: 560, alignment: .leading).frame(maxWidth: .infinity)
            }.scrollDismissesKeyboard(.interactively)
            }
            if current == .phoneWifi {
                VStack(spacing: 12) {
                    Button {
                        if nearbyReady && !link.enabled { link.start() }
                        awareEnableFailed = !chat.aware.enableForOnboarding()
                        if !awareEnableFailed { advance() }
                    } label: {
                        Text("Enable phone-to-phone Wi-Fi").frame(maxWidth: .infinity, minHeight: 44)
                    }.buttonStyle(LokaPrimaryButtonStyle()).foregroundStyle(LokaStyle.onGreen)

                    Text("Good chats. Your community, closer.").font(.footnote).foregroundStyle(LokaStyle.muted)
                        .multilineTextAlignment(.center).frame(maxWidth: .infinity)
                }.padding(.horizontal, 28).padding(.vertical, 16).frame(maxWidth: 560).frame(maxWidth: .infinity)
            }
        }.background(LokaStyle.background)
            .onAppear { name = displayName }
            .task { await refreshPermissions(); advanceGranted() }
            .onChange(of: scenePhase) { _, phase in
                if phase == .active { chat.retryLocalWifiAccess(); Task { await refreshPermissions(); advanceGranted() } }
            }
            .onChange(of: link.bluetoothState) { _, _ in Task { await refreshPermissions(); advanceGranted() } }
            .onChange(of: link.status) { _, _ in Task { await refreshPermissions(); advanceGranted() } }
    }

}
private struct IncomingContactLink: Identifiable { let id = UUID(); let value: String }

/// Native split navigation collapses to a single conversation on narrow windows.
private struct ChatsWorkspace: View {
    @EnvironmentObject private var contacts: ContactStore
    @EnvironmentObject private var chat: ChatStore
    @State private var selectedID: String?
    @State private var compactColumn: NavigationSplitViewColumn = .sidebar
    @State private var columns: NavigationSplitViewVisibility = .all
    @Environment(\.horizontalSizeClass) private var sizeClass
    @State private var path: [String] = []
    private func openConversation(_ id: String) {
        selectedID = id
        if sizeClass == .regular {
            columns = .all
            compactColumn = .detail
        } else if path.last != id { path = [id] }
    }
    private func showChats() {
        selectedID = nil
        path = []
        chat.openFriend = nil
        columns = .all
        compactColumn = .sidebar
    }
    var body: some View {
        Group {
            if sizeClass != .regular {
                NavigationStack(path:$path) {
                    ChatsView(selectedID:selectedID) { contact in
                        chat.openFriend = nil
                        openConversation(contact.id)
                    }
                    .navigationDestination(for:String.self) { id in
                        if let contact = contacts.contacts.first(where:{$0.id == id}) {
                            ConversationView(contact:contact,link:chat.link).id(contact.id).lokaDetail()
                        } else { Text("This friend is no longer saved.").lokaDetail() }
                    }
                }.onChange(of:path) { _, ids in
                    selectedID = ids.last
                    if ids.isEmpty { chat.openFriend = nil }
                }
            } else {
                NavigationSplitView(columnVisibility:$columns,preferredCompactColumn:$compactColumn) {
                    ChatsView(selectedID:selectedID) { contact in
                        // A direct selection replaces any earlier request from New chat.
                        chat.openFriend = nil
                        openConversation(contact.id)
                    }.navigationSplitViewColumnWidth(min:300,ideal:360,max:420)
                } detail: {
                    NavigationStack {
                        if let contact = contacts.contacts.first(where:{$0.id == selectedID}) {
                            ConversationView(contact:contact,link:chat.link).id(contact.id)
                                .frame(maxWidth:860).frame(maxWidth:.infinity)
                                .toolbar(.visible,for:.navigationBar)
                                .toolbar {
                                    ToolbarItem(placement:.topBarLeading) {
                                        Button(action:showChats) {
                                            HStack(spacing:6) {
                                                Image(systemName:"chevron.left")
                                                Text("Chats")
                                            }
                                        }
                                            .accessibilityLabel("Back to chats")
                                    }
                                }
                        } else {
                            ContentUnavailableView("Your conversations",systemImage:"bubble.left.and.bubble.right",description:Text("Choose a chat or start a conversation with someone nearby."))
                                .toolbar(.hidden,for:.navigationBar)
                        }
                    }.background(LokaStyle.background)
                }.navigationSplitViewStyle(.balanced)
            }
        }
        .onChange(of:chat.openFriend) { _, id in if let id { openConversation(id) } }
        .onChange(of:sizeClass) { _, _ in
            if let selectedID { openConversation(selectedID) }
            else { columns = .all; compactColumn = .sidebar }
        }
        .onChange(of:contacts.contacts.map(\.id)) { _, ids in
            if let selectedID, !ids.contains(selectedID) { showChats() }
        }
    }
}

struct ChatsView: View {
    var nearbyOnly = false
    var selectedID: String? = nil
    var selectContact: ((LokaContact) -> Void)? = nil
    @EnvironmentObject private var store: ContactStore
    @EnvironmentObject private var chat: ChatStore
    @State private var search = ""
    @State private var newChat = false
    @State private var removing: LokaContact?
    @AppStorage("loka.profile.displayName") private var displayName = ""
    private var friends: [LokaContact] {
        store.contacts.filter { search.isEmpty || $0.name.localizedCaseInsensitiveContains(search) }
            .sorted { latest($0)?.timestamp ?? 0 > latest($1)?.timestamp ?? 0 }
    }
    private func latest(_ friend: LokaContact) -> LokaMessage? { chat.messages.filter { $0.friendID == friend.id }.max(by: lokaMessagePrecedes) }
    var body: some View {
        ScrollView {
          VStack(alignment: .leading, spacing: 20) {
            VStack(alignment: .leading, spacing: 20) {
                if !nearbyOnly { HStack {
                    Text(nearbyOnly ? "Around you" : "Hey, \(displayName.isEmpty ? "You" : displayName) 👋").font(.custom("LilitaOne", size: 30, relativeTo: .title))
                    Spacer()
                    NavigationLink { MyContactCodeView().lokaDetail() } label: {
                        Image(systemName: "qrcode").font(.title3.weight(.semibold)).foregroundStyle(LokaStyle.onGreen)
                            .frame(width: 46, height: 46).background(lokaGreen).clipShape(RoundedRectangle(cornerRadius: 14))
                    }.accessibilityLabel("Share or scan a LOKA code")
                }
                }
                if !nearbyOnly {
                    ScrollView(.horizontal, showsIndicators: false) {
                        HStack(alignment: .top, spacing: 16) {
                            NavigationLink { AddFriendView().lokaDetail() } label: {
                                VStack(spacing: 6) { Image(systemName: "plus").font(.title2).frame(width: 56, height: 56).background(LokaStyle.mint, in: Circle()); Text("Add").font(.caption) }
                            }
                            ForEach(store.contacts.prefix(8)) { friend in
                                contactDestination(friend) { VStack(spacing: 6) { LokaAvatar(name: friend.name, size: 56, peerID: friend.id).overlay(Circle().stroke(selectedID == friend.id ? LokaStyle.green : .clear,lineWidth:3)); Text(friend.name.isEmpty ? "Friend" : friend.name).font(.caption).lineLimit(1).frame(width: 60) } }
                            }
                        }
                    }
                }
                if !nearbyOnly { HStack(spacing: 12) {
                    Image(systemName: "magnifyingglass").foregroundStyle(.secondary)
                    TextField("Search conversations", text: $search).textInputAutocapitalization(.never)
                    if !search.isEmpty { Button { search = "" } label: { Image(systemName: "xmark.circle.fill") }.accessibilityLabel("Clear search") }
                }.padding(16).background(LokaStyle.surface).clipShape(RoundedRectangle(cornerRadius: 18)) }
            }.padding(.bottom, 4)
            if nearbyOnly {
                NearbyPeopleView().frame(maxWidth:680).frame(maxWidth:.infinity)

            } else {
            if store.contacts.isEmpty {
                VStack(spacing: 16) {
                    Image(systemName: "bubble.left.and.bubble.right.fill").font(.system(size: 56)).foregroundStyle(lokaGreen)
                        .frame(width: 130, height: 110).background(LokaStyle.mint).clipShape(RoundedRectangle(cornerRadius: 36))
                    Text("Bring your people to LOKA").font(.title2.bold())
                    Text("Scan a friend’s LOKA QR or share your own. Your next conversation starts here.").foregroundStyle(.secondary)
                    NavigationLink { AddFriendView().lokaDetail() } label: { Text("Add someone").fontWeight(.semibold).frame(maxWidth: .infinity).padding(14).background(lokaGreen).foregroundStyle(LokaStyle.onGreen).clipShape(RoundedRectangle(cornerRadius: 16)) }
                    NavigationLink { MyContactCodeView().lokaDetail() } label: { Label("Share My LOKA", systemImage: "qrcode") }
                }.multilineTextAlignment(.center).frame(maxWidth: .infinity).padding(.vertical, 24)
            } else if friends.isEmpty {
                Text("No conversations match your search.").foregroundStyle(.secondary)
            }
            if store.contacts.isEmpty {
                VStack(alignment: .leading, spacing: 12) {
                    Text("Better together").font(.title2.bold())
                    Text("More people using LOKA nearby can help messages travel farther. Invite your friends to join your local network.").foregroundStyle(.secondary)
                    if let key = store.publicKey, let link = try? ContactCode.encode(key) {
                        ShareLink(item: "Let’s connect on LOKA. If you have LOKA installed, add me with this link: \(link)") { Label("Invite friends", systemImage: "square.and.arrow.up") }
                    }
                }.padding(22).frame(maxWidth: .infinity, alignment: .leading).background(LokaStyle.mint).clipShape(RoundedRectangle(cornerRadius: 24))
            }
            ForEach(friends) { contact in
                contactDestination(contact) {
                    HStack(spacing: 14) {
                        LokaAvatar(name: contact.name.isEmpty ? "Friend" : contact.name, peerID: contact.id)
                        VStack(alignment: .leading, spacing: 5) {
                            HStack {
                                Text(contact.name.isEmpty ? "Friend" : contact.name).font(.headline)
                                Spacer()
                                if let message = latest(contact) { Text(lokaMessageTime(message.timestamp)).font(.caption2).foregroundStyle(.secondary) }
                            }
                            Text(latest(contact).map { ($0.outgoing ? "You: " : "") + ($0.image == true ? "Photo" : $0.voice ? "Voice message" : $0.text) } ?? "Start a private conversation")
                                .font(.subheadline).foregroundStyle(.secondary).lineLimit(1)
                        }
                    }.padding(.vertical, 14).padding(.horizontal, 14)
                        .background(selectedID == contact.id ? LokaStyle.mint : LokaStyle.surface)
                        .clipShape(RoundedRectangle(cornerRadius: 14))
                        .overlay(RoundedRectangle(cornerRadius:14).stroke(selectedID == contact.id ? LokaStyle.green : .clear,lineWidth:2))
                }
                .contextMenu { Button("Remove friend", role: .destructive) { removing = contact } }
            }
            }
          }.padding(.horizontal, 20).padding(.bottom, 28)
        }
        .overlay(alignment: .bottomTrailing) {
            if !nearbyOnly { Button { newChat = true } label: { Image(systemName: "person.2.fill").font(.title2).foregroundStyle(LokaStyle.onGreen).frame(width: 58, height: 58).background(lokaGreen).clipShape(Circle()).shadow(radius: 4) }.accessibilityLabel("New chat").padding(20) }
        }
        .sheet(isPresented: $newChat) {
            NavigationStack { List {
                HStack(spacing: 14) { Image(systemName: "person.2.fill").foregroundStyle(.secondary); VStack(alignment: .leading) { Text("Group chats"); Text("Coming soon").font(.caption).foregroundStyle(.secondary) } }.accessibilityElement(children: .combine)
                NavigationLink { AddFriendView().lokaDetail() } label: { Label("Add a friend by QR", systemImage: "qrcode") }
                ForEach(store.contacts) { friend in Button { newChat = false; chat.openFriend = friend.id } label: { HStack { LokaAvatar(name: friend.name, size: 40, peerID: friend.id); Text(friend.name.isEmpty ? "Friend" : friend.name) } } }
            }.navigationTitle("New chat").toolbar { Button("Done") { newChat = false } } }
        }
        .buttonStyle(.plain).background(LokaStyle.background)
        .confirmationDialog("Remove friend?", isPresented: Binding(get: { removing != nil }, set: { if !$0 { removing = nil } })) {
            Button("Remove friend", role: .destructive) {
                if let friend = removing { chat.forget(friend.id); store.remove(friend.id) }; removing = nil
            }
        } message: { Text("This removes their saved contact and this iPhone’s temporary conversation. You can add them again with their QR.") }
        .toolbar(.hidden,for:.navigationBar)
        .safeAreaInset(edge:.top,spacing:0) {
            if nearbyOnly {
                LokaPageHeading(title:"Around you",subtitle:"Real people. Right here.") {
                    NavigationLink { MyContactCodeView().lokaDetail() } label: { Image(systemName:"qrcode").font(.system(size:22)).foregroundStyle(LokaStyle.onGreen).frame(width:48,height:48).background(LokaStyle.green,in:RoundedRectangle(cornerRadius:14)) }.accessibilityLabel("Share or scan a LOKA code")
                }
            } else {
                HStack(alignment:.center) {
                    VStack(alignment:.leading,spacing:4) { LokaWordmark(compact:true);Text("Your world, closer.").font(.caption).foregroundStyle(LokaStyle.muted) }.frame(maxWidth:.infinity,alignment:.leading)
                    VStack(alignment:.trailing,spacing:6) {
                        NavigationLink { ProfileView().lokaDetail() } label: { LokaAvatar(name:displayName.isEmpty ? "You" : displayName,size:44,own:true) }.accessibilityLabel("Your profile")
                        DeviceNetworkBadge()
                    }
                }.padding(.horizontal,24).padding(.vertical,12).background(LokaStyle.background)
            }
        }

    }
    @ViewBuilder private func contactDestination<Content: View>(_ contact: LokaContact, @ViewBuilder label: () -> Content) -> some View {
        if let selectContact {
            Button { selectContact(contact) } label: { label() }
                .accessibilityAddTraits(selectedID == contact.id ? [.isSelected] : [])
        } else {
            NavigationLink { ConversationView(contact: contact, link: chat.link).lokaDetail() } label: { label() }
        }
    }

}

struct ContactDetailsView: View {
    let contact: LokaContact
    var body: some View {
        List {
            Section {
                Label("Friend saved", systemImage: "checkmark.circle.fill")
                Text("Saved on this iPhone. Your friend needs to add you too.").foregroundStyle(.secondary)
                NavigationLink { MyContactCodeView().lokaDetail() } label: { Label("Share My LOKA", systemImage: "qrcode") }
                Text("Keep both apps open while testing messages.").font(.footnote).foregroundStyle(.secondary)
            }
            Section {
                DisclosureGroup("Check friend’s code") {
                    Text(contact.id).font(.system(.footnote, design: .monospaced)).textSelection(.enabled)
                }
            }
        }.navigationTitle(contact.name.isEmpty ? "Friend" : contact.name).lokaDetail()
    }
}

struct SettingsView: View {
    @EnvironmentObject private var contacts: ContactStore
    @EnvironmentObject private var chat: ChatStore
    @AppStorage("loka.profile.displayName") private var displayName = ""
    @AppStorage("loka.appearance.theme") private var theme = "System"
    @State private var avatarPicker = false
    @State private var themePicker = false
    @State private var deleting = false
    @State private var deletingBusy = false
    private var privacy: some View {
        FeatureInfoView(title:"Privacy & trusted contacts",symbol:"hand.raised",text:"Your name is shared nearby when visibility is on. New chats need your approval. Your private device key stays in Keychain. LOKA does not upload your profile or address book.").lokaDetail()
    }
    private var backups: some View {
        FeatureInfoView(title:"Chats & backups",symbol:"lock.doc",text:"Messages and short voice notes are saved encrypted on this iPhone. Pending messages retry until their expiry. iPhone backup export is not available yet.").lokaDetail()
    }
    private var help: some View {
        FeatureInfoView(title:"Help & app info",symbol:"info.circle",text:"LOKA for iPhone\n\nAdd a friend with their LOKA QR code. Nearby chat requests need approval. Local messages use available local connections without requiring Internet. Calls, games and encrypted iPhone backup export are coming later.").lokaDetail()
    }
    var body: some View {
        ScrollView {
            VStack(alignment:.leading,spacing:24) {
                profileHero
                profileActions
                counters
                mainSettings
                privacyCard
                connections
                dataActions
                VStack(spacing:6) { Text("LOKA").font(.headline).foregroundStyle(LokaStyle.green);Text("Your world, closer.").font(.caption).foregroundStyle(LokaStyle.muted) }.frame(maxWidth:.infinity).padding(.vertical,12)
            }.padding(.horizontal,20).padding(.top,8).padding(.bottom,24)
        }.background(LokaStyle.background).toolbar(.hidden,for:.navigationBar)
            .safeAreaInset(edge:.top,spacing:0) {
                LokaPageHeading(title:"Your corner",subtitle:"Make LOKA your own.") {
                    NavigationLink { help } label: { Image(systemName:"gearshape").font(.system(size:22)).frame(width:48,height:48).background(LokaStyle.mint,in:RoundedRectangle(cornerRadius:14)) }.accessibilityLabel("Settings and app info")
                }
            }
            .sheet(isPresented:$avatarPicker) { AvatarCollectionSheet { avatarPicker=false } }
            .sheet(isPresented:$themePicker) { themeSheet }
            .alert("Delete all LOKA data?",isPresented:$deleting) {
                Button("Cancel",role:.cancel) {}
                Button("Delete all data",role:.destructive) {
                    deletingBusy=true
                    Task { UserDefaults.standard.set(true,forKey:LokaReset.marker);await chat.stopForReset();NotificationCenter.default.post(name:Notification.Name("loka.reset.finished"),object:nil) }
                }
            } message: { Text("Your profile, friends, messages and device identity will be removed from this iPhone. You’ll return to setup and need to exchange new contact codes. Saved backup files and messages on other phones remain. iPhone backup export is not available yet; cancel if you need to keep this history.") }
    }
    private var profileHero: some View {
        HStack(spacing:18) {
            ZStack {
                Canvas { context,size in
                    let center=CGPoint(x:size.width/2,y:size.height/2)
                    for angles in [(-40.0,-5.0),(125.0,165.0)] { var p=Path();p.addArc(center:center,radius:63,startAngle:.degrees(angles.0),endAngle:.degrees(angles.1),clockwise:false);context.stroke(p,with:.color(LokaStyle.yellow),style:StrokeStyle(lineWidth:7,lineCap:.round)) }
                    var p=Path();p.move(to:CGPoint(x:3,y:12));p.addLine(to:CGPoint(x:8,y:22));context.stroke(p,with:.color(.mint),style:StrokeStyle(lineWidth:5,lineCap:.round))
                }.accessibilityHidden(true)
                LokaAvatar(name:displayName,size:116,own:true)
            }.frame(width:132,height:132).overlay(alignment:.bottomTrailing) {
                Button { avatarPicker=true } label: { Image(systemName:"camera").font(.system(size:22)).foregroundStyle(LokaStyle.onGreen).frame(width:44,height:44).background(LokaStyle.green,in:Circle()) }.accessibilityLabel("Change profile picture")
            }
            VStack(alignment:.leading,spacing:8) {
                HStack { Text(displayName.isEmpty ? "You" : displayName).font(.custom("LilitaOne",size:26)).frame(maxWidth:.infinity,alignment:.leading);NavigationLink { ProfileView() } label: { Image(systemName:"pencil").frame(width:44,height:44) }.accessibilityLabel("Edit your name") }
                Text("Here for good chats\nand great games.").font(.system(size:13)).foregroundStyle(LokaStyle.muted)
            }
        }
    }
    private var profileActions: some View {
        HStack(spacing:12) {
            NavigationLink { ProfileView() } label: { Label("Edit profile",systemImage:"pencil") }.buttonStyle(LokaPrimaryButtonStyle())
            NavigationLink { MyContactCodeView().lokaDetail() } label: { Image(systemName:"qrcode").font(.system(size:24)).foregroundStyle(LokaStyle.onGreen).frame(width:48,height:48).background(LokaStyle.green,in:RoundedRectangle(cornerRadius:14)) }.accessibilityLabel("Show my contact QR code")
        }
    }
    private var counters: some View {
        HStack(spacing:12) {
            VStack(alignment:.leading,spacing:6) { Image(systemName:"gamecontroller").font(.system(size:24));Text("Games played").font(.system(size:13,weight:.semibold));Text("Coming soon").font(.system(size:18)) }.frame(maxWidth:.infinity,minHeight:108,alignment:.leading).padding(18).background(LokaStyle.yellow,in:RoundedRectangle(cornerRadius:22))
            VStack(alignment:.leading,spacing:6) { Image(systemName:"person.2").font(.system(size:24));Text("Friends").font(.system(size:13,weight:.semibold));Text("\(contacts.contacts.count)").font(.custom("LilitaOne",size:30)) }.frame(maxWidth:.infinity,minHeight:108,alignment:.leading).padding(18).background(Color.mint,in:RoundedRectangle(cornerRadius:22))
        }.foregroundStyle(Color(red:0.17,green:0.05,blue:0.25))
    }
    private var mainSettings: some View {
        LokaSettingsGroup(title:"SETTINGS") {
            HStack(spacing:12) { Image(systemName:"person.2").font(.system(size:24)).foregroundStyle(Color.mint);Toggle(isOn:Binding(get:{chat.peopleVisible},set:{chat.showNearbyName($0)})) { VStack(alignment:.leading,spacing:5) { Text("Nearby visibility").font(.system(size:16,weight:.semibold));Text("Let nearby people find and chat with you.").font(.system(size:12)).foregroundStyle(LokaStyle.muted) } } }.padding(18)
            LokaSettingsDivider()
            NavigationLink { privacy } label: { LokaSettingsRow(icon:"lock",title:"Privacy & trusted contacts",detail:"Control who can find and message you") }.buttonStyle(.plain)
            LokaSettingsDivider()
            NavigationLink { backups } label: { LokaSettingsRow(icon:"bubble.left",title:"Chats & backups",detail:"History and encrypted backups") }.buttonStyle(.plain)
            LokaSettingsDivider()
            Button { themePicker=true } label: { LokaSettingsRow(icon:"paintpalette",title:"Theme",detail:"Choose your style") }.buttonStyle(.plain)
        }
    }
    private var privacyCard: some View {
        HStack(spacing:12) { Image(systemName:"checkmark.shield").font(.system(size:24)).foregroundStyle(Color.mint);VStack(alignment:.leading,spacing:5) { Text("You choose who can find you.").font(.system(size:16,weight:.semibold));Text("Stay in control. Chat and connect safely, offline.").font(.system(size:13)).foregroundStyle(LokaStyle.muted) } }.padding(18).frame(maxWidth:.infinity,alignment:.leading).background(LokaStyle.mint,in:RoundedRectangle(cornerRadius:22))
    }
    private var connections: some View {
        LokaSettingsGroup(title:"PREFERENCES & HELP") {
            NavigationLink { CommunitySharingView(saved:{}).navigationTitle("Community sharing").lokaDetail() } label: { LokaSettingsRow(icon:"person.3",title:"Community sharing",detail:"Wi-Fi and mobile sharing preferences") }.buttonStyle(.plain)
            LokaSettingsDivider()
            NavigationLink { ConnectionsView(link:chat.link).lokaDetail() } label: { LokaSettingsRow(icon:"antenna.radiowaves.left.and.right",title:"Local connection",detail:"Chat nearby without Internet") }.buttonStyle(.plain)
            LokaSettingsDivider()
            Button { chat.enableLocalWifi() } label: { LokaSettingsRow(icon:"wifi",title:"Enable local Wi-Fi",detail:"Connect over shared Wi-Fi without Internet") }.buttonStyle(.plain)
            LokaSettingsDivider()
            NavigationLink { help } label: { LokaSettingsRow(icon:"info.circle",title:"Help & app info",detail:"Getting started and about LOKA") }.buttonStyle(.plain)
        }
    }
    private var dataActions: some View {
        LokaSettingsGroup(title:"YOUR DATA") { Button { deleting=true } label: { LokaSettingsRow(icon:"trash",title:"Delete all app data",detail:"Remove this device’s profile and history") }.buttonStyle(.plain).foregroundStyle(.red).disabled(deletingBusy) }
    }
    private var themeSheet: some View {
        NavigationStack {
            VStack(alignment:.leading,spacing:12) {
                ForEach(["System","Dark","Light"],id:\.self) { choice in Button { theme=choice;themePicker=false } label: { HStack { Text(choice);Spacer();if choice == theme { Image(systemName:"checkmark") } }.padding(18).background(LokaStyle.surface,in:RoundedRectangle(cornerRadius:16)) }.buttonStyle(.plain) }
                Spacer()
            }.padding(24).background(LokaStyle.background).navigationTitle("Choose your theme").navigationBarTitleDisplayMode(.inline).toolbar { Button("Done") { themePicker=false } }
        }.presentationDetents([.medium]).presentationDragIndicator(.visible)
    }
}

struct ProfileView: View {
    @AppStorage("loka.profile.displayName") private var displayName = ""
    @State private var draft = ""
    @Environment(\.dismiss) private var dismiss
    var body: some View {
        CompactNameSetup(name: $draft, editing: true) {
            displayName = draft.trimmingCharacters(in: .whitespacesAndNewlines); dismiss()
        }.background(LokaStyle.background).navigationTitle("Edit profile").navigationBarTitleDisplayMode(.inline).lokaDetail()
            .onAppear { draft = displayName }
    }
}

struct FeatureInfoView: View {
    let title: String
    let symbol: String
    let text: String
    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 24) {
                Image(systemName: symbol).font(.system(size: 40)).foregroundStyle(lokaGreen)
                Text(text).font(.body).foregroundStyle(.secondary)
            }.frame(maxWidth: .infinity, alignment: .leading).padding(24)
        }
        .navigationTitle(title).lokaDetail()
        .background(LokaStyle.background)
    }
}


private struct NearbySignal: View {
    let level: Int
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    private var color: Color { level == 0 ? .secondary : level <= 2 ? .red : level <= 4 ? .orange : lokaGreen }
    var body: some View {
        HStack(alignment: .bottom, spacing: 2) {
            ForEach(0..<6) { index in RoundedRectangle(cornerRadius: 1).fill(index < level ? color : Color.secondary.opacity(0.2)).frame(width: 3, height: CGFloat(5 + index * 3)) }
        }.frame(height: 24).animation(reduceMotion ? nil : .easeInOut(duration: 0.25), value: level)
        .accessibilityElement(children: .ignore).accessibilityLabel(level == 0 ? "Signal unavailable" : "Signal \(level) of 6")
    }
}
private struct NearbyRequestStack: View {
    @EnvironmentObject private var chat: ChatStore
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    let requests: [ContactConsentBook.Entry]
    let people: [NearbyProfile]
    let now: Date
    @State private var later: Set<String> = []
    @State private var focused: String?
    private var incoming: [ContactConsentBook.Entry] {
        requests.filter { !$0.outgoing && $0.phase == .incoming && $0.request.expires > Int64(now.timeIntervalSince1970*1000) }.sorted { ($0.request.expires,$0.request.id) < ($1.request.expires,$1.request.id) }
    }
    private func deferRequest(_ id: String) { later.insert(id); focused=nil }
    var body: some View {
        let available=incoming.filter { !later.contains($0.request.id) }
        let index=available.firstIndex { $0.request.id == focused } ?? 0
        if !incoming.isEmpty {
            VStack(alignment:.leading,spacing:12) {
                HStack {
                    Text("Chat requests (\(incoming.count))").font(.headline)
                    Spacer()
                    if incoming.contains(where:{ later.contains($0.request.id) }) {
                        Button("Show later") { later=[]; focused=nil }.font(.caption)
                    }
                }
                if !available.isEmpty {
                    let request=available[index]
                    VStack(alignment:.leading,spacing:10) {
                        HStack(spacing:12) {
                            LokaAvatar(name:request.peerName,size:44,avatarID:people.first { $0.id == request.peer }?.avatarID)
                            Text("\(request.peerName) wants to chat").font(.headline).frame(maxWidth:.infinity,alignment:.leading)
                        }
                        Text("Accept to add each other.").font(.caption).foregroundStyle(LokaStyle.muted)
                        HStack {
                            Button("Accept") { chat.decideChat(request.request.id,accept:true) }.buttonStyle(.borderedProminent)
                            Button("Decline") { chat.decideChat(request.request.id,accept:false) }.buttonStyle(.bordered)
                            Button("Later") { deferRequest(request.request.id) }.buttonStyle(.bordered)
                        }.tint(LokaStyle.green)
                        Text("Swipe left to decline · right for later").font(.caption2).foregroundStyle(LokaStyle.muted)
                    }.padding(14).frame(maxWidth:.infinity,alignment:.leading)
                    .background(LokaStyle.mint,in:RoundedRectangle(cornerRadius:18))
                    .background {
                        if available.count > 1 { RoundedRectangle(cornerRadius:18).fill(LokaStyle.green.opacity(0.18)).offset(y:7).padding(.horizontal,7) }
                    }.padding(.bottom,available.count > 1 ? 7 : 0)
                    .simultaneousGesture(DragGesture(minimumDistance:24).onEnded { drag in
                        guard abs(drag.translation.width) > 70, abs(drag.translation.width) > abs(drag.translation.height)*1.5 else { return }
                        if drag.translation.width < 0 { chat.decideChat(request.request.id,accept:false) }
                        else { deferRequest(request.request.id) }
                    })
                    .accessibilityAction(named:"Later") { deferRequest(request.request.id) }
                    .accessibilityAction(named:"Decline") { chat.decideChat(request.request.id,accept:false) }
                    if available.count > 1 {
                        HStack {
                            Button { focused=available[(index+available.count-1)%available.count].request.id } label: { Image(systemName:"chevron.left").frame(width:44,height:32) }.accessibilityLabel("Previous request")
                            Spacer(); Text("\(index+1) of \(available.count)").font(.caption); Spacer()
                            Button { focused=available[(index+1)%available.count].request.id } label: { Image(systemName:"chevron.right").frame(width:44,height:32) }.accessibilityLabel("Next request")
                        }
                    }
                } else { Text("Requests set aside for later.").font(.caption).foregroundStyle(LokaStyle.muted) }
            }.animation(reduceMotion ? nil : .easeInOut(duration:0.2),value:available.map(\.request.id))
            .onChange(of:incoming.map(\.request.id)) { _, ids in later.formIntersection(Set(ids)) }
        }
    }
}

private struct NearbyPeopleView: View {
    @EnvironmentObject private var chat: ChatStore
    @EnvironmentObject private var store: ContactStore
    var body: some View {
        TimelineView(.periodic(from: .now, by: 5)) { context in
            let devices = chat.link.nearbyDevices(at: context.date)
            let people = NearbyPeople.displayProfiles(chat.nearbyPeople)
            VStack(alignment: .leading, spacing: 18) {
                NearbyRequestStack(requests:chat.chatRequests,people:people,now:context.date)
                Toggle(isOn: Binding(get: { chat.peopleVisible }, set: { chat.showNearbyName($0) })) { VStack(alignment: .leading, spacing: 5) { Text("Visible nearby").bold(); Text(chat.peopleVisible ? "Let nearby people find you." : "Turn on to request a chat.").font(.caption).foregroundStyle(LokaStyle.muted) } }.padding(16).background(LokaStyle.surface, in: RoundedRectangle(cornerRadius: 22))
                NearbyConstellation(people: chat.link.enabled ? people : [], active: chat.link.enabled)
                Text("\(people.count) \(people.count == 1 ? "person" : "people") nearby").font(.title2.bold()).frame(maxWidth: .infinity)
                Text("Chosen names · chat requests need approval").font(.caption).foregroundStyle(LokaStyle.muted).frame(maxWidth: .infinity)
                if devices.isEmpty && people.isEmpty {
                    Text(chat.link.enabled ? "No nearby LOKA devices" : "Nearby is turned off").font(.title2.bold())
                    Text("People will appear here when LOKA finds them.").foregroundStyle(.secondary)
                    if !chat.link.enabled { NavigationLink { ConnectionsView(link: chat.link).lokaDetail() } label: { Text("Turn on nearby messaging") } }
                }
                ForEach(people) { person in
                    let friend = store.contacts.first { $0.id == person.id }
                    let name = friend.flatMap { $0.name.isEmpty ? nil : $0.name } ?? person.name
                    let handles = chat.nearbyPeople.filter { $0.id == person.id }.map(\.handle)
                    let signal = devices.filter { handles.compactMap(NearbyRadioKey.applePeripheral).contains($0.identifier.uuidString) }.compactMap { chat.link.nearbySignalValue($0, at: context.date) }.max()
                    let request = chat.chatRequests.first { $0.peer == person.id }
                    HStack(spacing: 14) {
                        LokaAvatar(name: name, size: 48, avatarID: person.avatarID)
                        VStack(alignment: .leading, spacing: 8) {
                            HStack { Text(name).font(.headline).frame(maxWidth: .infinity, alignment: .leading); NearbySignal(level: NearbyPeople.bars(signal)) }
                            if let friend { NavigationLink { ConversationView(contact: friend, link: chat.link).lokaDetail() } label: { Text("Message") } }
                            else if let request { Text(request.phase == .outgoing ? "Request sent" : request.phase == .incoming ? "Wants to chat" : request.phase == .declined ? "Request declined" : "Adding friend…").font(.subheadline).foregroundStyle(.secondary) }
                            else { Button("Request chat") { chat.requestChat(person.id) }.disabled(!chat.peopleVisible) }
                        }
                    }.padding(.vertical, 8)
                }
                if devices.contains(where: { peer in !chat.nearbyPeople.contains(where: { NearbyRadioKey.applePeripheral($0.handle) == peer.identifier.uuidString }) }) {
                    Label("Looking for other people nearby…", systemImage: "person.crop.circle.badge.clock")
                        .font(.footnote).foregroundStyle(.secondary)
                }
                if !chat.peopleVisible { Text("Turn on name sharing to request a chat.").font(.caption).foregroundStyle(.secondary) }
            }.frame(maxWidth: .infinity, alignment: .leading).padding(20).background(LokaStyle.surface).clipShape(RoundedRectangle(cornerRadius: 24))
            .onChange(of: context.date) { _, _ in chat.link.refreshSignal() }
        }
    }
}

struct LokaDoodles: View {
    var body: some View {
        Canvas { context, size in
            let palette: [Color] = [LokaStyle.green, LokaStyle.yellow, .mint, .pink]
            for index in 0..<24 {
                let x = size.width * CGFloat((index * 37 + 13) % 100) / 100
                let y = size.height * CGFloat((index * 29 + 7) % 100) / 100
                var path = Path()
                if index % 3 == 0 { path.addEllipse(in: CGRect(x: x - 8, y: y - 8, width: 16, height: 16)) }
                else {
                    path.move(to: CGPoint(x: x - 8, y: y - 8)); path.addLine(to: CGPoint(x: x + 8, y: y + 8))
                    if index % 3 == 1 { path.move(to: CGPoint(x: x - 8, y: y + 8)); path.addLine(to: CGPoint(x: x + 8, y: y - 8)) }
                }
                context.stroke(path, with: .color(palette[index % 4].opacity(0.13)), style: StrokeStyle(lineWidth: 3, lineCap: .round))
            }
        }.allowsHitTesting(false).accessibilityHidden(true)
    }
}

private struct LokaTabActiveKey: EnvironmentKey { static let defaultValue = true }
extension EnvironmentValues { var lokaTabActive: Bool { get { self[LokaTabActiveKey.self] } set { self[LokaTabActiveKey.self] = newValue } } }
struct LokaTabsHiddenKey: PreferenceKey {
    static let defaultValue = false
    static func reduce(value: inout Bool, nextValue: () -> Bool) { value = value || nextValue() }
}
private struct LokaDetailStyle: ViewModifier {
    @Environment(\.lokaTabActive) private var active
    func body(content: Content) -> some View { content.toolbar(.visible, for: .navigationBar).toolbarRole(.editor).navigationBarTitleDisplayMode(.inline).preference(key: LokaTabsHiddenKey.self, value: active).background(LokaStyle.background) }
}
extension View { func lokaDetail() -> some View { modifier(LokaDetailStyle()) } }

struct LokaPrimaryButtonStyle: ButtonStyle {
    @Environment(\.isEnabled) private var enabled
    func makeBody(configuration: Configuration) -> some View {
        configuration.label.font(.system(size: 16, weight: .bold)).foregroundStyle(LokaStyle.onGreen).frame(maxWidth: .infinity, minHeight: 54)
            .background(LokaStyle.green.opacity(enabled ? (configuration.isPressed ? 0.8 : 1) : 0.35), in: RoundedRectangle(cornerRadius: 16))
    }
}
private struct LokaBottomTabs: View {
    @Binding var selection: Int
    @Namespace private var indicator
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    private let tabs = [(0, "Chats", "bubble.left"), (2, "Nearby", "person.2"), (3, "Pay", "wallet.bifold"), (1, "You", "person")]
    var body: some View {
        HStack(spacing: 0) {
            ForEach(tabs, id: \.0) { tab in
                Button { withAnimation(reduceMotion ? nil : .spring(response:0.36,dampingFraction:0.82)) { selection = tab.0 } } label: {
                    VStack(spacing: 4) {
                        Image(systemName: tab.2).font(.system(size: 22, weight: .medium)).frame(width: 64, height: 32)
                            .background { if selection == tab.0 { Capsule().fill(LokaStyle.mint).matchedGeometryEffect(id:"selected-tab",in:indicator) } }
                            .scaleEffect(selection == tab.0 && !reduceMotion ? 1.06 : 1)
                        Text(tab.1).font(.system(size: 11, weight: selection == tab.0 ? .bold : .regular))
                    }.foregroundStyle(selection == tab.0 ? LokaStyle.green : LokaStyle.muted).frame(maxWidth: .infinity)
                }.buttonStyle(.plain).accessibilityLabel(tab.1).accessibilityAddTraits(selection == tab.0 ? .isSelected : [])
            }
        }.padding(.vertical, 10).frame(maxWidth:600).frame(maxWidth:.infinity)
            .background(LokaStyle.background.ignoresSafeArea(edges:.bottom))
    }
}
private struct LokaPageHeading<Action: View>: View {
    let title: String
    let subtitle: String
    @ViewBuilder let action: Action
    var body: some View {
        HStack(spacing: 12) {
            VStack(alignment: .leading, spacing: 5) {
                HStack(spacing: 3) {
                    Text(title).font(.custom("LilitaOne", size: 30, relativeTo: .title)).lineLimit(1).minimumScaleFactor(0.8)
                    Canvas { context, _ in
                        for ray in [(3.0,3.0,7.0,8.0),(16.0,2.0,13.0,8.0),(21.0,14.0,15.0,14.0)] {
                            var p = Path();p.move(to: CGPoint(x: ray.0,y: ray.1));p.addLine(to: CGPoint(x: ray.2,y: ray.3));context.stroke(p,with:.color(LokaStyle.yellow),style:StrokeStyle(lineWidth:3,lineCap:.round))
                        }
                    }.frame(width: 24,height:24).accessibilityHidden(true)
                }
                Text(subtitle).font(.system(size: 14)).foregroundStyle(LokaStyle.muted)
            }.frame(maxWidth: .infinity, alignment: .leading)
            action
        }.padding(.horizontal,24).padding(.vertical,12).background(LokaStyle.background)
    }
}
private struct AvatarCollectionSheet: View {
    let close: () -> Void
    var body: some View {
        NavigationStack {
            ScrollView { ProfileAvatarChoices(chosen: close).padding(24) }
                .background(LokaStyle.background).navigationTitle("Choose your look").navigationBarTitleDisplayMode(.inline)
                .toolbar { ToolbarItem(placement: .confirmationAction) { Button("Done", action: close) } }
        }.presentationDetents([.medium,.large]).presentationDragIndicator(.visible).tint(LokaStyle.green)
    }
}
private struct CompactNameSetup: View {
    @Binding var name: String
    var editing = false
    let save: () -> Void
    @State private var chooser = false
    var body: some View {
        GeometryReader { geometry in
            let compact = geometry.size.height < 390
            VStack(spacing: 0) {
                ScrollView {
                    VStack(spacing: compact ? 8 : 14) {
                        if !compact { Text(editing ? "Your look. Your name." : "Make it yours.").font(.custom("LilitaOne", size:27)) }
                        if !compact { Text("Choose a look and add your name.").font(.system(size:16)).foregroundStyle(LokaStyle.muted) }
                        Button { chooser = true } label: {
                            LokaAvatar(name: name,size: compact ? 64 : 112,own:true)
                                .overlay(alignment: .bottomTrailing) { Image(systemName:"pencil").font(.system(size:16,weight:.semibold)).padding(8).background(LokaStyle.mint,in:Circle()) }
                        }.buttonStyle(.plain).accessibilityLabel("Choose your avatar")
                        if !compact { Text("Tap your avatar to change it").font(.caption).foregroundStyle(LokaStyle.muted) }
                        TextField("Your name",text:$name).textContentType(.name).textInputAutocapitalization(.words).submitLabel(.continue)
                            .padding(16).background(LokaStyle.surface,in:RoundedRectangle(cornerRadius:16))
                            .overlay(RoundedRectangle(cornerRadius:16).stroke(LokaStyle.adaptive(0xAA82CB,0x9865C9)))
                            .onChange(of:name) { _, value in if value.count > 40 { name=String(value.prefix(40)) } }
                    }.frame(maxWidth:.infinity).padding(.top,compact ? 4 : 14)
                }.scrollDismissesKeyboard(.interactively)
                Button(editing ? "Save changes" : "Continue",action:save).buttonStyle(LokaPrimaryButtonStyle()).disabled(name.trimmingCharacters(in:.whitespacesAndNewlines).isEmpty).padding(.top,12)
                if !compact { Text("Good chats. Your community, closer.").font(.caption).foregroundStyle(LokaStyle.muted).padding(.vertical,12) }
            }.padding(.horizontal,28).padding(.bottom,12)
        }.sheet(isPresented:$chooser) { AvatarCollectionSheet { chooser=false } }
            .onAppear {
                if UserDefaults.standard.object(forKey:"loka.appearance.avatar") == nil { UserDefaults.standard.set(Int.random(in:6..<42),forKey:"loka.appearance.avatar") }
            }
    }
}
private struct LokaSettingsRow: View {
    let icon: String
    let title: String
    let detail: String
    var body: some View {
        HStack(spacing:16) {
            Image(systemName:icon).font(.system(size:21)).foregroundStyle(LokaStyle.green).frame(width:40,height:40).background(LokaStyle.mint,in:RoundedRectangle(cornerRadius:12))
            VStack(alignment:.leading,spacing:5) { Text(title).font(.system(size:16,weight:.semibold));Text(detail).font(.system(size:12)).foregroundStyle(LokaStyle.muted) }.frame(maxWidth:.infinity,alignment:.leading)
            Image(systemName:"chevron.right").font(.system(size:14)).foregroundStyle(LokaStyle.muted)
        }.padding(18).contentShape(Rectangle())
    }
}
private struct LokaSettingsGroup<Content: View>: View {
    let title: String
    @ViewBuilder let content: Content
    var body: some View {
        VStack(alignment:.leading,spacing:10) {
            Text(title).font(.system(size:10,weight:.semibold)).tracking(1.3).foregroundStyle(LokaStyle.muted).padding(.leading,16)
            VStack(spacing:0) { content }.background(LokaStyle.surface,in:RoundedRectangle(cornerRadius:20))
        }
    }
}
private struct LokaSettingsDivider: View { var body: some View { Rectangle().fill(LokaStyle.adaptive(0xE7D7EE,0x49335D)).frame(height:1).padding(.leading,74) } }
