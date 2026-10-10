import SwiftUI


struct CommunitySharingView: View {
    var onboarding = false
    var saved: () -> Void
    @State private var value = CommunitySharingPreferences.load()
    @State private var saveError: String?
    @Environment(\.dismiss) private var dismiss
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    var body: some View {
        VStack(spacing: 0) {
            ScrollView {
                VStack(alignment: .leading, spacing: 20) {
                    if onboarding {
                        Image("community_sharing").resizable().scaledToFit().frame(maxHeight: 190).accessibilityHidden(true)
                        Text("A little connection.\nA stronger community.").font(.custom("LilitaOne", size: 27, relativeTo: .title))
                    }
                    Text("Help relay encrypted messages when you’re online. Sharing is optional.").foregroundStyle(LokaStyle.muted)
                    VStack(alignment: .leading, spacing: 16) {
                        Toggle("Join community sharing", isOn: $value.enabled).font(.headline)
                        if value.enabled {
                            Divider()
                            Toggle("Share on Wi-Fi", isOn: $value.wifi)
                            if value.wifi { CommunitySharingLimitField(label: "Wi-Fi sharing limit", value: $value.wifiLimit, choices: ["Unlimited", "500 MB", "1 GB", "5 GB", "Custom"]) }
                            Divider()
                            Toggle("Share mobile data", isOn: $value.mobile)
                            if value.mobile {
                                CommunitySharingLimitField(label: "Monthly sharing limit", value: $value.mobileLimit, choices: ["50 MB", "100 MB", "500 MB", "1 GB", "Custom"])
                                Text("Sharing stops at your limit. Carrier charges may apply.").font(.footnote).foregroundStyle(LokaStyle.muted)
                            } else { Text("Mobile data won’t be used for community sharing.").font(.footnote).foregroundStyle(LokaStyle.muted) }
                            if !value.wifi && !value.mobile { Text(value.error ?? "").font(.footnote).foregroundStyle(.red) }
                        } else { Text("Community sharing is off.").foregroundStyle(LokaStyle.adaptive(0x087956, 0x64DFBA)) }
                    }.padding(18).background(LokaStyle.surface, in: RoundedRectangle(cornerRadius: 24))
                    Text("Internet community sharing isn’t available yet. Save your preferences for when it launches.").font(.footnote).foregroundStyle(LokaStyle.adaptive(0x087956, 0x64DFBA))
                    if !onboarding {
                        Text("Usage: no community relay traffic recorded.").foregroundStyle(LokaStyle.muted)
                        Text("Monthly limits use your device’s local calendar month and cover community relay traffic plus network overhead. Your own messages and local mesh relaying are separate.").font(.footnote).foregroundStyle(LokaStyle.muted)
                    }
                    if let saveError { Text(saveError).foregroundStyle(.red) }
                }.padding(24)
            }.scrollDismissesKeyboard(.interactively)
            Button {
                do {
                    let data = try JSONEncoder().encode(value)
                    UserDefaults.standard.set(data, forKey: "loka.communitySharing.preferences")
                    saved()
                    if !onboarding { dismiss() }
                } catch { saveError = "Couldn’t save sharing preferences. Please try again." }
            } label: { Text(onboarding ? "Save & continue" : "Save changes").bold().frame(maxWidth: .infinity, minHeight: 44) }
                .buttonStyle(LokaPrimaryButtonStyle()).disabled(value.error != nil)
                .padding(.horizontal, 24).padding(.vertical, 16)
        }.background(LokaStyle.background).tint(LokaStyle.green)
            .animation(reduceMotion ? nil : .easeInOut(duration: 0.2), value: value.enabled)
            .animation(reduceMotion ? nil : .easeInOut(duration: 0.2), value: value.wifi)
            .animation(reduceMotion ? nil : .easeInOut(duration: 0.2), value: value.mobile)
            .animation(reduceMotion ? nil : .easeInOut(duration: 0.2), value: value.wifiLimit.selection)
            .animation(reduceMotion ? nil : .easeInOut(duration: 0.2), value: value.mobileLimit.selection)
    }
}

private struct CommunitySharingLimitField: View {
    let label: String
    @Binding var value: CommunitySharingLimit
    let choices: [String]
    @State private var sheet = false
    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            Text(label).font(.caption).foregroundStyle(LokaStyle.muted)
            Button { sheet = true } label: {
                HStack { Text(value.label); Spacer(); Image(systemName: "chevron.down") }
                    .padding(14).background(LokaStyle.mint, in: RoundedRectangle(cornerRadius: 14))
            }.buttonStyle(.plain).accessibilityLabel("\(label), \(value.label)")
            if value.selection == "Custom" {
                TextField("Custom monthly limit", text: $value.custom).keyboardType(.decimalPad)
                    .padding(14).background(LokaStyle.surface, in: RoundedRectangle(cornerRadius: 14))
                    .onChange(of: value.custom) { _, text in if text.count > 24 { value.custom = String(text.prefix(24)) } }
                Picker("Unit", selection: $value.unit) { Text("MB").tag("MB"); Text("GB").tag("GB") }.pickerStyle(.segmented)
                if let error = value.error { Text(error).font(.caption).foregroundStyle(.red) }
            }
            if value.selection == "Unlimited" { Text("No sharing cap on Wi-Fi.").font(.caption).foregroundStyle(LokaStyle.muted) }
            else if value.selection != "Custom" { Text("\(value.selection) per calendar month.").font(.caption).foregroundStyle(LokaStyle.muted) }
        }
        .sheet(isPresented: $sheet) {
            ScrollView {
                VStack(alignment: .leading, spacing: 8) {
                    Text(label).font(.title2.bold()).padding(.bottom, 12)
                    ForEach(choices, id: \.self) { choice in
                        Button { value.selection = choice; sheet = false } label: {
                            HStack { Text(["Unlimited", "Custom"].contains(choice) ? choice : "\(choice) / month"); Spacer(); if value.selection == choice { Image(systemName: "checkmark") } }.frame(minHeight: 48)
                        }.buttonStyle(.plain).foregroundStyle(LokaStyle.green)
                    }
                }.padding(24)
            }.presentationDetents([.medium, .large]).presentationDragIndicator(.visible).background(LokaStyle.background)
        }
    }
}
