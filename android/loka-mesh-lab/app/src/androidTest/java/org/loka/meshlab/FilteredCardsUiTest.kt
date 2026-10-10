package org.loka.meshlab
import android.os.Build
import androidx.compose.material3.MaterialTheme
import androidx.compose.ui.test.*
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.test.platform.app.InstrumentationRegistry
import org.junit.*
import org.loka.core.PartyCard
class FilteredCardsUiTest {
    @get:Rule val ui=createComposeRule()
    private val prefs get()=InstrumentationRegistry.getInstrumentation().targetContext.getSharedPreferences("loka-card-eligibility",0)
    private var changed=false;private var old18=false;private var old21=false
    @Before fun setup(){Assume.assumeTrue(Build.HARDWARE in listOf("ranchu","goldfish") || InstrumentationRegistry.getArguments().getString("allowPhysicalCardsUi")=="true");old18=prefs.getBoolean("18",false);old21=prefs.getBoolean("21",false);changed=true;prefs.edit().putBoolean("18",false).putBoolean("21",false).commit()}
    @After fun restore(){if(changed)prefs.edit().putBoolean("18",old18).putBoolean("21",old21).commit()}
    private fun photo(name:String) {
        android.os.ParcelFileDescriptor.AutoCloseInputStream(InstrumentationRegistry.getInstrumentation().uiAutomation.executeShellCommand("screencap -p /data/local/tmp/loka-premium-$name.png")).use{it.readBytes()}
    }
    private fun start(){val cards=listOf(PartyCard("a","x","Clean one","clean",setOf("group"),2,20,false),PartyCard("b","x","Clean two","clean",setOf("group"),2,20,false),PartyCard("c","x","Dirty one","dirty",setOf("group"),2,20,false,setOf("dirty"),true));ui.setContent{MaterialTheme{FilteredCardsContent(cards,{},{})}}}
    private fun closeSheet(){
        ui.onNodeWithTag("cards-sheet-handle",useUnmergedTree=true).performTouchInput{swipe(center,center+androidx.compose.ui.geometry.Offset(0f,900f),250)}
        ui.waitForIdle()
    }
    private fun tap(text:String){
        if(text=="Cancel"){closeSheet();return}
        if(text=="Start playing →"){
            val toggle=ui.onNodeWithTag("card-handoff-toggle")
            if(runCatching{toggle.assertIsOn()}.isSuccess){toggle.performScrollTo().performClick()}
            runCatching{ui.onNodeWithTag("card-round-0").performScrollTo().performClick()}
        }
        val node=ui.onNodeWithText(text);runCatching{node.performScrollTo()}
        if(text=="Start playing →" && node.fetchSemanticsNode().config.contains(androidx.compose.ui.semantics.SemanticsProperties.Disabled)){tap("A group")}
        runCatching{node.performScrollTo()};node.performClick();ui.waitForIdle()
        if(text=="Filters"){ui.mainClock.advanceTimeBy(400);ui.waitForIdle()}
        if(text in listOf("Start playing →","Apply filters") && ui.onAllNodesWithText("Player names").fetchSemanticsNodes().isNotEmpty()){
            for(i in 0..19){val field=ui.onNodeWithTag("card-player-name-$i");if(runCatching{field.fetchSemanticsNode()}.isSuccess){runCatching{field.performScrollTo()};if(field.fetchSemanticsNode().config[androidx.compose.ui.semantics.SemanticsProperties.EditableText].text.isEmpty())field.performTextInput(if(i==0)"Alex" else if(i==1)"Blair" else "Player ${i+1}")}}
            tap("Continue")
        }
    }
    @Test fun cleanDeckExhaustsAndCancelledFiltersPreserveCard(){start();tap("Start playing →");val first=ui.onAllNodesWithText("Clean one").fetchSemanticsNodes().isNotEmpty();tap("Filters");ui.onNodeWithContentDescription("Dirty not selected").assertDoesNotExist();ui.onNodeWithContentDescription("Drinking not selected").assertDoesNotExist();tap("Cancel");ui.onNodeWithText(if(first)"Clean one" else "Clean two").assertExists();tap("Next card");ui.onNodeWithText(if(first)"Clean two" else "Clean one").assertExists();tap("Skip");ui.onNodeWithText("You’ve finished this deck").assertExists();tap("Another round");ui.onNodeWithText("Filters").assertExists()}
    @Test fun emptyCategorySelectionBlocksStartAndRestrictedCategoriesAreAbsent(){start();ui.onNodeWithContentDescription("Clean selected").performClick();ui.onNodeWithText("Start playing →").assertIsNotEnabled();ui.onNodeWithContentDescription("Dirty not selected").assertDoesNotExist();ui.onNodeWithContentDescription("Drinking not selected").assertDoesNotExist();ui.onNodeWithContentDescription("Clean not selected").performClick();tap("Start playing →");ui.onNodeWithText("Confirm & play").assertDoesNotExist();ui.onNodeWithText("Dirty one").assertDoesNotExist();tap("Filters");ui.onNodeWithContentDescription("Clean selected").performClick();ui.onNodeWithText("Apply filters").assertIsNotEnabled()}
    @Test fun shortDragReturnsAndBothSwipeDirectionsDrawOnce(){
        start();tap("Start playing →")
        val first=ui.onAllNodesWithText("Clean one").fetchSemanticsNodes().isNotEmpty()
        val firstText=if(first)"Clean one" else "Clean two"
        ui.onNodeWithTag("swipe-card").performTouchInput { swipe(center,center.copy(x=center.x+width*0.08f),durationMillis=800) }
        ui.onNodeWithText(firstText).assertExists()
        ui.onNodeWithTag("swipe-card").performTouchInput { down(center);moveTo(center.copy(x=center.x-width*0.45f),delayMillis=600) }
        ui.onNodeWithText(firstText).assertExists()
        android.os.ParcelFileDescriptor.AutoCloseInputStream(InstrumentationRegistry.getInstrumentation().uiAutomation.executeShellCommand("screencap -p /data/local/tmp/loka-cards-prompt-peek.png")).use{it.readBytes()}
        ui.onNodeWithTag("swipe-card").performTouchInput { up() }
        ui.onNodeWithText(if(first)"Clean two" else "Clean one").assertExists()
        ui.onNodeWithTag("swipe-card").performTouchInput { swipeRight() }
        ui.onNodeWithText("You’ve finished this deck").assertExists()
    }
    @Test fun shuffleShowsIllustratedPromptCardsWithoutAdvancingTheDeck(){
        ui.mainClock.autoAdvance=false
        var busy=false;var advances=0
        val sample=PartyCard("sample","x","Question on the animated card","clean",setOf("group"),2,20,false)
        ui.setContent{MaterialTheme{CardMotion(1,{busy=it},{advances++},shuffleFace={CardGraphic(sample,androidx.compose.ui.unit.Dp(340f),interactive=false)}){androidx.compose.material3.Text("Face-up card")}}}
        ui.onNodeWithText("Shuffling cards…").assertDoesNotExist()
        ui.onNodeWithText("Face-up card").assertDoesNotExist()
        ui.onNodeWithTag("dealt-card-0").assertDoesNotExist()
        ui.mainClock.advanceTimeBy(400)
        ui.onNodeWithTag("dealt-card-0").assertExists()
        Assert.assertTrue(busy);Assert.assertEquals(0,advances)
        ui.onNodeWithTag("dealt-card-4").assertDoesNotExist()
        ui.mainClock.advanceTimeBy(1000)
        ui.onNodeWithText("Face-up card").assertDoesNotExist()
        ui.onNodeWithTag("dealt-card-4").assertExists()
        android.os.ParcelFileDescriptor.AutoCloseInputStream(InstrumentationRegistry.getInstrumentation().uiAutomation.executeShellCommand("screencap -p /data/local/tmp/loka-cards-mixing.png")).use{it.readBytes()}
        ui.mainClock.advanceTimeBy(1000)
        ui.onNodeWithText("Shuffling cards…").assertDoesNotExist()
        ui.onNodeWithText("Face-up card").assertExists()
        Assert.assertFalse(busy);Assert.assertEquals(0,advances)
        ui.mainClock.autoAdvance=true
    }
    @Test fun longPromptScrollsWhileNextStaysInTheFooter(){
        val longPrompt="A long card prompt. ".repeat(100)
        val cards=listOf(PartyCard("long","x",longPrompt,"clean",setOf("group"),2,20,false))
        ui.setContent{MaterialTheme{FilteredCardsContent(cards,{},{})}}
        tap("Start playing →")
        val next=ui.onNodeWithText("Next card")
        next.assertIsDisplayed()
        val before=next.fetchSemanticsNode().boundsInRoot
        val filters=ui.onNodeWithText("Filters").fetchSemanticsNode().boundsInRoot
        val skip=ui.onNodeWithText("Skip").fetchSemanticsNode().boundsInRoot
        Assert.assertEquals(filters.center.y,skip.center.y,1f)
        Assert.assertTrue(filters.top>=before.bottom)
        ui.onNodeWithText("Clean").assertDoesNotExist()
        ui.onNodeWithTag("swipe-card").performTouchInput{swipeUp()}
        next.assertIsDisplayed()
        Assert.assertEquals(before,next.fetchSemanticsNode().boundsInRoot)
        ui.onNodeWithText(longPrompt).assertExists()
        ui.onNodeWithText("✓ Clean").assertDoesNotExist()
    }
    @Test fun audienceRequiredAndCancelledFiltersKeepThePlayerSetup() {
        val base=PartyCard("shared","x","Shared prompt","clean",setOf("friends","couples","group"),2,20,false)
        val cards=listOf(base,base.copy(id="friends",text="Friends prompt",modes=setOf("friends"),max=2),base.copy(id="couples",text="Couple prompt",modes=setOf("couples"),max=2),base.copy(id="group",text="Group prompt",modes=setOf("group"),min=3,max=6))
        ui.setContent{MaterialTheme{FilteredCardsContent(cards,{},{})}}
        ui.onNodeWithText("Start playing →").assertIsNotEnabled()
        tap("Two friends");ui.onNodeWithText("2 matching cards").assertExists();tap("Start playing →")
        ui.onNodeWithText("2 players · Friends").assertExists();ui.onNodeWithText("Couple prompt").assertDoesNotExist();ui.onNodeWithText("Group prompt").assertDoesNotExist()
        tap("Filters");tap("A group");ui.onNodeWithContentDescription("More players").performClick();ui.onNodeWithText("Players: 4").assertExists();tap("Cancel")
        ui.onNodeWithText("2 players · Friends").assertExists()
        tap("Filters");tap("A couple");tap("Apply filters")
        ui.onNodeWithText("2 players · Couple").assertExists();ui.onNodeWithText("Friends prompt").assertDoesNotExist()
    }
    @Test fun drinkingTaggedCardsCannotBeSelected() {
        val card=PartyCard("drink","truth_or_drink","What is your secret talent?","clean",setOf("friends","couples","group"),2,12,false,setOf("drinking"),false,true,"Truth or Drink")
        ui.setContent{MaterialTheme{FilteredCardsContent(listOf(card),{},{})}}
        tap("Two friends");ui.onNodeWithContentDescription("Drinking not selected").assertDoesNotExist()
        ui.onNodeWithText("No cards match. Change the pack, categories or player setup.").assertExists();ui.onNodeWithText("Start playing →").assertIsNotEnabled()
    }
    @Test fun headingTracksTheActiveGameAndRulesStayOutsideTheCard() {
        val a=PartyCard("a","a","First prompt","clean",setOf("friends"),2,2,false,gameName="Never Have I Ever",instructions=mapOf("friends" to "First game rules"))
        val b=a.copy(id="b",game="b",text="Second prompt",gameName="Would You Rather",instructions=mapOf("friends" to "Second game rules"))
        ui.setContent{MaterialTheme{FilteredCardsContent(listOf(a,b),{},{})}}
        tap("Two friends");tap("Start playing →")
        val first=ui.onAllNodesWithText(a.text).fetchSemanticsNodes().isNotEmpty()
        ui.onNodeWithTag("cards-game-title").assertTextEquals(if(first)a.gameName else b.gameName)
        tap("How to play");ui.onNodeWithText(if(first)"First game rules" else "Second game rules").assertExists();tap("Got it")
        ui.onNodeWithText(if(first)a.text else b.text).assertExists();tap("Next card")
        ui.onNodeWithTag("cards-game-title").assertTextEquals(if(first)b.gameName else a.gameName)
        ui.onNodeWithText(if(first)b.text else a.text).assertExists()
    }
    @Test fun startAndNearbyStayOnTheSameFixedFooterWhenChoicesScroll() {
        start()
        val start=ui.onNodeWithText("Start playing →");val nearby=ui.onNodeWithText("Nearby multiplayer")
        start.assertIsDisplayed();nearby.assertIsDisplayed()
        val a=start.fetchSemanticsNode().boundsInRoot;val b=nearby.fetchSemanticsNode().boundsInRoot
        Assert.assertEquals(a.top,b.top);Assert.assertEquals(a.bottom,b.bottom)
        ui.onNodeWithText("Who’s playing?").performTouchInput{swipeUp()}
        start.assertIsDisplayed();nearby.assertIsDisplayed()
        Assert.assertEquals(a,start.fetchSemanticsNode().boundsInRoot);Assert.assertEquals(b,nearby.fetchSemanticsNode().boundsInRoot)
    }
    @Test fun localNamesRequiredAndTurnRotatesOnlyOnCompletedDraws() {
        val cards=(0..5).map{PartyCard("$it","x","Question $it","clean",setOf("friends"),2,2,false,gameName="A game")}
        ui.setContent{MaterialTheme{FilteredCardsContent(cards,{},{})}}
        tap("Two friends");ui.onNodeWithText("Start playing →").performClick()
        ui.onNodeWithText("Continue").assertIsNotEnabled()
        ui.onNodeWithTag("card-player-name-0").performTextInput("Alex")
        ui.onNodeWithTag("card-player-name-1").performTextInput("alex")
        ui.onNodeWithText("Continue").assertIsNotEnabled()
        ui.onNodeWithTag("card-player-name-1").performTextClearance();ui.onNodeWithTag("card-player-name-1").performTextInput("Blair");tap("Continue")
        ui.onNodeWithTag("cards-current-player").assertTextEquals("Alex’s turn")
        tap("How to play");tap("Got it");ui.onNodeWithTag("cards-current-player").assertTextEquals("Alex’s turn")
        tap("Next card");ui.onNodeWithTag("cards-current-player").assertTextEquals("Blair’s turn")
        tap("Skip");ui.onNodeWithTag("cards-current-player").assertTextEquals("Alex’s turn")
        ui.onNodeWithTag("swipe-card").performTouchInput{swipeLeft()};ui.onNodeWithTag("cards-current-player").assertTextEquals("Blair’s turn")
        tap("Filters");tap("Cancel");ui.onNodeWithTag("cards-current-player").assertTextEquals("Blair’s turn")
    }
    @Test fun playerNameFooterRemainsFixedWhenNamesScroll() {
        start();tap("A group");repeat(16){ui.onNodeWithContentDescription("More players").performClick()};ui.onNodeWithText("Start playing →").performClick()
        val before=ui.onNodeWithText("Continue").fetchSemanticsNode().boundsInRoot
        repeat(3){ui.onNodeWithTag("card-names-scroll").performTouchInput{swipeUp()}}
        ui.onNodeWithTag("card-player-name-0").assertIsNotDisplayed()
        Assert.assertEquals(before,ui.onNodeWithText("Continue").fetchSemanticsNode().boundsInRoot)
        ui.onNodeWithText("Cancel").assertDoesNotExist();photo("names-footer");closeSheet();ui.onNodeWithText("Choose your cards").assertExists()
    }
    @Test fun skipAnimatesOutBeforeCommittingExactlyOneDraw() {
        ui.mainClock.autoAdvance=false
        val request=androidx.compose.runtime.mutableIntStateOf(0)
        var busy=false;var advances=0
        ui.setContent{MaterialTheme{CardMotion(1,{busy=it},{advances++},dismissKey=request.intValue){androidx.compose.material3.Text("Current prompt")}}}
        ui.mainClock.advanceTimeBy(2400);Assert.assertFalse(busy)
        ui.runOnIdle{request.intValue++};ui.mainClock.advanceTimeBy(100)
        Assert.assertTrue(busy);Assert.assertEquals(0,advances);ui.onNodeWithText("Current prompt").assertExists()
        photo("skip-moving")
        ui.mainClock.advanceTimeBy(300);Assert.assertFalse(busy);Assert.assertEquals(1,advances)
        ui.mainClock.advanceTimeBy(500);Assert.assertEquals(1,advances);ui.mainClock.autoAdvance=true
    }

