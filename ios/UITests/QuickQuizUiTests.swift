import XCTest

final class QuickQuizUiTests: XCTestCase {
    let app = XCUIApplication()
    let answers = [0,1,3,2,1,2,3,0,2,0]
    override func setUpWithError() throws {
        #if !targetEnvironment(simulator)
        let physicalCardChecks=["testFilteredCardShortDragAndBothSwipeDirections","testCardsLightAndDarkBackNavigationAndUniformButtons","testPlayHeaderStaysAboveScrollingContent","testCardFooterFiltersAndExpandedCard","testCardsStartWithoutAnAgeWheel","testPlayerNameFooterStaysBelowSafeScrollingArea","testLocalPlayerNames"]
        guard physicalCardChecks.contains(where:{name.contains($0)}) else {
            throw XCTSkip("In-memory network fixtures remain simulator-only; physical Cards checks use the production app.")
        }
        #endif
        continueAfterFailure = false; XCUIDevice.shared.orientation = .portrait
    }
    func start(guest: Bool = false) {
        app.launchArguments = ["--quiz-ui-fixture"] + (guest ? ["--quiz-guest"] : [])
        app.launch()
        XCTAssertTrue(app.staticTexts["Quick Quiz"].waitForExistence(timeout: 15))
    }
    func closeCardsSheet(){
        let handle=app.buttons["Sheet Grabber"].firstMatch
        XCTAssertTrue(handle.waitForExistence(timeout:5))
        handle.coordinate(withNormalizedOffset:CGVector(dx:0.5,dy:0.5)).press(forDuration:0.1,thenDragTo:app.coordinate(withNormalizedOffset:CGVector(dx:0.5,dy:0.97)))
    }
    func tap(_ button: XCUIElement) {
        XCTAssertTrue(button.waitForExistence(timeout: 5))
        if button.label=="Start playing →",app.switches["card-handoff-toggle"].exists {
            let toggle=app.switches["card-handoff-toggle"];for _ in 0..<6 where !toggle.isHittable{app.scrollViews.firstMatch.swipeUp()};if (toggle.value as? String)=="1"{toggle.tap()}
            let open=app.buttons["card-round-0"];if open.exists{tap(open)}
        }
        if button.label=="Start playing →",!button.isEnabled,app.buttons["card-audience-group"].exists {tap(app.buttons["card-audience-group"])}
        for _ in 0..<6 where !button.isHittable { app.scrollViews.firstMatch.swipeUp() }
        XCTAssertTrue(button.isHittable)
        XCTAssertEqual(XCTWaiter.wait(for:[XCTNSPredicateExpectation(predicate:NSPredicate(format:"isEnabled == true"),object:button)],timeout:5),.completed)
        let tappedLabel=button.label
        button.tap()
        if ["Start playing →","Apply filters"].contains(tappedLabel),app.staticTexts["Player names"].waitForExistence(timeout:2) {
            let fields=app.textFields.matching(NSPredicate(format:"identifier BEGINSWITH %@","card-player-name-"))
            photo("local-player-name-entry");XCTAssertTrue(fields.firstMatch.waitForExistence(timeout:5),app.debugDescription)
            for i in 0..<fields.count {let field=fields.element(boundBy:i);if (field.value as? String)?.hasPrefix("Player ")==true || (field.value as? String)=="" {field.tap();field.typeText(i==0 ? "Alex" : i==1 ? "Blair" : "Player \(i+1)")}}
            tap(app.buttons["Continue"])
        }
    }
    func photo(_ name: String) {
        let attachment = XCTAttachment(screenshot: app.screenshot()); attachment.name = name; attachment.lifetime = .keepAlways; add(attachment)
    }
    func testHostInviteTenAnswersDuplicateDeliveryAndRestart() {
        start(); photo("library")
        tap(app.buttons["Invite Alex"])
        XCTAssertTrue(app.staticTexts["Waiting for your friend"].exists); photo("waiting")
        tap(app.buttons["test-peer-turn"])
        XCTAssertTrue(app.staticTexts["Question 1 of 10"].exists)
        tap(app.buttons["quiz-answer-0"])
        XCTAssertTrue(app.staticTexts["Question 2 of 10"].exists)
        tap(app.buttons["test-restart"])
        XCTAssertTrue(app.staticTexts["Reconnecting…"].exists); photo("reconnecting")
        tap(app.buttons["Resume / sync"])
        for revision in 1..<10 {
            if revision % 2 == 1 { tap(app.buttons["test-peer-turn"]) }
            else { tap(app.buttons["quiz-answer-\(answers[revision])"]) }
        }
        XCTAssertTrue(app.staticTexts["Quiz complete!"].exists)
        XCTAssertTrue(app.staticTexts["You 5  •  Alex 5"].exists); photo("complete")
        XCUIDevice.shared.orientation = .landscapeLeft
        photo("landscape-complete")
        tap(app.buttons["End game"])
        XCTAssertTrue(app.staticTexts["Invite a verified friend"].exists)
    }
    func testNormalAppFourGameShelfAndPartyCardsFilters() {
        app.launchArguments = ["-loka.onboarding.complete", "YES", "-loka.localConnection.enabled", "NO", "-loka.cards.eligible18", "NO", "-loka.cards.eligible21", "NO"]
        app.launch()
        tap(app.buttons["Play"])
        for title in ["Ludo", "Cards"] { XCTAssertTrue(app.buttons[title].waitForExistence(timeout:10)) }
        app.scrollViews.firstMatch.swipeUp()
        for title in ["Chess", "Quick quiz"] { XCTAssertTrue(app.buttons[title].waitForExistence(timeout:10)) }
        app.scrollViews.firstMatch.swipeDown()
        photo("four-game-shelf")
        tap(app.buttons["Cards"])
        XCTAssertTrue(app.staticTexts["Choose your cards"].waitForExistence(timeout:10));photo("choose-cards")
        tap(app.buttons["Start playing →"])
        XCTAssertTrue(app.buttons["Filters"].exists);photo("filtered-play")
        let first=app.staticTexts["filtered-current-card"].label
        tap(app.buttons["Filters"]);photo("filter-sheet")
        XCTAssertTrue(app.buttons["card-filter-clean"].exists);XCTAssertFalse(app.buttons["card-filter-dirty"].exists);XCTAssertFalse(app.buttons["card-filter-drinking"].exists)
        closeCardsSheet()
        XCTAssertEqual(app.staticTexts["filtered-current-card"].label,first)
        tap(app.buttons["Next card"])
        XCTAssertNotEqual(app.staticTexts["filtered-current-card"].label,first)
        XCUIDevice.shared.orientation = .landscapeLeft;photo("filtered-landscape")
    }
    func testNormalAppCardsOfferOnlyCleanCards() {
        app.launchArguments=["-loka.onboarding.complete","YES","-loka.localConnection.enabled","NO","-loka.cards.eligible18","NO","-loka.cards.eligible21","NO"]
        app.launch();tap(app.buttons["Play"]);tap(app.buttons["Cards"])
        XCTAssertTrue(app.staticTexts["Choose your cards"].waitForExistence(timeout:10))
        XCTAssertFalse(app.buttons["card-filter-drinking"].exists);XCTAssertFalse(app.buttons["card-filter-dirty"].exists);photo("clean-only-categories")
        tap(app.buttons["card-filter-clean"])
        XCTAssertFalse(app.buttons["Start playing →"].isEnabled)
        tap(app.buttons["card-filter-clean"]);tap(app.buttons["Start playing →"])
        XCTAssertTrue(app.buttons["Next card"].waitForExistence(timeout:5))
        XCTAssertFalse(app.staticTexts["Confirm your age"].exists)
    }
    func testFilterSheetOffersOnlyCleanCards() {
        app.launchArguments=["-loka.onboarding.complete","YES","-loka.localConnection.enabled","NO","--reset-card-age"]
        app.launch();tap(app.buttons["Play"]);tap(app.buttons["Cards"]);tap(app.buttons["Start playing →"])
        XCTAssertTrue(app.buttons["Next card"].waitForExistence(timeout:5))
        tap(app.buttons["Filters"]);XCTAssertTrue(app.buttons["card-filter-clean"].waitForExistence(timeout:5))
        XCTAssertFalse(app.buttons["card-filter-drinking"].exists);XCTAssertFalse(app.buttons["card-filter-dirty"].exists);photo("clean-only-filters")
        tap(app.buttons["card-filter-clean"])
        XCTAssertFalse(app.buttons["Apply filters"].isEnabled);closeCardsSheet()
        XCTAssertTrue(app.staticTexts["filtered-current-card"].exists)
    }
    func testNativeGroupCardTurnsDuplicateDeliveryAndRestart() {
        app.launchArguments=["--party-ui-fixture"];app.launch()
        XCTAssertTrue(app.staticTexts["Card 1"].waitForExistence(timeout:10));XCTAssertTrue(app.staticTexts["Up next"].exists);XCTAssertTrue(app.staticTexts["Playing"].exists);photo("cards-play")
        XCTAssertFalse(app.buttons["Take a sip"].exists)
        tap(app.buttons["Done / Next"])
        XCTAssertFalse(app.buttons["Done / Next"].isEnabled)
        tap(app.buttons["party-test-peers"])
        tap(app.buttons["Shuffle"])
        tap(app.buttons["party-test-restart"])
        XCTAssertTrue(app.staticTexts["Reconnecting…"].exists);photo("cards-reconnecting")
        tap(app.buttons["Resume / sync"])
        tap(app.buttons["party-test-peers"])
        tap(app.buttons["Skip"])
        tap(app.buttons["party-test-peers"])
        XCTAssertTrue(app.staticTexts["Round complete!"].exists);photo("cards-round-complete")
        XCUIDevice.shared.orientation = .landscapeLeft;photo("cards-landscape-complete")
    }
    func testGuestInvitationTurnGatingAndLeave() {
        start(guest: true); photo("invitation")
        tap(app.buttons["Accept invitation"])
        XCTAssertFalse(app.buttons["quiz-answer-0"].isEnabled)
        tap(app.buttons["test-peer-turn"])
        XCTAssertTrue(app.buttons["quiz-answer-1"].isEnabled)
        photo("guest-question")
        tap(app.buttons["quiz-answer-1"])
        XCTAssertTrue(app.staticTexts["You 1  •  Alex 1"].exists)
        tap(app.buttons["Leave game"])
        XCTAssertTrue(app.staticTexts["Invite a verified friend"].exists)
    }
    func testCardsLightAndDarkBackNavigationAndUniformButtons() {
        for theme in ["Light","Dark"] {
            app.launchArguments=["-loka.onboarding.complete","YES","-loka.localConnection.enabled","NO","-loka.appearance.theme",theme]
            app.launch();tap(app.buttons["Play"]);tap(app.buttons["Cards"])
            let start=app.buttons["Start playing →"];XCTAssertTrue(start.waitForExistence(timeout:5));let startFrame=start.frame;let nearbyFrame=app.buttons["Nearby multiplayer"].frame
            photo("cards-choose-"+theme)
            tap(start);let next=app.buttons["Next card"];XCTAssertTrue(next.waitForExistence(timeout:5))
            XCTAssertEqual(next.frame.minX,startFrame.minX,accuracy:1);XCTAssertEqual(next.frame.maxX,nearbyFrame.maxX,accuracy:1);XCTAssertEqual(startFrame.minY,nearbyFrame.minY,accuracy:1);XCTAssertEqual(startFrame.height,nearbyFrame.height,accuracy:1)
            XCTAssertTrue(app.staticTexts["filtered-current-card"].waitForExistence(timeout:5))
            photo("cards-art-"+theme)
            tap(app.buttons["‹ Back"]);XCTAssertTrue(app.staticTexts["Choose your cards"].waitForExistence(timeout:5));XCTAssertFalse(app.buttons["Chats"].exists);photo("cards-return-"+theme)
            tap(start);tap(app.buttons["Filters"]);photo("cards-filters-"+theme);closeCardsSheet()
            tap(app.buttons["‹ Back"]);tap(app.buttons["‹ Back"]);XCTAssertTrue(app.buttons["Chats"].waitForExistence(timeout:5))
        }
    }
    func testCardFooterFiltersAndExpandedCard() {
        for theme in ["Light","Dark"] {
            app.launchArguments=["-loka.onboarding.complete","YES","-loka.localConnection.enabled","NO","-loka.appearance.theme",theme]
            app.launch();tap(app.buttons["Play"]);tap(app.buttons["Cards"]);tap(app.buttons["Start playing →"])
            let prompt=app.staticTexts["filtered-current-card"]
            XCTAssertTrue(prompt.waitForExistence(timeout:8))
            let filters=app.buttons["Filters"],skip=app.buttons["Skip"],next=app.buttons["Next card"]
            XCTAssertTrue(filters.isHittable);XCTAssertTrue(skip.isHittable)
            XCTAssertEqual(filters.frame.midY,skip.frame.midY,accuracy:1)
            XCTAssertGreaterThanOrEqual(filters.frame.minY,next.frame.maxY)
            XCTAssertFalse(app.staticTexts["Clean"].exists)
            XCTAssertLessThanOrEqual(prompt.frame.maxY,next.frame.minY)
            photo("cards-footer-"+theme)
            let original=prompt.label
            tap(filters);XCTAssertTrue(app.staticTexts["Choose your cards"].waitForExistence(timeout:5));closeCardsSheet()
            XCTAssertEqual(prompt.label,original)
            tap(skip);XCTAssertEqual(XCTWaiter.wait(for:[XCTNSPredicateExpectation(predicate:NSPredicate(format:"label != %@",original),object:prompt)],timeout:3),.completed)
        }
    }
    func testPlayHeaderStaysAboveScrollingContent() {
        for theme in ["Light","Dark"] {
            app.launchArguments=["-loka.onboarding.complete","YES","-loka.localConnection.enabled","NO","-loka.appearance.theme",theme]
            app.launch();tap(app.buttons["Play"])
            let header=app.otherElements["play-shelf-header"].firstMatch
            let scroll=app.scrollViews["play-shelf-scroll"].firstMatch
            XCTAssertTrue(header.waitForExistence(timeout:5));XCTAssertTrue(scroll.exists)
            let initial=header.frame
            XCTAssertGreaterThanOrEqual(scroll.frame.minY,initial.maxY-1)
            scroll.swipeUp();XCTAssertEqual(header.frame,initial);photo("play-header-scrolled-"+theme)
            scroll.swipeDown();scroll.swipeDown();XCTAssertEqual(header.frame,initial)
            XCTAssertGreaterThanOrEqual(scroll.frame.minY,header.frame.maxY-1)
            photo("play-header-top-"+theme)
            tap(app.buttons["Cards"]);XCTAssertTrue(app.staticTexts["Choose your cards"].waitForExistence(timeout:5))
            XCTAssertFalse(app.staticTexts["Let’s play"].exists)
        }
    }
    func testFilteredCardShortDragAndBothSwipeDirections() {
        app.launchArguments=["-loka.onboarding.complete","YES","-loka.localConnection.enabled","NO"]
        app.launch();tap(app.buttons["Play"]);tap(app.buttons["Cards"]);tap(app.buttons["Start playing →"])
        let card=app.staticTexts["filtered-current-card"]
        XCTAssertTrue(card.waitForExistence(timeout:5))
        let first=card.label
        let origin=card.coordinate(withNormalizedOffset:CGVector(dx:0.5,dy:0.5))
        origin.press(forDuration:0.1,thenDragTo:origin.withOffset(CGVector(dx:20,dy:0)),withVelocity:.slow,thenHoldForDuration:0.1)
        XCTAssertEqual(card.label,first)
        card.swipeLeft()
        XCTAssertEqual(XCTWaiter.wait(for:[XCTNSPredicateExpectation(predicate:NSPredicate(format:"label != %@",first),object:card)],timeout:3),.completed)
        let second=card.label
        card.swipeRight()
        XCTAssertEqual(XCTWaiter.wait(for:[XCTNSPredicateExpectation(predicate:NSPredicate(format:"label != %@",second),object:card)],timeout:3),.completed);XCTAssertNotEqual(card.label,first)
        photo("cards-after-left-and-right-swipes")
        tap(app.buttons["Next card"])
        XCTAssertNotEqual(card.label,second)
    }
    func testCardsRequireAudienceAndCancelKeepsTheAppliedSetup() {
        app.launchArguments=["-loka.onboarding.complete","YES","-loka.localConnection.enabled","NO"]
        app.launch();tap(app.buttons["Play"]);tap(app.buttons["Cards"])
        let start=app.buttons["Start playing →"];XCTAssertTrue(start.waitForExistence(timeout:5));XCTAssertFalse(start.isEnabled)
        tap(app.buttons["card-audience-friends"]);tap(start)
        XCTAssertTrue(app.staticTexts["2 players · Friends"].waitForExistence(timeout:5))
        let first=app.staticTexts["filtered-current-card"].label
        tap(app.buttons["Filters"]);tap(app.buttons["card-audience-couples"]);closeCardsSheet()
        XCTAssertTrue(app.staticTexts["2 players · Friends"].exists);XCTAssertEqual(app.staticTexts["filtered-current-card"].label,first)
        tap(app.buttons["Filters"]);tap(app.buttons["card-audience-group"])
        let stepper=app.steppers["card-player-count"];XCTAssertTrue(stepper.exists);stepper.buttons["card-player-count-Increment"].tap()
        XCTAssertEqual(stepper.value as? String,"4")
        tap(app.buttons["Apply filters"]);XCTAssertTrue(app.staticTexts["4 players · Group"].waitForExistence(timeout:5));photo("audience-filtered-group-card")
    }
    func testCardsStartFooterDoesNotMoveWhenChoicesScroll() {
        app.launchArguments=["-loka.onboarding.complete","YES","-loka.localConnection.enabled","NO"]
        app.launch();tap(app.buttons["Play"]);tap(app.buttons["Cards"])
        let start=app.buttons["Start playing →"],nearby=app.buttons["Nearby multiplayer"]
        XCTAssertTrue(start.waitForExistence(timeout:5));XCTAssertTrue(start.isHittable && nearby.isHittable)
        let a=start.frame,b=nearby.frame
        XCTAssertEqual(a.minY,b.minY,accuracy:1);XCTAssertEqual(a.height,b.height,accuracy:1)
        app.scrollViews.firstMatch.swipeUp();XCTAssertEqual(start.frame,a);XCTAssertEqual(nearby.frame,b)
        app.scrollViews.firstMatch.swipeDown();XCTAssertEqual(start.frame,a);XCTAssertEqual(nearby.frame,b);photo("cards-fixed-start-footer")
    }
    func testCardsStartWithoutAnAgeWheel() {
        app.launchArguments=["-loka.onboarding.complete","YES","-loka.localConnection.enabled","NO","-loka.cards.eligible18","NO","-loka.cards.eligible21","NO","-AppleLocale","en_US"]
        app.launch();tap(app.buttons["Play"]);tap(app.buttons["Cards"]);tap(app.buttons["card-audience-friends"])
        XCTAssertFalse(app.buttons["card-filter-drinking"].exists);XCTAssertFalse(app.buttons["card-filter-dirty"].exists);tap(app.buttons["Start playing →"])
        XCTAssertTrue(app.staticTexts["filtered-current-card"].waitForExistence(timeout:5))
        XCTAssertFalse(app.pickerWheels.firstMatch.exists);XCTAssertFalse(app.buttons["Confirm & play"].exists);photo("cards-no-age-wheel")
    }
    func testGameTitleAndRulesStayOutsideThePromptCard() {
        app.launchArguments=["-loka.onboarding.complete","YES","-loka.localConnection.enabled","NO"]
        app.launch();tap(app.buttons["Play"]);tap(app.buttons["Cards"]);tap(app.buttons["card-audience-friends"]);tap(app.buttons["Start playing →"])
        let prompt=app.staticTexts["filtered-current-card"],title=app.staticTexts["cards-game-title"]
        XCTAssertTrue(prompt.waitForExistence(timeout:5));XCTAssertTrue(title.exists);XCTAssertFalse(title.label.isEmpty);XCTAssertNotEqual(title.label,"Cards")
        let text=prompt.label,name=title.label
        tap(app.buttons["How to play"]);XCTAssertTrue(app.buttons["Got it"].waitForExistence(timeout:5));photo("cards-game-rules")
        tap(app.buttons["Got it"]);XCTAssertTrue(prompt.waitForExistence(timeout:5));XCTAssertEqual(prompt.label,text);XCTAssertEqual(title.label,name);photo("cards-prompt-only")
        tap(app.buttons["Next card"]);XCTAssertNotEqual(prompt.label,text);XCTAssertTrue(title.exists)
    }

