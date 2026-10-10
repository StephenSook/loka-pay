import SwiftUI
import PhotosUI
import ImageIO
import AVFoundation

private let chatGreen = LokaStyle.green

struct ConversationView: View {
    let contact: LokaContact
    @EnvironmentObject private var chat: ChatStore
    @EnvironmentObject private var contacts: ContactStore
    @ObservedObject var link: BleLink
    @State private var photo: PhotosPickerItem?
    @State private var cameraOpen = false
    @State private var imageDraft: Data?
    @State private var preparingImage = false
    @State private var photoError: String?
    @State private var draft = ""
    @State private var infoID: String?
    @State private var reactionID: String?
    @State private var conversationVisible = false
    @State private var viewportHeight: CGFloat = 0
    @State private var visibleIDs: Set<String> = []
    @State private var editingName = false
    @State private var editedName = ""
    @State private var securityInfo = false
    @StateObject private var voice = VoiceNote()
    @FocusState private var composing: Bool
    @Environment(\.scenePhase) private var scenePhase
    private var sending: Bool { chat.sending.contains(contact.id) }
    private var messages: [LokaMessage] { chat.messages.filter { $0.friendID == contact.id }.sorted(by: lokaMessagePrecedes) }
    private var name: String { contacts.contacts.first { $0.id == contact.id }?.name.nonEmpty ?? "LOKA friend" }
    private func markVisibleRead() {
        guard conversationVisible, scenePhase == .active, infoID == nil, reactionID == nil, !cameraOpen else { return }
        visibleIDs.forEach { chat.markRead($0) }
    }
    var body: some View {
        VStack(spacing: 0) {
            ScrollViewReader { proxy in
                ScrollView {
                    LazyVStack(spacing: 12) {
                        if messages.isEmpty {
                            VStack(spacing: 8) {
                                LokaAvatar(name: name, size: 64, peerID: contact.id)
                                Text("Say hello to \(name)").font(.headline)
                                Text("Both people need to add each other. Keep both apps open for this test.").font(.subheadline).foregroundStyle(.secondary)
                            }.multilineTextAlignment(.center).padding(.vertical, 32)
                        }
                        ForEach(messages) { message in
                            HStack {
                                if message.outgoing { Spacer(minLength: 36) }
                                VStack(alignment: .leading, spacing: 6) {
                                    if message.image == true, let data = Data(base64Encoded: message.text), ChatContent.validImage(data), let image = UIImage(data: data) {
                                        Image(uiImage: image).resizable().scaledToFit().frame(maxWidth: 280, maxHeight: 280).accessibilityLabel("Photo message")
                                    } else if message.voice, let bytes = Data(base64Encoded: message.text) { VoiceBubble(data: bytes) }
                                    else { Text(message.text).font(.body).foregroundStyle(message.outgoing && message.delivered ? Color.white : LokaStyle.ink) }
                                    let mine = ChatContent.reactionEmoji(message.myReaction), theirs = ChatContent.reactionEmoji(message.peerReaction)
                                    if !mine.isEmpty || !theirs.isEmpty { Text([mine, theirs].filter { !$0.isEmpty }.joined(separator: "  ")).font(.title3).accessibilityLabel("Your reaction: \(mine.isEmpty ? "none" : mine). Their reaction: \(theirs.isEmpty ? "none" : theirs)") }
                                    HStack(spacing: 5) {
                                        Text(lokaMessageTime(message.timestamp))
                                        if message.outgoing {
                                            TimelineView(.periodic(from: .now, by: 10)) { context in
                                                let unconfirmed = !message.delivered && Int64(context.date.timeIntervalSince1970 * 1000) >= message.expiresAt
                                                HStack(spacing: 4) {
                                                    if !message.delivered && !unconfirmed && (chat.preparingMessageIDs.contains(message.id) || (chat.localConnectionReady && Int64(context.date.timeIntervalSince1970 * 1000) - message.timestamp < 15000)) { ProgressView().controlSize(.mini) }
                                                    if message.delivered || unconfirmed || (!chat.preparingMessageIDs.contains(message.id) && (!chat.localConnectionReady || Int64(context.date.timeIntervalSince1970 * 1000) - message.timestamp >= 15000)) { Text(message.delivered ? "✓✓" : unconfirmed ? "!" : "◷") }
                                                }.accessibilityLabel(message.readAt != nil ? "Read" : message.delivered ? "Delivered" : unconfirmed ? "Delivery not confirmed" : "Awaiting delivery confirmation")
                                                .foregroundStyle(unconfirmed ? Color(.systemOrange) : message.readAt != nil ? Color.mint : message.delivered && !message.voice ? Color.white.opacity(0.8) : LokaStyle.muted)
                                            }
                                        }
                                    }.font(.caption).foregroundStyle(message.outgoing && message.delivered && !message.voice ? Color.white.opacity(0.8) : LokaStyle.muted)
                                        .frame(alignment: .trailing)
                                    if message.outgoing && !message.delivered {
                                        Text(Int64(Date().timeIntervalSince1970 * 1000) >= message.expiresAt ? "Delivery not confirmed" : chat.preparingMessageIDs.contains(message.id) ? "Preparing…" : chat.localConnectionReady ? "Waiting for delivery" : "Waiting for a connection")
                                            .font(.caption2).foregroundStyle(.secondary)
                                    }
                                }.fixedSize(horizontal: false, vertical: true).padding(14).background(message.outgoing ? (message.delivered ? (message.voice ? LokaStyle.mint : Color(red: 0.47, green: 0.15, blue: 0.91)) : LokaStyle.pendingBubble) : LokaStyle.surface)
                                    .clipShape(RoundedRectangle(cornerRadius: 18))
                                    .onTapGesture(count: 2) { infoID = message.id }
                                    .onLongPressGesture { reactionID = message.id }
                                    .popover(isPresented: Binding(get: { reactionID == message.id }, set: { if !$0 { reactionID = nil } }), arrowEdge: .bottom) {
                                        VStack(spacing: 4) {
                                            HStack(spacing: 0) {
                                                ForEach(ChatContent.reactions.filter { !$0.isEmpty }, id: \.self) { emoji in
                                                    Button { chat.react(to: message, emoji: emoji); reactionID = nil } label: { Text(emoji).font(.title2).frame(width: 44, height: 44) }.disabled(!chat.ready)
                                                }
                                            }
                                            if !ChatContent.reactionEmoji(message.myReaction).isEmpty { Button("Remove reaction") { chat.react(to: message, emoji: ""); reactionID = nil }.padding(6) }
                                            if !message.voice && message.image != true { Button("Copy text") { UIPasteboard.general.string = message.text; reactionID = nil }.padding(6) }
                                        }.padding(8).presentationCompactAdaptation(.popover)
                                    }
                                    .onGeometryChange(for: Bool.self) { proxy in
                                        let rect = proxy.frame(in: .named("conversationViewport"))
                                        return viewportHeight > 0 && rect.maxY > 0 && rect.minY < viewportHeight && min(rect.maxY, viewportHeight) - max(rect.minY, 0) >= min(rect.height, 60)
                                    } action: { visible in
                                        if visible { visibleIDs.insert(message.id); if conversationVisible && scenePhase == .active && infoID == nil && reactionID == nil { chat.markRead(message.id) } }
                                        else { visibleIDs.remove(message.id) }
                                    }
                                    .accessibilityAction(named: "Message info") { infoID = message.id }

                                if !message.outgoing { Spacer(minLength: 36) }
                            }.id(message.id)
                        }
                    }.padding(20)
                }
                .background(LokaDoodles())
                .coordinateSpace(name: "conversationViewport")
                .onGeometryChange(for: CGFloat.self) { $0.size.height } action: { viewportHeight = $0 }
                .scrollDismissesKeyboard(.interactively)
                .onChange(of: messages.last?.id) { _, _ in if let id = messages.last?.id { withAnimation { proxy.scrollTo(id, anchor: .bottom) } } }
                .onAppear { if let id = messages.last?.id { proxy.scrollTo(id, anchor: .bottom) } }
            }

            if !chat.localConnectionReady {
                NavigationLink { ConnectionsView(link: link) } label: { Label(link.connected ? "Checking the local connection…" : "Finding a local connection…", systemImage: "antenna.radiowaves.left.and.right").font(.subheadline) }.padding(10)
            }
            TimelineView(.periodic(from: .now, by: 1)) { context in
                if (chat.typingUntil[contact.id] ?? 0) > Int64(context.date.timeIntervalSince1970 * 1000) {
                    Text("Typing…").font(.caption).foregroundStyle(chatGreen).frame(maxWidth: .infinity, alignment: .leading).padding(.horizontal, 20).accessibilityLabel("\(name) is typing")
                }
            }
            if preparingImage { ProgressView("Preparing photo…") }
            if let photoError { Text(photoError).font(.caption).foregroundStyle(.red) }
            if let bytes = imageDraft, let image = UIImage(data: bytes) {
                VStack {
                    Image(uiImage: image).resizable().scaledToFit().frame(height: 150).accessibilityLabel("Photo ready to send")
                    HStack {
                        Button("Remove") { imageDraft = nil }.disabled(sending)
                        Spacer()
                        Button("Send photo") { Task { if await chat.send(to: contact, text: "", image: bytes) { imageDraft = nil; photo = nil } } }.disabled(sending)
                    }
                }.padding(12).background(LokaStyle.surface)
            }
            if voice.recording || voice.data != nil {
                HStack(spacing: 12) {
                    Button("Cancel") { voice.discard() }.disabled(sending)
                    if voice.recording {
                        VStack(alignment: .leading) {
                            Text(String(format: "● %d:%02d / 1:00", voice.seconds / 60, voice.seconds % 60)).font(.subheadline.monospacedDigit()).foregroundStyle(chatGreen)
                            HStack(spacing: 3) { ForEach(Array(voice.levels.enumerated()), id: \.offset) { _, level in Capsule().fill(chatGreen).frame(width: 3, height: 4 + level * 24) } }.frame(height: 28)
                        }
                        Spacer(); Button("Stop") { voice.stop() }
                    } else if let data = voice.data {
                        Button(voice.playing ? "Stop preview" : "▶ Preview") { voice.play(data) }
                        Spacer()
                        Button {
                            Task { if await chat.send(to: contact, text: "", voice: data) { voice.discard() } }
                        } label: { Text("Send").bold() }.disabled(sending)
                    }
                }.padding(16).background(LokaStyle.surface)
            } else if imageDraft == nil {
                HStack(alignment: .bottom, spacing: 10) {
                    PhotosPicker(selection: $photo, matching: .images) { Image(systemName: "plus").font(.system(size: 22, weight: .regular)).frame(width: 44, height: 44) }.accessibilityLabel("Attach photo").disabled(sending || preparingImage)
                    TextField("Message \(name)…", text: $draft, axis: .vertical).lineLimit(1...5).focused($composing).disabled(sending)
                        .padding(.horizontal, 16).padding(.vertical, 12).frame(minHeight: 48)
                        .background(composing ? LokaStyle.surface : LokaStyle.background)
                        .clipShape(RoundedRectangle(cornerRadius: 26))
                        .overlay(RoundedRectangle(cornerRadius: 26).stroke(composing ? chatGreen : Color(.systemGray4), lineWidth: composing ? 1.5 : 0.5))
                    if draft.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
                        Button {
                            composing = false
                            Task {
                                guard UIImagePickerController.isSourceTypeAvailable(.camera) else { photoError = "Camera unavailable. Choose a photo with + instead."; return }
                                let status = AVCaptureDevice.authorizationStatus(for: .video)
                                let granted: Bool
                                if status == .notDetermined { granted = await AVCaptureDevice.requestAccess(for: .video) } else { granted = status == .authorized }
                                if granted { cameraOpen = true } else { photoError = "Allow camera access in Settings to take a photo." }
                            }
                        } label: { Image(systemName: "camera").font(.system(size: 22, weight: .regular)).frame(width: 44, height: 44) }.accessibilityLabel("Take photo").disabled(sending || preparingImage)
                        Button { composing = false; Task { await voice.start() } } label: {
                            Image(systemName: "mic").font(.system(size: 22, weight: .regular)).foregroundStyle(chatGreen).frame(width: 44, height: 44)
                        }.accessibilityLabel("Record voice note").disabled(!chat.ready || sending)
                    } else {
                        Button {
                            let submitted = draft
                            Task { if await chat.send(to: contact, text: submitted), draft == submitted { draft = "" } }
                        } label: {
                            Image(systemName: "paperplane.fill")
                                .foregroundStyle(LokaStyle.onGreen).frame(width: 46, height: 46).background(chatGreen).clipShape(Circle())
                        }.accessibilityLabel(sending ? "Preparing message" : "Send message")
                            .disabled(!chat.ready || sending || !contacts.contacts.contains { $0.id == contact.id } || draft.utf8.count > 1400)
                    }
                }.padding(12).background(LokaStyle.surface)
            }
            if draft.utf8.count > 1400 { Text("This message is too long. Try a shorter one.").font(.caption).foregroundStyle(.red) }
            if let error = voice.error { Text(error).font(.caption).foregroundStyle(.red) }
        }
        .background(LokaStyle.background)
        .fullScreenCover(isPresented: $cameraOpen) {
            ChatCamera { image in
                cameraOpen = false
                guard let image else { return }
                preparingImage = true; photoError = nil
                Task {
                    defer { preparingImage = false }
                    do {
                        let ratio = min(1, 1024 / max(image.size.width, image.size.height))
                        let size = CGSize(width: max(1, image.size.width * ratio), height: max(1, image.size.height * ratio))
                        let format = UIGraphicsImageRendererFormat(); format.scale = 1
                        let resized = UIGraphicsImageRenderer(size: size, format: format).image { _ in image.draw(in: CGRect(origin: .zero, size: size)) }
                        guard let data = resized.jpegData(compressionQuality: 0.75) else { throw LokaProtocolError.invalid }
                        imageDraft = try await Task.detached { try preparePhoto(data) }.value
                    } catch { photoError = "Could not prepare that photo. Try again." }
                }
            }.ignoresSafeArea()
        }
        .alert("Name on this phone", isPresented: $editingName) {
            TextField("Name", text: $editedName)
            Button("Save") { do { try contacts.add(contact.publicKey, name: editedName) } catch { contacts.error = error.localizedDescription } }
            Button("Cancel", role: .cancel) {}
        }
        .alert("Message security", isPresented: $securityInfo) {
            Button("Got it", role: .cancel) {}
        } message: { Text("Your messages, photos and voice notes are encrypted between you and your friend. Phones helping deliver them cannot read them. Verify your friend’s code for extra confidence. LOKA is still a security preview.") }
        .onChange(of: photo) { _, item in
            guard let item, !preparingImage else { return }
            preparingImage = true; photoError = nil
            Task {
                defer { preparingImage = false }
                do {
                    guard let source = try await item.loadTransferable(type: Data.self), source.count <= 16 * 1024 * 1024 else { throw LokaProtocolError.invalid }
                    imageDraft = try await Task.detached(priority: .userInitiated) { try preparePhoto(source) }.value
                } catch { photoError = "Could not prepare that photo. Try another image under 16 MB." }
            }
        }
        .navigationTitle("").navigationBarTitleDisplayMode(.inline)
        .toolbar {
            ToolbarItem(placement: .principal) {
                Button { editedName = name; editingName = true } label: {
                    HStack(spacing: 10) { LokaAvatar(name: name, size: 34, peerID: contact.id); Text(name).font(.headline).foregroundStyle(.primary).lineLimit(1) }
                }.accessibilityLabel("Edit contact name")
            }
            ToolbarItem(placement: .topBarTrailing) { Button { securityInfo = true } label: { Image(systemName: "lock.shield.fill").frame(width: 40, height: 40).background(chatGreen.opacity(0.1)).clipShape(Circle()) }.accessibilityLabel("About message security") }
        }
        .sheet(isPresented: Binding(get: { infoID != nil }, set: { if !$0 { infoID = nil } })) {
            NavigationStack {
                if let message = chat.messages.first(where: { $0.id == infoID }) {
                    List {
                        Section {
                            LabeledContent("Sent", value: lokaMessageTime(message.timestamp))
                            if message.outgoing {
                                LabeledContent("Delivered", value: message.deliveredAt.map(lokaMessageTime) ?? (message.delivered ? "Confirmed" : "Not yet confirmed"))
                                LabeledContent("Read", value: message.readAt.map(lokaMessageTime) ?? "Not yet confirmed")
                            } else { Text("Received on this phone") }
                            if let hops = message.reportedHops { LabeledContent("Reported hops", value: "\(hops) (estimate)") }
                            MessageRouteFlow(message: message, friendName: contact.name,
                                relayName: contacts.contacts.first(where: { $0.id == message.route?.carrier })?.name
                                    ?? chat.nearbyPeople.first(where: { $0.id == message.route?.carrier })?.name ?? "Nearby phone")
                        }
                        if message.reactionPacket != nil { Text(Int64(Date().timeIntervalSince1970 * 1000) - ((try? ChatContent.reactionVersion(message.myReaction).0) ?? 0) >= 300000 ? "Reaction delivery not confirmed." : "Your reaction is waiting for confirmation.") }
                    }.navigationTitle("Message info").navigationBarTitleDisplayMode(.inline)
                        .toolbar { ToolbarItem(placement: .confirmationAction) { Button("Done") { infoID = nil } } }
                }
            }
        }
        .toolbar(.hidden, for: .tabBar)
        .onChange(of: draft) { _, value in
            chat.typing(contact.id, active: scenePhase == .active && composing && !value.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
        }
        .onChange(of: composing) { _, value in if !value { chat.typing(contact.id, active: false) } }
        .task(id: draft) {
            do { try await Task.sleep(for: .seconds(4)); chat.typing(contact.id, active: false) } catch {}
        }
        .onAppear { conversationVisible = true; LocalNotifications.shared.visibleFriend = contact.id; LocalNotifications.shared.clear(contact.id); markVisibleRead() }
        .onChange(of: infoID) { _, _ in markVisibleRead() }
        .onChange(of: reactionID) { _, _ in markVisibleRead() }
        .onChange(of: cameraOpen) { _, _ in markVisibleRead() }
        .onDisappear { chat.typing(contact.id, active: false); conversationVisible = false; visibleIDs.removeAll(); LocalNotifications.shared.visibleFriend = nil; voice.discard() }
        .onChange(of: scenePhase) { _, phase in
            LocalNotifications.shared.visibleFriend = phase == .active ? contact.id : nil
            if phase == .active && conversationVisible && infoID == nil && reactionID == nil && !cameraOpen { visibleIDs.forEach { chat.markRead($0) } }
            if phase != .active { chat.typing(contact.id, active: false) }
            if phase != .active && voice.recording { voice.stop() }
        }
    }
}

