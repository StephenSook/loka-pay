import SwiftUI

/// The merchant's screen. Received comes only after the note, the merchant checks and the ledger
/// reservation pass; Paid or Failed only from a verified CONF. The caller starts and stops the
/// connectivity monitor (LokaPayHomeView does). `bluetoothOn` is the mesh layer's report, or nil.
public struct ReceiveView: View {
    @Bindable var model: ReceiveModel
    @ObservedObject var connectivity: ConnectivityMonitor
    let bluetoothOn: Bool?
    @State private var scanning = false

    public init(model: ReceiveModel, connectivity: ConnectivityMonitor, bluetoothOn: Bool? = nil) {
        self.model = model
        self.connectivity = connectivity
        self.bluetoothOn = bluetoothOn
    }

    /// The screen without its scroll view (also rendered on its own for layout checks).
    var screenContent: some View {
        VStack(alignment: .leading, spacing: 18) {
            SandboxBanner()
            HStack {
                Text("Receive").font(LokaStyle.display).foregroundStyle(LokaColor.ink)
                Spacer()
                LiveNoInternetChip(monitor: connectivity)
            }
            phaseContent
            if let issue = model.issue { IssueBanner(issue) }
        }
        .padding(16)
    }

    public var body: some View {
        ScrollView { screenContent }
        .background(LokaColor.paper.ignoresSafeArea())
        .sheet(isPresented: $scanning) {
            ScanSheet(title: "Scan the payer's codes", issue: model.issue) { text in
                Task { await model.accept(text: text) }
            }
        }
        .onChange(of: model.phase) { (_: ReceiveModel.Phase, phase: ReceiveModel.Phase) in
            if phase != .ready { scanning = false }
        }
        .sensoryFeedback(.success, trigger: model.phase) { (_: ReceiveModel.Phase, new: ReceiveModel.Phase) in
            isGoodNews(new)
        }
        .sensoryFeedback(.error, trigger: model.phase) { (_: ReceiveModel.Phase, new: ReceiveModel.Phase) in
            isBadNews(new)
        }
        // Bluetooth codes are taken only while this screen is shown; others wait in the inbox.
        .onAppear { model.startInbox() }
        .onDisappear { model.stopInbox() }
    }

    private func isGoodNews(_ phase: ReceiveModel.Phase) -> Bool {
        if phase == .received { return true }
        return phase == .settled && model.settlement?.status == MoneyStatus.paid
    }

    private func isBadNews(_ phase: ReceiveModel.Phase) -> Bool {
        phase == .settled && model.settlement?.status == MoneyStatus.failed
    }

    @ViewBuilder private var phaseContent: some View {
        switch model.phase {
        case .unavailable:
            VStack(alignment: .leading, spacing: 8) {
                Text("Receive is not ready on this phone").font(LokaStyle.title).foregroundStyle(LokaColor.ink)
                Text("No payment can be accepted until the item below is fixed.")
                    .font(LokaStyle.body).foregroundStyle(LokaColor.muted)
            }
            .lokaCard()
        case .ready:
            readyCard
        case .received:
            receivedSection
        case .settled:
            settledSection
        }
    }

    private var readyCard: some View {
        VStack(alignment: .leading, spacing: 14) {
            Text("Show this code to the payer").font(LokaStyle.title).foregroundStyle(LokaColor.ink)
            if let text = model.merchantText, let merchant = model.merchant {
                PaymentQRView(text: text, caption: "Merchant code: \(merchant.displayName)")
            }
            Button { scanning = true } label: { Label("Scan the payer's codes", systemImage: "qrcode.viewfinder") }
                .buttonStyle(LokaButtonStyle())
            let step = model.readyStep
            switch step {
            case .noteWaitingForAllowance:
                Label(step.text, systemImage: "hourglass")
                    .font(LokaStyle.body).foregroundStyle(LokaColor.ink)
            case .allowanceVerified:
                Label(step.text, systemImage: "checkmark.circle.fill")
                    .font(LokaStyle.body).foregroundStyle(LokaColor.ink)
            case .waitingForBoth:
                Text(step.text).font(LokaStyle.body).foregroundStyle(LokaColor.muted)
            }
            if model.conflictingSpend { MoneyStatusChip(.conflictingSpend) }
            // A waiting note belongs to an allowance not on this phone yet, so another payer's
            // risk line would describe the wrong allowance.
            if step != .noteWaitingForAllowance { limitBlock(model.lastAllowance) }
            CodeEntryField(prompt: "Or paste a payer code") { text in Task { await model.accept(text: text) } }
        }
        .lokaCard()
    }