    @Test fun sheetActionsMatchAndNamesDismissWithKeyboardOpen() {
        start();tap("A group");ui.onNodeWithText("Start playing →").performClick();ui.waitForIdle()
        val expected=ui.onNodeWithText("Continue").fetchSemanticsNode().boundsInRoot.size
        ui.onNodeWithTag("card-player-name-0").performClick().performTextInput("Alex")
        ui.waitForIdle();ui.onNodeWithTag("card-player-name-0").assertTextContains("Alex");photo("names-keyboard");closeSheet()
        ui.onNodeWithText("Player names").assertDoesNotExist();ui.onNodeWithText("Start playing →").assertExists()
        tap("Start playing →");tap("How to play")
        Assert.assertEquals(expected,ui.onNodeWithText("Got it").fetchSemanticsNode().boundsInRoot.size)
        photo("uniform-rules");closeSheet();ui.onNodeWithText("Got it").assertDoesNotExist()
        tap("Filters")
        Assert.assertEquals(expected,ui.onNodeWithText("Apply filters").fetchSemanticsNode().boundsInRoot.size)
        photo("uniform-filters");ui.onNodeWithContentDescription("Dirty not selected").assertDoesNotExist();ui.onNodeWithContentDescription("Drinking not selected").assertDoesNotExist()
        ui.onNodeWithText("Back to Clean cards").assertDoesNotExist();closeSheet()
        ui.onNodeWithText("Confirm your age").assertDoesNotExist();ui.onNodeWithText("Next card").assertExists()
    }

