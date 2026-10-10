package org.loka.meshlab

import android.os.Build
import android.view.accessibility.AccessibilityNodeInfo
import androidx.test.core.app.ActivityScenario
import androidx.test.platform.app.InstrumentationRegistry
import org.junit.*

class PartyCardsAppSmokeTest {
    private fun find(node: AccessibilityNodeInfo?, text: String): AccessibilityNodeInfo? {
        if (node == null) return null
        if (node.text?.toString() == text || node.contentDescription?.toString() == text) return node
        for (i in 0 until node.childCount) find(node.getChild(i), text)?.let { return it }
        return null
    }
    private fun scrollable(node:AccessibilityNodeInfo?):AccessibilityNodeInfo? {
        if(node==null)return null
        if(node.isScrollable)return node
        for(i in 0 until node.childCount)scrollable(node.getChild(i))?.let{return it}
        return null
    }
    private fun await(text: String): AccessibilityNodeInfo {
        val automation = InstrumentationRegistry.getInstrumentation().uiAutomation
        repeat(100) { at -> find(automation.rootInActiveWindow,text)?.let{return it};if(at%10==9)scrollable(automation.rootInActiveWindow)?.performAction(AccessibilityNodeInfo.ACTION_SCROLL_FORWARD);Thread.sleep(100) }
        error("Missing screen text: $text")
    }
    private fun enabledControl(text:String):AccessibilityNodeInfo {
        await(text)
        repeat(100) {
            var node=find(InstrumentationRegistry.getInstrumentation().uiAutomation.rootInActiveWindow,text)
            while(node!=null){node.refresh();if(node.isClickable && node.isEnabled)return node;node=node.parent}
            Thread.sleep(100)
        }
        photo("disabled-control");error("Control did not become enabled: $text")
    }
    private fun photo(name:String) {
        android.os.ParcelFileDescriptor.AutoCloseInputStream(InstrumentationRegistry.getInstrumentation().uiAutomation.executeShellCommand("screencap -p /data/local/tmp/loka-party-ui-$name.png")).use{it.readBytes()}
    }
    @Test fun actualAppPlayShelfOpensPartyCards() {
        Assume.assumeTrue(Build.HARDWARE in listOf("ranchu", "goldfish") || InstrumentationRegistry.getArguments().getString("allowPhysicalCardsUi")=="true")
        val context = InstrumentationRegistry.getInstrumentation().targetContext
        val profile = context.getSharedPreferences("loka-profile", 0)
        val appearance=context.getSharedPreferences("loka-appearance",0)
        val oldTheme=appearance.getString("theme","System")
        val theme=InstrumentationRegistry.getArguments().getString("partyTheme")
        if(theme!=null)appearance.edit().putString("theme",theme).commit()
        val old = profile.getBoolean("onboarding-complete", false)
        profile.edit().putBoolean("onboarding-complete", true).commit()
        try {
            ActivityScenario.launch(MainActivity::class.java).use { scenario ->
                var play: AccessibilityNodeInfo? = await("Play")
                while (play != null && !play.isClickable) play = play.parent
                Assert.assertTrue(play?.performAction(AccessibilityNodeInfo.ACTION_CLICK) == true)
                await("Cards"); await("Ludo");photo("shelf")
                var cards: AccessibilityNodeInfo? = await("Cards")
                while (cards != null && !cards.isClickable) cards = cards.parent
                Assert.assertTrue(cards?.performAction(AccessibilityNodeInfo.ACTION_CLICK) == true)
                await("Choose your cards");photo("choose-cards")
                fun noTabs() {for(label in listOf("Chats","Nearby","Play","You"))Assert.assertNull("Tab visible inside Cards: $label",find(InstrumentationRegistry.getInstrumentation().uiAutomation.rootInActiveWindow,label))}
                noTabs()
                var back:AccessibilityNodeInfo?=await("‹ Back");while(back!=null && !back.isClickable)back=back.parent;Assert.assertTrue(back?.performAction(AccessibilityNodeInfo.ACTION_CLICK)==true)
                await("Play");cards=await("Cards");while(cards!=null && !cards.isClickable)cards=cards.parent;Assert.assertTrue(cards?.performAction(AccessibilityNodeInfo.ACTION_CLICK)==true);await("Choose your cards");noTabs()
                fun click(text:String) {
                    Assert.assertTrue(enabledControl(text).performAction(AccessibilityNodeInfo.ACTION_CLICK));InstrumentationRegistry.getInstrumentation().uiAutomation.waitForIdle(150,5000)
                    if(text in listOf("Start playing →","Apply filters")){
                        var namesVisible=false
                        for(at in 0..20){if(find(InstrumentationRegistry.getInstrumentation().uiAutomation.rootInActiveWindow,"Player names")!=null){namesVisible=true;break};Thread.sleep(100)}
                        if(namesVisible){
                        fun editable(node:AccessibilityNodeInfo?):AccessibilityNodeInfo? {if(node==null)return null;if(node.isEditable)return node;for(i in 0 until node.childCount)editable(node.getChild(i))?.let{return it};return null}
                        for(i in 1..4){var labeled:AccessibilityNodeInfo?=await("Player $i name");while(labeled!=null && !labeled.isEditable && labeled.parent!=null)labeled=labeled.parent;val field=editable(labeled) ?: error("Missing name field $i");val args=android.os.Bundle();args.putCharSequence(AccessibilityNodeInfo.ACTION_ARGUMENT_SET_TEXT_CHARSEQUENCE,if(i==1)"Alex" else "Player $i");Assert.assertTrue(field.performAction(AccessibilityNodeInfo.ACTION_SET_TEXT,args))}
                        Assert.assertTrue(enabledControl("Continue").performAction(AccessibilityNodeInfo.ACTION_CLICK));InstrumentationRegistry.getInstrumentation().uiAutomation.waitForIdle(150,5000)
                        }
                    }
                }
                fun awaitCard() {
                    find(InstrumentationRegistry.getInstrumentation().uiAutomation.rootInActiveWindow,"Reveal card")?.let{Assert.assertTrue(enabledControl("Reveal card").performAction(AccessibilityNodeInfo.ACTION_CLICK))}
                    val prompts=PartyCatalog.load(context).games.flatMap{game->game.cards.map{card->card.text}}.toSet()
                    fun containsPrompt(node:AccessibilityNodeInfo?):Boolean {
                        if(node==null)return false
                        if(node.text?.toString()?.let{text->prompts.any{prompt->text==prompt || text.endsWith(": "+prompt)}}==true)return true
                        return (0 until node.childCount).any{containsPrompt(node.getChild(it))}
                    }
                    repeat(100){if(containsPrompt(InstrumentationRegistry.getInstrumentation().uiAutomation.rootInActiveWindow))return;Thread.sleep(100)}
                    photo("missing-card");error("No playable card appeared after shuffle")
                }
                click("A group");await("Players: 4");photo("group-selected");click("Start playing →");await("Filters");awaitCard();enabledControl("Next card");noTabs();photo("filtered-play")
                if(theme in listOf("Dark","Light")) {
                    scenario.moveToState(androidx.lifecycle.Lifecycle.State.CREATED)
                    scenario.moveToState(androidx.lifecycle.Lifecycle.State.RESUMED)
                    InstrumentationRegistry.getInstrumentation().waitForIdleSync()
                    scenario.onActivity{activity->Assert.assertEquals("Status icons follow the app theme after resume",theme=="Light",androidx.core.view.WindowCompat.getInsetsController(activity.window,activity.window.decorView).isAppearanceLightStatusBars)}
                }
                find(InstrumentationRegistry.getInstrumentation().uiAutomation.rootInActiveWindow,"Resume game")?.let{click("Resume game")}
                val nextBounds=android.graphics.Rect();enabledControl("Next card").getBoundsInScreen(nextBounds)
                click("‹ Back");await("Choose your cards");noTabs();photo("returned-choose")
                val startBounds=android.graphics.Rect();enabledControl("Start playing →").getBoundsInScreen(startBounds)
                val nearbyBounds=android.graphics.Rect();enabledControl("Nearby multiplayer").getBoundsInScreen(nearbyBounds)
                Assert.assertEquals("Start/Nearby footer top",startBounds.top,nearbyBounds.top)
                Assert.assertEquals("Start/Nearby footer bottom",startBounds.bottom,nearbyBounds.bottom)
                Assert.assertEquals("Footer left edge",nextBounds.left,minOf(startBounds.left,nearbyBounds.left))
                Assert.assertEquals("Footer right edge",nextBounds.right,maxOf(startBounds.right,nearbyBounds.right))
                click("Start playing →");awaitCard();enabledControl("Next card")
                click("Filters");await("Apply filters");noTabs();photo("filter-sheet")
                click("Apply filters");awaitCard();await("Next card");click("Skip");await("Filters")

            }
        } finally { profile.edit().putBoolean("onboarding-complete", old).commit();if(theme!=null)appearance.edit().putString("theme",oldTheme).commit() }
    }
}
