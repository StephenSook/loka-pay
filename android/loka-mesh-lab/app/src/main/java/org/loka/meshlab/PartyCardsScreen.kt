package org.loka.meshlab

import androidx.compose.foundation.*
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.Alignment
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalView
import androidx.compose.ui.platform.LocalSoftwareKeyboardController
import androidx.compose.ui.draw.clipToBounds
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.*
import androidx.compose.ui.semantics.*
import androidx.compose.ui.draw.rotate
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.luminance
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.layout.ContentScale
import org.loka.core.playRule
import org.loka.core.CardBirthday
import androidx.compose.animation.AnimatedVisibility
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.ui.text.input.TextFieldValue
import androidx.compose.ui.text.TextRange
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.input.VisualTransformation
import androidx.compose.ui.text.input.TransformedText
import androidx.compose.ui.text.input.OffsetMapping
import androidx.compose.ui.text.AnnotatedString
import org.loka.core.CardPacks
import org.loka.core.LocalCardSession
import org.loka.core.CardAudience
import org.loka.core.PartySettings
import java.time.LocalDate
import java.time.format.DateTimeFormatter
import java.time.format.ResolverStyle

internal data class PartyUiActions(val invite:(List<String>,PartySettings)->Unit,val accept:()->Unit,val move:(String)->Unit,val resume:()->Unit,val end:()->Unit)
@Composable internal fun PartyCardsScreen(state:LabState,model:LabViewModel,back:()->Unit) {
    var nearby by remember { mutableStateOf(false) }
    if(nearby || state.partySession?.phase in listOf("invited","joining","lobby","active")) PartyCardsContent(state,PartyUiActions(model::inviteCards,model::acceptCards,model::cardAction,model::resumeCards,model::endCards),{nearby=false;back()})
    else FilteredCardsContent(state.partyGames.flatMap{it.cards},back,{nearby=true})
}
@Composable internal fun PartyCardsContent(state:LabState,actions:PartyUiActions,back:()->Unit) {
    val context=LocalContext.current
    val prefs=remember{context.getSharedPreferences("loka-party-preferences",0)}
    var ageConfirmed by remember{mutableStateOf(prefs.getBoolean("adult-confirmed",false))}
    var drinkingAge by remember{mutableStateOf(context.getSharedPreferences("loka-card-eligibility",0).getBoolean("21",false))}
    var birthday by remember{mutableStateOf("")}
    var page by remember{mutableStateOf("vibe")}
    var intensity by remember{mutableStateOf("clean")}
    var mode by remember{mutableStateOf("friends")}
    var count by remember{mutableIntStateOf(2)}
    var consent by remember{mutableStateOf(false)}
    var drinking by remember{mutableStateOf(false)}
    var search by remember{mutableStateOf("")}
    var chosen by remember{mutableStateOf<PartyGame?>(null)}
    var selected by remember{mutableStateOf<List<String>>(emptyList())}
    var settingsOpen by remember{mutableStateOf(false)}
    var ask by remember{mutableStateOf(true)}
    var confirmation by remember{mutableStateOf(false)}
    val session=state.partySession?.takeIf{it.phase!="ended"}
    fun name(id:String)=if(id==state.deviceId)"You" else state.nearbyPeople.firstOrNull{it.id==id}?.name?.ifBlank{"Player"} ?: state.trusted.firstOrNull{it.id==id}?.name?.ifBlank{"Player"} ?: "Player ${session?.members?.indexOf(id)?.plus(1) ?: ""}"
    fun eligible(game:PartyGame)=game.cards.filter{mode in it.modes && count in it.min..it.max && (intensity=="all" || it.intensity==intensity) && (consent || !it.consent) && (!it.alcohol || drinking) && (!it.adult || intensity!="clean")}
    fun invite(){chosen?.let{actions.invite(selected,PartySettings(it.id,mode,intensity,consent,drinking))}}
    if(confirmation)AlertDialog(onDismissRequest={confirmation=false},title={Text("Ready to play?")},text={Text("${chosen?.name} · $count players · ${intensity.replaceFirstChar{it.uppercase()}}. Everyone accepts before the first card.")},confirmButton={TextButton(onClick={confirmation=false;invite()}){Text("Invite players")}},dismissButton={TextButton(onClick={confirmation=false}){Text("Cancel")}})
    Column(Modifier.fillMaxSize().background(LokaColors.background)) {
        Row(Modifier.fillMaxWidth().padding(horizontal=16.dp,vertical=8.dp),verticalAlignment=Alignment.CenterVertically) {
            TextButton(onClick={when { settingsOpen->settingsOpen=false;session!=null->back();page=="players"->page="library";page=="library"->page="vibe";else->back() }}){Text("‹ Back")}
            Text(if(settingsOpen)"Game settings" else session?.let{state.partyGames.firstOrNull{g->g.id==it.settings.game}?.name} ?: if(page=="vibe")"Choose your vibe" else "Party cards",fontFamily=LokaDisplay.font,fontSize=22.sp,modifier=Modifier.weight(1f))
            if(ageConfirmed)TextButton(onClick={settingsOpen=!settingsOpen},modifier=Modifier.semantics { contentDescription="Game settings" }){Text("⚙")}
        }
        Column(Modifier.weight(1f).verticalScroll(remember(page,settingsOpen,session?.id) { ScrollState(0) }).padding(24.dp).widthIn(max=720.dp).align(Alignment.CenterHorizontally),verticalArrangement=Arrangement.spacedBy(18.dp)) {
            state.partyError?.let { Text(it,color=MaterialTheme.colorScheme.error) }
            if(session==null && state.partySession?.phase=="ended" && state.partyStatus.contains("expired"))Text(state.partyStatus,color=LokaColors.muted)
            if(!ageConfirmed || (session?.settings?.drinking==true && !drinkingAge)) {
                Text("Before we play",fontFamily=LokaDisplay.font,fontSize=34.sp)
                Text("You must be 18 or older to play these party games.",color=LokaColors.muted)
                OutlinedTextField(value=birthday,onValueChange={birthday=CardBirthday.format(it)},label={Text("Date of birth · DD/MM/YYYY")},singleLine=true,modifier=Modifier.fillMaxWidth())
                Text("Your date stays on this screen. Only your age confirmation is saved on this device.",color=LokaColors.muted,fontSize=13.sp)
                val valid=runCatching{val date=LocalDate.parse(birthday,DateTimeFormatter.ofPattern("dd/MM/uuuu").withResolverStyle(ResolverStyle.STRICT));date<=LocalDate.now().minusYears(if(session?.settings?.drinking==true)21 else 18) && date>=LocalDate.of(1900,1,1)}.getOrDefault(false)
                Button(onClick={prefs.edit().putBoolean("adult-confirmed",true).apply();ageConfirmed=true;drinkingAge=runCatching{LocalDate.parse(birthday,DateTimeFormatter.ofPattern("dd/MM/uuuu").withResolverStyle(ResolverStyle.STRICT))<=LocalDate.now().minusYears(21)}.getOrDefault(false);context.getSharedPreferences("loka-card-eligibility",0).edit().putBoolean("18",true).putBoolean("21",drinkingAge).apply();birthday=""},enabled=valid,modifier=Modifier.fillMaxWidth()){Text("Confirm age")}
                Text("Adult themes. Skipping is always okay.",color=LokaColors.muted)
            } else if(settingsOpen) {
                Text("Intensity",fontWeight=FontWeight.Bold)
                PartyChips(listOf("clean","flirty","all"),intensity){intensity=it}
                Text("Players",fontWeight=FontWeight.Bold)
                PartyChips(listOf("2","3","4"),count.toString()){count=it.toInt();mode=if(count==2)"friends" else "group";selected=emptyList()}
                Row(verticalAlignment=Alignment.CenterVertically){Text("Ask before each game",Modifier.weight(1f));Switch(checked=ask,onCheckedChange={ask=it})}
                Row(verticalAlignment=Alignment.CenterVertically){Text("Show only clean cards",Modifier.weight(1f));Switch(checked=intensity=="clean",onCheckedChange={intensity=if(it)"clean" else "all"})}
                Row(verticalAlignment=Alignment.CenterVertically){Text("Allow consent dares",Modifier.weight(1f));Switch(checked=consent,onCheckedChange={consent=it})}
                Text(if(session!=null)"These settings apply to your next round. Everyone will accept the new invitation." else "Filter changes apply to your next card game.",color=LokaColors.muted)
                Button(onClick={settingsOpen=false;if(session==null)page="library"},modifier=Modifier.fillMaxWidth()){Text("Apply settings")}
            } else if(session!=null) {
                Text(if(state.partyPaused && session.phase in listOf("active","complete"))"Reconnecting…" else state.partyStatus,color=LokaColors.green,fontWeight=FontWeight.Bold)
                PartyChips(listOf(session.settings.intensity,if(session.members.size==2)"2 Players" else "Group"),session.settings.intensity){}
                Text(session.members.joinToString(" · "){name(it)},color=LokaColors.muted)
                when(session.phase) {
                    "invited"->{Text("${name(session.host)} invited you. ${session.members.size} players; ${session.settings.intensity} cards. You can skip any card.");Text("Consent dares: ${if(session.settings.consent)"Included" else "Off"}",color=LokaColors.muted);Button(onClick=actions.accept,modifier=Modifier.fillMaxWidth()){Text("Accept invitation")};OutlinedButton(onClick=actions.end,modifier=Modifier.fillMaxWidth()){Text("Decline")}}
                    "lobby","joining"->{Text("Waiting for players · ${session.accepted.size}/${session.members.size}",fontFamily=LokaDisplay.font,fontSize=26.sp);session.members.forEach{Text("${name(it)} · ${if(it in session.accepted)"Ready" else "Inviting…"}")}}
                    "active"->{
                        Text("${name(session.turn)}’s turn",fontFamily=LokaDisplay.font,fontSize=28.sp)
                        val nextId=session.members[(session.revision+1)%session.members.size]
                        Row(Modifier.fillMaxWidth(),horizontalArrangement=Arrangement.SpaceBetween) {
                            listOf(session.turn to "Playing",nextId to "Up next").forEach{(id,label)->Row(verticalAlignment=Alignment.CenterVertically,horizontalArrangement=Arrangement.spacedBy(8.dp)) {
                                ProfilePortrait(name(id),Modifier.size(42.dp),own=id==state.deviceId,avatarID=state.nearbyPeople.firstOrNull{it.id==id}?.avatarID,peerID=id)
                                Column{Text(label,color=LokaColors.muted,fontSize=12.sp);Text(name(id),fontWeight=FontWeight.Bold)}
                            }}
                        }
                        state.partyCard?.let{Text(it.gameName,fontFamily=LokaDisplay.font,fontSize=26.sp,color=Color(0xFFFFD466));CardGraphic(it,440.dp,mode=session.settings.mode);Text(it.playRule(session.settings.mode),color=LokaColors.muted);Text("Card ${session.revision+1}",color=LokaColors.muted,fontSize=12.sp)} ?: Text("Synchronizing card…")
                        Text("Play your way. Skipping is always okay.",color=LokaColors.muted)
                        Button(onClick={actions.move("done")},enabled=state.partyCanAct,modifier=Modifier.fillMaxWidth()){Text("Done / Next")}
                        Row(horizontalArrangement=Arrangement.spacedBy(12.dp)) {
                            OutlinedButton(onClick={actions.move("skip")},enabled=state.partyCanAct,modifier=Modifier.weight(1f)){Text("Skip")}
                        }
                        TextButton(onClick={actions.move("shuffle")},enabled=state.partyCanAct,modifier=Modifier.fillMaxWidth()){Text("Shuffle")}
                    }
                    "complete"->{Text("Round complete!",fontFamily=LokaDisplay.font,fontSize=30.sp);Text("${session.revision} cards played. Pick another game or play again.")}
                }
                if(session.phase in listOf("active","joining","complete"))OutlinedButton(onClick=actions.resume,modifier=Modifier.fillMaxWidth()){Text("Resume / sync")}
                TextButton(onClick={actions.end();chosen=null;page="library"},modifier=Modifier.fillMaxWidth()){Text(if(session.host==state.deviceId)"End game" else "Leave game")}
            } else if(page=="vibe") {
                Text("Good company. Great stories.",color=LokaColors.muted)
                listOf("clean" to "Just for fun · No sexual content","flirty" to "Mild & cheeky · Light teasing").forEach{(id,caption)->
                    Surface(onClick={intensity=id},shape=RoundedCornerShape(24.dp),color=if(intensity==id)LokaColors.mint else LokaColors.surface,border=BorderStroke(1.dp,if(intensity==id)LokaColors.mintAccent else LokaColors.line),modifier=Modifier.fillMaxWidth()) {
                        Column(Modifier.padding(24.dp)){Text(id.replaceFirstChar{it.uppercase()}+if(intensity==id)" ✓" else "",fontFamily=LokaDisplay.font,fontSize=26.sp);Text(caption,color=LokaColors.muted)}
                    }
                }
                Text("How many players?",fontWeight=FontWeight.Bold)
                PartyChips(listOf("2 Players","Group"),if(count==2)"2 Players" else "Group"){count=if(it=="Group")3 else 2;mode=if(count==2)"friends" else "group";selected=emptyList()}
                if(count==2)PartyChips(listOf("Two people","Couple"),if(mode=="couples")"Couple" else "Two people"){mode=if(it=="Couple")"couples" else "friends"}
                else PartyChips(listOf("3","4"),count.toString()){count=it.toInt();selected=emptyList()}
                Text("Up to 4 devices per nearby session. Friendship is not required.",color=LokaColors.muted,fontSize=13.sp)
                Button(onClick={page="library"},enabled=state.partyGames.isNotEmpty(),modifier=Modifier.fillMaxWidth()){Text("Browse games")}
                if(state.partyGames.isEmpty())Text(state.partyStatus,color=LokaColors.muted)
            } else if(page=="library") {
                OutlinedTextField(value=search,onValueChange={search=it},label={Text("Find a game")},modifier=Modifier.fillMaxWidth())
                Text("Intensity",fontWeight=FontWeight.Bold);PartyChips(listOf("clean","flirty","all"),intensity){intensity=it}
                Text("Players",fontWeight=FontWeight.Bold);PartyChips(listOf("2 Players","Group"),if(count==2)"2 Players" else "Group"){count=if(it=="Group")3 else 2;mode=if(count==2)"friends" else "group";selected=emptyList()}
                val games=state.partyGames.filter{it.name.contains(search,true) && eligible(it).isNotEmpty()}
                if(games.isEmpty())Text("No cards match. Change your filters to see more games.")
                games.chunked(2).forEach { row -> Row(horizontalArrangement=Arrangement.spacedBy(12.dp)) {
                    row.forEach{g->Surface(shape=RoundedCornerShape(24.dp),color=LokaColors.mint,modifier=Modifier.weight(1f)) {
                        Column(Modifier.padding(14.dp),verticalArrangement=Arrangement.spacedBy(8.dp)) {
                            Text(g.name,fontFamily=LokaDisplay.font,fontSize=18.sp,maxLines=2,modifier=Modifier.heightIn(min=44.dp))
                            PartyDeckArt(g.id)
                            Text("$count players · ${intensity.replaceFirstChar{it.uppercase()}}",fontSize=12.sp,color=LokaColors.muted)
                            Text("${eligible(g).size} cards",fontSize=12.sp)
                            OutlinedButton(onClick={chosen=g;selected=emptyList();page="players"},modifier=Modifier.fillMaxWidth().semantics { contentDescription="Play ${g.name}" }){Text("Play")}
                        }
                    }}
                    if(row.size==1)Spacer(Modifier.weight(1f))
                }}
            } else {
                Text(chosen?.name ?: "Choose players",fontFamily=LokaDisplay.font,fontSize=28.sp)
                Text(chosen?.instructions?.get(mode) ?: "",color=LokaColors.muted)
                Text("Invite ${count-1} nearby ${if(count==2)"person" else "people"}",fontWeight=FontWeight.Bold)
                val nearby=state.nearbyPeople.distinctBy{it.id}.filter{it.id!=state.deviceId}
                if(nearby.isEmpty())Text("Waiting for someone nearby. Keep LOKA open on both devices.",color=LokaColors.muted)
                nearby.forEach{person->OutlinedButton(onClick={selected=if(person.id in selected)selected-person.id else if(selected.size<count-1)selected+person.id else selected},modifier=Modifier.fillMaxWidth()){Text("${if(person.id in selected)"✓ " else ""}${person.name.ifBlank{"Nearby player"}}")}}
                Text("${selected.size}/${count-1} selected · Everyone accepts before play",color=LokaColors.muted)
                Button(onClick={if(ask)confirmation=true else invite()},enabled=selected.size==count-1,modifier=Modifier.fillMaxWidth()){Text("Invite to play")}
                Text("Inviting someone to a game does not add them to your contacts.",fontSize=13.sp,color=LokaColors.muted)
            }
        }
    }
}
@Composable private fun PartyChips(values:List<String>,selected:String,change:(String)->Unit) {
    Row(Modifier.fillMaxWidth().horizontalScroll(rememberScrollState()),horizontalArrangement=Arrangement.spacedBy(8.dp)) {
        values.distinct().forEach{value->FilterChip(selected=value==selected,onClick={change(value)},label={Text(value.replaceFirstChar{it.uppercase()})})}
    }
}

