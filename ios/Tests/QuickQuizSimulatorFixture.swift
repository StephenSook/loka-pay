#if DEBUG && targetEnvironment(simulator)
import SwiftUI

/// Explicit simulator-only UI fixture. Uses the production engines and presentation;
/// in-memory delivery is not evidence of Bluetooth, Wi-Fi, mesh, or encryption.
@MainActor final class QuizSimulatorPeer: ObservableObject {
    let own = String(repeating: "a", count: 64), friend = String(repeating: "b", count: 64)
    let pack: QuizPack; let hash: String
    var local: QuickQuiz!; var remote: QuickQuiz!
    var now: Int64 = 1_000_000; var saved = ""; var wire: [(String,String)] = []
    @Published var update = 0
    init(guest: Bool) {
        (pack, hash) = try! QuizPack.load()
        local = engine(own); remote = engine(friend)
        if guest { try! remote.invite(own); pump() }
    }
    func engine(_ id: String) -> QuickQuiz {
        try! QuickQuiz(own: id, pack: hash, answers: pack.questions.map(\.answer), clock: { self.now },
            save: { if id == self.own { self.saved = $0 } },
            send: { _, text in self.wire.append((id,text)); return UUID().uuidString.lowercased() }, discard: { _ in })
    }
    func pump() {
        var count = 0
        while !wire.isEmpty {
            count += 1; precondition(count < 100)
            let (sender, text) = wire.removeFirst(), receiver = sender == own ? remote! : local!
            try! receiver.receive(sender, text)
            if try! GameEvent.decode(text).kind == "U" { try! receiver.receive(sender, text) }
        }
        update += 1
    }
    func act(_ action: () throws -> Void) { try! action(); pump() }
    func remoteTurn() { act { if remote.session?.phase == "invited" { try remote.accept() } else { try remote.answer(pack.questions[remote.session!.revision].answer) } } }
    func restart() {
        now += 91_000
        let archive = saved
        local = engine(own); try! local.restore(archive)
        update += 1
    }
}
struct QuickQuizSimulatorFixture: View {
    @StateObject private var peer: QuizSimulatorPeer
    init(guest: Bool) { _peer = StateObject(wrappedValue: QuizSimulatorPeer(guest: guest)) }
    var body: some View {
        VStack(spacing: 0) {
            QuickQuizContent(session: peer.local.session, questions: peer.pack.questions, own: peer.own,
                friends: [QuizFriend(id: peer.friend, name: "Alex")], status: peer.local.notice, paused: peer.local.paused, canAnswer: peer.local.canAnswer,
                invite: { id in peer.act { try peer.local.invite(id) } }, accept: { peer.act { try peer.local.accept() } },
                answer: { i in peer.act { try peer.local.answer(i) } }, resume: { peer.act { try peer.local.resume() } }, end: { peer.act { try peer.local.end() } })
            HStack {
                Button("Test peer turn") { peer.remoteTurn() }.accessibilityIdentifier("test-peer-turn")
                Button("Test restart") { peer.restart() }.accessibilityIdentifier("test-restart")
            }.font(.caption).padding(10)
            Text("Simulator fixture · In-memory delivery").font(.caption2)
        }
    }
}
#endif

#if DEBUG && targetEnvironment(simulator)
/// Simulator-only card presentation fixture. Uses the bundled pack and real group
/// engines; in-memory events prove no physical radio or encrypted delivery.
@MainActor final class PartySimulatorPeer:ObservableObject {
    let ids=[String(repeating:"a",count:64),String(repeating:"b",count:64),String(repeating:"c",count:64)]
    let catalog:PartyCatalog
    var engines:[String:PartyCards]=[:],saved:[String:String]=[:],wire:[(String,String,String)]=[]
    var now:Int64=1_000_000
    @Published var update=0
    var local:PartyCards { engines[ids[0]]! }
    init(){catalog=try! PartyCatalog.load();for id in ids{engines[id]=engine(id)};try! local.invite(Array(ids.dropFirst()),PartySettings(game:"never_have_i_ever",mode:"group"));pump();for id in ids.dropFirst(){try! engines[id]!.accept();pump()}}
    func engine(_ id:String)->PartyCards {try! PartyCards(own:id,pack:catalog.hash,cards:catalog.games.flatMap(\.cards),clock:{self.now},save:{self.saved[id]=$0},send:{peer,text in self.wire.append((id,peer,text));return UUID().uuidString.lowercased()},discard:{_ in})}
    func pump(){var n=0;while !wire.isEmpty{n+=1;precondition(n<200);let (from,to,text)=wire.removeFirst();let receiver=engines[to]!;try! receiver.receive(from,text);if try! PartyEvent.decode(text).kind=="U"{try! receiver.receive(from,text)};for g in engines.values{try! g.tick()}};precondition(Set(engines.values.map{$0.current?.id ?? "-"}).count==1);update+=1}
    func act(_ f:()throws->Void){try! f();pump()}
    func others(){while local.session!.phase=="active",local.session!.turn != ids[0]{let actor=local.session!.turn;act{try engines[actor]!.act("done")}}}
    func restart(){now+=91000;let raw=saved[ids[0]]!;engines[ids[0]]=engine(ids[0]);try! local.restore(raw);update+=1}
}
struct PartySimulatorFixture:View {
    @StateObject private var peer=PartySimulatorPeer()
    var body:some View {
        VStack {
            ScrollView {
                VStack(alignment:.leading,spacing:18) {
                    Text("Never Have I Ever").font(.custom("LilitaOne",size:28))
                    PartySessionContent(s:peer.local.session!,card:peer.local.current,own:peer.ids[0],name:{$0==peer.ids[0] ? "You" : $0==peer.ids[1] ? "Alex" : "Bo"},status:peer.local.notice,paused:peer.local.paused,canAct:peer.local.canAct,accept:{peer.act{try peer.local.accept()}},move:{kind in peer.act{try peer.local.act(kind)}},resume:{peer.act{try peer.local.resume()}},end:{peer.act{try peer.local.end()}})
                }.padding(24).frame(maxWidth:720).frame(maxWidth:.infinity)
            }
            HStack { Button("Test other players"){peer.others()}.accessibilityIdentifier("party-test-peers");Button("Test restart"){peer.restart()}.accessibilityIdentifier("party-test-restart") }.font(.caption)
            Text("Simulator fixture · In-memory delivery").font(.caption2)
        }.background(LokaStyle.background).foregroundStyle(LokaStyle.ink).tint(LokaStyle.green)
    }
}
#endif
