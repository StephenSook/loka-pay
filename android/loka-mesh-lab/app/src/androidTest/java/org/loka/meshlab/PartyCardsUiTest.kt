package org.loka.meshlab

import android.os.Build
import android.os.ParcelFileDescriptor
import androidx.compose.foundation.layout.*
import androidx.compose.material3.Text
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.runtime.mutableStateOf
import androidx.compose.ui.Modifier
import androidx.compose.ui.test.*
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.test.platform.app.InstrumentationRegistry
import org.junit.*
import org.junit.Assert.assertEquals
import org.loka.core.*
import java.util.UUID

/** Production card presentation + three real engines. In-memory delivery is not radio proof. */
class PartyCardsUiTest {
    @get:Rule val ui=createComposeRule()
    private val context get()=InstrumentationRegistry.getInstrumentation().targetContext
    private val ids=listOf("a".repeat(64),"b".repeat(64),"c".repeat(64))
    private lateinit var catalog:PartyCatalog
    private val engines=mutableMapOf<String,PartyCards>()
    private val saved=mutableMapOf<String,String>()
    private val wire=ArrayDeque<Triple<String,String,String>>()
    private var now=1_000_000L
    private val rendered=mutableStateOf(LabState())
    private var oldAdult=false
    private var prefsChanged=false
    private var oldTheme:String?=null
    private var themeChanged=false
    private fun engine(id:String)=PartyCards(id,catalog.hash,catalog.games.flatMap{it.cards},{now},{saved[id]=it},{peer,text->wire.add(Triple(id,peer,text));UUID.randomUUID().toString()},{})
    private fun render(){val g=engines.getValue(ids[0]);rendered.value=LabState(deviceId=ids[0],partyGames=catalog.games,partySession=g.session,partyCard=g.current,partyStatus=g.notice,partyCanAct=g.canAct,partyPaused=g.paused)}
    private fun pump(){var count=0;while(wire.isNotEmpty()){check(++count<200);val (from,to,text)=wire.removeFirst();val g=engines.getValue(to);g.receive(from,text);if(PartyEvent.decode(text).kind=="U")g.receive(from,text);engines.values.forEach{it.tick()}};assertEquals(1,engines.values.map{it.current?.id}.toSet().size);render()}
    private fun tap(text:String)=ui.onNodeWithText(text).performScrollTo().performClick()
    private fun photo(name:String){ui.waitForIdle();ParcelFileDescriptor.AutoCloseInputStream(InstrumentationRegistry.getInstrumentation().uiAutomation.executeShellCommand("screencap -p /data/local/tmp/loka-party-ui-$name.png")).use{it.readBytes()}}
    @After fun cleanup(){if(prefsChanged)context.getSharedPreferences("loka-party-preferences",0).edit().putBoolean("adult-confirmed",oldAdult).commit();if(themeChanged)context.getSharedPreferences("loka-appearance",0).edit().putString("theme",oldTheme).commit()}
    @Test fun groupCardTurnsDuplicateDeliveryAndRestartUseProductionPresentation() {
        Assume.assumeTrue(Build.HARDWARE in listOf("ranchu","goldfish") || InstrumentationRegistry.getArguments().getString("allowPhysicalCardsUi")=="true")
        val prefs=context.getSharedPreferences("loka-party-preferences",0);oldAdult=prefs.getBoolean("adult-confirmed",false);prefsChanged=true;prefs.edit().putBoolean("adult-confirmed",true).commit()
        val theme=InstrumentationRegistry.getArguments().getString("partyTheme");if(theme!=null){val appearance=context.getSharedPreferences("loka-appearance",0);oldTheme=appearance.getString("theme","System");themeChanged=true;appearance.edit().putString("theme",theme).commit()}
        catalog=PartyCatalog.load(context);ids.forEach{engines[it]=engine(it)}
        engines.getValue(ids[0]).invite(ids.drop(1),PartySettings("never_have_i_ever","group"));pump()
        ids.drop(1).forEach{engines.getValue(it).accept();pump()}
        ui.setContent{MaterialTheme(colorScheme=LokaColors.scheme){Surface(modifier=Modifier.safeDrawingPadding()){Column(Modifier.fillMaxSize()){Box(Modifier.weight(1f)){PartyCardsContent(rendered.value,PartyUiActions({_,_->},{engines.getValue(ids[0]).accept();pump()},{engines.getValue(ids[0]).act(it);pump()},{engines.getValue(ids[0]).resume();pump()},{engines.getValue(ids[0]).end();pump()}),{})};Text("Emulator fixture · In-memory delivery")}}}}
        ui.onNodeWithText("Up next").assertExists();ui.onNodeWithText("Playing").assertExists();ui.onNodeWithText("Card 1").assertExists();ui.onNodeWithText("Take a sip").assertIsNotEnabled();photo("card-play")
        tap("Done / Next");ui.onNodeWithText("Card 2").assertExists();ui.onNodeWithText("Done / Next").assertIsNotEnabled()
        ui.runOnIdle{ids.drop(1).forEach{engines.getValue(it).act("done");pump()}}
        tap("Shuffle");ui.onNodeWithText("Card 5").assertExists()
        ui.runOnIdle{now+=91000;val raw=saved.getValue(ids[0]);engines[ids[0]]=engine(ids[0]).also{it.restore(raw)};render()}
        ui.onNodeWithText("Reconnecting…").assertExists();photo("reconnecting");tap("Resume / sync")
        ui.runOnIdle{ids.drop(1).forEach{engines.getValue(it).act("done");pump()}}
        tap("Skip");ui.onNodeWithText("Card 8").assertExists()
        ui.runOnIdle{engines.getValue(ids[1]).act("done");pump()}
        ui.onNodeWithText("Round complete!").assertExists();photo("round-complete")
    }
}
