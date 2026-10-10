import SwiftUI

/// The payer's screen. Every money line reads a verified certificate, ack or receipt from the
/// model. The caller starts and stops the connectivity monitor (LokaPayHomeView does).
public struct PayView: View {
    @Bindable var model: PayModel
    let connectivity: ConnectivityMonitor?
    @State private var scanningMerchant = false
    @State private var scanningReturn = false

    public init(model: PayModel, connectivity: ConnectivityMonitor? = nil) {
        self.model = model
        self.connectivity = connectivity
    }

    /// The screen without its scroll view (also rendered on its own for layout checks).
    var screenContent: some View {
        VStack(alignment: .leading, spacing: 18) {
            SandboxBanner()
            HStack {
                Text("Pay").font(LokaStyle.display).foregroundStyle(LokaColor.ink)
                Spacer()
                if let connectivity { LiveNoInternetChip(monitor: connectivity) }
            }
            if let allowance = model.allowance {
                AllowanceCard(certificate: allowance.certificate, usage: model.notesSigned.map { .notesSigned($0) })
            }
            phaseContent
            if let issue = model.issue { IssueBanner(issue) }
        }
        .padding(16)
    }

    public var body: some View {
        ScrollView { screenContent }
        .background(LokaColor.paper.ignoresSafeArea())
        .sheet(isPresented: $scanningMerchant) {
            ScanSheet(title: "Scan the merchant code", issue: model.issue) { text in
                model.acceptMerchant(text: text)
                if model.phase == .enterAmount { scanningMerchant = false }
            }
        }
        .sheet(isPresented: $scanningReturn) {
            ScanSheet(title: "Scan the merchant's receipt", issue: model.issue) { text in
                model.acceptReturn(text: text)
                if model.phase == .receipt { scanningReturn = false }
            }
        }
        // A haptic when a verified ack or receipt lands (Received or Paid), not when this phone signs.
        .sensoryFeedback(.success, trigger: model.phase) { _, new in new == .receipt }
    }

    @ViewBuilder private var phaseContent: some View {
        switch model.phase {
        case .unavailable:
            VStack(alignment: .leading, spacing: 8) {
                Text("Pay is not ready on this phone").font(LokaStyle.title).foregroundStyle(LokaColor.ink)
                Text("Nothing can be signed until the item below is fixed.")
                    .font(LokaStyle.body).foregroundStyle(LokaColor.muted)
            }
            .lokaCard()
        case .scanMerchant:
            VStack(alignment: .leading, spacing: 12) {
                Text("Scan the merchant's code").font(LokaStyle.title).foregroundStyle(LokaColor.ink)
                Text("The merchant's phone shows a code with its certificate. This phone checks it before you pay.")
                    .font(LokaStyle.body).foregroundStyle(LokaColor.muted)
                Button { scanningMerchant = true } label: { Label("Scan merchant code", systemImage: "qrcode.viewfinder") }
                    .buttonStyle(LokaButtonStyle())
                CodeEntryField(prompt: "Or paste the merchant code") { model.acceptMerchant(text: $0) }
            }
            .lokaCard()
        case .enterAmount:
            amountCard
        case .signing:
            VStack(alignment: .leading, spacing: 12) {
                ProgressView()
                Text("Waiting for Face ID or the passcode").font(LokaStyle.title).foregroundStyle(LokaColor.ink)
                Text("Nothing has been sent yet.").font(LokaStyle.body).foregroundStyle(LokaColor.muted)
            }
            .lokaCard()
        case .showNote:
            noteCard
        case .receipt:
            receiptSection
        }
    }

    private var amountCard: some View {
        VStack(alignment: .leading, spacing: 12) {
            Text("Paying").font(LokaStyle.caption).foregroundStyle(LokaColor.muted)
            Text(model.merchant?.displayName ?? "").font(LokaStyle.title).foregroundStyle(LokaColor.ink)
            Label("Merchant certificate verified", systemImage: "checkmark.shield.fill")
                .font(LokaStyle.caption).foregroundStyle(LokaColor.muted)
            TextField("Amount, for example 1.50", text: $model.amountText)
                .font(LokaStyle.display.monospacedDigit())
                .foregroundStyle(LokaColor.ink)
                #if os(iOS)
                .keyboardType(.decimalPad)
                #endif
                .accessibilityLabel("Amount in sandbox dollars")
            amountHint
            Button {
                Task { await model.pay() }
            } label: {
                Label(signButtonTitle, systemImage: isEnclave ? "faceid" : "signature")
            }
            .buttonStyle(LokaButtonStyle())
            .disabled(!amountIsValid)
            Button("Change merchant") { model.changeMerchant() }
                .font(LokaStyle.label)
                .foregroundStyle(LokaColor.ink)
        }
        .lokaCard()
    }

    @ViewBuilder private var amountHint: some View {
        switch model.amountCheck {
        case .success(let units):
            Text("You will sign $\(Money.display(baseUnits: units)) sandbox to \(model.merchant?.displayName ?? "this merchant").")
                .font(LokaStyle.body).foregroundStyle(LokaColor.ink)
        case .failure(let kind):
            if !model.amountText.isEmpty {
                Text(kind.message).font(LokaStyle.body).foregroundStyle(LokaColor.ink)
            }
        }
        if let certificate = model.allowance?.certificate {
            Text("Up to $\(Money.display(baseUnits: certificate.offlineLimit)) per payment offline (allowance offline limit).")
                .font(LokaStyle.caption).foregroundStyle(LokaColor.muted)
        }
    }

    private var amountIsValid: Bool {
        if case .success = model.amountCheck { return true }
        return false
    }

    private var isEnclave: Bool { model.signerIsSecureEnclave }

