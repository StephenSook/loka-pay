package org.loka.meshlab

import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.*
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.Alignment
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp

@Composable
internal fun QuickQuizScreen(state: LabState, model: LabViewModel) {
    QuickQuizContent(state, model::inviteQuiz, model::acceptQuiz, model::answerQuiz, model::resumeQuiz, model::endQuiz)
}

/** Same presentation used by the app and native UI tests; networking stays in the owner. */
@Composable
internal fun QuickQuizContent(state: LabState, invite: (String) -> Unit, accept: () -> Unit, answer: (Int) -> Unit, resume: () -> Unit, end: () -> Unit) {
    val session = state.quizSession
    Column(Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(24.dp), verticalArrangement = Arrangement.spacedBy(16.dp), horizontalAlignment = Alignment.CenterHorizontally) {
        Column(Modifier.widthIn(max = 720.dp).fillMaxWidth(), verticalArrangement = Arrangement.spacedBy(16.dp)) {
            Text("Let’s play", fontFamily = LokaDisplay.font, fontSize = 32.sp, fontWeight = FontWeight.ExtraBold)
            Text("Good company. Great stories.", color = LokaColors.muted)
            Surface(color = LokaColors.mint, shape = RoundedCornerShape(26.dp)) {
                Column(Modifier.fillMaxWidth().padding(24.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
                    Image(painterResource(R.drawable.game_quiz), null, Modifier.height(110.dp).align(Alignment.CenterHorizontally))
                    Text("Quick Quiz", fontFamily = LokaDisplay.font, fontSize = 28.sp, fontWeight = FontWeight.Bold)
                    Text("2 players · Untimed · 10 questions")
                    Text("No Internet needed when LOKA has a usable local connection.", color = LokaColors.muted)
                }
            }
            Text(if (session?.phase == "active" && state.quizPaused) "Reconnecting…" else state.quizStatus, color = LokaColors.green, fontWeight = FontWeight.Bold)
            if (session == null || session.phase == "ended") {
                Text("Invite a verified friend", fontSize = 20.sp, fontWeight = FontWeight.Bold)
                if (state.trusted.isEmpty()) Text("Add and verify a friend in Nearby before inviting them.", color = LokaColors.muted)
                state.trusted.forEach { friend ->
                    OutlinedButton(onClick = { invite(friend.id) }, enabled = state.quizQuestions.isNotEmpty(), modifier = Modifier.fillMaxWidth()) { Text("Invite ${friend.name.ifBlank { "LOKA friend" }}") }
                }
                Text("Party cards", fontSize = 20.sp, fontWeight = FontWeight.Bold)
                Text("The party catalog is prepared. Multiplayer party cards are coming later.", color = LokaColors.muted)
            } else {
                val friendID = if (session.host == state.deviceId) session.guest else session.host
                val name = state.trusted.firstOrNull { it.id == friendID }?.name?.ifBlank { "Your friend" } ?: "Your friend"
                Text("Playing with $name")
                if (session.phase == "invited") {
                    Button(onClick = accept, modifier = Modifier.fillMaxWidth()) { Text("Accept invitation") }
                }
                if (session.phase == "active") {
                    val scores = session.scores(state.quizQuestions.map { it.answer })
                    val mine = if (session.host == state.deviceId) 0 else 1
                    Text("You ${scores[mine]}  •  $name ${scores[1 - mine]}", fontSize = 20.sp, fontWeight = FontWeight.Bold)
                    if (session.revision < state.quizQuestions.size) {
                        val q = state.quizQuestions[session.revision]
                        Surface(color = LokaColors.mint, shape = RoundedCornerShape(24.dp)) {
                            Column(Modifier.fillMaxWidth().padding(24.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
                                Text("Question ${session.revision + 1} of ${state.quizQuestions.size}", color = LokaColors.muted)
                                Text(q.text, fontFamily = LokaDisplay.font, fontSize = 24.sp, fontWeight = FontWeight.Bold)
                                q.options.forEachIndexed { index, option -> OutlinedButton(onClick = { answer(index) }, enabled = state.quizCanAnswer, modifier = Modifier.fillMaxWidth()) { Text(option) } }
                            }
                        }
                    } else Text("Quiz complete!", fontSize = 26.sp, fontWeight = FontWeight.Bold)
                }
                if (session.phase in listOf("active", "joining")) OutlinedButton(onClick = resume, modifier = Modifier.fillMaxWidth()) { Text("Resume / sync") }
                TextButton(onClick = end) { Text(if (session.host == state.deviceId) "End game" else "Leave game") }
            }
        }
    }
}