    func testLocalPlayerNames() {
        app.launchArguments=["-loka.onboarding.complete","YES","-loka.localConnection.enabled","NO","-loka.cards.eligible21","NO","-AppleLocale","en_US"]
        app.launch();tap(app.buttons["Play"]);tap(app.buttons["Cards"]);tap(app.buttons["card-audience-friends"])
        tap(app.buttons["Start playing →"])
        let turn=app.staticTexts["cards-current-player"];XCTAssertTrue(app.staticTexts["filtered-current-card"].waitForExistence(timeout:5));XCTAssertEqual(turn.label,"Alex’s turn")
        tap(app.buttons["Next card"]);XCTAssertEqual(turn.label,"Blair’s turn");tap(app.buttons["Skip"]);XCTAssertEqual(turn.label,"Alex’s turn")
    }
    func testPlayerNameFooterStaysBelowSafeScrollingArea() {
        app.launchArguments=["-loka.onboarding.complete","YES","-loka.localConnection.enabled","NO"]
        app.launch();tap(app.buttons["Play"]);tap(app.buttons["Cards"]);tap(app.buttons["card-audience-group"])
        let stepper=app.steppers["card-player-count"];for _ in 0..<16 {stepper.buttons["card-player-count-Increment"].tap()}
        app.buttons["Start playing →"].tap()
        let title=app.staticTexts["Player names"],button=app.buttons["Continue"],scroll=app.scrollViews["card-names-scroll"]
        XCTAssertTrue(title.waitForExistence(timeout:5));let header=title.frame,footer=button.frame
        for _ in 0..<3 {scroll.swipeUp()};XCTAssertFalse(app.textFields["card-player-name-0"].isHittable);XCTAssertEqual(title.frame,header);XCTAssertEqual(button.frame,footer)
        XCTAssertGreaterThanOrEqual(scroll.frame.minY,title.frame.maxY)
        XCTAssertLessThanOrEqual(scroll.frame.maxY,button.frame.minY)
        XCTAssertFalse(app.buttons["Cancel"].exists);photo("cards-pinned-names-footer");closeCardsSheet();XCTAssertTrue(app.buttons["Start playing →"].waitForExistence(timeout:5))
    }
    func testSkipMotionAndDragToDismissPreserveLocalTurns() {
        app.launchArguments=["-loka.onboarding.complete","YES","-loka.localConnection.enabled","NO"]
        app.launch();tap(app.buttons["Play"]);tap(app.buttons["Cards"]);tap(app.buttons["card-audience-friends"]);tap(app.buttons["Start playing →"])
        let card=app.staticTexts["filtered-current-card"],turn=app.staticTexts["cards-current-player"]
        XCTAssertTrue(card.waitForExistence(timeout:5));let first=card.label
        tap(app.buttons["Filters"]);XCTAssertFalse(app.buttons["Cancel"].exists);closeCardsSheet();XCTAssertTrue(card.waitForExistence(timeout:5));XCTAssertEqual(card.label,first)
        tap(app.buttons["Skip"])
        XCTAssertEqual(XCTWaiter.wait(for:[XCTNSPredicateExpectation(predicate:NSPredicate(format:"label != %@",first),object:card)],timeout:3),.completed)
        XCTAssertEqual(turn.label,"Blair’s turn");photo("cards-after-animated-skip")
    }

