import Foundation
import Observation
import Testing
@testable import LokaPay

private typealias F = ScreenFixtures

/// Review round 2 on the payment screens (3.71). Each suite names the finding it covers.
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