private extension String { var nonEmpty: String? { isEmpty ? nil : self } }

private func preparePhoto(_ data: Data) throws -> Data {
    guard data.count <= 16 * 1024 * 1024, let source = CGImageSourceCreateWithData(data as CFData, nil) else { throw LokaProtocolError.invalid }
    for size in [1024, 512, 256, 128] {
        let options: [CFString: Any] = [kCGImageSourceCreateThumbnailFromImageAlways: true, kCGImageSourceCreateThumbnailWithTransform: true, kCGImageSourceThumbnailMaxPixelSize: size, kCGImageSourceShouldCacheImmediately: true]
        guard let thumbnail = CGImageSourceCreateThumbnailAtIndex(source, 0, options as CFDictionary) else { throw LokaProtocolError.invalid }
        let image = UIImage(cgImage: thumbnail)
        for quality in [0.75, 0.60, 0.45, 0.30] {
            if let bytes = image.jpegData(compressionQuality: quality), ChatContent.validImage(bytes) { return bytes }
        }
    }
    throw LokaProtocolError.invalid
}

private struct ChatCamera: UIViewControllerRepresentable {
    let finished: (UIImage?) -> Void
    func makeCoordinator() -> Coordinator { Coordinator(finished: finished) }
    func makeUIViewController(context: Context) -> UIImagePickerController {
        let camera = UIImagePickerController(); camera.sourceType = .camera; camera.cameraCaptureMode = .photo; camera.delegate = context.coordinator; return camera
    }
    func updateUIViewController(_ controller: UIImagePickerController, context: Context) {}
    final class Coordinator: NSObject, UIImagePickerControllerDelegate, UINavigationControllerDelegate {
        let finished: (UIImage?) -> Void
        init(finished: @escaping (UIImage?) -> Void) { self.finished = finished }
        func imagePickerControllerDidCancel(_ picker: UIImagePickerController) { finished(nil) }
        func imagePickerController(_ picker: UIImagePickerController, didFinishPickingMediaWithInfo info: [UIImagePickerController.InfoKey: Any]) { finished(info[.originalImage] as? UIImage) }
    }
}