    @ViewBuilder private func limitBlock(_ certificate: AllowanceCertificate?) -> some View {
        if let certificate {
            let unsettled = model.unsettled(for: certificate)
            // No chip without a total: "Within local limit" would be a guess.
            if unsettled != nil, let state = model.limitState { LimitChip(state) }
            Text(LimitState.riskLine(unsettled: unsettled, offlineLimit: certificate.offlineLimit,
                                     allowanceId: certificate.allowanceId))
                .font(LokaStyle.caption).foregroundStyle(LokaColor.muted)
        }
    }

    @ViewBuilder private var receivedSection: some View {
        if let payment = model.payment {
            VStack(alignment: .leading, spacing: 12) {
                MoneyStatusChip(.received, large: true)
                HStack(alignment: .firstTextBaseline) {
                    Text("$\(Money.display(baseUnits: payment.note.note.amount))")
                        .font(LokaStyle.display).foregroundStyle(LokaColor.ink)
                    Text("sandbox").font(LokaStyle.label).foregroundStyle(LokaColor.muted)
                }
                Text("Received, pending (sandbox). Checked offline on this phone; not settled yet.")
                    .font(LokaStyle.body).foregroundStyle(LokaColor.ink)
                ZeroBarsMeter(internet: connectivity.state, holdingSince: payment.receivedAt, bluetoothOn: bluetoothOn)
                limitBlock(payment.certificate)
            }
            .lokaCard()
            AllowanceCard(certificate: payment.certificate,
                          usage: model.unsettled(for: payment.certificate).map { .unsettledHere($0) })
            VStack(alignment: .leading, spacing: 12) {
                if let ackText = payment.ackText {
                    PaymentQRView(text: ackText, caption: "Receipt for the payer, signed by this phone")
                } else if model.isWorking {
                    ProgressView()
                    Text(ReceiveModel.ackSigningText(secureEnclave: model.signerIsSecureEnclave))
                        .font(LokaStyle.body).foregroundStyle(LokaColor.ink)
                } else {
                    Text("The receipt is not signed yet.").font(LokaStyle.body).foregroundStyle(LokaColor.ink)
                    Button("Sign the receipt again") { Task { await model.signAck() } }.buttonStyle(LokaButtonStyle())
                }
            }
            .lokaCard()
            settleCard(payment)
        }
    }

    private func settleCard(_ payment: ReceivedPayment) -> some View {
        VStack(alignment: .leading, spacing: 12) {
            Button {
                Task { await model.settle() }
            } label: {
                Label("Settle on Solana devnet", systemImage: "arrow.up.circle.fill")
            }
            .buttonStyle(LokaButtonStyle())
            .disabled(payment.ack == nil || model.isWorking)
            if model.isWorking, payment.ack != nil { ProgressView() }
            if model.pendingSettlement != nil {
                Text("The server has the note; the chain has not decided yet.")
                    .font(LokaStyle.body).foregroundStyle(LokaColor.ink)
                Button("Check again") { Task { await model.checkAgain() } }
                    .buttonStyle(LokaButtonStyle(fill: LokaColor.card, text: LokaColor.ink))
            }
            Text("Settling needs internet. The status changes only when a server-signed confirmation verifies on this phone.")
                .font(LokaStyle.caption).foregroundStyle(LokaColor.muted)
            Button("Next payment") { model.nextPayment() }
                .font(LokaStyle.label).foregroundStyle(LokaColor.ink)
        }
        .lokaCard()
    }

