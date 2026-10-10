import Foundation

@main struct EncounterHistoryChecks {
    static func main() throws {
        let a = String(repeating: "a", count: 64), b = String(repeating: "b", count: 64)
        let trace = EncounterTrace()
        trace.observe([a, "invalid"], now: 100); trace.observe([a], now: 6100)
        precondition(trace.snapshot().samples.first!.peers == [1])
        precondition(trace.snapshot().samples.last!.time == 6000)
        let traceData = try JSONEncoder().encode(trace.snapshot())
        precondition(!String(data: traceData, encoding: .utf8)!.contains(a))
        for i in 0..<600 { trace.observe([], now: Int64(6200 + i)) }
        precondition(trace.snapshot().samples.count == 512 && trace.snapshot().dropped == 90)
        let scope = trace.snapshot().scope
        trace.observe([], now: 1)
        precondition(trace.snapshot().scope != scope && trace.snapshot().samples.count == 1 && trace.snapshot().samples[0].time == 0)
        trace.clear(); precondition(trace.snapshot().samples.isEmpty)
        let h = EncounterHistory()
        h.observe([a, "radio-handle"], now: 0)
        h.observe([a], now: 4000); precondition(h.snapshot(now: 4000).isEmpty)
        h.observe([a], now: 6000)
        precondition(h.snapshot(now: 6000).first!.encounters == 1)
        precondition(abs(h.snapshot(now: 6000).first!.estimate - 0.75) < 0.000001)
        h.observe([a], now: 8000)
        h.observe([], now: 9000); h.observe([a], now: 10000); h.observe([a], now: 16000)
        precondition(h.snapshot(now: 16000).first!.encounters == 1)
        h.observe([], now: 66000); h.observe([a], now: 67000); h.observe([a], now: 73000)
        precondition(h.snapshot(now: 73000).first!.encounters == 2)
        let restarted = EncounterHistory(); try restarted.restore(h.saved(now: 133000), now: 133000)
        precondition(restarted.snapshot(now: 133000) == h.snapshot(now: 133000))
        restarted.observe([a], now: 133000); precondition(restarted.snapshot(now: 133000).first!.encounters == 2)
        restarted.observe([a], now: 139000); precondition(restarted.snapshot(now: 139000).first!.encounters == 3)
        let previous = restarted.saved(now: 139000)
        do { try restarted.restore(previous + previous, now: 139000); fatalError("Duplicate records accepted") } catch {}
        precondition(restarted.saved(now: 139000) == previous)
        let invalid = EncounterHistory.Record(identity: a, encounters: 1, lastEncounter: 1, estimate: .nan)
        do { try restarted.restore([invalid], now: 139000); fatalError("Invalid estimate accepted") } catch {}
        precondition(restarted.saved(now: 139000) == previous)
        try restarted.restore(previous, now: 1); precondition(restarted.saved(now: 1).isEmpty)
        let bounded = EncounterHistory(capacity: 1)
        bounded.observe([a], now: 0); bounded.observe([a], now: 31000)
        precondition(bounded.snapshot(now: 31000).isEmpty)
        bounded.observe([a], now: 37000)
        precondition(abs(bounded.snapshot(now: 97000).first!.estimate - 0.75 * 0.98) < 0.000001)
        bounded.observe([b], now: 38000); bounded.observe([b], now: 44000)
        precondition(bounded.snapshot(now: 44000).first!.identity == b)
        precondition(bounded.snapshot(now: 86444000).isEmpty)
        bounded.observe([a], now: 1); precondition(bounded.snapshot(now: 1).isEmpty)
        bounded.clear(); precondition(bounded.snapshot(now: 1).isEmpty)
        precondition(EncounterHistory().snapshot(now: 1).isEmpty)
        print("Swift shadow encounters passed: qualification, churn, suspension, decay, capacity, expiry and reset")
    }
}
