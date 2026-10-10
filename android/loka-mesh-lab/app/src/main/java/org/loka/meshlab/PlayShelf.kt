package org.loka.meshlab
import androidx.compose.foundation.*
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.draw.clip
import androidx.compose.ui.Modifier
import androidx.compose.ui.Alignment
import androidx.compose.ui.graphics.*
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.*
@Composable
internal fun PlayShelf(state: LabState, model: LabViewModel, selected:String?, select:(String?)->Unit) {
    androidx.activity.compose.BackHandler(selected!=null){select(null)}
    LaunchedEffect(state.partySession?.phase) { if (state.partySession?.phase == "invited") select("Cards") }
    if (selected == "Cards") { PartyCardsScreen(state, model) { select(null) }; return }
    if (selected == "Quick quiz") {
        Column { TextButton(onClick = { select(null) }) { Text("‹ Pick a game") }; Box(Modifier.weight(1f)) { QuickQuizScreen(state, model) } }; return
    }
    val games = listOf(Triple("Ludo", R.drawable.game_ludo, "2–4 players"), Triple("Cards", R.drawable.game_cards, "2–20 players"), Triple("Chess", R.drawable.game_chess, "2 players"), Triple("Quick quiz", R.drawable.game_quiz, "2 players"))
    Box(Modifier.fillMaxSize(),contentAlignment=Alignment.TopCenter) {
    LazyColumn(modifier=Modifier.widthIn(max=720.dp),contentPadding = PaddingValues(16.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
        item { Text("Let’s play", fontFamily = LokaDisplay.font, fontSize = 32.sp); Text("Games are better together.", color = LokaColors.muted) }
        item {
            Column(Modifier.fillMaxWidth().clip(RoundedCornerShape(28.dp)).background(Brush.linearGradient(listOf(Color(0xFF6024D5), Color(0xFF8A35F4)))).padding(18.dp)) {
                Text("Play together,\nright here.", color = Color.White, fontFamily = LokaDisplay.font, fontSize = 26.sp)
                Spacer(Modifier.height(8.dp))
                Text("Fun party games with people nearby.", color = Color(0xFFECDFFF), fontSize = 13.sp, lineHeight = 18.sp)
                Spacer(Modifier.height(12.dp))
                Text("INVITE SOMEONE NEARBY", color = Color(0xFF321045), fontSize = 12.sp, fontWeight = FontWeight.Bold,
                    modifier = Modifier.clickable { select("Cards") }.clip(RoundedCornerShape(16.dp)).background(LokaColors.yellow).padding(horizontal = 16.dp, vertical = 10.dp))
            }
        }
        item { Text("Pick a game", fontFamily = LokaDisplay.font, fontSize = 22.sp); Text("Play together nearby. No Internet needed on a usable local connection.", color = LokaColors.muted, fontSize = 13.sp) }
        games.chunked(2).forEach { row -> item {
            Row(horizontalArrangement = Arrangement.spacedBy(14.dp)) {
                row.forEach { (title, art, players) ->
                    Column(Modifier.weight(1f).clickable(enabled = title in listOf("Cards", "Quick quiz")) { select(title) }.clip(RoundedCornerShape(22.dp)).background(LokaColors.surface).border(3.dp, when(title) { "Ludo" -> LokaColors.yellow; "Cards" -> Color(0xFFF26486); "Chess" -> LokaColors.mintAccent; else -> Color(0xFF9380FF) }, RoundedCornerShape(22.dp))) {
                        Image(androidx.compose.ui.res.painterResource(art), null, Modifier.fillMaxWidth().height(72.dp).padding(8.dp), contentScale = androidx.compose.ui.layout.ContentScale.Fit)
                        Column(Modifier.padding(10.dp)) { Text(title, fontWeight = FontWeight.Bold); Text(players, color = LokaColors.muted, fontSize = 12.sp); Text(if (title in listOf("Cards", "Quick quiz")) "Play ›" else "Coming soon", color = LokaColors.green, fontSize = 12.sp) }
                    }
                }
            }
        } }
    }
    }
}