    @ViewBuilder private var settledSection: some View {
        if let settlement = model.settlement {
            MoneyStatusChip(settlement.status, large: true)
            ReceiptCard(receipt: settlement.receipt, merchant: model.merchant, clusterId: model.deployment.clusterId,
                        receivedWithZeroBars: model.payment?.receivedWithZeroBars ?? false)
            VStack(alignment: .leading, spacing: 12) {
                if let reason = settlement.reasonUnsigned {
                    Text("The server names the error \(reason) (not signed; the signed code is on the receipt).")
                        .font(LokaStyle.caption).foregroundStyle(LokaColor.muted)
                }
                if settlement.replayed {
                    Text("The server had already decided this note (not signed).")
                        .font(LokaStyle.caption).foregroundStyle(LokaColor.muted)
                }
                PaymentQRView(text: settlement.receiptText, caption: "Settled receipt for the payer")
                Button("Next payment") { model.nextPayment() }.buttonStyle(LokaButtonStyle())
            }
            .lokaCard()
        }
    }
}

#if DEBUG
#Preview("Receive: merchant certificate missing") {
    ReceiveView(model: ReceiveModel(merchantWire: nil, signer: PreviewFixtures.merchantSigner,
                                    ledger: OfflineLedger(url: PreviewFixtures.scratchURL("preview-ledger.json")),
                                    settlementClient: nil, deployment: PreviewFixtures.deployment,
                                    serverPublicKey: PreviewFixtures.serverKey, now: { PreviewFixtures.now }),
                connectivity: ConnectivityMonitor())
}

#Preview("Receive: ready, Bluetooth inbox") {
    ReceiveView(model: .preview(.ready, bluetoothInbox: true), connectivity: ConnectivityMonitor(), bluetoothOn: true)
}

#Preview("Receive: ready, camera only") {
    ReceiveView(model: .preview(.ready), connectivity: ConnectivityMonitor())
}

#Preview("Receive: note before allowance") {
    ReceiveView(model: .preview(.ready, issue: .allowanceNeeded, waitingNote: PreviewFixtures.note0),
                connectivity: ConnectivityMonitor())
}

#Preview("Receive: conflicting spend seen") {
    ReceiveView(model: .preview(.ready, issue: .payment(.serialSeen), conflict: true, unsettled: 1_000_000),
                connectivity: ConnectivityMonitor())
}

#Preview("Receive: over the offline limit") {
    ReceiveView(model: .preview(.ready, issue: .payment(.offlineLimit), unsettled: 2_750_000),
                connectivity: ConnectivityMonitor())
}

#Preview("Receive: received, zero bars") {
    ReceiveView(model: .preview(.received, payment: PreviewFixtures.received(), unsettled: 1_000_000),
                connectivity: ConnectivityMonitor(), bluetoothOn: true)
}

#Preview("Receive: receipt not signed") {
    ReceiveView(model: .preview(.received, payment: PreviewFixtures.received(withAck: false),
                                issue: .signing("Authentication canceled."), unsettled: 1_000_000),
                connectivity: ConnectivityMonitor())
}

#Preview("Receive: server not running") {
    ReceiveView(model: .preview(.received, payment: PreviewFixtures.received(),
                                issue: .settlement(.http(status: 503, error: nil, message: nil)), unsettled: 1_000_000),
                connectivity: ConnectivityMonitor())
}

#Preview("Receive: refused by the server") {
    ReceiveView(model: .preview(.received, payment: PreviewFixtures.received(),
                                issue: .settlement(.refused(check: "bad_signature", message: "")), unsettled: 1_000_000),
                connectivity: ConnectivityMonitor())
}

#Preview("Receive: chain has not decided") {
    ReceiveView(model: .preview(.received, payment: PreviewFixtures.received(),
                                pending: PendingSettlement(noteId: PreviewFixtures.note0.noteId, signature: nil,
                                                           explorer: nil, retryAfter: 2),
                                unsettled: 1_000_000),
                connectivity: ConnectivityMonitor())
}

#Preview("Receive: paid") {
    ReceiveView(model: .preview(.settled, payment: PreviewFixtures.received(),
                                settlement: PreviewFixtures.settled(conf: PreviewFixtures.confSettledWire), unsettled: 0),
                connectivity: ConnectivityMonitor())
}

#Preview("Receive: failed on chain, dark") {
    ReceiveView(model: .preview(.settled, payment: PreviewFixtures.received(),
                                settlement: PreviewFixtures.settled(conf: PreviewFixtures.confFailedWire), unsettled: 0),
                connectivity: ConnectivityMonitor())
        .preferredColorScheme(.dark)
}
#endif
