import SwiftUI
import AVFoundation
import UIKit

@MainActor final class VoiceNote: NSObject, ObservableObject, AVAudioRecorderDelegate, AVAudioPlayerDelegate {
    @Published var recording = false
    @Published var playing = false
    @Published var seconds = 0
    @Published var levels: [CGFloat] = []
    @Published var data: Data?
    @Published var error: String?
    private var recorder: AVAudioRecorder?
    private var player: AVAudioPlayer?
    private var timer: Timer?
    private var request = UUID()
    private let url = FileManager.default.temporaryDirectory.appendingPathComponent("loka-voice-\(UUID().uuidString).m4a")
    func start() async {
        guard !recording else { return }
        let token = UUID(); request = token
        let permitted = await withCheckedContinuation { continuation in AVAudioSession.sharedInstance().requestRecordPermission { continuation.resume(returning: $0) } }
        guard request == token, !Task.isCancelled, UIApplication.shared.applicationState == .active else { return }
        guard permitted else { error = "Allow microphone access in Settings to record a voice note."; return }
        do {
            discard(); error = nil
            let session = AVAudioSession.sharedInstance(); try session.setCategory(.playAndRecord, mode: .default, options: [.defaultToSpeaker]); try session.setActive(true)
            FileManager.default.createFile(atPath: url.path, contents: nil, attributes: [.protectionKey: FileProtectionType.complete])
            recorder = try AVAudioRecorder(url: url, settings: [AVFormatIDKey: kAudioFormatMPEG4AAC, AVSampleRateKey: 16000, AVNumberOfChannelsKey: 1, AVEncoderBitRateKey: 12000])
            recorder?.isMeteringEnabled = true; recorder?.delegate = self; guard recorder?.record(forDuration: 60) == true else { throw LokaProtocolError.invalid }
            recording = true; seconds = 0
            timer = Timer.scheduledTimer(withTimeInterval: 0.1, repeats: true) { [weak self] _ in Task { @MainActor in
                guard let self, self.recording, let recorder = self.recorder else { return }
                recorder.updateMeters(); self.seconds = min(60, Int(recorder.currentTime))
                self.levels.append(max(0.04, CGFloat(pow(10, recorder.averagePower(forChannel: 0) / 20))))
                if self.levels.count > 24 { self.levels.removeFirst() }
            } }
        } catch { self.error = "Could not start recording."; discard() }
    }
    func stop() { recorder?.stop(); recording = false; timer?.invalidate(); timer = nil }
    nonisolated func audioRecorderDidFinishRecording(_ recorder: AVAudioRecorder, successfully flag: Bool) {
        Task { @MainActor in
            recording = false; timer?.invalidate(); timer = nil
            defer { try? FileManager.default.removeItem(at: url) }
            if flag, let bytes = try? Data(contentsOf: url), (1...98304).contains(bytes.count) { data = bytes }
            else { error = "Recording could not be saved. Try a shorter voice note." }
            try? AVAudioSession.sharedInstance().setActive(false, options: .notifyOthersOnDeactivation)
        }
    }
    func play(_ bytes: Data) {
        if playing { player?.stop(); playing = false; return }
        do {
            try AVAudioSession.sharedInstance().setCategory(.playback, mode: .spokenAudio)
            try AVAudioSession.sharedInstance().setActive(true)
            player = try AVAudioPlayer(data: bytes); player?.delegate = self
            guard player!.duration <= 63, player!.play() else { throw LokaProtocolError.invalid }; playing = true
        } catch { self.error = "This voice note could not be played." }
    }
    nonisolated func audioPlayerDidFinishPlaying(_ player: AVAudioPlayer, successfully flag: Bool) {
        Task { @MainActor in playing = false; try? AVAudioSession.sharedInstance().setActive(false, options: .notifyOthersOnDeactivation) }
    }
    func discard() {
        request = UUID()
        recorder?.delegate = nil; recorder?.stop(); recorder = nil; player?.stop(); player = nil
        timer?.invalidate(); timer = nil; data = nil; recording = false; playing = false; seconds = 0; levels = []
        try? FileManager.default.removeItem(at: url)
        try? AVAudioSession.sharedInstance().setActive(false, options: .notifyOthersOnDeactivation)
    }
}
struct VoiceBubble: View {
    let data: Data
    @StateObject private var voice = VoiceNote()
    var body: some View {
        VStack(alignment: .leading) {
            Button { voice.play(data) } label: { Label(voice.playing ? "Stop voice note" : "Play voice note", systemImage: voice.playing ? "stop.circle.fill" : "play.circle.fill").font(.body.weight(.semibold)) }
            if let error = voice.error { Text(error).font(.caption).foregroundStyle(.red) }
        }.onDisappear { voice.discard() }
    }
}