@Composable private fun PartyDeckArt(id:String) {
    Box(Modifier.fillMaxWidth().height(54.dp).clearAndSetSemantics {},contentAlignment=Alignment.Center) {
        Box(Modifier.offset(x=(-24).dp).rotate(-15f).size(42.dp,48.dp).background(Color(0xFFFFCC52),RoundedCornerShape(10.dp)))
        Box(Modifier.offset(x=24.dp).rotate(15f).size(42.dp,48.dp).background(Color(0xFFF28CAF),RoundedCornerShape(10.dp)))
        Box(Modifier.size(44.dp,52.dp).background(Color(0xFFD6B3FF),RoundedCornerShape(10.dp)),contentAlignment=Alignment.Center) {
            Text(when(id){"never_have_i_ever"->"?";"truth_or_drink"->"♥";"whos_most_likely_to"->"♛";"hot_seat"->"♜";"two_player_specials"->"♡";else->"✦"},fontSize=28.sp,fontWeight=FontWeight.Bold,color=Color(0xFF301045))
        }
    }
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable internal fun FilteredCardsContent(cards:List<org.loka.core.PartyCard>,back:()->Unit,nearby:()->Unit) {
    val prefs=LocalContext.current.getSharedPreferences("loka-card-eligibility",0)
    var adult by remember { mutableStateOf(prefs.getBoolean("18",false)) }
    var drinking by remember { mutableStateOf(prefs.getBoolean("21",false)) }
    val context=LocalContext.current
    val session=remember(cards){LocalCardSession(cards)}
    val deck=session.deck
    val storage=remember(cards){LocalCardStorage(context.getSharedPreferences("loka-cards-session",0),cards)}
    var saved by remember(cards){mutableStateOf(storage.load(cards,adult,drinking))}
    var selectedPack by remember {mutableStateOf("all")}
    var draftPack by remember {mutableStateOf("all")}
    var roundTurns by remember {mutableIntStateOf(1)}
    var handoff by remember {mutableStateOf(true)}
    var sound by remember {mutableStateOf(false)}
    var optionsOpen by remember {mutableStateOf(false)}
    var editingNames by remember {mutableStateOf(false)}
    var nameList by remember {mutableStateOf("")}
    var nameListError by remember {mutableStateOf("")}
    var revision by remember { mutableIntStateOf(0) }
    var playing by remember { mutableStateOf(false) }
    var shuffleRevision by remember { mutableIntStateOf(0) }
    var motionBusy by remember { mutableStateOf(false) }
    var dealPending by remember { mutableStateOf(true) }
    var skipRequest by remember { mutableIntStateOf(0) }
    var rulesOpen by remember { mutableStateOf(false) }
    var namesOpen by remember { mutableStateOf(false) }
    val playerNames=session.names
    var draftNames by remember { mutableStateOf(emptyList<String>()) }
    val playerTurn=session.turn
    var selected by remember { mutableStateOf(setOf("clean")) }
    var draft by remember { mutableStateOf(setOf("clean")) }
    var selectedAudience by remember { mutableStateOf<CardAudience?>(null) }
    var draftAudience by remember { mutableStateOf<CardAudience?>(null) }
    var filtersOpen by remember { mutableStateOf(false) }
    var ageOpen by remember { mutableStateOf(false) }
    var birthdayChosen by remember { mutableStateOf(false) }
    var birthdayDate by remember { mutableStateOf(LocalDate.now()) }
    val birthday=birthdayDate.format(DateTimeFormatter.ofPattern("ddMMuuuu"))
    val hapticView=LocalView.current
    val keyboard=LocalSoftwareKeyboardController.current
    var rejected by remember { mutableStateOf(false) }
    var unavailable by remember { mutableStateOf(emptySet<String>()) }
    val dark=LokaColors.background.luminance()<0.3f
    val screenText=if(dark)Color.White else Color(0xFF240B30)
    val muted=if(dark)Color(0xFFE9D8FF) else Color(0xFF71557F)
    val plum=if(dark)Color(0xFF210D29) else Color(0xFFF7F1FC);val lavender=Color(0xFFE9D8FF);val mint=Color(0xFFAAF0C9);val coral=Color(0xFFFF91A4);val ink=Color(0xFF240B30)

    fun namesValid(names:List<String>,count:Int)=LocalCardSession.validNames(names,count)
    fun persist(){storage.save(session);saved=session.frame() to session.previous}
    fun pause(){session.pause();dealPending=false;persist();revision++}
    fun restore(){val value=saved ?: return;runCatching{session.restore(value.first,adult,drinking,value.second);session.resume();dealPending=false;selected=deck.filters;selectedAudience=deck.audience;selectedPack=deck.pack;roundTurns=session.roundTurns;handoff=session.handoff;sound=session.sound;draftNames=session.names;playing=true;revision++;persist()}.onFailure{storage.clear();saved=null}}
    fun reveal(){session.reveal();hapticView.performHapticFeedback(android.view.HapticFeedbackConstants.VIRTUAL_KEY);if(session.sound)hapticView.playSoundEffect(android.view.SoundEffectConstants.CLICK);persist();revision++}
    fun advance(){if(!session.paused && !session.finished && session.revealed){hapticView.performHapticFeedback(android.view.HapticFeedbackConstants.VIRTUAL_KEY);session.advance(adult,drinking);persist();revision++}}
    fun apply(value:Set<String>){val audience=draftAudience ?: return;if(!audience.valid)return
        session.configure(value,adult,drinking,audience,draftNames,draftPack,roundTurns,handoff,sound);selected=value;selectedAudience=audience;selectedPack=draftPack;dealPending=true;revision++;shuffleRevision++;playing=true;filtersOpen=false;ageOpen=false;persist()
    }
    fun request(value:Set<String>,audience:CardAudience?){if(value.isEmpty() || audience?.valid!=true)return;draft=value;draftAudience=audience;if(!namesValid(draftNames,audience.players)){draftNames=List(audience.players){draftNames.getOrNull(it) ?: playerNames.getOrNull(it) ?: ""};nameList="";nameListError="";filtersOpen=false;namesOpen=true;return};if(("dirty" in value && !adult) || ("drinking" in value && !drinking)){filtersOpen=false;ageOpen=true;rejected=false;birthdayChosen=false;birthdayDate=LocalDate.now()}else apply(value)}
    fun canStart(categories:Set<String>,audience:CardAudience?,pack:String)=audience?.valid==true && deck.eligible(categories,true,true,audience,pack).isNotEmpty()
    @Composable fun matchingCards(categories:Set<String>,audience:CardAudience?,pack:String) {
        if(audience?.valid==true){val matches=deck.eligible(categories,true,true,audience,pack);val count=matches.size;val remaining=matches.count{it.id !in deck.shown};Text(if(count==0)"No cards match. Change the pack, categories or player setup." else "$count matching cards · $remaining unseen",color=muted,fontSize=13.sp)
            if(count>0 && roundTurns>0 && remaining<audience.players*roundTurns)Text("This selection has $remaining unused cards. A full round needs ${audience.players*roundTurns}. Try All packs or add a category; this deck will end early.",color=muted,fontSize=13.sp)
        }
    }
    @Composable fun packChoices(value:String,change:(String)->Unit) {
        Text("Question packs",fontFamily=LokaDisplay.font,fontSize=24.sp,color=screenText)
        Row(Modifier.fillMaxWidth().horizontalScroll(rememberScrollState()),horizontalArrangement=Arrangement.spacedBy(8.dp)) {
            CardPacks.labels.forEach{(id,label)->FilterChip(selected=value==id,onClick={change(id)},label={Text(label+if(value==id)" ✓" else "")},border=BorderStroke(1.dp,muted),colors=FilterChipDefaults.filterChipColors(containerColor=if(dark)Color(0xFF3B2343) else Color(0xFFF0E7FA),labelColor=screenText,selectedContainerColor=lavender,selectedLabelColor=ink),modifier=Modifier.testTag("card-pack-$id"))}
        }
    }
    @Composable fun roundChoices() {
        Text("Make it your round",fontFamily=LokaDisplay.font,fontSize=24.sp,color=screenText)
        Row(Modifier.fillMaxWidth().horizontalScroll(rememberScrollState()),horizontalArrangement=Arrangement.spacedBy(8.dp)) {
            listOf(1 to "Quick round",2 to "Longer round",0 to "Open-ended").forEach{(value,label)->FilterChip(selected=roundTurns==value,onClick={roundTurns=value},label={Text(label+if(roundTurns==value)" ✓" else "")},border=BorderStroke(1.dp,muted),colors=FilterChipDefaults.filterChipColors(containerColor=if(dark)Color(0xFF3B2343) else Color(0xFFF0E7FA),labelColor=screenText,selectedContainerColor=lavender,selectedLabelColor=ink),modifier=Modifier.testTag("card-round-$value"))}
        }
        Text(when(roundTurns){1->"One turn for everyone.";2->"Two turns for everyone.";else->"Keep playing until you’re ready to stop."},color=muted,fontSize=13.sp)
        Row(verticalAlignment=Alignment.CenterVertically){Text("Pass phone, then reveal",color=screenText,modifier=Modifier.weight(1f));Switch(checked=handoff,onCheckedChange={handoff=it},modifier=Modifier.testTag("card-handoff-toggle"))}
        Row(verticalAlignment=Alignment.CenterVertically){Text("Card sounds",color=screenText,modifier=Modifier.weight(1f));Switch(checked=sound,onCheckedChange={sound=it})}
    }
    val lifecycle=androidx.lifecycle.compose.LocalLifecycleOwner.current.lifecycle
    val latestPause by rememberUpdatedState({if(playing && session.names.isNotEmpty())pause()})
    DisposableEffect(lifecycle){val observer=androidx.lifecycle.LifecycleEventObserver{_,event->if(event==androidx.lifecycle.Lifecycle.Event.ON_STOP)latestPause()};lifecycle.addObserver(observer);onDispose{lifecycle.removeObserver(observer)}}
    // Session model changes are projected through the native screen revision.
    @Suppress("UNUSED_VARIABLE") val sessionRevision=revision
    @Composable fun audienceRows(value:CardAudience?,change:(CardAudience)->Unit) {
        Column(Modifier.fillMaxWidth(),verticalArrangement=Arrangement.spacedBy(12.dp)) {
            Text("Who’s playing?",fontFamily=LokaDisplay.font,fontSize=24.sp,color=screenText)
            Row(Modifier.height(IntrinsicSize.Min),horizontalArrangement=Arrangement.spacedBy(8.dp)) {
                listOf("friends","couples","group").forEach{mode->
                    val title=when(mode){"friends"->"Two friends";"couples"->"A couple";else->"A group"}
                    val checked=value?.mode==mode
                    Surface(onClick={change(CardAudience(if(mode=="group")maxOf(3,value?.players ?: 4) else 2,mode))},shape=RoundedCornerShape(14.dp),color=if(checked)lavender else if(dark)Color(0xFF3B2343) else Color(0xFFF0E7FA),border=BorderStroke(1.5.dp,if(checked)ink else muted),modifier=Modifier.weight(1f).fillMaxHeight().semantics{this.selected=checked}) {
                        Box(Modifier.heightIn(min=44.dp).padding(8.dp),contentAlignment=Alignment.Center){Text(title,color=if(checked)ink else screenText,fontSize=14.sp,fontWeight=FontWeight.Bold,textAlign=androidx.compose.ui.text.style.TextAlign.Center)}
                    }
                }
            }
            if(value?.mode=="group")Row(Modifier.fillMaxWidth(),verticalAlignment=Alignment.CenterVertically) {
                Text("Players: ${value.players}",color=screenText,modifier=Modifier.weight(1f))
                OutlinedButton(onClick={change(value.copy(players=value.players-1))},enabled=value.players>3,modifier=Modifier.semantics{contentDescription="Fewer players"}){Text("−")}
                Spacer(Modifier.width(8.dp))
                OutlinedButton(onClick={change(value.copy(players=value.players+1))},enabled=value.players<20,modifier=Modifier.semantics{contentDescription="More players"}){Text("+")}
            }
        }
    }
    @Composable fun rows(value:Set<String>,change:(Set<String>)->Unit) {
        listOf("clean").forEach { category ->
            val checked=category in value
            val color=when(category){"clean"->mint;"dirty"->coral;else->lavender}
            Surface(onClick={if(category !in unavailable)change(if(checked)value-category else value+category)},enabled=category !in unavailable,shape=RoundedCornerShape(24.dp),color=if(checked)color else if(dark)Color(0xFF3B2343) else Color(0xFFF0E7FA),border=BorderStroke(1.5.dp,if(checked)ink.copy(alpha=0.5f) else muted),modifier=Modifier.fillMaxWidth().semantics{this.selected=checked;contentDescription=category.replaceFirstChar{it.uppercase()}+if(checked)" selected" else " not selected"}) {
                Row(Modifier.padding(20.dp),verticalAlignment=Alignment.CenterVertically) {
                    Image(painterResource(mascotArt(category)),null,Modifier.size(52.dp),contentScale=ContentScale.Fit)
                    Column(Modifier.weight(1f).padding(horizontal=14.dp)){Text(category.replaceFirstChar{it.uppercase()},fontFamily=LokaDisplay.font,fontSize=25.sp,color=if(checked)ink else screenText);Text(when(category){"clean"->"Lighthearted fun.";"drinking"->"For a livelier night. · 21+";else->"Bolder questions. · 18+"},color=if(checked)ink else muted,fontSize=13.sp)}
                    Box(Modifier.size(28.dp).background(if(checked)ink else Color.Transparent,androidx.compose.foundation.shape.CircleShape).border(2.dp,if(checked)ink else muted,androidx.compose.foundation.shape.CircleShape),contentAlignment=Alignment.Center) {
                        if(checked)Canvas(Modifier.size(18.dp)){drawLine(Color.White,androidx.compose.ui.geometry.Offset(size.width*0.18f,size.height*0.52f),androidx.compose.ui.geometry.Offset(size.width*0.42f,size.height*0.75f),2.dp.toPx(),cap=androidx.compose.ui.graphics.StrokeCap.Round);drawLine(Color.White,androidx.compose.ui.geometry.Offset(size.width*0.42f,size.height*0.75f),androidx.compose.ui.geometry.Offset(size.width*0.84f,size.height*0.24f),2.dp.toPx(),cap=androidx.compose.ui.graphics.StrokeCap.Round)}
                    }
                }
            }
        }
    }
    Box(Modifier.fillMaxSize().background(androidx.compose.ui.graphics.Brush.radialGradient(if(dark)listOf(Color(0xFF321739),plum,Color(0xFF120815)) else listOf(Color.White,plum,Color(0xFFEEE3F7)))),contentAlignment=Alignment.TopCenter) {
    Column(Modifier.widthIn(max=720.dp).fillMaxSize().padding(horizontal=18.dp),verticalArrangement=Arrangement.spacedBy(12.dp),horizontalAlignment=Alignment.CenterHorizontally) {
        androidx.activity.compose.BackHandler(playing && !filtersOpen && !ageOpen && !namesOpen && !optionsOpen){pause();playing=false}
        CardsBrand(playing,{if(playing){pause();playing=false}else back()},if(playing)deck.current?.gameName?.ifBlank{"Cards"} ?: "Cards" else "Cards")
        if(playing){
            Row(Modifier.widthIn(max=420.dp).fillMaxWidth(),verticalAlignment=Alignment.CenterVertically){Text("${playerNames.getOrNull(playerTurn).orEmpty()}’s turn",color=screenText,fontFamily=LokaDisplay.font,fontSize=20.sp,maxLines=2,overflow=androidx.compose.ui.text.style.TextOverflow.Ellipsis,textAlign=androidx.compose.ui.text.style.TextAlign.Center,modifier=Modifier.weight(1f).testTag("cards-current-player"));TextButton(onClick={optionsOpen=true},enabled=!motionBusy,modifier=Modifier.semantics{contentDescription="Game options"}){Text("•••",color=screenText)}}
            Text(deck.audience.label+" · "+if(session.goal>0)"${session.completed.coerceAtMost(session.goal)}/${session.goal} turns · ${session.phaseLabel}" else "${session.completed} turns · ${session.phaseLabel}",color=muted,fontSize=12.sp)

        }
        if(!playing) {
            Column(Modifier.weight(1f).verticalScroll(rememberScrollState()),verticalArrangement=Arrangement.spacedBy(18.dp),horizontalAlignment=Alignment.CenterHorizontally) {
                Text("Choose your cards",fontFamily=LokaDisplay.font,fontSize=30.sp,color=screenText);Text("One deck. Your vibe.",color=muted)
                if(saved!=null){CardsSheetAction("Resume game"){restore()};Text("Your unfinished round is saved on this phone.",color=muted,fontSize=13.sp)}
                audienceRows(selectedAudience){selectedAudience=it}
                packChoices(selectedPack){selectedPack=it}
                rows(selected){selected=it}
                matchingCards(selected,selectedAudience,selectedPack)
                roundChoices()
                Text("Mix categories or keep it clean.",color=muted)
                Spacer(Modifier.height(24.dp))
            }
            Row(Modifier.widthIn(max=420.dp).fillMaxWidth().height(IntrinsicSize.Min).padding(bottom=12.dp).semantics{contentDescription="Cards start actions"},horizontalArrangement=Arrangement.spacedBy(12.dp)) {
                Button(onClick={draftPack=selectedPack;request(selected,selectedAudience)},enabled=canStart(selected,selectedAudience,selectedPack),shape=RoundedCornerShape(20.dp),colors=ButtonDefaults.buttonColors(containerColor=Color(0xFFA15CED),contentColor=Color.White),contentPadding=PaddingValues(horizontal=8.dp,vertical=12.dp),modifier=Modifier.weight(1f).heightIn(min=56.dp).fillMaxHeight()) {Text("Start playing →",fontSize=17.sp,lineHeight=21.sp,fontFamily=LokaDisplay.font,textAlign=androidx.compose.ui.text.style.TextAlign.Center)}
                OutlinedButton(onClick=nearby,shape=RoundedCornerShape(20.dp),contentPadding=PaddingValues(horizontal=8.dp,vertical=12.dp),modifier=Modifier.weight(1f).heightIn(min=56.dp).fillMaxHeight()) {Text("Nearby multiplayer",color=screenText,fontSize=17.sp,lineHeight=21.sp,fontFamily=LokaDisplay.font,textAlign=androidx.compose.ui.text.style.TextAlign.Center)}
            }
        } else {
            val card=remember(revision){deck.current}
            BoxWithConstraints(Modifier.weight(1f).fillMaxWidth(),contentAlignment=Alignment.Center) {
                val cardHeight=(maxHeight-12.dp).coerceAtLeast(1.dp).coerceAtMost(640.dp)
                if(session.paused) {
                    Text("Game paused",fontFamily=LokaDisplay.font,fontSize=30.sp,color=screenText)
                } else if(session.finished) {
                    Column(horizontalAlignment=Alignment.CenterHorizontally,verticalArrangement=Arrangement.spacedBy(16.dp)) {Text("✦",color=Color(0xFFA15CED),fontSize=48.sp);Text(if(deck.current==null)"You’ve finished this deck" else "Round complete!",fontFamily=LokaDisplay.font,fontSize=30.sp,color=screenText,textAlign=androidx.compose.ui.text.style.TextAlign.Center);Text("${session.completed} turns together. Ready for another?",color=muted,textAlign=androidx.compose.ui.text.style.TextAlign.Center)}
                } else if(card!=null && !session.revealed) {
                    Column(Modifier.widthIn(max=420.dp).fillMaxWidth().height(cardHeight).verticalScroll(rememberScrollState()).padding(horizontal=24.dp,vertical=20.dp).semantics(mergeDescendants=true){}.testTag("cards-handoff-message"),horizontalAlignment=Alignment.CenterHorizontally,verticalArrangement=Arrangement.spacedBy(16.dp,Alignment.CenterVertically)) {
                        Text("→",fontSize=48.sp,color=lavender,modifier=Modifier.clearAndSetSemantics{})
                        Text("Pass the phone to",fontSize=18.sp,fontWeight=FontWeight.Medium,color=muted,textAlign=androidx.compose.ui.text.style.TextAlign.Center)
                        Text(playerNames.getOrNull(playerTurn) ?: "the next player",fontFamily=LokaDisplay.font,fontSize=36.sp,lineHeight=40.sp,color=screenText,textAlign=androidx.compose.ui.text.style.TextAlign.Center)
                        Text("Tap Reveal card when you’re ready.",fontSize=14.sp,color=muted,textAlign=androidx.compose.ui.text.style.TextAlign.Center)
                    }
                } else if(card!=null) {
                    val face=session.display(card)
                    val upcoming=remember(revision){deck.peek(adult,drinking)}
                    val shuffleCards=remember(revision){deck.eligible(selected,adult,drinking)}
                    CardMotion(shuffleRevision,onBusy={motionBusy=it;if(!it && session.revealed && !session.paused)dealPending=false},onAdvance={advance()},cardHeight=cardHeight,dismissKey=skipRequest,animateShuffle=dealPending,shuffleFace={index->CardGraphic((if(index==4 || shuffleCards.isEmpty())card else shuffleCards[index % shuffleCards.size]).copy(text="Your next moment together"),cardHeight,mode=deck.audience.mode,interactive=false)},preview=if(upcoming!=null && !session.handoff)({CardGraphic(upcoming,cardHeight,mode=deck.audience.mode)}) else null) {
                        CardGraphic(face,cardHeight,mode=deck.audience.mode)
                    }
                } else Text("You’ve finished this deck",fontFamily=LokaDisplay.font,fontSize=30.sp,color=muted,textAlign=androidx.compose.ui.text.style.TextAlign.Center)
            }
            Column(Modifier.widthIn(max=420.dp).fillMaxWidth().padding(bottom=12.dp).semantics{contentDescription="Card actions"},horizontalAlignment=Alignment.CenterHorizontally,verticalArrangement=Arrangement.spacedBy(4.dp)) {
                if(session.paused){CardsSheetAction("Resume game"){session.resume();persist();revision++}}
                else if(session.finished){
                    CardsSheetAction("Another round"){session.newRound(adult,drinking);dealPending=true;persist();revision++;shuffleRevision++}
                    TextButton(onClick={playing=false}){Text("Change the vibe",color=muted)}
                    TextButton(onClick={storage.clear();saved=null;session.end();draftNames=emptyList();selectedAudience=null;playing=false}){Text("Finish game",color=muted)}
                } else if(card!=null) {
                    CardsSheetAction(if(session.revealed)"Next card" else "Reveal card",enabled=!motionBusy){if(session.revealed)advance() else reveal()}
                    Row(Modifier.fillMaxWidth(),horizontalArrangement=Arrangement.SpaceEvenly,verticalAlignment=Alignment.CenterVertically) {
                        TextButton(enabled=!motionBusy,onClick={draft=selected;draftPack=selectedPack;draftAudience=selectedAudience;draftNames=playerNames;filtersOpen=true}){Text("Filters",color=muted,fontSize=14.sp)}
                        TextButton(enabled=!motionBusy && session.revealed,onClick={skipRequest++}){Text("Skip",color=muted,fontSize=14.sp)}
                        TextButton(enabled=!motionBusy,onClick={rulesOpen=true}){Text("How to play",color=muted,fontSize=14.sp)}
                    }
                }

            }
        }
    }
    }
    if(optionsOpen)ModalBottomSheet(sheetState=rememberModalBottomSheetState(skipPartiallyExpanded=true),dragHandle={BottomSheetDefaults.DragHandle(Modifier.testTag("cards-sheet-handle"))},onDismissRequest={optionsOpen=false},containerColor=plum){
        Column(Modifier.fillMaxWidth().padding(24.dp).verticalScroll(rememberScrollState()),verticalArrangement=Arrangement.spacedBy(12.dp),horizontalAlignment=Alignment.CenterHorizontally){
            Text("Game options",fontFamily=LokaDisplay.font,fontSize=28.sp,color=screenText)
            Text("${CardPacks.labels[deck.pack]} · ${playerNames.size} players",color=muted)
            CardsSheetAction("Undo last card",enabled=session.previous!=null){session.undo(adult,drinking);optionsOpen=false;persist();revision++}
            CardsSheetAction("Edit players"){draftAudience=selectedAudience;draftNames=playerNames;nameList="";nameListError="";editingNames=true;optionsOpen=false;namesOpen=true}
            CardsSheetAction("Pause game"){pause();optionsOpen=false}
            CardsSheetAction("Finish game"){storage.clear();saved=null;session.end();draftNames=emptyList();selectedAudience=null;optionsOpen=false;playing=false}
        }
    }
    if(namesOpen)ModalBottomSheet(sheetState=rememberModalBottomSheetState(skipPartiallyExpanded=true),dragHandle={BottomSheetDefaults.DragHandle(Modifier.testTag("cards-sheet-handle"))},onDismissRequest={keyboard?.hide();namesOpen=false;editingNames=false;draftNames=playerNames},containerColor=plum){
        Column(Modifier.fillMaxWidth().fillMaxHeight(0.9f).padding(horizontal=24.dp)) {
            Text("Player names",fontFamily=LokaDisplay.font,fontSize=28.sp,color=screenText)
            Text("${draftNames.count{it.trim().isNotEmpty()}} of ${draftNames.size} names added",color=muted,modifier=Modifier.padding(vertical=12.dp))
            Column(Modifier.weight(1f).fillMaxWidth().clipToBounds().verticalScroll(rememberScrollState()).testTag("card-names-scroll"),verticalArrangement=Arrangement.spacedBy(14.dp)) {
                OutlinedTextField(value=nameList,onValueChange={nameList=it.take(2000);nameListError=""},label={Text("Paste names, separated by commas or lines")},minLines=2,modifier=Modifier.fillMaxWidth().testTag("card-name-list"))
                OutlinedButton(enabled=nameList.isNotBlank(),onClick={val names=LocalCardSession.parseNames(nameList);if(names.size in 1..draftNames.size && names.map{it.lowercase()}.distinct().size==names.size && names.all{it.length<=40}){draftNames=names+List(draftNames.size-names.size){""};nameListError="";keyboard?.hide()}else nameListError="Use up to ${draftNames.size} different names, 40 characters each."},modifier=Modifier.fillMaxWidth().height(56.dp)){Text("Use names")}
                if(nameListError.isNotEmpty())Text(nameListError,color=muted)
                draftNames.forEachIndexed{index,name->OutlinedTextField(value=name,onValueChange={value->draftNames=draftNames.toMutableList().also{it[index]=value.take(40)}},label={Text("Player ${index+1} name")},singleLine=true,modifier=Modifier.fillMaxWidth().testTag("card-player-name-$index"))}
                if(draftNames.filter{it.trim().isNotEmpty()}.map{it.trim().lowercase()}.distinct().size != draftNames.count{it.trim().isNotEmpty()})Text("Use a different name for each player.",color=muted)
                Spacer(Modifier.height(14.dp))
            }
            Column(Modifier.fillMaxWidth().padding(top=14.dp,bottom=16.dp),horizontalAlignment=Alignment.CenterHorizontally) {
                CardsSheetAction("Continue",enabled=namesValid(draftNames,draftAudience?.players ?: 0)){keyboard?.hide();namesOpen=false;if(editingNames){session.rename(draftNames);editingNames=false;persist();revision++}else request(draft,draftAudience)}
            }
        }
    }
    if(rulesOpen)ModalBottomSheet(sheetState=rememberModalBottomSheetState(skipPartiallyExpanded=true),dragHandle={BottomSheetDefaults.DragHandle(Modifier.testTag("cards-sheet-handle"))},onDismissRequest={rulesOpen=false},containerColor=plum){Column(Modifier.fillMaxWidth().fillMaxHeight(0.9f).padding(24.dp),horizontalAlignment=Alignment.CenterHorizontally){
        Column(Modifier.weight(1f).fillMaxWidth().verticalScroll(rememberScrollState()),verticalArrangement=Arrangement.spacedBy(18.dp)) {
            deck.current?.let{card->Text(card.gameName.ifBlank{"How to play"},fontFamily=LokaDisplay.font,fontSize=26.sp,color=screenText);Text(card.playRule(deck.audience.mode),color=screenText);Text(deck.audience.label,color=muted)}
        }
        CardsSheetAction("Got it"){rulesOpen=false}
        Spacer(Modifier.height(16.dp))
    }}
    if(filtersOpen)ModalBottomSheet(sheetState=rememberModalBottomSheetState(skipPartiallyExpanded=true),dragHandle={BottomSheetDefaults.DragHandle(Modifier.testTag("cards-sheet-handle"))},onDismissRequest={filtersOpen=false},containerColor=plum){Column(Modifier.fillMaxWidth().fillMaxHeight(0.9f).padding(24.dp),horizontalAlignment=Alignment.CenterHorizontally){
        Column(Modifier.weight(1f).fillMaxWidth().verticalScroll(rememberScrollState()),verticalArrangement=Arrangement.spacedBy(16.dp)){Text("Choose your cards",fontFamily=LokaDisplay.font,fontSize=30.sp,color=screenText);audienceRows(draftAudience){draftAudience=it};packChoices(draftPack){draftPack=it};rows(draft){draft=it};matchingCards(draft,draftAudience,draftPack);Spacer(Modifier.height(16.dp))}
        CardsSheetAction("Apply filters",enabled=canStart(draft,draftAudience,draftPack)){request(draft,draftAudience)}
        Spacer(Modifier.height(16.dp))
    }}
    if(ageOpen)ModalBottomSheet(sheetState=rememberModalBottomSheetState(skipPartiallyExpanded=true),dragHandle={BottomSheetDefaults.DragHandle(Modifier.testTag("cards-sheet-handle"))},onDismissRequest={ageOpen=false},containerColor=lavender){Column(Modifier.fillMaxWidth().fillMaxHeight(0.9f).padding(24.dp),horizontalAlignment=Alignment.CenterHorizontally,verticalArrangement=Arrangement.spacedBy(14.dp)){
        Text("Confirm your age",fontFamily=LokaDisplay.font,fontSize=30.sp,color=ink)
        Text("Dirty cards: 18+. Drinking cards: 21+. Your date of birth stays on this screen.",color=ink)
        val threshold=if("drinking" in draft)21 else 18
        val result=CardBirthday.eligible(birthday,threshold)
        Column(Modifier.weight(1f).fillMaxWidth().clipToBounds().verticalScroll(rememberScrollState()),verticalArrangement=Arrangement.spacedBy(14.dp)) {
        BirthdayWheel(birthdayDate,{birthdayDate=it;birthdayChosen=true;rejected=false},ink)
        Text(if(result==true)"Ready to confirm." else "These cards require age $threshold+.",color=ink,fontSize=13.sp)
        if(rejected)Text("Those categories are unavailable for your age. You can play Clean cards.",color=ink)
        }
        CardsSheetAction("Confirm & play",enabled=birthdayChosen && result!=null && !rejected){if(result==true){adult=CardBirthday.eligible(birthday,18)==true;drinking=CardBirthday.eligible(birthday,21)==true;prefs.edit().putBoolean("18",adult).putBoolean("21",drinking).apply();birthdayDate=LocalDate.now();apply(draft)}else {rejected=true;unavailable=unavailable+draft.filter{it!="clean" && CardBirthday.eligible(birthday,if(it=="drinking")21 else 18)!=true};if(!playing)selected=setOf("clean")}}
        if(rejected)CardsSheetAction("Play Clean cards"){ageOpen=false;apply(setOf("clean"))}
        Spacer(Modifier.height(16.dp))
    }}
}

/** One primary action size and type style across Cards sheets. */
@Composable private fun CardsSheetAction(title:String,enabled:Boolean=true,onClick:()->Unit) {
    Button(onClick=onClick,enabled=enabled,shape=RoundedCornerShape(24.dp),colors=ButtonDefaults.buttonColors(containerColor=Color(0xFFA15CED),contentColor=Color.White),contentPadding=PaddingValues(horizontal=12.dp,vertical=0.dp),modifier=Modifier.widthIn(max=420.dp).fillMaxWidth().height(56.dp)) {
        Text(title,fontFamily=LokaDisplay.font,fontSize=22.sp,lineHeight=26.sp,maxLines=1)
    }
}

@Composable private fun CardsBrand(playing:Boolean,back:()->Unit,title:String="Cards") {
    val dark=LokaColors.background.luminance()<0.3f
    Box(Modifier.fillMaxWidth().height(if(playing)112.dp else 132.dp),contentAlignment=Alignment.Center) {
        TextButton(onClick=back,modifier=Modifier.align(Alignment.TopStart)){Text("‹ Back",fontSize=13.sp,color=if(dark)Color(0xFFE9D8FF) else Color(0xFF71557F))}
        Column(horizontalAlignment=Alignment.CenterHorizontally,verticalArrangement=Arrangement.spacedBy((-8).dp)) {
            Row(verticalAlignment=Alignment.CenterVertically,modifier=Modifier.clearAndSetSemantics{contentDescription="LOKA"}) {
                listOf("L" to -7f,"O" to 3f,"K" to -3f,"A" to 4f).forEach{(letter,tilt)->Text(letter,fontFamily=LokaDisplay.font,fontSize=if(playing)52.sp else 64.sp,lineHeight=if(playing)56.sp else 68.sp,color=if(dark)Color(0xFFFFECE9) else Color(0xFF562379),modifier=Modifier.rotate(tilt))}
            }
            Text(title,fontFamily=LokaDisplay.font,fontSize=26.sp,lineHeight=28.sp,maxLines=2,textAlign=androidx.compose.ui.text.style.TextAlign.Center,modifier=Modifier.padding(horizontal=46.dp).testTag("cards-game-title"),color=if(dark)Color(0xFFFFD466) else Color(0xFFA55D06))
        }
        Text("✦",Modifier.align(Alignment.CenterStart).padding(start=28.dp),color=Color(0xFF9C75B4),fontSize=20.sp)
        Text("✦",Modifier.align(Alignment.CenterEnd).padding(end=28.dp),color=Color(0xFFFFD466),fontSize=20.sp)
    }
}

/** Display separators while retaining digits and a correct caret for edits/backspace. */
private object CardBirthdayTransformation:VisualTransformation {
    override fun filter(text:AnnotatedString):TransformedText {
        val display=CardBirthday.format(text.text)
        val offsets=object:OffsetMapping {
            override fun originalToTransformed(offset:Int):Int {
                val raw=offset.coerceIn(0,text.length)
                return (raw+(if(raw>2)1 else 0)+(if(raw>4)1 else 0)).coerceAtMost(display.length)
            }
            override fun transformedToOriginal(offset:Int)=display.take(offset.coerceIn(0,display.length)).count{it in '0'..'9'}.coerceAtMost(text.length)
        }
        return TransformedText(AnnotatedString(display),offsets)
    }
}
