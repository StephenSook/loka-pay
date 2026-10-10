import Foundation

@main struct BleFramingChecks {
    static func main() throws {
        let radioID = UUID().uuidString
        precondition(NearbyRadioKey.applePeripheral("ble:" + radioID) == radioID)
        precondition(NearbyRadioKey.applePeripheral("ble:extra:" + radioID) == radioID)
        precondition(NearbyRadioKey.applePeripheral("ble:in:" + radioID) == nil)
        precondition(NearbyRadioKey.applePeripheral("wifi:" + radioID) == nil)
        var budget = BleAdmissionBudget()
        for _ in 0..<8 { precondition(budget.take(now: 100)) }
        precondition(!budget.take(now: 100))
        precondition(!budget.take(now: 100.1))
        precondition(budget.take(now: 100.25))
        precondition(!budget.take(now: .nan))
        var inboundRoutes = LocalRouteState()
        precondition(inboundRoutes.updatePeripheral(ready: true))
        precondition(!inboundRoutes.update(wifi: false, ready: false) && inboundRoutes.available)
        precondition(!inboundRoutes.updateAware(ready: true))
        precondition(!inboundRoutes.updatePeripheral(ready: false) && inboundRoutes.available)
        precondition(inboundRoutes.updateAware(ready: false) && !inboundRoutes.available)
        print("Apple peripheral admission and independent route checks passed")
        var extraRoutes = LocalRouteState()
        precondition(extraRoutes.updateAdditional(ready: true))
        precondition(!extraRoutes.update(wifi: false, ready: false) && extraRoutes.available)
        precondition(!extraRoutes.updatePeripheral(ready: true))
        precondition(!extraRoutes.updateAdditional(ready: false) && extraRoutes.available)
        precondition(extraRoutes.updatePeripheral(ready: false) && !extraRoutes.available)
        print("Concurrent Bluetooth route isolation passed")
        var awareRoutes = LocalRouteState()
        precondition(awareRoutes.updateAware(ready: true) && awareRoutes.available)
        precondition(!awareRoutes.update(wifi: false, ready: false) && awareRoutes.available)
        precondition(!awareRoutes.update(wifi: true, ready: true))
        precondition(!awareRoutes.updateAware(ready: false) && awareRoutes.available)
        precondition(awareRoutes.update(wifi: true, ready: false) && !awareRoutes.available)
        print("Aware route fallback checks passed: independent of BLE and shared LAN state")
        var routes = LocalRouteState()
        precondition(!routes.available)
        precondition(routes.update(wifi: true, ready: true) && routes.available)
        precondition(!routes.update(wifi: false, ready: false) && routes.available)
        precondition(!routes.update(wifi: false, ready: true) && routes.available)
        precondition(!routes.update(wifi: true, ready: false) && routes.available)
        precondition(!routes.update(wifi: true, ready: true) && routes.available)
        precondition(!routes.update(wifi: false, ready: false) && routes.available)
        precondition(routes.update(wifi: true, ready: false) && !routes.available)
        print("Combined route checks passed: Wi-Fi-only, Bluetooth-only, failure and recovery")

        for address in [[10,0,0,1], [172,16,0,1], [172,31,0,1], [192,168,1,1]] {
            precondition(LocalWifiFraming.isPrivateIPv4(Data(address.map(UInt8.init))))
        }
        for address in [[8,8,8,8], [127,0,0,1], [172,15,0,1], [172,32,0,1], [192,0,2,1]] {
            precondition(!LocalWifiFraming.isPrivateIPv4(Data(address.map(UInt8.init))))
        }
        for size in [1, 255, 256, 1400, 16384] {
            let header = try LocalWifiFraming.header(size)
            let decoded = try LocalWifiFraming.length(header)
            precondition(decoded == size)
        }
        for invalid in [Data([0,0,0,0]), Data([0,0,64,1]), Data([255,255,255,255]), Data([0,1])] {
            precondition((try? LocalWifiFraming.length(invalid)) == nil)
        }
        precondition((try? LocalWifiFraming.header(16385)) == nil)
        print("Local Wi-Fi framing checks passed: boundary vectors, zero, oversize and malformed lengths")

        var candidates = NearbyCandidatePolicy()
        let old = UUID(), changed = UUID()
        precondition(candidates.take(old, now: 0))
        precondition(!candidates.take(old, now: 29))
        precondition(candidates.take(changed, now: 29)) // fresh route does not depend on old radio handle
        precondition(candidates.take(old, now: 30))
        candidates.reset(); precondition(candidates.take(old, now: 30))
        candidates.reset()
        for _ in 0..<32 { precondition(candidates.take(UUID(), now: 0)) }
        precondition(!candidates.take(UUID(), now: 0))
        print("Swift automatic discovery checks passed: changed handle, cooldown and bounded attempts")
        var setup = LinkSetupDeadline()
        precondition(!setup.expired(now: 100))
        setup.begin(now: 100)
        precondition(!setup.expired(now: 119.9))
        precondition(setup.expired(now: 120))
        precondition(setup.expired(now: 500)) // resumed after suspension; no eternal restoring
        setup.cancel(); precondition(!setup.expired(now: 500))
        setup.begin(now: 600); precondition(!setup.expired(now: 619))
        precondition(setup.expired(now: 620))
        print("Swift setup deadline checks passed: timeout, suspension, cancellation and new attempt")
        var recovery = LinkRecovery()
        precondition(recovery.nextDelay(enabled: false, canDiscover: true) == nil)
        precondition(recovery.nextDelay(enabled: true, canDiscover: false) == nil)
        for delay: Double in [1, 2, 4, 8, 16, 30] { precondition(recovery.nextDelay(enabled: true, canDiscover: true) == delay) }
        precondition(recovery.nextDelay(enabled: true, canDiscover: true) == nil)
        recovery.reset(); precondition(recovery.nextDelay(enabled: true, canDiscover: true) == 1)
        print("Swift reconnect policy checks passed: discovery availability, explicit Off, bounded backoff and reset")
        var approval = LinkApprovalChecks()
        precondition(!approval.takeAttempt(now: 0))
        approval.begin(now: 10)
        precondition(approval.takeAttempt(now: 10))
        precondition(!approval.takeAttempt(now: 10.1))
        precondition(approval.takeAttempt(now: 13))
        approval.cancel() // successful check, disconnect or explicit Off
        precondition(!approval.takeAttempt(now: 20))
        approval.begin(now: 30)
        precondition(!approval.takeAttempt(now: 90)) // suspended beyond the deadline
        approval.begin(now: 100)
        for attempt in 0..<20 { precondition(approval.takeAttempt(now: 100 + Double(attempt) * 3)) }
        precondition(!approval.takeAttempt(now: 159))
        print("Swift link approval checks passed: bounded retries, pacing, cancellation and expiry")
        func chunks(_ frame: Data) -> [Data] {
            stride(from: 0, to: frame.count, by: 19).map { start in
                let end = min(start + 19, frame.count)
                return Data([UInt8((start == 0 ? 1 : 0) | (end == frame.count ? 2 : 0))]) + frame[start..<end]
            }
        }
        let media = Data(repeating: 42, count: 1400), receipt = Data(repeating: 7, count: 1400)
        var fifo: [Data] = []
        for i in 0..<20 { var distinct = media; distinct[0] = UInt8(42 + i); try BleSendQueue.enqueue(distinct, queue: &fifo, urgent: false, inFlight: false) }
        var duplicates: [Data] = []
        for _ in 0..<100 { try BleSendQueue.enqueue(media, queue: &duplicates, urgent: false, inFlight: false) }
        precondition(duplicates.count == chunks(media).count)
        try BleSendQueue.enqueue(receipt, queue: &duplicates, urgent: true, inFlight: true)
        var duplicateDecoder = BleFrameAssembler(); var distinctFrames: [Data] = []
        for chunk in duplicates { if let f = try duplicateDecoder.accept(chunk, now: 0) { distinctFrames.append(f) } }
        precondition(distinctFrames == [media, receipt])
        var fast = fifo
        try BleSendQueue.enqueue(receipt, queue: &fifo, urgent: false, inFlight: true)
        try BleSendQueue.enqueue(receipt, queue: &fast, urgent: true, inFlight: true)
        func position(_ queue: [Data]) throws -> Int {
            var decoder = BleFrameAssembler()
            for (i, chunk) in queue.enumerated() { if try decoder.accept(chunk, now: 0) == receipt { return i + 1 } }
            fatalError("Receipt missing")
        }
        let fifoPosition = try position(fifo), fastPosition = try position(fast)
        precondition(fifoPosition == 1554 && fastPosition == 148)
        var partial = chunks(media); var partialDecoder = BleFrameAssembler()
        for _ in 0..<10 { _ = try partialDecoder.accept(partial.removeFirst(), now: 0) }
        try BleSendQueue.enqueue(receipt, queue: &partial, urgent: true, inFlight: false)
        var complete: [Data] = []
        for chunk in partial { if let value = try partialDecoder.accept(chunk, now: 0) { complete.append(value) } }
        precondition(complete == [media, receipt])
        print("Receipt queue experiment: FIFO 1554 chunks; priority 148 chunks; no frame corruption")
        var assembler = BleFrameAssembler()
        for size in [1,19,20,38,39,2048,16384] {
            let frame = Data((0..<size).map { UInt8(truncatingIfNeeded: $0 * 31) })
            var results: [Data] = []
            for chunk in chunks(frame) { if let result = try assembler.accept(chunk, now: 0) { results.append(result) } }
            precondition(results == [frame])
        }
        func rejected(_ bytes: Data, now: TimeInterval = 0) throws {
            do { _ = try assembler.accept(bytes, now: now); fatalError("Malformed frame accepted") }
            catch BleFrameError.invalid { }
        }
        try rejected(Data([2,1])); try rejected(Data([4,1])); try rejected(Data([1])); try rejected(Data(repeating: 0, count: 21))
        _ = try assembler.accept(Data([1,1]), now: 0); try rejected(Data([2,2]), now: 11)
        let full = chunks(Data(repeating: 0, count: 16384))
        for chunk in full.dropLast(2) { _ = try assembler.accept(chunk, now: 0) }
        _ = try assembler.accept(Data([0]) + Data(repeating: 0, count: 19), now: 0)
        try rejected(Data([2]) + Data(repeating: 0, count: 19))
        let recovered = try assembler.accept(Data([3,42]), now: 0)
        precondition(recovered == Data([42]))
        print("Swift BLE framing checks passed: maximum frame, boundaries, malformed flags, timeout, overflow and recovery")
    }
}
