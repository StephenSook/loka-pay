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
    /// Bluetooth glue, inbound for the payer: the merchant's ack (`L1|P|1|Y|...`) and receipt
    /// (`L1|P|1|X|...`) texts. Pay checks the ones about the note on screen with
    /// `PayModel.acceptReturn` (`MeshReturns.attach`). nil: returns come by camera only.
    public var meshReturns: PaymentInbox?
    /// Bluetooth glue, outbound for the merchant: the ack, then the receipt, for the note on the
    /// Receive screen, with the Bluetooth delivery that note was accepted from
    /// (`ReceivedPayment.meshOrigin`: camera, a first delivery, or unknown). The glue sends a text only to the
    /// sender of that one delivery (`MeshPaymentRouter.replyTarget`). It returns true when the reply
    /// is settled (queued, or there is no Bluetooth route for it) and false on a passing failure (a
    /// locked phone, a full queue). Replies are offered on events only (`MeshReplySender`), never on
    /// a timer, and only while these screens are shown; a reply that failed is offered again on the
    /// next event or by the Receive card's "Send the reply again over Bluetooth" button.
    /// nil: replies go by camera only.
    public var meshReply: (@MainActor (_ text: String, _ origin: MeshOrigin) -> Bool)?
    /// The mesh layer's report that a local LOKA link is up; nil when not reported. A change to true
    /// offers waiting replies again.
    public var meshLinkReady: Bool?

    public init(deployment: Deployment, serverPublicKey: Data?, signer: (any PaymentSigner)?,
                allowanceWire: Data?, merchantWire: Data?, serials: SerialReservations, ledger: OfflineLedger,
                settlementClient: SettlementClient?, connectivity: ConnectivityMonitor,
                meshSend: (@MainActor (String) -> Void)? = nil, meshInbox: PaymentInbox? = nil,
                bluetoothOn: Bool? = nil, meshReturns: PaymentInbox? = nil,
                meshReply: (@MainActor (_ text: String, _ origin: MeshOrigin) -> Bool)? = nil,
                meshLinkReady: Bool? = nil) {
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
        self.meshReturns = meshReturns
        self.meshReply = meshReply
        self.meshLinkReady = meshLinkReady
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
    private let meshReturns: PaymentInbox?
    private let meshReply: (@MainActor (_ text: String, _ origin: MeshOrigin) -> Bool)?
    /// False while the app shows something else over these screens (the Offline corner, another
    /// tab). The screens are then unmounted, so Receive detaches its Bluetooth inbox and nothing is
    /// accepted, reserved or signed unseen; codes wait in the inbox. The models keep their state.
    private let isActive: Bool
    private let meshLinkReady: Bool?
    /// Sends the merchant's replies on events, while shown, per payment presentation. nil without a
    /// `meshReply` (camera only).
    @State private var replies: MeshReplySender?

    public init(dependencies: LokaPayDependencies, startOn tab: Tab = .pay, isActive: Bool = true) {
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
        meshReturns = d.meshReturns
        meshReply = d.meshReply
        meshLinkReady = d.meshLinkReady
        _replies = State(initialValue: d.meshReply.map { MeshReplySender(send: $0) })
        self.isActive = isActive
    }

    public var body: some View {
        VStack(spacing: 0) {
            Picker("Screen", selection: $tab) {
                ForEach(Tab.allCases, id: \.self) { Text($0.rawValue).tag($0) }
            }
            .pickerStyle(.segmented)
            .padding(.horizontal, 16)
            .padding(.top, 8)
            if isActive {
                switch tab {
                case .pay: PayView(model: payModel, connectivity: connectivity)
                case .receive: ReceiveView(model: receiveModel, connectivity: connectivity, bluetoothOn: bluetoothOn,
                                           resendReply: resendReplyAction)
                }
            } else {
                Spacer(minLength: 0)
            }
        }
        .background(LokaColor.paper.ignoresSafeArea())
        .onAppear {
            connectivity.start()
            // Acks and receipts over Bluetooth reach the payment on screen, on either tab, while shown.
            if let meshReturns { MeshReturns.follow(meshReturns, model: payModel, active: isActive) }
            replyEvent()
        }
        .onDisappear {
            connectivity.stop()
            meshReturns?.detach(payModel)
        }
        // Reply events: Receive shown, these screens shown again, a local link up, the radio on, an ack
        // or a receipt newly available. Each is gated on isActive inside MeshReplySender.
        .onChange(of: tab) { if tab == .receive { replyEvent() } }
        .onChange(of: isActive) {
            if let meshReturns { MeshReturns.follow(meshReturns, model: payModel, active: isActive) }
            replyEvent()
        }
        .onChange(of: meshLinkReady) { if meshLinkReady == true { replyEvent() } }
        .onChange(of: bluetoothOn) { if bluetoothOn == true { replyEvent() } }
        .onChange(of: receiveModel.payment?.ackText) { replyEvent() }
        .onChange(of: receiveModel.paymentPresentation) { replyEvent() }
        .onChange(of: receiveModel.settlement?.receiptText) { replyEvent() }
    }

    /// One reply event for the payment on screen now: its ack and receipt, its presentation and the
    /// origin its note was first accepted from. Nothing is sent while these screens are hidden.
    private func replyEvent() {
        replies?.event(ack: receiveModel.payment?.ackText, receipt: receiveModel.settlement?.receiptText,
                       presentation: receiveModel.paymentPresentation,
                       origin: receiveModel.payment?.meshOrigin ?? .notOverBluetooth, active: isActive)
    }

    /// The Receive card's retry button, only while a reply of the payment on screen failed for a
    /// passing reason. It resends that payment's failed replies only.
    private var resendReplyAction: (() -> Void)? {
        let presentation = receiveModel.paymentPresentation
        guard let replies, replies.hasFailedReplies(for: presentation) else { return nil }
        return {
            replies.resendFailed(presentation: receiveModel.paymentPresentation,
                                 origin: receiveModel.payment?.meshOrigin ?? .notOverBluetooth, active: isActive)
        }
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
