import SwiftUI

/// The payer's screen. Every money line reads a verified certificate, ack or receipt from the
/// model. The caller starts and stops the connectivity monitor (LokaPayHomeView does).
public struct PayView: View {
    @Bindable var model: PayModel
    let connectivity: ConnectivityMonitor?
    @State private var scanningMerchant = false
    @State private var scanningReturn = false
    @State private var scanningCheatMerchant = false
    @State private var scanningAllowance = false

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
                if allowance.importedAt != nil || !allowance.certificate.earmarks.isEmpty {
                    Text((allowance.importedAt != nil ? "Imported from a sender's code. " : "")
                         + PayModel.earmarkLine(allowance.certificate, names: model.knownMerchantNames) + ".")
                        .font(LokaStyle.body).foregroundStyle(LokaColor.ink)
                        .fixedSize(horizontal: false, vertical: true)
                }
            }
            phaseContent
            if model.canChangeAllowance {
                allowanceChooser
                receiveFromSenderCard
            }
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
        .sheet(isPresented: $scanningCheatMerchant) {
            ScanSheet(title: "Scan merchant B's code", issue: model.issue) { text in
                model.acceptCheatMerchant(text: text)
                if model.cheatStep == .confirm { scanningCheatMerchant = false }
            }
        }
        .sheet(isPresented: $scanningAllowance) {
            ScanSheet(title: "Scan the sender's allowance code", issue: model.issue) { text in
                model.importAllowance(text: text)
                if model.importNote != nil { scanningAllowance = false }
            }
        }
        // A haptic when a verified ack or receipt lands (Received or Paid), not when this phone signs.
        .sensoryFeedback(.success, trigger: model.phase) { _, new in new == .receipt }
        .announcesIssue(model.issue)
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
                Text(PayModel.signingTitle(secureEnclave: isEnclave)).font(LokaStyle.title).foregroundStyle(LokaColor.ink)
                Text("Nothing has been sent yet.").font(LokaStyle.body).foregroundStyle(LokaColor.muted)
            }
            .lokaCard()
        case .showNote:
            noteCard
            cheatSection
        case .receipt:
            receiptSection
            cheatSection
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
                .buttonStyle(LokaTextButtonStyle())
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
            Text(PayModel.offlineLimitHint(certificate))
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
                .buttonStyle(LokaTextButtonStyle())
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

    // MARK: - Allowances from senders (Script B)

    /// Which allowance Pay signs with, when this phone holds more than one.
    @ViewBuilder private var allowanceChooser: some View {
        let choices = model.allowanceChoices
        if choices.count > 1 {
            VStack(alignment: .leading, spacing: 10) {
                Text("Pay with").font(LokaStyle.headline).foregroundStyle(LokaColor.ink)
                ForEach(choices.reversed(), id: \.certificate.allowanceId) { choice in
                    let selected = choice.certificate.allowanceId == model.allowance?.certificate.allowanceId
                    Button { model.selectAllowance(id: choice.certificate.allowanceId) } label: {
                        HStack(alignment: .top, spacing: 10) {
                            Image(systemName: selected ? "checkmark.circle.fill" : "circle")
                                .foregroundStyle(LokaColor.ink)
                                .accessibilityHidden(true)
                            VStack(alignment: .leading, spacing: 3) {
                                // String(...) keeps the id verbatim: a localized interpolation would print "1,001".
                                Text("Allowance #" + String(choice.certificate.allowanceId)
                                     + (choice.importedAt == nil ? " (from setup)" : " (from a sender)"))
                                    .font(LokaStyle.label).foregroundStyle(LokaColor.ink)
                                Text("Up to $" + Money.display(baseUnits: choice.certificate.cap) + " sandbox. "
                                     + PayModel.earmarkLine(choice.certificate, names: model.knownMerchantNames) + ".")
                                    .font(LokaStyle.caption).foregroundStyle(LokaColor.muted)
                                    .fixedSize(horizontal: false, vertical: true)
                            }
                            Spacer(minLength: 0)
                        }
                        .frame(minHeight: 44)
                        .contentShape(Rectangle())
                    }
                    .buttonStyle(.plain)
                    .accessibilityAddTraits(selected ? .isSelected : [])
                }
            }
            .lokaCard()
        }
    }

    /// The setup allowance's id for a sender (text and code), and the scan that imports the
    /// allowance a sender's payment opened for this phone.
    private var receiveFromSenderCard: some View {
        VStack(alignment: .leading, spacing: 12) {
            Text("Get money from a sender (sandbox)").font(LokaStyle.headline).foregroundStyle(LokaColor.ink)
            if let id = model.setupAllowanceId, let code = model.allowanceIdCodeText {
                Text("Your allowance id (a sender needs this)").font(LokaStyle.label).foregroundStyle(LokaColor.ink)
                Text(String(id))
                    .font(LokaStyle.display.monospacedDigit())
                    .foregroundStyle(LokaColor.ink)
                    .textSelection(.enabled)
                    .accessibilityLabel("Allowance id " + String(id))
                // On Pay's first screen whenever the allowance can change: no full brightness there.
                PaymentQRView(text: code, caption: "Allowance id code for zerobars.us/send", brightens: false)
            }
            Text("A sender's payment opens a new sandbox allowance for this phone. Scan the code their page shows; "
                 + "this phone checks the server's signature and that it names this phone's key before adding it.")
                .font(LokaStyle.body).foregroundStyle(LokaColor.muted)
                .fixedSize(horizontal: false, vertical: true)
            Button { scanningAllowance = true } label: {
                Label("Scan the sender's allowance code", systemImage: "qrcode.viewfinder")
            }
            .buttonStyle(LokaButtonStyle(fill: LokaColor.card, text: LokaColor.ink))
            CodeEntryField(prompt: "Or paste the allowance code (L1|P|1|A|...)") { model.importAllowance(text: $0) }
            if let note = model.importNote {
                Label(note, systemImage: "checkmark.seal.fill")
                    .font(LokaStyle.body).foregroundStyle(LokaColor.ink)
                    .fixedSize(horizontal: false, vertical: true)
            }
        }
        .lokaCard()
    }

    // MARK: - Try to cheat (task 2.13, sandbox demo)

    /// Under the payment's own card, which it never changes. The judge presses it after a payment
    /// settles; the owner signs the same allowance and serial again for merchant B.
    @ViewBuilder private var cheatSection: some View {
        if model.canTryToCheat {
            switch model.cheatStep {
            case .off:
                VStack(alignment: .leading, spacing: 10) {
                    Text("Try to cheat (sandbox demo)").font(LokaStyle.headline).foregroundStyle(LokaColor.ink)
                    Text(PayView.cheatExplanation).font(LokaStyle.body).foregroundStyle(LokaColor.muted)
                    Button { model.startCheat() } label: {
                        Label("Try to cheat (sandbox demo)", systemImage: "exclamationmark.triangle.fill")
                    }
                    .buttonStyle(LokaButtonStyle(fill: LokaColor.warningFill, text: LokaColor.inkFixed))
                }
                .lokaCard()
            case .scanMerchant:
                VStack(alignment: .leading, spacing: 12) {
                    Text("Try to cheat: scan merchant B's code").font(LokaStyle.headline).foregroundStyle(LokaColor.ink)
                    Text("A different merchant from this payment's. This phone checks its certificate like any merchant's.")
                        .font(LokaStyle.body).foregroundStyle(LokaColor.muted)
                    Button { scanningCheatMerchant = true } label: {
                        Label("Scan merchant B's code", systemImage: "qrcode.viewfinder")
                    }
                    .buttonStyle(LokaButtonStyle(fill: LokaColor.card, text: LokaColor.ink))
                    CodeEntryField(prompt: "Or paste merchant B's code") { model.acceptCheatMerchant(text: $0) }
                    cancelCheatButton
                }
                .lokaCard(border: LokaColor.warningBorder)
            case .confirm:
                VStack(alignment: .leading, spacing: 12) {
                    Text("Try to cheat (sandbox demo)").font(LokaStyle.caption).foregroundStyle(LokaColor.muted)
                    Text(model.cheatMerchant?.displayName ?? "").font(LokaStyle.title).foregroundStyle(LokaColor.ink)
                    Label("Merchant certificate verified", systemImage: "checkmark.shield.fill")
                        .font(LokaStyle.caption).foregroundStyle(LokaColor.muted)
                    if let original = model.cheatOriginal {
                        Text(PayView.cheatConfirmText(original, merchantName: model.cheatMerchant?.displayName ?? "merchant B"))
                            .font(LokaStyle.body).foregroundStyle(LokaColor.ink)
                    }
                    Button { Task { await model.signCheat() } } label: {
                        Label(isEnclave ? "Sign the cheat note with Face ID" : "Sign the cheat note (software key, no Face ID)",
                              systemImage: isEnclave ? "faceid" : "signature")
                    }
                    .buttonStyle(LokaButtonStyle())
                    cancelCheatButton
                }
                .lokaCard()
            case .signing:
                VStack(alignment: .leading, spacing: 12) {
                    ProgressView()
                    Text(PayModel.signingTitle(secureEnclave: isEnclave)).font(LokaStyle.title).foregroundStyle(LokaColor.ink)
                    Text("Signing the cheat note. No serial is reserved for it.").font(LokaStyle.body).foregroundStyle(LokaColor.muted)
                }
                .lokaCard()
            case .showNote:
                cheatNoteCard
            }
        }
    }

    @ViewBuilder private var cheatNoteCard: some View {
        if let cheat = model.cheat {
            VStack(alignment: .leading, spacing: 14) {
                Label(cheat.banner, systemImage: "exclamationmark.triangle.fill")
                    .font(LokaStyle.label).foregroundStyle(LokaColor.inkFixed)
                    .fixedSize(horizontal: false, vertical: true)
                    .padding(12)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .background(RoundedRectangle(cornerRadius: 16, style: .continuous).fill(LokaColor.warningFill))
                    .overlay(RoundedRectangle(cornerRadius: 16, style: .continuous)
                        .strokeBorder(LokaColor.warningBorder, lineWidth: LokaStyle.borderWidth))
                Text("$\(Money.display(baseUnits: cheat.payment.note.note.amount)) sandbox to \(cheat.merchant.displayName)")
                    .font(LokaStyle.title).foregroundStyle(LokaColor.ink)
                Text("Show code 1, then code 2, to merchant B.").font(LokaStyle.body).foregroundStyle(LokaColor.muted)
                Picker("Cheat code", selection: Binding(get: { model.cheatCodeStep }, set: { model.showCheatCode($0) })) {
                    Text("1. Allowance").tag(PayModel.CodeStep.allowance)
                    Text("2. Cheat note").tag(PayModel.CodeStep.note)
                }
                .pickerStyle(.segmented)
                if let text = model.currentCheatCodeText {
                    PaymentQRView(text: text, caption: model.cheatCodeStep == .allowance
                        ? "Code 1 of 2: your allowance certificate"
                        : "Code 2 of 2: the cheat note (same serial, merchant B)")
                }
                if model.cheatCodeStep == .allowance {
                    Button("Next: show the cheat note") { model.showCheatCode(.note) }.buttonStyle(LokaButtonStyle())
                }
                Button("Try another merchant") { model.startCheat() }
                    .buttonStyle(LokaTextButtonStyle())
                    .font(LokaStyle.label).foregroundStyle(LokaColor.ink)
                cancelCheatButton
            }
            .lokaCard(border: LokaColor.warningBorder)
        }
    }

    private var cancelCheatButton: some View {
        Button(model.cheatStep == .showNote ? "Close the cheat note" : "Cancel") { model.cancelCheat() }
            .buttonStyle(LokaTextButtonStyle())
            .font(LokaStyle.label).foregroundStyle(LokaColor.ink)
    }

    /// The one line under the control.
    static let cheatExplanation =
        "Signs this same allowance and serial again for another merchant. The chain should refuse it."

    static func cheatConfirmText(_ original: SignedNote, merchantName: String) -> String {
        // String(...) keeps the id verbatim: a localized interpolation would print "1,001".
        "This signs serial " + String(original.note.serial) + " of allowance #" + String(original.note.allowanceId)
            + " again: the same $" + Money.display(baseUnits: original.note.amount) + " sandbox and expiry, to "
            + merchantName + " instead. No new serial is reserved."
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

#Preview("Pay: try to cheat, scan merchant B") {
    PayView(model: .preview(.receipt, merchant: PreviewFixtures.merchant, payment: PreviewFixtures.payment,
                            receipt: PreviewFixtures.receipt(conf: PreviewFixtures.confSettledWire),
                            cheatStep: .scanMerchant))
}

#Preview("Pay: try to cheat, same merchant refused") {
    PayView(model: .preview(.receipt, merchant: PreviewFixtures.merchant, payment: PreviewFixtures.payment,
                            receipt: PreviewFixtures.receipt(conf: PreviewFixtures.confSettledWire),
                            issue: .cheatSameMerchant, cheatStep: .scanMerchant))
}

#Preview("Pay: try to cheat, confirm") {
    PayView(model: .preview(.receipt, merchant: PreviewFixtures.merchant, payment: PreviewFixtures.payment,
                            receipt: PreviewFixtures.receipt(conf: PreviewFixtures.confSettledWire),
                            cheatStep: .confirm, cheatMerchant: PreviewFixtures.merchantB))
}

#Preview("Pay: cheat note, dark") {
    PayView(model: .preview(.receipt, merchant: PreviewFixtures.merchant, payment: PreviewFixtures.payment,
                            receipt: PreviewFixtures.receipt(conf: PreviewFixtures.confSettledWire),
                            cheatStep: .showNote, cheat: PreviewFixtures.cheat))
        .preferredColorScheme(.dark)
}
#endif
