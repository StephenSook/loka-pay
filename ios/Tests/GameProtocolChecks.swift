import Foundation

@main struct Checks {
    static let pack = String(repeating: "c", count: 64)
    static let a = String(repeating: "a", count: 64), b = String(repeating: "b", count: 64)
    static let answers = [0,1,3,2,1,2,3,0,2,0]
    static func main() throws {
        let args = CommandLine.arguments
        for kotlinHosts in [true,false] {
            let javaOwn = kotlinHosts ? a : b, swiftOwn = kotlinHosts ? b : a
            let proc = Process(); proc.executableURL = URL(fileURLWithPath: args[1]); proc.arguments = ["-cp",args[2],"GameInterop",javaOwn,pack]
            let input = Pipe(), output = Pipe(); proc.standardInput = input; proc.standardOutput = output; try proc.run()
            defer { try? input.fileHandleForWriting.close(); proc.terminate() }
            var queue: [(Bool,String)] = [], now: Int64 = 1000000, saved = ""
            let swift = try QuickQuiz(own: swiftOwn, pack: pack, answers: answers, clock: {now}, save: {saved = $0}, send: {_,text in queue.append((true,text)); return UUID().uuidString.lowercased()}, discard: {_ in })
            var javaRevision = -1
            @discardableResult func command(_ parts: [String], reject: Bool = false) throws -> [String] {
                try input.fileHandleForWriting.write(contentsOf: Data((parts.joined(separator: "\t") + "\n").utf8))
                var data = Data()
                while true { guard let byte = try output.fileHandleForReading.read(upToCount:1), !byte.isEmpty else { fatalError("JVM peer stopped") }; if byte[0] == 10 { break }; data.append(byte) }
                let fields = String(data:data,encoding:.utf8)!.components(separatedBy:"\t")
                if reject { precondition(fields[0] == "ERR"); return fields }
                precondition(fields[0] == "OK", parts[0] + " " + String(data:data,encoding:.utf8)!)
                javaRevision = Int(fields[1])!
                if fields.count > 4, !fields[4].isEmpty { for raw in fields[4].components(separatedBy:",") { queue.append((false,String(data:Data(base64Encoded:raw)!,encoding:.utf8)!)) } }
                return fields
            }
            func drain() throws {
                var budget = 100
                while !queue.isEmpty {
                    precondition(budget > 0); budget -= 1
                    let (fromSwift,text) = queue.removeFirst(), e = try GameEvent.decode(text)
                    let canonical = try e.encode(); precondition(canonical == text)
                    if fromSwift { try command(["recv",swiftOwn,Data(text.utf8).base64EncodedString()]) }
                    else { try swift.receive(javaOwn,text) }
                    // Duplicate applied commits must leave the revision unchanged.
                    if e.kind == "U" {
                        if fromSwift { let prior=javaRevision; try command(["recv",swiftOwn,Data(text.utf8).base64EncodedString()]); precondition(prior==javaRevision) }
                        else { let prior=swift.session!.revision; try swift.receive(javaOwn,text); precondition(prior==swift.session!.revision) }
                    }
                    try command(["tick"]); try swift.tick()
                }
            }
            if kotlinHosts { try command(["invite",swiftOwn]); try drain(); precondition(swift.session?.phase == "invited"); try swift.accept() }
            else { try swift.invite(javaOwn); try drain(); try command(["accept"]) }
            try drain()
            for i in 0..<10 {
                let swiftTurn = (i % 2 == 0) != kotlinHosts
                if swiftTurn { try swift.answer(answers[i]) } else { try command(["answer",String(answers[i])]) }
                if i == 1 {
                    // Host applies move; commit and applied ACK are lost; guest restarts.
                    if let at = queue.firstIndex(where: { (try? GameEvent.decode($0.1).kind) == "M" }) {
                        let (fromSwift,text) = queue.remove(at:at)
                        if fromSwift { try command(["recv",swiftOwn,Data(text.utf8).base64EncodedString()]) }
                        else { try swift.receive(javaOwn,text) }
                        queue.removeAll(); now += 16000; try command(["time",String(now)])
                        if kotlinHosts { try swift.restore(saved); try swift.resume() } else { try command(["restore"]); try command(["resume"]) }
                    }
                }
                try drain(); precondition(swift.session?.revision == i+1 && javaRevision == i+1)
            }
            precondition(swift.session!.scores(answers) == [5,5])
            let bad = GameEvent(kind:"M",id:UUID().uuidString.lowercased(),session:swift.session!.id,pack:pack,expires:now+120000,value:"0",ref:UUID().uuidString.lowercased())
            try command(["recv",String(repeating:"d",count:64),Data(try bad.encode().utf8).base64EncodedString()],reject:true)
            do { try swift.receive(String(repeating:"d",count:64),bad.encode()); fatalError("Unauthorized sender accepted") } catch QuizError.invalid { }
            print("PASS Kotlin/Swift \(kotlinHosts ? "Kotlin" : "Swift") host: invitation, acceptance, 10 answers, duplicate commits, lost commit, restart/snapshot recovery, scores, unauthorized rejection")
        }
    }
}
