package org.loka.meshlab

import android.os.ParcelFileDescriptor
import android.os.Build
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.foundation.layout.safeDrawingPadding
import androidx.compose.ui.Modifier
import androidx.compose.runtime.mutableStateOf
import androidx.compose.ui.test.*
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.test.platform.app.InstrumentationRegistry
import org.junit.*
import org.loka.core.QuickQuiz
import org.loka.core.GameEvent
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.unit.Density
import java.util.UUID

/** Native screen + real engines, with an in-memory peer. This does not test radios. */
class QuickQuizUiTest {
    @get:Rule val ui = createComposeRule()
    private val context get() = InstrumentationRegistry.getInstrumentation().targetContext
    private val own = "a".repeat(64)
    private val friend = "b".repeat(64)
    private lateinit var pack: QuizPack
    private lateinit var local: QuickQuiz
    private lateinit var remote: QuickQuiz
    private var now = 1_000_000L
    private var saved = ""
    private val wire = ArrayDeque<Pair<String, String>>()
    private val rendered = mutableStateOf(LabState())
    private fun engine(id: String) = QuickQuiz(id, pack.hash, pack.questions.map { it.answer }, { now },
        { if (id == own) saved = it }, { _, text -> wire.addLast(id to text); UUID.randomUUID().toString() }, {})
    private fun pump() {
        var count = 0
        while (wire.isNotEmpty()) {
            check(++count < 100)
            val (sender, text) = wire.removeFirst()
            val receiver = if (sender == own) remote else local
            receiver.receive(sender, text)
            // Deliberately duplicate every commit, as a retried delivery would.
            if (GameEvent.decode(text).kind == "U") receiver.receive(sender, text)
        }
        render()
    }
    private fun render() {
        rendered.value = LabState(deviceId = own, trusted = listOf(TrustedDevice(friend, "", "Alex")),
            quizQuestions = pack.questions, quizSession = local.session, quizStatus = local.notice,
            quizCanAnswer = local.canAnswer, quizPaused = local.paused)
    }
    private fun start(guest: Boolean) {
        Assume.assumeTrue(Build.HARDWARE in listOf("ranchu", "goldfish"))
        pack = QuizPack.load(context); local = engine(own); remote = engine(friend); render()
        if (guest) { remote.invite(own); pump() }
        ui.setContent {
            val density = LocalDensity.current
            CompositionLocalProvider(LocalDensity provides Density(density.density, if (guest) 1.6f else density.fontScale)) {
                MaterialTheme(colorScheme = LokaColors.scheme) {
                    Surface(color = LokaColors.background, modifier = Modifier.safeDrawingPadding()) {
                        QuickQuizContent(rendered.value,
                            { local.invite(it); pump() }, { local.accept(); pump() }, { local.answer(it); pump() },
                            { local.resume(); pump() }, { local.end(); pump() })
                    }
                }
            }
        }
    }
    private fun tap(text: String) = ui.onNodeWithText(text).performScrollTo().assertIsDisplayed().performClick()
    private fun photo(name: String) {
        ui.waitForIdle()
        ParcelFileDescriptor.AutoCloseInputStream(InstrumentationRegistry.getInstrumentation().uiAutomation
            .executeShellCommand("screencap -p /data/local/tmp/loka-quiz-ui-$name.png")).use { it.readBytes() }
    }
    @Test fun hostInviteScoresDuplicatesAndRecovery() {
        start(false); photo("library")
        tap("Invite Alex")
        ui.onNodeWithText("Waiting for your friend").assertExists(); photo("waiting")
        ui.runOnIdle { remote.accept(); pump() }
        ui.onNodeWithText("Question 1 of 10").assertExists()
        photo("question")
        tap(pack.questions[0].options[pack.questions[0].answer])
        ui.runOnIdle {
            Assert.assertEquals(1, local.session!!.revision)
            now += 91_000; render()
        }
        ui.onNodeWithText("Reconnecting…").assertExists(); photo("reconnecting")
        ui.runOnIdle { local = engine(own).also { it.restore(saved) }; render() }
        tap("Resume / sync")
        for (revision in 1..9) {
            if (revision % 2 == 1) ui.runOnIdle { remote.answer(pack.questions[revision].answer); pump() }
            else tap(pack.questions[revision].options[pack.questions[revision].answer])
        }
        ui.onNodeWithText("Quiz complete!").performScrollTo().assertIsDisplayed()
        ui.onNodeWithText("You 5  •  Alex 5").assertExists(); photo("complete")
        ui.runOnIdle {
            Assert.assertEquals(10, local.session!!.revision)
            Assert.assertEquals(local.session!!.moves, remote.session!!.moves)
        }
        tap("End game"); ui.onNodeWithText("Invite a verified friend").assertExists()
    }
    @Test fun guestAcceptsAndCannotAnswerOthersTurn() {
        start(true); photo("invitation")
        tap("Accept invitation")
        ui.onNodeWithText(pack.questions[0].options[0]).assertIsNotEnabled()
        ui.runOnIdle { remote.answer(pack.questions[0].answer); pump() }
        tap(pack.questions[1].options[pack.questions[1].answer])
        ui.runOnIdle { Assert.assertEquals(2, local.session!!.revision); Assert.assertEquals(listOf(1,1), local.session!!.scores(pack.questions.map { it.answer })) }
        tap("Leave game"); ui.onNodeWithText("Invite a verified friend").assertExists()
    }
}