    private var signButtonTitle: String {
        isEnclave ? "Sign with Face ID and pay" : "Sign and pay (software key, no Face ID)"
    }

    private var noteCard: some View {
        VStack(alignment: .leading, spacing: 14) {
            MoneyStatusChip(.pending)
            if let note = model.payment?.note {
                Text("$\(Money.display(baseUnits: note.note.amount)) sandbox to \(model.merchant?.displayName ?? "the merchant")")
                    .font(LokaStyle.title).foregroundStyle(LokaColor.ink)
            }
            Text("Signed on this phone. Show code 1, then code 2, to the merchant.")
                .font(LokaStyle.body).foregroundStyle(LokaColor.muted)
            Picker("Code", selection: Binding(get: { model.codeStep }, set: { model.showCode($0) })) {
                Text("1. Allowance").tag(PayModel.CodeStep.allowance)
                Text("2. Payment note").tag(PayModel.CodeStep.note)
            }
            .pickerStyle(.segmented)
            if let text = model.currentCodeText {
                PaymentQRView(text: text, caption: model.codeStep == .allowance
                    ? "Code 1 of 2: your allowance certificate"
                    : "Code 2 of 2: the signed payment note")
            }
            if model.codeStep == .allowance {
                Button("Next: show the payment note") { model.showCode(.note) }.buttonStyle(LokaButtonStyle())
            }
            if model.canSendOverBluetooth {
                Button { model.sendOverBluetooth() } label: {
                    Label("Send both over Bluetooth", systemImage: "dot.radiowaves.left.and.right")
                }
                .buttonStyle(LokaButtonStyle(fill: LokaColor.received, text: LokaColor.inkFixed))
            } else {
                Text("Bluetooth sending is not connected in this build. Use the codes.")
                    .font(LokaStyle.caption).foregroundStyle(LokaColor.muted)
            }
            Button { scanningReturn = true } label: {
                Label("Scan the merchant's receipt", systemImage: "qrcode.viewfinder")
            }
            .buttonStyle(LokaButtonStyle(fill: LokaColor.card, text: LokaColor.ink))
            CodeEntryField(prompt: "Or paste the merchant's receipt") { model.acceptReturn(text: $0) }
            Button("New payment") { model.newPayment() }
                .font(LokaStyle.label).foregroundStyle(LokaColor.ink)
        }
        .lokaCard()
    }

    @ViewBuilder private var receiptSection: some View {
        if let receipt = model.receipt {
            ReceiptCard(receipt: receipt, merchant: model.merchant, clusterId: model.deployment.clusterId)
            VStack(alignment: .leading, spacing: 12) {
                if receipt.confirmation == nil {
                    Text("The merchant accepted this note offline. It settles when the merchant is online; scan the settled receipt then.")
                        .font(LokaStyle.body).foregroundStyle(LokaColor.ink)
                    Button { scanningReturn = true } label: {
                        Label("Scan the settled receipt", systemImage: "qrcode.viewfinder")
                    }
                    .buttonStyle(LokaButtonStyle(fill: LokaColor.card, text: LokaColor.ink))
                    CodeEntryField(prompt: "Or paste the settled receipt") { model.acceptReturn(text: $0) }
                }
                Button("New payment") { model.newPayment() }.buttonStyle(LokaButtonStyle())
            }
            .lokaCard()
        }
    }
}

#if DEBUG
#Preview("Pay: server key not pinned") {
    PayView(model: .preview(.scanMerchant, serverKey: nil))
}

#Preview("Pay: scan merchant") {
    PayView(model: .preview(.scanMerchant))
}

#Preview("Pay: amount") {
    PayView(model: .preview(.enterAmount, merchant: PreviewFixtures.merchant, amountText: "1.00"))
}

#Preview("Pay: over the offline limit") {
    PayView(model: .preview(.enterAmount, merchant: PreviewFixtures.merchant, amountText: "4.00"))
}

#Preview("Pay: Face ID cancelled") {
    PayView(model: .preview(.enterAmount, merchant: PreviewFixtures.merchant,
                            issue: .signing("serial 0 set aside and never reused; Authentication canceled."),
                            amountText: "1.00"))
}

#Preview("Pay: signing") {
    PayView(model: .preview(.signing, merchant: PreviewFixtures.merchant, amountText: "1.00"))
}

#Preview("Pay: code 1 of 2") {
    PayView(model: .preview(.showNote, merchant: PreviewFixtures.merchant, payment: PreviewFixtures.payment))
}

#Preview("Pay: code 2 of 2") {
    PayView(model: .preview(.showNote, merchant: PreviewFixtures.merchant, payment: PreviewFixtures.payment,
                            codeStep: .note))
}

#Preview("Pay: received by the merchant") {
    PayView(model: .preview(.receipt, merchant: PreviewFixtures.merchant, payment: PreviewFixtures.payment,
                            receipt: PreviewFixtures.receipt(conf: nil)))
}

#Preview("Pay: paid") {
    PayView(model: .preview(.receipt, merchant: PreviewFixtures.merchant, payment: PreviewFixtures.payment,
                            receipt: PreviewFixtures.receipt(conf: PreviewFixtures.confSettledWire)))
}

#Preview("Pay: failed on chain, dark") {
    PayView(model: .preview(.receipt, merchant: PreviewFixtures.merchant, payment: PreviewFixtures.payment,
                            receipt: PreviewFixtures.receipt(conf: PreviewFixtures.confFailedWire)))
        .preferredColorScheme(.dark)
}

#Preview("Pay: wrong code scanned") {
    PayView(model: .preview(.scanMerchant, issue: .wrongKind(expected: [.merchant], got: .note)))
}
#endif
