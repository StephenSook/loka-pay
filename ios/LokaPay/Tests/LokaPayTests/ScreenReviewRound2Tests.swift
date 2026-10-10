import Foundation
import Observation
import Testing
@testable import LokaPay

private typealias F = ScreenFixtures

/// Review round 2 on the payment screens (3.71). Each suite names the finding it covers.
@Suite("a conflicting spend is shown only for its own allowance (review 2, findings 1 and 4)")
@MainActor
struct ConflictPairingTests {
    let payerA = SoftwareP256Signer()
    let payerB = SoftwareP256Signer()
    let merchant = SoftwareP256Signer()
    let allowanceA: Data
    let allowanceB: Data

    init() {
        allowanceA = F.allowanceWire(payer: payerA.keyHash, id: 77, offlineLimit: 3_000_000)
        allowanceB = F.allowanceWire(payer: payerB.keyHash, id: 88, offlineLimit: 2_000_000)
    }

    func makeModel() -> ReceiveModel {
        ReceiveModel(merchantWire: F.merchantWire(merchant: merchant.keyHash), signer: merchant,
                     ledger: OfflineLedger(url: F.tempURL("ledger.json")), settlementClient: nil,
                     deployment: F.deployment, serverPublicKey: F.serverKey, now: { F.now })
    }

    func text(_ kind: PaymentTransport.Kind, _ wire: Data) -> String { PaymentTransport.encode(kind, wire) }

    /// Payer A pays on serial 4, then signs a second note on serial 4: a proven conflict on 77.
    func conflictOnA(_ model: ReceiveModel) async throws -> AllowanceCertificate {
        await model.accept(text: text(.allowance, allowanceA))
        let first = try F.note(payer: payerA, payee: merchant.keyHash, amount: 1_000_000, serial: 4, allowanceId: 77)
        await model.accept(text: text(.note, first.wire))
        #expect(model.phase == .received)
        model.nextPayment()
        let second = try F.note(payer: payerA, payee: merchant.keyHash, amount: 500_000, serial: 4, allowanceId: 77)
        await model.accept(text: text(.note, second.wire))
        #expect(model.issue?.kind == .payment(.serialSeen))
        #expect(model.conflictAllowanceId == 77)
        #expect(model.conflictingSpend)
        let certA = try #require(model.lastAllowance)
        #expect(model.limitState == .conflictingSpend)
        // One chip, not a status chip and a limit chip saying the same thing.
        #expect(model.limitBadge(for: certA) == .conflictingSpend)
        return certA
    }

    @Test("conflict on A, then B's allowance: B gets no conflict chip")
    func nextPayersAllowance() async throws {
        let model = makeModel()
        let certA = try await conflictOnA(model)
        await model.accept(text: text(.allowance, allowanceB))
        let certB = try #require(model.allowances[88])
        #expect(model.lastAllowance?.allowanceId == 88)
        #expect(model.conflictAllowanceId == nil)
        #expect(!model.conflictingSpend)
        #expect(model.limitState == .withinLimit)
        #expect(model.limitBadge(for: certB) == .limit(.withinLimit))
        #expect(model.limitBadge(for: certA) == nil, "no total was read for A while B is on screen")
        #expect(model.issue == nil)
    }

    @Test("conflict on A, then a note checked against B: B gets no conflict chip")
    func noteCheckedAgainstB() async throws {
        let model = makeModel()
        await model.accept(text: text(.allowance, allowanceB))
        _ = try await conflictOnA(model)
        // 2.50 against B's 2.00 offline limit: refused, and the card now shows B.
        let big = try F.note(payer: payerB, payee: merchant.keyHash, amount: 2_500_000, serial: 0, allowanceId: 88)
        await model.accept(text: text(.note, big.wire))
        #expect(model.issue?.kind == .payment(.offlineLimit))
        #expect(model.lastAllowance?.allowanceId == 88)
        #expect(model.conflictAllowanceId == nil)
        #expect(!model.conflictingSpend)
        #expect(model.limitState == .withinLimit)
    }

    @Test("A's own allowance scanned again keeps A's conflict")
    func sameAllowanceKeepsConflict() async throws {
        let model = makeModel()
        let certA = try await conflictOnA(model)
        await model.accept(text: text(.allowance, allowanceA))
        #expect(model.conflictAllowanceId == 77)
        #expect(model.conflictingSpend)
        #expect(model.limitBadge(for: certA) == .conflictingSpend)
    }

    @Test("the limit chip never carries the conflict state; an unread total gives no chip")
    func badgeKinds() async throws {
        let model = makeModel()
        await model.accept(text: text(.allowance, allowanceA))
        let certA = try #require(model.lastAllowance)
        #expect(model.limitBadge(for: certA) == .limit(.withinLimit))
        let certB = try AllowanceCertificate.verify(wire: allowanceB, deployment: F.deployment, serverPublicKey: F.serverKey)
        #expect(model.limitBadge(for: certB) == nil)
    }
}

@Suite("wrong-kind messages use the right article (review 2, finding 5)")
struct WrongKindArticleTests {
    @Test("an allowance, a payment note")
    func articles() {
        #expect(MoneyIssueKind.wrongKind(expected: [.note], got: .allowance).message
                == "That is an allowance code. This step needs a payment note code.")
        #expect(MoneyIssueKind.wrongKind(expected: [.allowance], got: .marker).message
                == "That is a spend marker code. This step needs an allowance code.")
        #expect(MoneyIssueKind.wrongKind(expected: [.note, .allowance], got: .ack).message
                == "That is a merchant receipt code. This step needs a payment note or allowance code.")
    }

    @Test("no kind pair reads 'a' before a vowel or 'an' before a consonant")
    func everyPair() throws {
        let wrong = try Regex(#"\ba [aeiou]|\ban [^aeiou ]"#)
        for got in PaymentTransport.Kind.allCases {
            for expected in PaymentTransport.Kind.allCases where expected != got {
                let message = MoneyIssueKind.wrongKind(expected: [expected], got: got).message
                #expect(message.firstMatch(of: wrong) == nil, "\(message)")
            }
        }
    }
}
