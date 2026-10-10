import XCTest

/// Ordinary app, real identity/storage/radios. Explicitly select host on iPad,
/// guest on iPhone. Local age confirmation is synthetic test input only.
final class PhysicalPartyCardsTests: XCTestCase {
    let app=XCUIApplication()
    override func setUpWithError() throws {
        #if targetEnvironment(simulator)
        throw XCTSkip("Physical Cards test requires real devices.")
        #endif
        continueAfterFailure=false
        app.launchArguments=["-loka.party.adultConfirmed","YES"]
    }
    func record(_ text:String) { print("PHYSICAL_CARDS \(Int64(Date().timeIntervalSince1970*1000)) \(text)") }
    func tap(_ button:XCUIElement) {
        XCTAssertTrue(button.waitForExistence(timeout:15))
        for _ in 0..<10 where !button.isHittable {
            let s=app.scrollViews.firstMatch
            if button.frame.minY < s.frame.minY { s.swipeDown() } else { s.swipeUp() }
        }
        XCTAssertTrue(button.isHittable);button.tap()
    }
    func open() {
        app.launch();tap(app.buttons["Play"])
        if app.staticTexts["Let’s play"].exists { app.scrollViews.firstMatch.swipeUp();tap(app.buttons["Cards"]) }
    }
    func photo(_ name:String) { let shot=XCTAttachment(screenshot:app.screenshot());shot.name=name;shot.lifetime = .keepAlways;add(shot) }
    func advance(_ card:Int) {
        app.scrollViews.firstMatch.swipeDown()
        XCTAssertTrue(app.staticTexts["Card \(card)"].waitForExistence(timeout:90))
        let button=app.buttons["Done / Next"]
        let ready=expectation(for:NSPredicate(format:"enabled == true"),evaluatedWith:button)
        wait(for:[ready],timeout:40)
        record("turn-\(card)");photo("card-\(card)");tap(button);record("submitted-\(card)")
    }
    func testHostInvitesNearbyAndSynchronizesSixCards() {
        open();tap(app.buttons["Browse games"]);tap(app.buttons["party-game-never_have_i_ever"])
        let peer=app.buttons.matching(NSPredicate(format:"identifier BEGINSWITH 'party-peer-1f161a8d'")).firstMatch
        tap(peer);tap(app.buttons["Invite to play"]);tap(app.buttons["Invite players"]);record("invited")
        for card in [1,3,5] { advance(card) }
        app.scrollViews.firstMatch.swipeDown()
        XCTAssertTrue(app.staticTexts["Card 7"].waitForExistence(timeout:90));record("six-cards-converged");photo("six-cards-host")
    }
    func testGuestAcceptsRecoversAndSynchronizesSixCards() {
        open();record("waiting-for-invitation")
        XCTAssertTrue(app.buttons["Accept invitation"].waitForExistence(timeout:120));tap(app.buttons["Accept invitation"]);record("accepted")
        advance(2)
        app.scrollViews.firstMatch.swipeDown()
        XCTAssertTrue(app.staticTexts["Card 3"].waitForExistence(timeout:60))
        app.terminate();open();record("restarted")
        tap(app.buttons["Resume / sync"]);record("requested-sync")
        for card in [4,6] { advance(card) }
        app.scrollViews.firstMatch.swipeDown()
        XCTAssertTrue(app.staticTexts["Card 7"].waitForExistence(timeout:90));record("six-cards-converged");photo("six-cards-guest")
    }
}