    func testCardsSheetActionsMatchAndNamesDismissWithKeyboardOpen() {
        app.launchArguments=["-loka.onboarding.complete","YES","-loka.localConnection.enabled","NO","-loka.cards.eligible18","NO","-loka.cards.eligible21","NO","-AppleLocale","en_US"]
        app.launch();tap(app.buttons["Play"]);tap(app.buttons["Cards"]);tap(app.buttons["card-audience-friends"])
        app.buttons["Start playing →"].tap()
        let button=app.buttons["Continue"];XCTAssertTrue(button.waitForExistence(timeout:5));let expected=button.frame.size
        let name=app.textFields["card-player-name-0"];name.tap();name.typeText("Alex")
        photo("names-with-keyboard");closeCardsSheet()
        XCTAssertTrue(app.buttons["Start playing →"].waitForExistence(timeout:5));XCTAssertFalse(app.staticTexts["Player names"].exists)
        func matches(_ label:String){let action=app.buttons[label];XCTAssertTrue(action.waitForExistence(timeout:5));XCTAssertEqual(action.frame.width,expected.width,accuracy:1);XCTAssertEqual(action.frame.height,expected.height,accuracy:1)}
        tap(app.buttons["Start playing →"]);tap(app.buttons["How to play"]);matches("Got it");photo("uniform-rules");closeCardsSheet()
        tap(app.buttons["Filters"]);matches("Apply filters");photo("uniform-filters")
        XCTAssertFalse(app.buttons["card-filter-dirty"].exists);XCTAssertFalse(app.buttons["card-filter-drinking"].exists)
        XCTAssertFalse(app.buttons["Back to Clean cards"].exists);closeCardsSheet()
        XCTAssertTrue(app.buttons["Next card"].waitForExistence(timeout:5));XCTAssertFalse(app.staticTexts["Confirm your age"].exists)
    }