    @Test fun localSocialRoundSupportsBulkNamesHandoffUndoAndColdResume() {
        val cards=(0 until 12).map{PartyCard("social$it","x","Question $it","clean",setOf("group"),3,20,false,packs=setOf("family"),stage=it%3,namedText="{player}, ask {partner}: Question $it")}
        val generation=androidx.compose.runtime.mutableIntStateOf(0)
        ui.setContent{androidx.compose.runtime.key(generation.intValue){MaterialTheme{FilteredCardsContent(cards,{},{})}}}
        ui.onNodeWithText("A group").performClick();ui.onNodeWithText("Start playing →").performClick();ui.waitForIdle()
        ui.onNodeWithTag("card-name-list").performTextInput("Alex, Blair, Casey, Drew");ui.onNodeWithText("Use names").performScrollTo().performClick()
        ui.onNodeWithTag("card-player-name-0").assertTextContains("Alex");ui.onNodeWithText("Continue").performClick();ui.waitForIdle()
        ui.onNodeWithText("Reveal card").assertExists();ui.onNodeWithText("Pass to Alex",substring=true).assertExists();photo("social-handoff")
        tap("Reveal card");ui.onNodeWithText("Alex, ask Blair:",substring=true).assertExists();photo("social-named-prompt")
        val first=ui.onNodeWithText("Alex, ask Blair:",substring=true).fetchSemanticsNode().config[androidx.compose.ui.semantics.SemanticsProperties.Text].first().text
        tap("Next card");ui.onNodeWithText("Pass to Blair",substring=true).assertExists()
        ui.onNodeWithContentDescription("Game options").performClick();tap("Undo last card");ui.onNodeWithText(first).assertExists();ui.onNodeWithText("Alex’s turn").assertExists()
        ui.onNodeWithContentDescription("Game options").performClick();tap("Pause game");ui.onNodeWithText("Game paused").assertExists();tap("Resume game");ui.onNodeWithText(first).assertExists()
        ui.runOnIdle{generation.intValue++};ui.waitForIdle();tap("Resume game");ui.onNodeWithText(first).assertExists();ui.onNodeWithText("Alex’s turn").assertExists()
        repeat(4){if(ui.onAllNodesWithText("Reveal card").fetchSemanticsNodes().isNotEmpty())tap("Reveal card");tap("Next card")}
        ui.onNodeWithText("Round complete!").assertExists();photo("social-round-complete");tap("Another round");ui.onNodeWithText("Pass to Alex",substring=true).assertExists()
        ui.onNodeWithContentDescription("Game options").performClick();tap("Finish game");ui.onNodeWithText("Choose your cards").assertExists();ui.onNodeWithText("Resume game").assertDoesNotExist()
    }

}
