import SwiftUI

/// Everything the payment screens need, supplied by the app.
public struct LokaPayDependencies {
    /// From config/pins.json (`LokaPins.parse`).
    public var deployment: Deployment
    /// The server's Ed25519 key from config/pins.json; nil while it is not published. The screens
    /// then refuse to trust any certificate and say why.
    public var serverPublicKey: Data?
    /// This phone's P-256 key (Secure Enclave on a phone). The allowance certificate and the
    /// merchant certificate must each name this key to unlock Pay and Receive.
    public var signer: (any PaymentSigner)?
    /// The allowance wire from `POST /v1/payers`, as stored by the app.
    public var allowanceWire: Data?
    /// The merchant wire from `POST /v1/merchants`, as stored by the app.
    public var merchantWire: Data?
    public var serials: SerialReservations
    public var ledger: OfflineLedger
    /// nil when no settlement server is connected; Settle then says so.
    public var settlementClient: SettlementClient?
    public var connectivity: ConnectivityMonitor
    /// Bluetooth glue: sends one transport text over the LOKA mesh. nil hides the Bluetooth button.
    public var meshSend: (@MainActor (String) -> Void)?
    /// Bluetooth glue, inbound: the LokaMesh glue calls `meshInbox.deliver(text)` with each
    /// `L1|P|1|...` text it receives, and Receive checks it like a scanned code. nil keeps Receive
    /// camera only (it then does not mention Bluetooth). Keep one inbox for the app's lifetime.
    public var meshInbox: PaymentInbox?
    /// The mesh layer's Bluetooth state for the zero-bars meter; nil leaves Bluetooth unmentioned.
    public var bluetoothOn: Bool?

    public init(deployment: Deployment, serverPublicKey: Data?, signer: (any PaymentSigner)?,
                allowanceWire: Data?, merchantWire: Data?, serials: SerialReservations, ledger: OfflineLedger,
                settlementClient: SettlementClient?, connectivity: ConnectivityMonitor,
                meshSend: (@MainActor (String) -> Void)? = nil, meshInbox: PaymentInbox? = nil,
                bluetoothOn: Bool? = nil) {
        self.deployment = deployment
        self.serverPublicKey = serverPublicKey
        self.signer = signer
        self.allowanceWire = allowanceWire
        self.merchantWire = merchantWire
        self.serials = serials
        self.ledger = ledger
        self.settlementClient = settlementClient
        self.connectivity = connectivity
        self.meshSend = meshSend
        self.meshInbox = meshInbox
        self.bluetoothOn = bluetoothOn
    }
}

/// The one view the app presents: Pay and Receive. It starts the connectivity monitor while shown.
/// The models are built once from `dependencies`; when a certificate arrives later (for example
/// after registration), give the view a new identity so it rebuilds:
/// `LokaPayHomeView(dependencies: deps).id(deps.allowanceWire.map(\.hex) ?? "")`.
public struct LokaPayHomeView: View {
    public enum Tab: String, CaseIterable, Sendable {
        case pay = "Pay"
        case receive = "Receive"
    }

    @State private var tab: Tab
    @State private var payModel: PayModel
    @State private var receiveModel: ReceiveModel
    @ObservedObject private var connectivity: ConnectivityMonitor
    private let bluetoothOn: Bool?

    public init(dependencies: LokaPayDependencies, startOn tab: Tab = .pay) {
        let d = dependencies
        let monitor = d.connectivity
        _payModel = State(wrappedValue: PayModel(allowanceWire: d.allowanceWire, signer: d.signer, serials: d.serials,
                                                 deployment: d.deployment, serverPublicKey: d.serverPublicKey,
                                                 meshSend: d.meshSend))
        _receiveModel = State(wrappedValue: ReceiveModel(merchantWire: d.merchantWire, signer: d.signer, ledger: d.ledger,
                                                         settlementClient: d.settlementClient, deployment: d.deployment,
                                                         serverPublicKey: d.serverPublicKey,
                                                         internetState: { monitor.isRunning ? monitor.state : nil },
                                                         inbox: d.meshInbox))
        _tab = State(initialValue: tab)
        connectivity = monitor
        bluetoothOn = d.bluetoothOn
    }

    public var body: some View {
        VStack(spacing: 0) {
            Picker("Screen", selection: $tab) {
                ForEach(Tab.allCases, id: \.self) { Text($0.rawValue).tag($0) }
            }
            .pickerStyle(.segmented)
            .padding(.horizontal, 16)
            .padding(.top, 8)
            switch tab {
            case .pay: PayView(model: payModel, connectivity: connectivity)
            case .receive: ReceiveView(model: receiveModel, connectivity: connectivity, bluetoothOn: bluetoothOn)
            }
        }
        .background(LokaColor.paper.ignoresSafeArea())
        .onAppear { connectivity.start() }
        .onDisappear { connectivity.stop() }
    }
}

#if DEBUG
#Preview("Home: test vectors") {
    LokaPayHomeView(dependencies: LokaPayDependencies(
        deployment: PreviewFixtures.deployment, serverPublicKey: PreviewFixtures.serverKey,
        signer: PreviewFixtures.payerSigner, allowanceWire: PreviewFixtures.allowanceWire, merchantWire: nil,
        serials: SerialReservations(url: PreviewFixtures.scratchURL("home-serials.json")),
        ledger: OfflineLedger(url: PreviewFixtures.scratchURL("home-ledger.json")),
        settlementClient: nil, connectivity: ConnectivityMonitor()))
}

#Preview("Home: server key not pinned yet") {
    LokaPayHomeView(dependencies: LokaPayDependencies(
        deployment: PreviewFixtures.deployment, serverPublicKey: nil, signer: PreviewFixtures.payerSigner,
        allowanceWire: nil, merchantWire: nil,
        serials: SerialReservations(url: PreviewFixtures.scratchURL("home-serials.json")),
        ledger: OfflineLedger(url: PreviewFixtures.scratchURL("home-ledger.json")),
        settlementClient: nil, connectivity: ConnectivityMonitor()), startOn: .receive)
}
#endif
