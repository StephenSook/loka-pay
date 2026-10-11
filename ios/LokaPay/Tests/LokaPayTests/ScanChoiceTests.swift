import Foundation
import Testing
@testable import LokaPay

/// The merchant's Paid screen shows two codes: the receipt code and, under it, the verify link
/// (task 3.86). The payer's camera must still attach the receipt, whichever code it reads first.
@Suite("The scanner's choice of code when a frame holds more than one")
struct ScanChoiceTests {
    static let receipt = "L1|P|1|X|AAAA"
    static let link = "https://zerobars.us/verify#r=AAAA"

    @Test("a LOKA code is reported before the verify link in the same frame, in either order")
    func lokaCodeFirst() {
        var linkFirst = ScanChoice()
        #expect(linkFirst.report([Self.link, Self.receipt]) == Self.receipt)
        var receiptFirst = ScanChoice()
        #expect(receiptFirst.report([Self.receipt, Self.link]) == Self.receipt)
    }

    @Test("a code in view is reported once, and two codes in view never take turns")
    func noRepeats() {
        var choice = ScanChoice()
        #expect(choice.report([Self.link, Self.receipt]) == Self.receipt)
        #expect(choice.report([Self.receipt, Self.link]) == nil)
        #expect(choice.report([Self.link, Self.receipt]) == nil)
        #expect(choice.report([Self.receipt]) == nil)
        #expect(choice.lastValue == Self.receipt)

        var two = ScanChoice()
        let other = "L1|P|1|Y|BBBB"
        #expect(two.report([Self.receipt, other]) == Self.receipt)
        #expect(two.report([other, Self.receipt]) == nil)
    }

    @Test("the link alone is still reported, once, so the screen can say why it was refused")
    func linkAlone() {
        var choice = ScanChoice()
        #expect(choice.report([Self.link]) == Self.link)
        #expect(choice.report([Self.link]) == nil)
        // The receipt code comes into view beside it.
        #expect(choice.report([Self.link, Self.receipt]) == Self.receipt)
    }

    @Test("a different code is reported, an earlier one again when it is seen alone, and empty frames are nothing")
    func differentCodes() {
        var choice = ScanChoice()
        #expect(choice.report([]) == nil)
        #expect(choice.report([""]) == nil)
        #expect(choice.report(["L1|P|1|A|AAAA"]) == "L1|P|1|A|AAAA")
        #expect(choice.report(["L1|P|1|N|BBBB"]) == "L1|P|1|N|BBBB")
        #expect(choice.report(["L1|P|1|A|AAAA"]) == "L1|P|1|A|AAAA")
    }
}
