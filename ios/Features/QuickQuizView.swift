import SwiftUI
import CryptoKit

struct QuizQuestion: Decodable {
    var id: String; var text: String; var options: [String]; var answer: Int
}
struct QuizPack: Decodable {
    var id: String; var version: Int; var rulesVersion: Int; var questions: [QuizQuestion]
    static func load() throws -> (QuizPack, String) {
        guard let url = Bundle.main.url(forResource: "quick-quiz-v1", withExtension: "json", subdirectory: "gameJson/quiz") else { throw QuizError.invalid }
        let raw = try Data(contentsOf: url); guard raw.count <= 16384 else { throw QuizError.invalid }
        let pack = try JSONDecoder().decode(Self.self, from: raw)
        guard pack.id == "quick_quiz", pack.version == 1, pack.rulesVersion == 1, pack.questions.count == 10 else { throw QuizError.invalid }
        for (i,q) in pack.questions.enumerated() {
            guard q.id == String(format: "qq_%03d", i + 1), (1...250).contains(q.text.count), q.options.count == 4,
                  Set(q.options).count == 4, q.options.allSatisfy({ (1...100).contains($0.count) }), (0...3).contains(q.answer) else { throw QuizError.invalid }
        }
        return (pack, SHA256.hash(data: raw).map { String(format: "%02x", $0) }.joined())
    }
}
struct QuickQuizView: View {
    @ObservedObject var chat: ChatStore
    @ObservedObject var contacts: ContactStore
    var body: some View {
        QuickQuizContent(session: chat.quizSession, questions: chat.quizQuestions,
            own: contacts.publicKey.map(ContactCode.fingerprint) ?? "", friends: contacts.contacts.map { QuizFriend(id: $0.id, name: $0.name) },
            status: chat.quizStatus, paused: chat.quizPaused, canAnswer: chat.quizCanAnswer,
            invite: chat.inviteQuiz, accept: chat.acceptQuiz, answer: chat.answerQuiz, resume: chat.resumeQuiz, end: chat.endQuiz)
    }
}
struct QuizFriend: Identifiable { var id: String; var name: String }
/// Presentation shared with simulator UI tests. The owner handles all delivery.
struct QuickQuizContent: View {
    var session: QuizSession?; var questions: [QuizQuestion]; var own: String; var friends: [QuizFriend]
    var status: String; var paused: Bool; var canAnswer: Bool
    var invite: (String) -> Void; var accept: () -> Void; var answer: (Int) -> Void; var resume: () -> Void; var end: () -> Void
    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 18) {
                Text("Let’s play").font(.custom("LilitaOne", size: 32, relativeTo: .largeTitle))
                Text("Good company. Great stories.").foregroundStyle(LokaStyle.muted)
                VStack(alignment: .leading, spacing: 12) {
                    Image("game_quiz").resizable().scaledToFit().frame(height: 120).frame(maxWidth: .infinity)
                    Text("Quick Quiz").font(.custom("LilitaOne", size: 28, relativeTo: .title))
                    Text("2 players · Untimed · 10 questions")
                    Text("No Internet needed when LOKA has a usable local connection.").foregroundStyle(LokaStyle.muted)
                }.padding(24).frame(maxWidth: .infinity, alignment: .leading).background(LokaStyle.mint, in: RoundedRectangle(cornerRadius: 26))
                Text(session?.phase == "active" && paused ? "Reconnecting…" : status).font(.headline).foregroundStyle(LokaStyle.green)
                if let session = session, session.phase != "ended" {
                    let friend = session.host == own ? session.guest : session.host
                    let name = friends.first(where: { $0.id == friend })?.name ?? "Your friend"
                    Text("Playing with \(name)")
                    if session.phase == "invited" { Button("Accept invitation") { accept() }.buttonStyle(.borderedProminent) }
                    if session.phase == "active" {
                        let scores = session.scores(questions.map(\.answer)), mine = session.host == own ? 0 : 1
                        Text("You \(scores[mine])  •  \(name) \(scores[1-mine])").font(.title3.bold())
                        if session.revision < questions.count {
                            let q = questions[session.revision]
                            VStack(alignment: .leading, spacing: 14) {
                                Text("Question \(session.revision + 1) of \(questions.count)").font(.caption).foregroundStyle(LokaStyle.muted)
                                Text(q.text).font(.custom("LilitaOne", size: 25, relativeTo: .title2))
                                ForEach(Array(q.options.enumerated()), id: \.offset) { i, option in
                                    Button { answer(i) } label: { Text(option).frame(maxWidth: .infinity).padding(8) }.buttonStyle(.bordered).disabled(!canAnswer).accessibilityIdentifier("quiz-answer-\(i)")
                                }
                            }.padding(24).frame(maxWidth: .infinity, alignment: .leading).background(LokaStyle.mint, in: RoundedRectangle(cornerRadius: 24))
                        } else { Text("Quiz complete!").font(.title.bold()) }
                    }
                    if ["active", "joining"].contains(session.phase) { Button("Resume / sync") { resume() }.buttonStyle(.bordered) }
                    Button(session.host == own ? "End game" : "Leave game") { end() }
                } else {
                    Text("Invite a verified friend").font(.title3.bold())
                    if friends.isEmpty { Text("Add and verify a friend in Nearby before inviting them.").foregroundStyle(LokaStyle.muted) }
                    ForEach(friends) { friend in
                        Button { invite(friend.id) } label: { Text("Invite \(friend.name.isEmpty ? "LOKA friend" : friend.name)").frame(maxWidth: .infinity).padding(8) }.buttonStyle(.bordered).disabled(questions.isEmpty)
                    }
                    Text("Party cards").font(.title3.bold())
                    Text("The party catalog is prepared. Multiplayer party cards are coming later.").foregroundStyle(LokaStyle.muted)
                }
            }.padding(24).frame(maxWidth: 720).frame(maxWidth: .infinity)
        }.background(LokaStyle.background).foregroundStyle(LokaStyle.ink).tint(LokaStyle.green).toolbar(.hidden, for: .navigationBar)
    }
}