private struct MessageRouteFlow: View {
    let message: LokaMessage
    let friendName: String
    let relayName: String
    private var relayCount: Int { message.reportedHops.map { max(0, min(6, $0 - 1)) } ?? ((message.route?.carrier.isEmpty == false) ? 1 : 0) }
    private var completed: Bool { !message.outgoing || message.delivered }
    private var expiry: Int64 { message.route?.expiresAt ?? message.expiresAt }
    private func connection(_ index: Int) -> String {
        if (message.outgoing && index == 0) || (!message.outgoing && index == relayCount) {
            return (message.route?.label ?? "Transport not recorded") + (message.outgoing ? " · local attempt" : " · received here")
        }
        return "Connection not reported"
    }
    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            Text("Delivery route").font(.headline)
            step(message.outgoing ? "Your phone" : friendName, detail: "Encrypted before sending", icon: "lock.fill")
            ForEach(0..<relayCount, id: \.self) { index in
                Label(connection(index), systemImage: "arrow.down").font(.caption).foregroundStyle(.secondary)
                step(relayCount == 1 ? relayName : "Nearby phone \(index + 1)",
                     detail: (message.reportedHops == nil ? "Relay selected" : "Relay reported") + " · encrypted\nCopy expires \(lokaMessageTime(expiry))", icon: "lock.shield.fill")
            }
            Label(connection(relayCount), systemImage: "arrow.down").font(.caption).foregroundStyle(.secondary)
            step(message.outgoing ? friendName : "Your phone",
                 detail: completed ? "Received and decrypted" : "Waiting for delivery · encrypted",
                 icon: completed ? "checkmark.shield.fill" : "clock")
            if !completed { Text("Delivery window ends \(lokaMessageTime(expiry))").font(.caption).foregroundStyle(.secondary) }
            Text("Relay phones cannot read this message. Only recorded route details are shown.").font(.caption).foregroundStyle(.secondary)
        }.padding(.vertical, 8)
    }
    private func step(_ title: String, detail: String, icon: String) -> some View {
        HStack(alignment: .top, spacing: 12) {
            Image(systemName: icon).foregroundStyle(chatGreen).frame(width: 32, height: 32).background(chatGreen.opacity(0.1)).clipShape(Circle())
            VStack(alignment: .leading, spacing: 4) { Text(title).font(.subheadline.weight(.semibold)); Text(detail).font(.caption).foregroundStyle(.secondary) }
        }.frame(maxWidth: .infinity, alignment: .leading).padding(12).background(chatGreen.opacity(0.05)).clipShape(RoundedRectangle(cornerRadius: 14))
    }
}