    func testCardsSocialRoundBulkNamesHandoffUndoAndColdResume() {
        app.launchArguments=["-loka.onboarding.complete","YES","-loka.localConnection.enabled","NO","-AppleLocale","en_US"]
        app.launch();tap(app.buttons["Play"]);tap(app.buttons["Cards"]);tap(app.buttons["card-audience-friends"])
        let family=app.buttons["card-pack-family"];for _ in 0..<5 where !family.isHittable{app.scrollViews["card-packs-scroll"].swipeLeft()};tap(family)
        app.buttons["Start playing →"].tap();XCTAssertTrue(app.staticTexts["Player names"].waitForExistence(timeout:5))
        let list=app.descendants(matching:.any).matching(identifier:"card-name-list").firstMatch;list.tap();list.typeText("Alex, Blair");tap(app.buttons["Use names"]);tap(app.buttons["Continue"])
        let card=app.staticTexts["filtered-current-card"];XCTAssertTrue(card.waitForExistence(timeout:5));XCTAssertTrue(card.label.contains("Pass to Alex"));photo("social-handoff")
        tap(app.buttons["Reveal card"]);XCTAssertTrue(card.waitForExistence(timeout:5));let first=card.label;XCTAssertFalse(first.contains("Pass to"));photo("social-prompt")
        tap(app.buttons["Next card"]);XCTAssertTrue(card.label.contains("Pass to Blair"))
        tap(app.buttons["cards-session-options"]);tap(app.buttons["Undo last card"]);XCTAssertTrue(card.waitForExistence(timeout:5));XCTAssertEqual(card.label,first);XCTAssertEqual(app.staticTexts["cards-current-player"].label,"Alex’s turn")
        tap(app.buttons["cards-session-options"]);tap(app.buttons["Pause game"]);XCTAssertTrue(app.staticTexts["Game paused"].waitForExistence(timeout:5));tap(app.buttons["Resume game"]);XCTAssertTrue(card.waitForExistence(timeout:5));XCTAssertEqual(card.label,first)
        app.terminate();app.launch();tap(app.buttons["Play"]);tap(app.buttons["Cards"]);tap(app.buttons["Resume game"]);XCTAssertTrue(card.waitForExistence(timeout:5));XCTAssertEqual(card.label,first)
        tap(app.buttons["Next card"]);tap(app.buttons["Reveal card"]);tap(app.buttons["Next card"]);XCTAssertTrue(app.staticTexts["Round complete!"].waitForExistence(timeout:5));photo("social-round-complete")
        tap(app.buttons["Another round"]);XCTAssertTrue(card.label.contains("Pass to Alex"));tap(app.buttons["cards-session-options"]);tap(app.buttons["Finish game"]);XCTAssertTrue(app.staticTexts["Choose your cards"].waitForExistence(timeout:5));XCTAssertFalse(app.buttons["Resume game"].exists)
    }

}
