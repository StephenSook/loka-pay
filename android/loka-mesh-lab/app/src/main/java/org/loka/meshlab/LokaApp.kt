package org.loka.meshlab

import androidx.compose.ui.semantics.liveRegion
import androidx.compose.animation.Crossfade
import androidx.compose.animation.animateContentSize
import androidx.compose.animation.animateColorAsState
import androidx.compose.animation.core.animateFloatAsState
import androidx.compose.animation.core.tween
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.animation.core.animateFloat

import androidx.activity.compose.BackHandler
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.gestures.detectHorizontalDragGestures
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.foundation.Image
import androidx.compose.foundation.verticalScroll
import androidx.compose.ui.graphics.asImageBitmap
import androidx.compose.ui.graphics.toArgb
import androidx.compose.ui.platform.LocalContext
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import org.loka.core.contact.ContactCode
import android.content.Intent
import com.journeyapps.barcodescanner.ScanContract
import com.journeyapps.barcodescanner.ScanOptions
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.combinedClickable
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.selection.SelectionContainer
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.rotate
import androidx.compose.ui.text.font.Font
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.draw.drawBehind
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.luminance
import androidx.compose.ui.graphics.Path
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.semantics.customActions
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.clearAndSetSemantics
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import org.loka.core.LabCrypto
import org.loka.core.MAX_LIFETIME_MS
import org.loka.core.fingerprint
import org.loka.core.transport.TransportCapability
import android.util.Base64
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale

internal object LokaColors {
    val green: Color @Composable get() = MaterialTheme.colorScheme.primary
    val ink: Color @Composable get() = MaterialTheme.colorScheme.onSurface
    val muted: Color @Composable get() = MaterialTheme.colorScheme.onSurfaceVariant
    val line: Color @Composable get() = MaterialTheme.colorScheme.outlineVariant
    val mint: Color @Composable get() = MaterialTheme.colorScheme.primaryContainer
    val background: Color @Composable get() = MaterialTheme.colorScheme.background
    val surface: Color @Composable get() = MaterialTheme.colorScheme.surface
    val yellow = Color(0xFFFFD83D)
    val mintAccent = Color(0xFF64DFBA)
    val pendingBubble: Color @Composable get() = MaterialTheme.colorScheme.secondaryContainer
    val scheme: ColorScheme @Composable get() = if (when (appearanceValue("theme", "System")) { "Dark" -> true; "Light" -> false; else -> androidx.compose.foundation.isSystemInDarkTheme() }) darkColorScheme(
        primary = Color(0xFFBA84FF), onPrimary = Color(0xFF26004C),
        primaryContainer = Color(0xFF392052), onPrimaryContainer = Color(0xFFEAD7FF),
        secondary = Color(0xFF64DFBA), secondaryContainer = Color(0xFF292039), onSecondaryContainer = Color(0xFFE4D4F7),
        background = Color(0xFF130E20), surface = Color(0xFF23192F), surfaceVariant = Color(0xFF30213F),
        onSurface = Color(0xFFFBF7FF), onBackground = Color(0xFFFBF7FF),
        onSurfaceVariant = Color(0xFFC1A6DC), outline = Color(0xFF9865C9), outlineVariant = Color(0xFF49335D)
    ) else lightColorScheme(
        primary = Color(0xFF7825E8), onPrimary = Color.White,
        primaryContainer = Color(0xFFEDDDFF), onPrimaryContainer = Color(0xFF350E51),
        secondary = Color(0xFF087956), secondaryContainer = Color(0xFFF1E7F6), onSecondaryContainer = Color(0xFF350E51),
        background = Color(0xFFFFFBF3), surface = Color(0xFFFFFEFC), surfaceVariant = Color(0xFFF3EAF9),
        onSurface = Color(0xFF2C0C40), onBackground = Color(0xFF2C0C40),
        onSurfaceVariant = Color(0xFF765889), outline = Color(0xFFAA82CB), outlineVariant = Color(0xFFE7D7EE)
    )
}

private fun nearbyRadioKey(handle: String) = handle.removePrefix("ble:out:").removePrefix("ble:")

private fun TrustedDevice.label() = name.ifBlank { "LOKA friend" }

@Composable
internal fun LokaApp(state: LabState, model: LabViewModel, start: () -> Unit,
    discoverable: () -> Unit, copyKey: () -> Unit, export: () -> Unit, incomingFriend: String? = null, consumeFriend: () -> Unit = {}, incomingContact: String? = null, consumeContact: () -> Unit = {}, notifications: () -> Unit = {}, nearbyGranted: Boolean = false, notificationsGranted: Boolean = false, nearbyDenied: Boolean = false, notificationsDenied: Boolean = false, nearbySupported: Boolean = true, nearbyRadioOn: Boolean = false) {
    if (!state.ready) { Box(Modifier.fillMaxSize().background(LokaColors.background).safeDrawingPadding().padding(24.dp), contentAlignment = Alignment.Center) { if (state.error != null) Text(state.error, color = MaterialTheme.colorScheme.error) else CircularProgressIndicator() }; return }
    if (!state.onboardingComplete) {
        Surface(color = LokaColors.background, contentColor = LokaColors.ink) {
            Box(Modifier.fillMaxSize(), contentAlignment = Alignment.TopCenter) {
                Box(Modifier.widthIn(max = 560.dp)) {
                    WelcomeScreen(state, model, start, notifications, nearbyGranted, notificationsGranted,
                        nearbyDenied, notificationsDenied, nearbySupported, nearbyRadioOn)
                }
            }
        }
        return
    }
    var tab by rememberSaveable { mutableStateOf("Chats") }
    var selectedPlayGame by rememberSaveable { mutableStateOf<String?>(null) }
    var conversation by rememberSaveable { mutableStateOf("") }
    val quizInvitation = state.quizSession?.takeIf { it.phase == "invited" && it.expires > state.now }
    if (state.partySession?.phase == "invited" && tab != "Play") AlertDialog(
        onDismissRequest = { tab = "Play" }, title = { Text("Party cards invitation") },
        text = { Text("Someone nearby invited you to play. View the game and its settings before joining.") },
        confirmButton = { TextButton(onClick = { tab = "Play" }) { Text("View invitation") } },
        dismissButton = { TextButton(onClick = model::endCards) { Text("Decline") } })
    if (quizInvitation != null && tab != "Play") AlertDialog(
        onDismissRequest = { tab = "Play" },
        title = { Text("Quick Quiz invitation") },
        text = { Text("${state.trusted.firstOrNull { it.id == quizInvitation.host }?.name?.ifBlank { "Your friend" } ?: "Your friend"} invited you to an untimed quiz.") },
        confirmButton = { TextButton(onClick = { tab = "Play"; model.acceptQuiz() }) { Text("Accept and play") } },
        dismissButton = { TextButton(onClick = model::endQuiz) { Text("Decline") } })

    var tools by rememberSaveable { mutableStateOf(false) }
    var backups by rememberSaveable { mutableStateOf(false) }
    var profilePage by rememberSaveable { mutableStateOf("") }
    var addFriend by rememberSaveable { mutableStateOf(false) }
    var newChat by remember { mutableStateOf(false) }
    var contactLink by rememberSaveable { mutableStateOf("") }
    LaunchedEffect(incomingFriend, state.ready) {
        if (incomingFriend != null && state.ready) { conversation = incomingFriend; tab = "Chats"; profilePage = ""; consumeFriend() }
    }
    LaunchedEffect(state.openAcceptedFriend) {
        state.openAcceptedFriend?.let { friend ->
            tab = "Chats"; conversation = friend; profilePage = ""; tools = false; backups = false
            model.consumeAcceptedFriend()
        }
    }
    LaunchedEffect(incomingContact) {
        if (incomingContact != null) { contactLink = incomingContact; addFriend = true; consumeContact() }
    }
    var dismissedRequests by remember { mutableStateOf(setOf<String>()) }
    val pendingRequests = state.peers.filter { !state.automaticNearby && state.running && it.id.startsWith("ble:") && it.readyToConnect && it.id !in state.allowed }
    LaunchedEffect(pendingRequests.map { it.id }) {
        dismissedRequests = dismissedRequests.intersect(pendingRequests.map { it.id }.toSet())
    }
    val approval = pendingRequests.firstOrNull { it.id !in dismissedRequests }
    if (approval != null && !addFriend) AlertDialog(
        onDismissRequest = { dismissedRequests = dismissedRequests + approval.id },
        title = { Text("Manual connection control is on") },
        text = { Text("Engineering mode asks you to approve nearby links. Switch to automatic connections for everyday messaging. Friend verification stays separate.") },
        confirmButton = { TextButton(onClick = { model.allow(approval.id, true); model.connect(approval.id) }) { Text("Allow connection") } },
        dismissButton = { TextButton(onClick = { model.automaticNearby(true) }) { Text("Connect automatically") } })
    val context = LocalContext.current
    val scope = rememberCoroutineScope()
    var cameraOpen by rememberSaveable { mutableStateOf(false) }
    val cameraScan = rememberLauncherForActivityResult(ScanContract()) { result ->
        cameraOpen = false
        result.contents?.let { scanned ->
            runCatching { ContactCode.decode(scanned) }
                .onSuccess { contactLink = scanned; addFriend = true }
                .onFailure { model.reportError("That QR is not a valid LOKA contact code.") }
        }
    }
    val openCamera = {
        if (!cameraOpen) {
            cameraOpen = true
            cameraScan.launch(ScanOptions().setCaptureActivity(LokaScanActivity::class.java).setDesiredBarcodeFormats(ScanOptions.QR_CODE).setPrompt("").setBeepEnabled(false).setOrientationLocked(false))
        }
    }
    val scan = rememberLauncherForActivityResult(ActivityResultContracts.GetContent()) { uri ->
        if (uri != null) scope.launch {
            runCatching { withContext(Dispatchers.IO) {
                ContactQr.read(context.contentResolver, uri).also { ContactCode.decode(it) }
            } }.onSuccess { contactLink = it; addFriend = true }
                .onFailure { model.reportError("Could not read a LOKA contact QR. Try a clearer image or paste the link.") }
        }
    }
    val snacks = remember { SnackbarHostState() }
    LaunchedEffect(state.error) { state.error?.let { snacks.showSnackbar(it); model.clearError() } }
    val closeBackups = { if (!model.state.value.backupBusy) { model.cancelBackup(); backups = false } }
    BackHandler(conversation.isNotEmpty() || tools || backups || profilePage.isNotEmpty()) {
        if (backups) closeBackups() else if (tools) tools = false else if (profilePage.isNotEmpty()) profilePage = "" else conversation = ""
    }
    val contact = (state.trusted + state.historyContacts).find { it.id == conversation }
    val cardsSubscreen = tab == "Play" && selectedPlayGame == "Cards"
    val canvasColor=if(cardsSubscreen) { if(LokaColors.background.luminance()<0.3f) Color(0xFF120815) else Color(0xFFEEE3F7) } else LokaColors.background
    SideEffect {
        // Older Android windows own this area; Android 15+ uses the Scaffold behind transparent bars.
        if(android.os.Build.VERSION.SDK_INT<35) {
            @Suppress("DEPRECATION")
            (context as? android.app.Activity)?.window?.statusBarColor=canvasColor.toArgb()
        }
    }
    BoxWithConstraints(Modifier.fillMaxSize()) {
    val expanded = maxWidth >= 840.dp
    Scaffold(floatingActionButton = {
        if (tab == "Chats" && (contact == null || expanded) && !tools && !backups && profilePage.isEmpty()) {
            FloatingActionButton(onClick = { newChat = true }, containerColor = LokaColors.green, contentColor = MaterialTheme.colorScheme.onPrimary) { Glyph("group", color = MaterialTheme.colorScheme.onPrimary, description = "New chat") }
        }
    }, containerColor = canvasColor, snackbarHost = { SnackbarHost(snacks) },
        topBar = {
            if (backups) {
                PageBar("Chats & backups", "Encrypted history", back = closeBackups)
            } else if (tools) {
                PageBar("Mesh Lab", "Engineering tools", back = { tools = false })
            } else if (profilePage.isNotEmpty()) {
                PageBar(profilePage, "", back = { profilePage = "" })
            } else if (contact != null && !expanded) {
                // Conversation supplies its own compact avatar/back header.
            } else if (tab == "You") {
                Row(Modifier.fillMaxWidth().statusBarsPadding().padding(horizontal = 24.dp, vertical = 12.dp)) {
                    Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(5.dp)) {
                        Row(verticalAlignment = Alignment.CenterVertically) {
                            Text("Your corner", fontFamily = LokaDisplay.font, fontSize = 30.sp, letterSpacing = (-.7).sp)
                            Glyph("spark", Modifier.size(24.dp), LokaColors.yellow)
                        }
                        Text("Make LOKA your own.", color = LokaColors.muted, fontSize = 14.sp)
                    }
                    IconButton(onClick = { profilePage = "Help & app info" }) { Glyph("settings", description = "Settings and app info") }
                }
            } else if (tab == "Nearby") {
                Row(Modifier.fillMaxWidth().statusBarsPadding().padding(horizontal = 24.dp, vertical = 12.dp), verticalAlignment = Alignment.CenterVertically) {
                    Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(5.dp)) {
                        Row(verticalAlignment = Alignment.CenterVertically) { Text("Around you", fontFamily = LokaDisplay.font, fontSize = 30.sp); Glyph("spark", Modifier.size(24.dp), LokaColors.yellow) }
                        Text("Real people. Right here.", color = LokaColors.muted, fontSize = 14.sp)
                    }
                    FilledIconButton(onClick = { profilePage = "My LOKA" }, shape = RoundedCornerShape(14.dp)) { Glyph("qr", color = MaterialTheme.colorScheme.onPrimary, description = "Share or scan a LOKA code") }
                }
            } else if (tab == "Play") {
                // Play and Cards supply their own heading, as in the game showcase.
                Spacer(Modifier.statusBarsPadding())
            } else {
                Row(Modifier.fillMaxWidth().statusBarsPadding().padding(horizontal = 24.dp, vertical = 12.dp),
                    verticalAlignment = Alignment.CenterVertically) {
                    Column(Modifier.weight(1f)) {
                        LokaWordmark(compact = true)
                        Text("Your world, closer.", color = LokaColors.muted, fontSize = 13.sp)
                    }
                    Column(horizontalAlignment = Alignment.End, verticalArrangement = Arrangement.spacedBy(6.dp)) {
                        ProfilePortrait(state.displayName, Modifier.size(44.dp).clickable { tab = "You" }, own = true)
                        DeviceModeBadge()
                    }
                }
            }
        }, bottomBar = {
            if (!expanded && !cardsSubscreen && !tools && !backups && profilePage.isEmpty() && contact == null) {
                Surface(color = LokaColors.background) {
                    Row(Modifier.fillMaxWidth().navigationBarsPadding().padding(vertical = 12.dp)) {
                        listOf("Chats", "Nearby", "Play", "You").forEach { name ->
                            val activeColor by animateColorAsState(if (tab == name) LokaColors.green else LokaColors.muted, tween(220), label = "tab color")
                            val pillColor by animateColorAsState(if (tab == name) LokaColors.mint else Color.Transparent, tween(220), label = "tab indicator")
                            val iconScale by animateFloatAsState(if (tab == name) 1.08f else 1f, label = "tab scale")
                            Column(Modifier.weight(1f).clickable { tab = name }.padding(4.dp),
                                horizontalAlignment = Alignment.CenterHorizontally) {
                                Box(Modifier.clip(RoundedCornerShape(18.dp)).background(pillColor).graphicsLayer { scaleX = iconScale; scaleY = iconScale }
                                    .padding(horizontal = 20.dp, vertical = 6.dp)) {
                                    Glyph(when (name) { "Chats" -> "chat"; "Nearby" -> "nearby"; "Play" -> "game"; else -> "user" },
                                        color = activeColor)
                                }
                                Text(name, fontSize = 11.sp, fontWeight = if (tab == name) FontWeight.Bold else FontWeight.Normal,
                                    color = activeColor)
                            }
                        }
                    }
                }
            }
        }) { padding ->
        Row(Modifier.fillMaxSize().padding(padding).consumeWindowInsets(padding)) {
            if (expanded && !cardsSubscreen) {
                NavigationRail(containerColor = LokaColors.background, modifier = Modifier.fillMaxHeight()) {
                    Spacer(Modifier.height(16.dp))
                    listOf("Chats", "Nearby", "Play", "You").forEach { name ->
                        NavigationRailItem(selected = tab == name, onClick = {
                            if (!state.backupBusy) { tab = name; tools = false; backups = false; profilePage = "" }
                        }, icon = { Glyph(when (name) { "Chats" -> "chat"; "Nearby" -> "nearby"; "Play" -> "game"; else -> "user" }, description = name) }, label = { Text(name) })
                    }
                }
                VerticalDivider()
            }
            Box(Modifier.weight(1f).fillMaxHeight(), contentAlignment = Alignment.TopCenter) {
            Box(if (expanded && (tab == "You" || profilePage.isNotEmpty() || backups)) Modifier.widthIn(max = 760.dp).fillMaxSize() else Modifier.fillMaxSize()) {
            Crossfade(targetState = tab, animationSpec = tween(220), label = "screen transition") { displayTab ->
            when {
                backups -> BackupScreen(state, model)
                tools -> LabScreen(state, model, start, discoverable, copyKey, export)
                profilePage == "Router-free Wi-Fi" -> Column(Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(20.dp)) { AwareSetupCard(state.running, model::refresh) }
                profilePage == "Background messaging" -> Column(Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(20.dp)) { BackgroundBatteryCard() }
                profilePage == "Local connection" -> NearbyScreen(state, model, start, { addFriend = true }, { tools = true })
                profilePage == "Community sharing" -> CommunitySharingScreen(saved = { profilePage = "" })
                profilePage == "My LOKA" -> ContactCodeScreen(state, model,
                    { openCamera() },
                    { scan.launch("image/*") }, { addFriend = true })
                profilePage.isNotEmpty() -> ProfileDetailScreen(profilePage, state, model, { tools = true }, { backups = true })
                expanded && displayTab == "Chats" -> Row(Modifier.fillMaxSize()) {
                    Box(Modifier.width(340.dp).fillMaxHeight()) {
                        ChatsScreen(state, model, { profilePage = "Local connection" }, { conversation = it }, { addFriend = true }, { profilePage = "My LOKA" }, selectedID = conversation)
                    }
                    VerticalDivider()
                    Box(Modifier.weight(1f).fillMaxHeight(), contentAlignment = Alignment.Center) {
                        if (contact != null) key(contact.id) {
                            Box(Modifier.widthIn(max = 860.dp).fillMaxSize()) {
                                ConversationScreen(contact, state, model, back = { conversation = "" }, connections = { profilePage = "Local connection" })
                            }
                        } else Column(Modifier.padding(32.dp), horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.spacedBy(12.dp)) {
                            Glyph("chat", Modifier.size(48.dp), LokaColors.green, "Conversations")
                            Text("Your conversations", style = MaterialTheme.typography.headlineSmall)
                            Text("Choose a chat or start a conversation with someone nearby.", color = LokaColors.muted,
                                textAlign = androidx.compose.ui.text.style.TextAlign.Center)
                        }
                    }
                }
                contact != null && displayTab == "Chats" -> ConversationScreen(contact, state, model, back = { conversation = "" }, connections = { profilePage = "Local connection" })
                displayTab == "Play" -> PlayShelf(state, model, selectedPlayGame) { selectedPlayGame = it }
                displayTab == "Nearby" -> ChatsScreen(state, model, { profilePage = "Local connection" }, { conversation = it; tab = "Chats" }, { addFriend = true }, { profilePage = "My LOKA" }, initialNearby = true)
                displayTab == "You" -> ProfileScreen(state, model, { profilePage = it }, { backups = true })
                else -> ChatsScreen(state, model, { profilePage = "Local connection" }, { conversation = it }, { addFriend = true }, { profilePage = "My LOKA" })
            }
            }
        }
    }
    } } }
    if (newChat) AlertDialog(onDismissRequest = { newChat = false }, title = { Text("New chat") }, text = { LazyColumn {
        item { Row(Modifier.fillMaxWidth().padding(vertical = 12.dp), verticalAlignment = Alignment.CenterVertically) { Glyph("group", Modifier.size(28.dp), LokaColors.muted, "Group chats"); Spacer(Modifier.width(12.dp)); Column { Text("Group chats", fontWeight = FontWeight.SemiBold); Text("Coming soon", color = LokaColors.muted, fontSize = 12.sp) } } }
        item { TextButton(onClick = { newChat = false; profilePage = "My LOKA" }) { Text("Add a friend by QR") } }
        items(state.trusted, key = { it.id }) { friend -> TextButton(onClick = { newChat = false; conversation = friend.id }) { Avatar(friend.label(), Modifier.size(36.dp), peerID = friend.id); Spacer(Modifier.width(12.dp)); Text(friend.label()) } }
        if (state.trusted.isEmpty()) item { Text("Add a friend to start messaging.") }
    } }, confirmButton = { TextButton(onClick = { newChat = false }) { Text("Done") } })
    if (addFriend) AddFriendDialog(state, model, contactLink,
        { openCamera() },
        { scan.launch("image/*") }, { addFriend = false; contactLink = ""; profilePage = "My LOKA" }, { addFriend = false; contactLink = "" })
}

@Composable
private fun WelcomeScreen(state: LabState, model: LabViewModel, start: () -> Unit, notifications: () -> Unit, nearbyGranted: Boolean, notificationsGranted: Boolean, nearbyDenied: Boolean, notificationsDenied: Boolean, nearbySupported: Boolean, nearbyRadioOn: Boolean) {
    var step by rememberSaveable { mutableStateOf(0) }
    var name by rememberSaveable { mutableStateOf(state.displayName.takeUnless { it == "You" }.orEmpty()) }
    val context = LocalContext.current
    val awareSupported = android.os.Build.VERSION.SDK_INT >= 29 && context.packageManager.hasSystemFeature(android.content.pm.PackageManager.FEATURE_WIFI_AWARE)
    val titles = listOf("Your name") + (if (nearbySupported) listOf("Nearby messaging") else emptyList()) + (if (awareSupported) listOf("Nearby Wi-Fi") else emptyList()) + listOf("Notifications", "Background messaging", "Community sharing", "Backup")
    val current = titles[step.coerceAtMost(titles.lastIndex)]
    fun alreadyEnabled(title: String): Boolean = when (title) {
        "Nearby messaging" -> nearbyGranted && nearbyRadioOn
        "Notifications" -> notificationsGranted
        "Nearby Wi-Fi" -> context.checkSelfPermission(if (android.os.Build.VERSION.SDK_INT >= 33) android.Manifest.permission.NEARBY_WIFI_DEVICES else android.Manifest.permission.ACCESS_FINE_LOCATION) == android.content.pm.PackageManager.PERMISSION_GRANTED
        "Background messaging" -> context.getSystemService(android.os.PowerManager::class.java).isIgnoringBatteryOptimizations(context.packageName) &&
            (android.os.Build.VERSION.SDK_INT < 28 || !context.getSystemService(android.app.ActivityManager::class.java).isBackgroundRestricted)
        else -> false
    }
    fun next() { do { step = (step + 1).coerceAtMost(titles.lastIndex) } while (step < titles.lastIndex && alreadyEnabled(titles[step])) }
    fun back() { do { step = (step - 1).coerceAtLeast(0) } while (step > 0 && alreadyEnabled(titles[step])) }
    BackHandler(step > 0) { back() }
    fun finish() {
        if (nearbySupported && (!nearbyGranted || !nearbyRadioOn)) { step = titles.indexOf("Nearby messaging"); return }
        if (nearbySupported && !state.running) start()
        model.chooseBackup(false); model.completeOnboarding()
    }
    LaunchedEffect(nearbyGranted, nearbyRadioOn, notificationsGranted, step) {
        if ((current == "Nearby messaging" && nearbyGranted && nearbyRadioOn) || (current == "Notifications" && notificationsGranted)) next()
    }
    Column(Modifier.fillMaxSize().background(LokaColors.background).safeDrawingPadding().imePadding()) {
        Column(Modifier.fillMaxWidth().padding(horizontal = 28.dp, vertical = 12.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
            Box(Modifier.fillMaxWidth().heightIn(min = 60.dp), contentAlignment = Alignment.Center) {
                LokaWordmark()
                if (step > 0) IconButton(onClick = { back() }, modifier = Modifier.align(Alignment.CenterStart).size(48.dp)) {
                    Glyph("back", description = "Go back")
                }
            }
            Column {
                Text("Step ${step + 1} of ${titles.size} · $current", color = LokaColors.muted)
                Spacer(Modifier.height(12.dp))
                Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                    Row(Modifier.weight(1f), horizontalArrangement = Arrangement.spacedBy(6.dp)) { repeat(titles.size) { index -> Box(Modifier.weight(1f).height(7.dp).clip(CircleShape).background(if (index <= step) LokaColors.green else LokaColors.mint)) } }
                    if (current != "Nearby messaging" && current != "Community sharing") {
                        FilledTonalIconButton(onClick = { if (current == "Backup") finish() else next() }, modifier = Modifier.size(48.dp), colors = IconButtonDefaults.filledTonalIconButtonColors(containerColor = LokaColors.mint, contentColor = LokaColors.green)) {
                            Glyph("forward", description = if (current == "Backup") "Finish setup" else "Skip $current")
                        }
                    }
                }
            }
        }
        if (current == "Your name") {
            NameOnboarding(name, { name = it }, { model.setDisplayName(name); next() }, Modifier.weight(1f))
        } else if (current == "Community sharing") {
            CommunitySharingScreen(Modifier.weight(1f), onboarding = true, saved = { next() })
        } else if (current == "Nearby Wi-Fi") {
            AwareSetupCard(state.running, model::refresh, onGranted = { next() }, layout = { details, action ->
                Column(Modifier.weight(1f).fillMaxWidth()) {
                    LazyColumn(Modifier.weight(1f).fillMaxWidth(), contentPadding = PaddingValues(28.dp), verticalArrangement = Arrangement.spacedBy(24.dp)) {
                        item { OnboardingArt(R.drawable.nearby_people) }
                        item { LokaHeroTitle("Phone to phone.") }
                        item { Text("Send messages straight to nearby phones using Wi-Fi. No Internet or mobile data needed.", color = LokaColors.muted, fontSize = 16.sp, lineHeight = 24.sp) }
                        item { details() }
                        state.error?.let { error -> item { Text(error, color = MaterialTheme.colorScheme.error) } }
                    }
                    Column(Modifier.fillMaxWidth().padding(horizontal = 28.dp, vertical = 16.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
                        action()
                        Text("Good chats. Your community, closer.", color = LokaColors.muted, fontSize = 12.sp, modifier = Modifier.fillMaxWidth(), textAlign = androidx.compose.ui.text.style.TextAlign.Center)
                    }
                }
            })
        } else {
            LazyColumn(Modifier.weight(1f).fillMaxWidth(),
                contentPadding = PaddingValues(28.dp), verticalArrangement = Arrangement.spacedBy(24.dp)) {
                item { OnboardingArt(when (current) { "Your name" -> R.drawable.welcome_people; "Notifications" -> R.drawable.notification_people; "Backup" -> R.drawable.backup_art; else -> R.drawable.nearby_people }) }
                item { LokaHeroTitle(when (current) {
                    "Your name" -> "Your people.\nCloser together."
                    "Nearby messaging" -> "Stay close,\neven offline."
                    "Nearby Wi-Fi" -> "Phone to phone."
                    "Notifications" -> "Don’t miss\na message."
                    "Background messaging" -> "Keep messages\ncoming."
                    else -> "Your backup\nchoice."
                }) }
                if (current != "Background messaging") item { Text(when (current) {
                    "Your name" -> "What would you like to be called? You can change your name later."
                    "Nearby messaging" -> when {
                        nearbyDenied -> "Open Settings → Permissions → ${if (android.os.Build.VERSION.SDK_INT >= 31) "Nearby devices" else "Location"} and choose Allow. Return to LOKA to continue."
                        nearbyGranted && !nearbyRadioOn -> "Turn on Bluetooth so LOKA can connect to phones around you. Choose Allow when your phone asks."
                        else -> "Let LOKA find phones around you and send messages without Internet. Choose Allow when your phone asks for nearby access."
                    }
                    "Nearby Wi-Fi" -> "Send messages straight to nearby phones using Wi-Fi. No Internet or mobile data needed."
                    "Notifications" -> if (notificationsDenied) "Open Notifications in Settings and turn on notifications for LOKA. Return here afterward." else "Get an alert when a message arrives, even when you’re not looking at LOKA."
                    "Background messaging" -> "Let LOKA stay active when you leave the app. This may use more battery."
                    else -> "Keep an encrypted copy of your chats. Create and save a backup from Settings → Chats & backups when you’re ready."
                }, color = LokaColors.muted, fontSize = 16.sp, lineHeight = 24.sp) }
                when (current) {
                    "Background messaging" -> {
                        item { BackgroundBatteryCard(showTitle = false, onReady = { next() }) }
                    }
                    "Backup" -> {
                        item { Button(onClick = { finish() }, modifier = Modifier.fillMaxWidth()) { Text("Start using LOKA") } }
                        item { Text("Nothing is backed up until you create and save a backup in Settings.", color = LokaColors.muted) }
                    }
                    else -> {
                        item { Button(onClick = if (current == "Nearby messaging") start else notifications, modifier = Modifier.fillMaxWidth().heightIn(min = 52.dp)) {
                            Text(if (current == "Nearby messaging") when {
                                nearbyDenied -> "Open app settings"
                                nearbyGranted && !nearbyRadioOn -> "Turn on Bluetooth"
                                else -> "Enable nearby messaging"
                            } else if (notificationsDenied) "Open notification settings" else "Enable notifications")
                        } }

                    }
                }
                item { Text("Good chats. Your community, closer.", color = LokaColors.muted, fontSize = 12.sp, modifier = Modifier.fillMaxWidth(), textAlign = androidx.compose.ui.text.style.TextAlign.Center) }
                state.error?.let { error -> item { Text(error, color = MaterialTheme.colorScheme.error) } }
            }
        }
    }
}

@Composable
private fun PageBar(title: String, subtitle: String, back: () -> Unit) {
    Row(Modifier.fillMaxWidth().background(LokaColors.surface).statusBarsPadding().padding(16.dp),
        verticalAlignment = Alignment.CenterVertically) {
        IconButton(onClick = back) { Glyph("back", description = "Go back") }
        Spacer(Modifier.width(8.dp))
        Column { Text(title, fontWeight = FontWeight.Bold, fontSize = 19.sp)
            if (subtitle.isNotBlank()) Text(subtitle, color = LokaColors.muted, fontSize = 12.sp) }
    }
}

@Composable
private fun ChatsScreen(state: LabState, model: LabViewModel, nearby: () -> Unit, open: (String) -> Unit, add: () -> Unit, myCode: () -> Unit, selectedID: String? = null, initialNearby: Boolean = false) {
    val shareContext = LocalContext.current
    val nearbyMode = initialNearby
    var search by rememberSaveable { mutableStateOf("") }
    val allContacts = (state.trusted + state.historyContacts).distinctBy { it.id }
    val contacts = allContacts.filter { it.label().contains(search, true) }
        .sortedByDescending { contact -> state.chatMessages.filter { it.peerId == contact.id }.maxWithOrNull(chatMessageOrder)?.timestamp ?: 0L }
    LazyColumn(contentPadding = PaddingValues(horizontal = 24.dp, vertical = 4.dp),
        verticalArrangement = Arrangement.spacedBy(16.dp)) {
        if (!initialNearby) item {
            Row(verticalAlignment = Alignment.CenterVertically) {
                Text(if (initialNearby) "Around you" else "Hey, ${state.displayName} 👋", Modifier.weight(1f), fontFamily = LokaDisplay.font, fontSize = 30.sp, letterSpacing = (-0.7).sp, maxLines = 2, overflow = androidx.compose.ui.text.style.TextOverflow.Ellipsis)
                FilledIconButton(onClick = myCode, shape = RoundedCornerShape(14.dp)) { Glyph("qr", color = MaterialTheme.colorScheme.onPrimary, description = "Share or scan a LOKA code") }
            }
        }
        if (!initialNearby) item {
            Row(Modifier.fillMaxWidth().horizontalScroll(rememberScrollState()), horizontalArrangement = Arrangement.spacedBy(16.dp)) {
                Column(Modifier.clickable(onClick = add), horizontalAlignment = Alignment.CenterHorizontally) {
                    Box(Modifier.size(56.dp).clip(CircleShape).background(LokaColors.mint), contentAlignment = Alignment.Center) { Glyph("plus", description = "Add someone") }
                    Text("Add", fontSize = 12.sp, modifier = Modifier.padding(top = 6.dp))
                }
                allContacts.take(8).forEach { friend ->
                    Column(Modifier.width(60.dp).clickable { open(friend.id) }, horizontalAlignment = Alignment.CenterHorizontally) {
                        Avatar(friend.label(), Modifier.size(56.dp), peerID = friend.id)
                        Text(friend.label(), fontSize = 12.sp, maxLines = 1, overflow = androidx.compose.ui.text.style.TextOverflow.Ellipsis, modifier = Modifier.padding(top = 6.dp))
                    }
                }
            }
        }
        if (nearbyMode) {
            item { NearbyRequestStack(state, model) }
            item { Surface(color = LokaColors.surface, shape = RoundedCornerShape(22.dp)) {
                Row(Modifier.fillMaxWidth().padding(16.dp), verticalAlignment = Alignment.CenterVertically) {
                    Glyph("group", color = LokaColors.mintAccent); Spacer(Modifier.width(12.dp))
                    Column(Modifier.weight(1f)) { Text("Visible nearby", fontWeight = FontWeight.Bold); Text(if (state.peopleVisible) "Let nearby people find you." else "Turn on to request a chat.", fontSize = 12.sp, color = LokaColors.muted) }
                    Switch(state.peopleVisible, model::showNearbyName)
                }
            } }
            item { NearbyRadar(if (state.running) org.loka.core.NearbyPeople.displayProfiles(state.nearbyPeople) else emptyList(), state.running) }
            val devices = if (!state.running) emptyList() else state.peers.filter { peer ->
                (peer.id.startsWith("ble:") || peer.id.startsWith("aware:") || peer.id.startsWith("wifi:")) && (peer.id in state.connected || (peer.readyToConnect && state.now - (state.peerSeenAt[peer.id] ?: 0L) < 30_000))
            }.sortedByDescending { state.signalSeenAt[it.id] ?: 0L }.distinctBy { it.id.removePrefix("ble:out:").removePrefix("ble:") }
            if (devices.isEmpty() && state.nearbyPeople.isEmpty()) item {
                Column(Modifier.fillMaxWidth().padding(vertical = 32.dp), horizontalAlignment = Alignment.CenterHorizontally) {
                    Glyph("nearby", Modifier.size(44.dp), LokaColors.muted)
                    Spacer(Modifier.height(16.dp))
                    Text(if (state.running) "No nearby LOKA devices" else "Nearby is turned off", fontSize = 22.sp, fontWeight = FontWeight.Bold)
                    Text(if (state.running) "Devices will appear here when LOKA finds them." else "Turn on nearby messaging to find phones around you.", color = LokaColors.muted)
                    if (!state.running) TextButton(onClick = nearby) { Text("Turn on nearby messaging") }
                }
            }
            val people = org.loka.core.NearbyPeople.displayProfiles(state.nearbyPeople)
            items(people, key = { "person:${it.id}" }) { person ->
                val friend = state.trusted.firstOrNull { it.id == person.id }
                val name = friend?.name?.takeIf { it.isNotBlank() } ?: person.name
                val request = state.chatRequests.firstOrNull { it.peer == person.id }
                val handles = state.nearbyPeople.filter { it.id == person.id }.map { it.handle }
                val signal = state.peers.filter { handles.any { handle -> nearbyRadioKey(handle) == nearbyRadioKey(it.id) } && state.now - (state.signalSeenAt[it.id] ?: 0L) < 30_000 }.mapNotNull { it.signalDbm }.filter { it in -127..-1 }.maxOrNull()
                Surface(shape = RoundedCornerShape(20.dp), color = LokaColors.surface) {
                    Row(Modifier.fillMaxWidth().padding(18.dp), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(14.dp)) {
                        Avatar(name, Modifier.size(48.dp), avatarID = person.avatarID)
                        Column(Modifier.weight(1f)) {
                            Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                                Text(name, Modifier.weight(1f), fontWeight = FontWeight.SemiBold)
                                NearbySignal(org.loka.core.NearbyPeople.bars(signal))
                            }
                            if (friend != null) TextButton(onClick = { open(person.id) }, contentPadding = PaddingValues(0.dp)) { Text("Message") }
                            else if (request == null) TextButton(onClick = { model.requestChat(person.id) }, enabled = state.peopleVisible, contentPadding = PaddingValues(0.dp)) { Text("Request chat") }
                            else Text(when (request.phase) { org.loka.core.ContactConsentBook.Phase.OUTGOING -> "Request sent"; org.loka.core.ContactConsentBook.Phase.INCOMING -> "Wants to chat"; org.loka.core.ContactConsentBook.Phase.DECLINED -> "Request declined"; else -> "Adding friend…" }, fontSize = 13.sp, color = LokaColors.muted)
                        }
                    }
                }
            }
            if (devices.any { peer -> state.nearbyPeople.none { nearbyRadioKey(it.handle) == nearbyRadioKey(peer.id) } }) item {
                Text("Looking for other people nearby…", style = MaterialTheme.typography.bodySmall, color = LokaColors.muted)
            }
            return@LazyColumn
        }
        item {
            OutlinedTextField(search, { search = it }, placeholder = { Text("Search conversations", fontSize = 14.sp) },
                leadingIcon = { Glyph("search", color = LokaColors.muted) }, singleLine = true,
                shape = RoundedCornerShape(18.dp), modifier = Modifier.fillMaxWidth(),
                colors = OutlinedTextFieldDefaults.colors(unfocusedBorderColor = LokaColors.line,
                    unfocusedContainerColor = LokaColors.surface, focusedContainerColor = LokaColors.surface))
        }
        if (allContacts.isEmpty()) item {
            Column(Modifier.fillMaxWidth().padding(top = 4.dp), horizontalAlignment = Alignment.CenterHorizontally) {
                ChatIllustration()
                Spacer(Modifier.height(12.dp))
                Text("Bring your people to LOKA", fontSize = 22.sp, lineHeight = 27.sp,
                    fontWeight = FontWeight.Bold, textAlign = androidx.compose.ui.text.style.TextAlign.Center, letterSpacing = (-0.5).sp)
                Spacer(Modifier.height(8.dp))
                Text("Scan a friend’s LOKA QR or share your own. Chat locally when a route is available.",
                    textAlign = androidx.compose.ui.text.style.TextAlign.Center, color = LokaColors.muted, fontSize = 14.sp, lineHeight = 21.sp)
                Spacer(Modifier.height(16.dp))
                Button(onClick = add, shape = RoundedCornerShape(16.dp), contentPadding = PaddingValues(horizontal = 28.dp, vertical = 15.dp)) {
                    Glyph("nearby", color = MaterialTheme.colorScheme.onPrimary); Spacer(Modifier.width(10.dp)); Text("Add someone", fontWeight = FontWeight.SemiBold)
                }
                Spacer(Modifier.height(12.dp))
                Row(verticalAlignment = Alignment.CenterVertically) { Glyph("lock", Modifier.size(14.dp), LokaColors.muted)
                    Spacer(Modifier.width(6.dp)); Text("Private by design. Local by nature.", fontSize = 11.sp, color = LokaColors.muted) }
            }
        } else {
            if (contacts.isEmpty()) item { Text("No conversations match your search.", color = LokaColors.muted) }
            if (allContacts.isEmpty()) item {
            Surface(shape = RoundedCornerShape(24.dp), color = LokaColors.mint) {
                Column(Modifier.padding(22.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
                    Text("Better together", fontSize = 22.sp, fontWeight = FontWeight.Bold)
                    Text("More people using LOKA nearby can help messages travel farther. Invite your friends to join your local network.", color = LokaColors.muted)
                    TextButton(onClick = {
                        runCatching {
                            val link = ContactCode.encode(Base64.decode(state.publicKey, Base64.NO_WRAP))
                            shareContext.startActivity(Intent.createChooser(Intent(Intent.ACTION_SEND).apply { type = "text/plain"; putExtra(Intent.EXTRA_TEXT, "Let’s connect on LOKA. If you have LOKA installed, add me with this link: $link") }, "Invite friends"))
                        }
                    }, enabled = state.ready) { Text("Invite friends") }
                }
            }
        }
        items(contacts, key = { it.id }) { friend ->
                val last = state.chatMessages.filter { it.peerId == friend.id }.maxWithOrNull(chatMessageOrder)
                Row(Modifier.fillMaxWidth().clip(RoundedCornerShape(14.dp)).background(if (selectedID == friend.id) LokaColors.mint else LokaColors.surface).clickable { open(friend.id) }.padding(horizontal = 14.dp, vertical = 14.dp), verticalAlignment = Alignment.CenterVertically) {
                    Avatar(friend.label(), Modifier.size(54.dp), peerID = friend.id)
                    Spacer(Modifier.width(14.dp))
                    Column(Modifier.weight(1f)) {
                        Text(friend.label(), fontSize = 16.sp, fontWeight = FontWeight.SemiBold)
                        Spacer(Modifier.height(5.dp))
                        Text(last?.let { if (it.image) "Photo" else if (it.voice) "Voice message" else if (it.outgoing) "You: ${it.body}" else it.body } ?: "Start a private conversation",
                            fontSize = 13.sp, color = LokaColors.muted, maxLines = 1, overflow = androidx.compose.ui.text.style.TextOverflow.Ellipsis)
                    }
                    Text(last?.let { time(it.timestamp) } ?: "", color = LokaColors.muted, fontSize = 11.sp)
                }
            }
        }
        item { Spacer(Modifier.height(12.dp)) }
    }
}

@Composable
private fun ConnectionCard(state: LabState, action: () -> Unit) {
    val pending = state.peers.any { it.id.startsWith("ble:") && it.readyToConnect && it.id !in state.allowed }
    val title = when { !state.running -> "Connect nearby"
        pending -> "A phone is waiting for approval"
        state.connected.isEmpty() -> "Ready to connect nearby"
        else -> "Local connection is on" }
    val caption = when { !state.running -> "Set up messaging without Internet"
        pending -> "Tap to allow your test phone"
        state.connected.isEmpty() -> "Tap to connect your other phone"
        else -> "No Internet needed · keep both apps open" }
    Row(Modifier.fillMaxWidth().clip(RoundedCornerShape(20.dp))
        .background(LokaColors.mint)
        .clickable(onClick = action).padding(16.dp), verticalAlignment = Alignment.CenterVertically) {
        Box(Modifier.size(40.dp).clip(CircleShape).background(LokaColors.surface), contentAlignment = Alignment.Center) { Glyph("nearby") }
        Spacer(Modifier.width(12.dp))
        Column(Modifier.weight(1f)) { Text(title, fontWeight = FontWeight.SemiBold, fontSize = 13.sp)
            Spacer(Modifier.height(4.dp)); Text(caption, fontSize = 11.sp, color = LokaColors.green) }
        Text("›", color = LokaColors.green, fontSize = 25.sp)
    }
}

@Composable
private fun NearbyScreen(state: LabState, model: LabViewModel, start: () -> Unit, add: () -> Unit, tools: () -> Unit) {
    var connectionToAllow by remember { mutableStateOf<String?>(null) }
    val peers = state.peers.filter { it.id.startsWith("ble:") && it.readyToConnect }
    val waiting = peers.filter { !state.automaticNearby && it.id !in state.allowed }
    LazyColumn(contentPadding = PaddingValues(24.dp), verticalArrangement = Arrangement.spacedBy(20.dp)) {
        item {
            Surface(shape = RoundedCornerShape(24.dp), color = LokaColors.mint) {
                Column(Modifier.fillMaxWidth().padding(24.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
                    Glyph("nearby", Modifier.size(36.dp))
                    Text(if (state.connected.isNotEmpty()) "You’re connected locally" else "Closer, even offline", fontWeight = FontWeight.Bold, fontSize = 25.sp)
                    Text("Connect nearby phones to send messages without Internet. Keep both apps open during this preview.", color = LokaColors.green, fontSize = 14.sp, lineHeight = 21.sp)
                }
            }
        }
        item { SettingsGroup("GET CONNECTED") {
            Column(Modifier.padding(20.dp), verticalArrangement = Arrangement.spacedBy(18.dp)) {
                HelpParagraph("1  Allow nearby access", if (state.running) "Nearby access is on. It stays on when you return to Chats." else "Let LOKA connect to nearby phones.")
                if (!state.running) Button(onClick = start, enabled = state.ready, modifier = Modifier.fillMaxWidth()) { Text("Turn on local connection") }
                HelpParagraph("2  Connect automatically", if (state.automaticNearby) "Nearby LOKA phones can carry encrypted messages automatically. Only verified friends can send you private messages." else if (waiting.isNotEmpty()) "Your other phone is ready. Allow its connection below." else "On iPhone, open Chats → Connect nearby and select a LOKA device. An approval will appear on this phone.")
                if (!state.automaticNearby) Button(onClick = { model.automaticNearby(true) }) { Text("Use automatic connections") }
                waiting.forEach { peer ->
                    Button(onClick = { connectionToAllow = peer.id }, modifier = Modifier.fillMaxWidth()) { Text("Allow nearby phone") }
                }
                HelpParagraph("3  Say hello", "Add each other using your LOKA QR codes, then open a chat. Pending messages retry when the connection is ready, for up to five minutes.")
                TextButton(onClick = add) { Text("Add someone") }
            }
        } }
        if (state.connected.isNotEmpty()) item { SettingsGroup("CONNECTED PHONES") {
            peers.filter { it.id in state.connected }.forEach { peer ->
                SettingsRow("nearby", "Nearby connection", "Block this nearby link", { model.allow(peer.id, false) })
            }
        } }
        item { SettingsGroup("WHAT YOU CAN SEND") {
            Column(Modifier.padding(20.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
                Text(if (state.connected.isEmpty()) "Waiting for a local connection" else "Local link connected", fontWeight = FontWeight.SemiBold)
                Text("Text · available in this version\nVoice notes · up to 60 seconds\nPhotos · resized for local delivery\nLive calls · not available yet", fontSize = 14.sp)
                Text("Both phones need an updated LOKA app. Signal strength and end-to-end speed are not measured on this Android connection. A nearby link does not prove your friend is reachable.", fontSize = 12.sp, color = LokaColors.muted)
            }
        } }
        item { SettingsGroup("PREFERENCES") {
            Column(Modifier.padding(20.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
                Row(verticalAlignment = Alignment.CenterVertically) {
                    Column(Modifier.weight(1f)) {
                        Text("Help messages travel", fontWeight = FontWeight.SemiBold)
                        Text("Carry encrypted messages for others", fontSize = 12.sp, color = LokaColors.muted)
                    }
                    Switch(state.relayEnabled, model::relay, enabled = state.ready)
                }
                Text("Uses local radios and battery. Connections never add friends automatically.", fontSize = 12.sp, color = LokaColors.muted)
                if (state.running) TextButton(onClick = model::stop) { Text("Turn off local connection") }
            }
        } }
        item { TextButton(onClick = tools) { Text("Engineering tools") } }
    }
    if (connectionToAllow != null) AlertDialog(onDismissRequest = { connectionToAllow = null },
        title = { Text("Allow nearby connection?") },
        text = { Text("Continue only if you selected this phone on your other device. We’ll remember this connection for automatic reconnection. It does not add a contact.") },
        confirmButton = { TextButton(onClick = {
            connectionToAllow?.let { model.allow(it, true); model.connect(it) }; connectionToAllow = null
        }) { Text("Allow connection") } },
        dismissButton = { TextButton(onClick = { connectionToAllow = null }) { Text("Cancel") } })
}

@OptIn(androidx.compose.foundation.ExperimentalFoundationApi::class, ExperimentalMaterial3Api::class)
@Composable
private fun ConversationScreen(contact: TrustedDevice, state: LabState, model: LabViewModel, back: () -> Unit, connections: () -> Unit) {
    var draft by rememberSaveable(contact.id) { mutableStateOf("") }
    var reactionID by remember(contact.id) { mutableStateOf<String?>(null) }
    var infoID by remember(contact.id) { mutableStateOf<String?>(null) }
    var rename by remember { mutableStateOf(false) }
    var securityInfo by remember { mutableStateOf(false) }
    var name by remember(contact.id) { mutableStateOf(contact.name) }
    val context = LocalContext.current
    val imageScope = rememberCoroutineScope()
    var imageDraft by remember(contact.id) { mutableStateOf<ByteArray?>(null) }
    var preparingImage by remember { mutableStateOf(false) }
    val choosePhoto = rememberLauncherForActivityResult(ActivityResultContracts.GetContent()) { uri ->
        if (uri != null && !preparingImage) imageScope.launch {
            preparingImage = true
            runCatching { withContext(Dispatchers.IO) { ImageAttachment.prepare(context.contentResolver, uri) } }
                .onSuccess { imageDraft = it }.onFailure { model.reportError("Could not prepare that photo. Try another image under 16 MB.") }
            preparingImage = false
        }
    }
    var capturePath by rememberSaveable(contact.id) { mutableStateOf<String?>(null) }
    val takePhoto = rememberLauncherForActivityResult(ActivityResultContracts.TakePicture()) { success ->
        val file = capturePath?.let { java.io.File(it) }; capturePath = null
        if (success && file != null) imageScope.launch {
            preparingImage = true
            try { imageDraft = withContext(Dispatchers.IO) { ImageAttachment.prepare(context.contentResolver, android.net.Uri.fromFile(file)) } }
            catch (_: Exception) { model.reportError("Could not prepare that photo. Try again.") }
            finally { preparingImage = false; file.delete() }
        } else file?.delete()
    }
    fun launchCamera() {
        if (capturePath != null) return
        val directory = java.io.File(context.cacheDir, "captures").apply { mkdirs() }
        directory.listFiles()?.filter { System.currentTimeMillis() - it.lastModified() > 3_600_000 }?.forEach { it.delete() }
        val file = java.io.File.createTempFile("photo-", ".jpg", directory)
        capturePath = file.absolutePath
        runCatching { takePhoto.launch(androidx.core.content.FileProvider.getUriForFile(context, "${context.packageName}.camera", file)) }
            .onFailure { file.delete(); capturePath = null; model.reportError("Camera unavailable. Choose a photo with + instead.") }
    }
    val cameraPermission = rememberLauncherForActivityResult(ActivityResultContracts.RequestPermission()) { granted ->
        if (granted) launchCamera() else model.reportError("Allow camera access to take a photo.")
    }
    val voice = remember(contact.id) { VoiceNote(context) }
    val mic = rememberLauncherForActivityResult(ActivityResultContracts.RequestPermission()) { granted ->
        if (granted) voice.start() else model.reportError("Allow microphone access to record a voice note.")
    }
    DisposableEffect(contact.id) {
        LocalNotifications.visibleFriend = contact.id; LocalNotifications.cancel(context, contact.id)
        onDispose { model.typing(contact.id, false); voice.discard(); LocalNotifications.visibleFriend = null }
    }
    val lifecycleOwner = androidx.lifecycle.compose.LocalLifecycleOwner.current
    var foreground by remember { mutableStateOf(lifecycleOwner.lifecycle.currentState.isAtLeast(androidx.lifecycle.Lifecycle.State.RESUMED)) }
    DisposableEffect(lifecycleOwner) {
        val observer = androidx.lifecycle.LifecycleEventObserver { _, event ->
            if (event == androidx.lifecycle.Lifecycle.Event.ON_RESUME) { foreground = true; LocalNotifications.visibleFriend = contact.id }
            if (event == androidx.lifecycle.Lifecycle.Event.ON_PAUSE) { foreground = false; model.typing(contact.id, false); if (voice.recording) voice.stop(); LocalNotifications.visibleFriend = null }
        }
        lifecycleOwner.lifecycle.addObserver(observer)
        onDispose { lifecycleOwner.lifecycle.removeObserver(observer) }
    }
    LaunchedEffect(draft, foreground) {
        if (!foreground || draft.isBlank()) model.typing(contact.id, false)
        kotlinx.coroutines.delay(4_000)
        model.typing(contact.id, false)
    }
    val sending = contact.id in state.sending
    val messages = state.chatMessages.filter { it.peerId == contact.id }.sortedWith(chatMessageOrder)
    val list = rememberLazyListState()
    val readThreshold = with(androidx.compose.ui.platform.LocalDensity.current) { 60.dp.roundToPx() }
    LaunchedEffect(list, messages.size, foreground, infoID, reactionID) {
        snapshotFlow {
            val layout = list.layoutInfo
            layout.visibleItemsInfo.filter { minOf(it.offset + it.size, layout.viewportEndOffset) - maxOf(it.offset, layout.viewportStartOffset) >= minOf(it.size, readThreshold) }.mapNotNull { it.key as? String }.toSet()
        }.collect { ids ->
            if (foreground && infoID == null && reactionID == null) model.markRead(ids)
        }
    }
    LaunchedEffect(messages.lastOrNull()?.id) { if (messages.isNotEmpty()) list.animateScrollToItem(messages.lastIndex) }
    Column(Modifier.fillMaxSize().imePadding()) {
        Row(Modifier.fillMaxWidth().padding(horizontal = 12.dp, vertical = 4.dp), verticalAlignment = Alignment.CenterVertically) {
            IconButton(onClick = back) { Glyph("back", description = "Go back") }
            Avatar(contact.label(), Modifier.size(44.dp).clickable { rename = true }.semantics { contentDescription = "Edit contact name" }, peerID = contact.id)
            Spacer(Modifier.width(12.dp))
            Column(Modifier.weight(1f)) {
                Text(contact.label(), fontWeight = FontWeight.SemiBold)
                if ((state.typingUntil[contact.id] ?: 0) > state.now) Text("Typing…", color = LokaColors.green, fontSize = 12.sp, modifier = Modifier.semantics { liveRegion = androidx.compose.ui.semantics.LiveRegionMode.Polite })
            }
            IconButton(onClick = { securityInfo = true }, modifier = Modifier.background(LokaColors.mint, CircleShape)) { Glyph("lock", description = "About message security") }
        }
        LazyColumn(Modifier.weight(1f).fillMaxWidth().lokaDoodles(), state = list, contentPadding = PaddingValues(20.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
            if (messages.isEmpty()) item {
                Column(Modifier.fillMaxWidth().padding(vertical = 40.dp), horizontalAlignment = Alignment.CenterHorizontally) {
                    Avatar(contact.label(), Modifier.size(64.dp), peerID = contact.id); Spacer(Modifier.height(14.dp))
                    Text("Say hello to ${contact.label()}", fontWeight = FontWeight.SemiBold)
                    Text("Your conversation starts here.", fontSize = 13.sp, color = LokaColors.muted)
                }
            }
            items(messages, key = { it.id }) { message ->
                val unconfirmed = message.outgoing && !message.delivered && (state.now - message.timestamp >= message.lifetime || !message.activeQueue)
                val purpleBubble = message.outgoing && message.delivered && !message.voice
                val statusColor = if (purpleBubble) { if (message.readAt != null) LokaColors.mintAccent else Color.White.copy(alpha = .8f) } else if (unconfirmed) MaterialTheme.colorScheme.onErrorContainer else if (message.readAt != null) Color(0xFF2585D9) else LokaColors.muted
                BoxWithConstraints(Modifier.fillMaxWidth()) {
                    val bubbleWidth = minOf(maxWidth * 0.88f, 420.dp)
                    Column(Modifier.align(if (message.outgoing) Alignment.CenterEnd else Alignment.CenterStart).widthIn(max = bubbleWidth).semantics { customActions = listOf(androidx.compose.ui.semantics.CustomAccessibilityAction("Message info") { infoID = message.id; true }) }.combinedClickable(onClick = {}, onDoubleClick = { infoID = message.id }, onLongClickLabel = "React to message", onLongClick = { reactionID = message.id }).clip(RoundedCornerShape(18.dp, 18.dp, if (message.outgoing) 4.dp else 18.dp, if (message.outgoing) 18.dp else 4.dp))
                        .background(if (unconfirmed) MaterialTheme.colorScheme.errorContainer else if (purpleBubble) Color(0xFF7825E8) else if (message.outgoing && message.delivered) LokaColors.mint else if (message.outgoing) LokaColors.pendingBubble else LokaColors.surface).padding(14.dp)) {
                        if (message.image) {
                            val bitmap = remember(message.id) { val bytes = Base64.decode(message.body, Base64.NO_WRAP); if (org.loka.core.ChatContent.validImage(bytes)) android.graphics.BitmapFactory.decodeByteArray(bytes, 0, bytes.size) else null }
                            if (bitmap != null) Image(bitmap.asImageBitmap(), "Photo message", Modifier.fillMaxWidth().heightIn(max = 280.dp)) else Text("Photo unavailable")
                        } else if (message.voice) VoiceBubble(Base64.decode(message.body, Base64.NO_WRAP))
                        else Text(message.body, fontSize = 15.sp, lineHeight = 22.sp, color = if (purpleBubble) Color.White else LokaColors.ink)
                        val mine = org.loka.core.ChatContent.reactionEmoji(message.myReaction)
                        val theirs = org.loka.core.ChatContent.reactionEmoji(message.peerReaction)
                        if (mine.isNotEmpty() || theirs.isNotEmpty()) Text(listOf(mine, theirs).filter { it.isNotEmpty() }.joinToString("  "), fontSize = 18.sp, modifier = Modifier.semantics { contentDescription = "Your reaction: ${mine.ifEmpty { "none" }}. Their reaction: ${theirs.ifEmpty { "none" }}" })
                        Spacer(Modifier.height(5.dp))
                        Row(Modifier.align(Alignment.End), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(5.dp)) {
                        Text(time(message.timestamp), fontSize = 11.sp, color = if (purpleBubble) Color.White.copy(alpha = .8f) else LokaColors.muted)
                        if (message.outgoing) {
                            val status = if (message.readAt != null) "Read" else if (message.delivered) "Delivered" else if (unconfirmed) "Delivery not confirmed" else if (state.connected.isEmpty()) "Waiting for a connection" else "Sending, awaiting delivery confirmation"
                            if (!message.delivered && !unconfirmed && state.connected.isNotEmpty()) CircularProgressIndicator(Modifier.size(12.dp).semantics { contentDescription = status }, strokeWidth = 1.5.dp, color = statusColor)
                            else Text(if (message.delivered) "✓✓" else if (unconfirmed) "!" else "◷", fontSize = 12.sp, color = statusColor, modifier = Modifier.semantics { contentDescription = status })
                        }
                        }
                    }
                }
            }
        }
        if (state.connected.isEmpty()) TextButton(onClick = connections, modifier = Modifier.fillMaxWidth()) { Text("Connect nearby") }
        if (preparingImage) LinearProgressIndicator(Modifier.fillMaxWidth())
        imageDraft?.let { bytes ->
            val thumbnail = remember(bytes) { android.graphics.BitmapFactory.decodeByteArray(bytes, 0, bytes.size) }
            Column(Modifier.fillMaxWidth().background(LokaColors.surface).padding(12.dp)) {
                if (thumbnail != null) Image(thumbnail.asImageBitmap(), "Photo ready to send", Modifier.fillMaxWidth().height(150.dp))
                Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween) {
                    TextButton(onClick = { imageDraft = null }, enabled = !sending) { Text("Remove") }
                    Button(onClick = { model.sendImage(contact.id, bytes) { imageDraft = null } }, enabled = !sending) { Text(if (sending) "Sending…" else "Send photo") }
                }
            }
        }
        if (voice.recording || voice.bytes != null) {
            Row(Modifier.fillMaxWidth().background(LokaColors.surface).padding(12.dp), verticalAlignment = Alignment.CenterVertically) {
                TextButton(onClick = voice::discard, enabled = !sending) { Text("Cancel") }
                if (voice.recording) {
                    Column(Modifier.weight(1f)) {
                        Text("● ${voice.seconds / 60}:${(voice.seconds % 60).toString().padStart(2, '0')} / 1:00", color = LokaColors.green)
                        Row(Modifier.height(28.dp), horizontalArrangement = Arrangement.spacedBy(3.dp), verticalAlignment = Alignment.CenterVertically) {
                            voice.levels.forEach { level -> Box(Modifier.width(3.dp).height((4 + level * 24).dp).clip(CircleShape).background(LokaColors.green)) }
                        }
                    }
                    Button(onClick = voice::stop) { Text("Stop") }
                } else {
                    TextButton(onClick = { voice.bytes?.let(voice::play) }, modifier = Modifier.weight(1f)) { Text(if (voice.playing) "Stop preview" else "▶ Preview voice note") }
                    Button(onClick = { voice.bytes?.let { model.sendVoice(contact.id, it) { voice.discard() } } }, enabled = !sending) {
                        if (sending) CircularProgressIndicator(Modifier.size(20.dp), strokeWidth = 2.dp) else Text("Send")
                    }
                }
            }
        } else if (imageDraft == null) Row(Modifier.fillMaxWidth().background(LokaColors.surface).padding(12.dp), verticalAlignment = Alignment.Bottom) {
            IconButton(onClick = { choosePhoto.launch("image/*") }, enabled = !sending && !preparingImage && state.trusted.any { it.id == contact.id }) { Glyph("plus", description = "Attach photo") }
            OutlinedTextField(draft, { draft = it; model.typing(contact.id, foreground && it.isNotBlank()) }, enabled = !sending, placeholder = { Text("Message", fontSize = 16.sp) }, shape = RoundedCornerShape(28.dp),
                modifier = Modifier.weight(1f), maxLines = 5,
                colors = OutlinedTextFieldDefaults.colors(unfocusedBorderColor = LokaColors.line, focusedBorderColor = LokaColors.green,
                    unfocusedContainerColor = LokaColors.surface, focusedContainerColor = LokaColors.surface, cursorColor = LokaColors.green))
            if (draft.isBlank()) IconButton(onClick = {
                if (context.checkSelfPermission(android.Manifest.permission.CAMERA) == android.content.pm.PackageManager.PERMISSION_GRANTED) launchCamera()
                else cameraPermission.launch(android.Manifest.permission.CAMERA)
            }, enabled = !sending && !preparingImage) { Glyph("camera", description = "Take photo") }
            Spacer(Modifier.width(4.dp))
            if (draft.isBlank()) IconButton(onClick = {
                if (context.checkSelfPermission(android.Manifest.permission.RECORD_AUDIO) == android.content.pm.PackageManager.PERMISSION_GRANTED) voice.start()
                else mic.launch(android.Manifest.permission.RECORD_AUDIO)
            }, modifier = Modifier.size(48.dp), enabled = state.ready && !sending && state.trusted.any { it.id == contact.id }) { Glyph("mic", description = "Record voice note") }
            else FilledIconButton(onClick = { val submitted = draft; model.send(contact.id, submitted) { if (draft == submitted) draft = "" } },
                enabled = state.ready && !sending && state.trusted.any { it.id == contact.id } && draft.toByteArray(Charsets.UTF_8).size <= 1400,
                modifier = Modifier.size(48.dp), shape = CircleShape) {
                if (sending) CircularProgressIndicator(Modifier.size(22.dp), strokeWidth = 2.dp)
                else Glyph("send", color = MaterialTheme.colorScheme.onPrimary, description = "Send message")
            }
        }
        voice.error?.let { Text(it, color = MaterialTheme.colorScheme.error, fontSize = 12.sp, modifier = Modifier.padding(12.dp)) }
        if (draft.toByteArray(Charsets.UTF_8).size > 1400) Text("This message is too long. Try a shorter one.", color = MaterialTheme.colorScheme.error, fontSize = 12.sp, modifier = Modifier.padding(12.dp))
    }
    state.chatMessages.firstOrNull { it.id == reactionID }?.let { message ->
        androidx.compose.ui.window.Dialog(onDismissRequest = { reactionID = null }) {
            Surface(shape = RoundedCornerShape(24.dp), color = LokaColors.surface, tonalElevation = 4.dp) {
                Column(Modifier.padding(12.dp)) {
                    Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceEvenly) {
                        org.loka.core.ChatContent.REACTIONS.filter { it.isNotEmpty() }.forEach { emoji ->
                            TextButton(onClick = { model.react(message.id, emoji); reactionID = null }, modifier = Modifier.weight(1f), contentPadding = PaddingValues(0.dp), enabled = state.ready && state.trusted.any { it.id == contact.id }) { Text(emoji, fontSize = 24.sp) }
                        }
                    }
                    if (org.loka.core.ChatContent.reactionEmoji(message.myReaction).isNotEmpty()) TextButton(onClick = { model.react(message.id, ""); reactionID = null }) { Text("Remove reaction") }
                    if (!message.voice && !message.image) TextButton(onClick = {
                        (context.getSystemService(android.content.Context.CLIPBOARD_SERVICE) as android.content.ClipboardManager).setPrimaryClip(android.content.ClipData.newPlainText("Message", message.body)); reactionID = null
                    }) { Text("Copy text") }
                }
            }
        }
    }
    state.chatMessages.firstOrNull { it.id == infoID }?.let { message ->
        ModalBottomSheet(onDismissRequest = { infoID = null }, containerColor = LokaColors.surface,
            sheetState = rememberModalBottomSheetState(skipPartiallyExpanded = false)) {
            Column(Modifier.fillMaxWidth().verticalScroll(rememberScrollState()).padding(horizontal = 24.dp).padding(bottom = 24.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
                Text("Message info", style = MaterialTheme.typography.titleLarge)
                Text("Sent · ${SimpleDateFormat("MMM d · h:mm a", Locale.getDefault()).format(Date(message.timestamp))}")
                if (message.outgoing) {
                    Text("Delivered · " + (message.deliveredAt?.let(::time) ?: if (message.delivered) "Confirmed" else "Not yet confirmed"))
                    Text("Read · " + (message.readAt?.let(::time) ?: "Not yet confirmed"))
                } else Text("Received on this phone")
                message.reportedHops?.let { Text("Reported hops · $it (estimate)") }
                MessageRouteFlow(message, contact.name, state.trusted.firstOrNull { it.id == message.route?.carrier }?.name?.takeIf { it.isNotBlank() }
                    ?: state.nearbyPeople.firstOrNull { it.id == message.route?.carrier }?.name ?: "Nearby phone")
                if (message.reactionPacket != null) Text(if (state.now - org.loka.core.ChatContent.reactionVersion(message.myReaction).first >= MAX_LIFETIME_MS) "Reaction delivery not confirmed." else "Your reaction is waiting for confirmation.", fontSize = 12.sp)
                if (!message.voice && !message.image) TextButton(onClick = {
                    (context.getSystemService(android.content.Context.CLIPBOARD_SERVICE) as android.content.ClipboardManager).setPrimaryClip(android.content.ClipData.newPlainText("Message", message.body))
                }) { Text("Copy text") }
            }
        }
    }

    if (securityInfo) AlertDialog(onDismissRequest = { securityInfo = false }, title = { Text("Message security") },
        text = { Text("Your messages, photos and voice notes are encrypted between you and your friend. Phones helping deliver them cannot read them. Verify your friend’s code for extra confidence. LOKA is still a security preview.") },
        confirmButton = { TextButton(onClick = { securityInfo = false }) { Text("Got it") } })
    if (rename) AlertDialog(onDismissRequest = { rename = false }, title = { Text("Friend's name") },
        text = { OutlinedTextField(name, { name = it }, label = { Text("Name on this phone") }, singleLine = true) },
        confirmButton = { TextButton(onClick = { model.renameContact(contact.id, name); rename = false }) { Text("Save") } },
        dismissButton = { TextButton(onClick = { rename = false }) { Text("Cancel") } })
}

@Composable
private fun ProfileScreen(state: LabState, model: LabViewModel, open: (String) -> Unit, backups: () -> Unit) {
    var editing by remember { mutableStateOf(false) }
    var choosingTheme by remember { mutableStateOf(false) }
    var choosingAvatar by remember { mutableStateOf(false) }
    var name by remember(state.displayName) { mutableStateOf(state.displayName) }
    LazyColumn(contentPadding = PaddingValues(horizontal = 20.dp, vertical = 8.dp), verticalArrangement = Arrangement.spacedBy(24.dp)) {
        item {
            Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
                Box(Modifier.size(132.dp)) {
                    Canvas(Modifier.fillMaxSize()) {
                        drawArc(LokaColors.yellow, -40f, 35f, false, style = Stroke(7.dp.toPx(), cap = androidx.compose.ui.graphics.StrokeCap.Round))
                        drawArc(LokaColors.yellow, 125f, 40f, false, style = Stroke(7.dp.toPx(), cap = androidx.compose.ui.graphics.StrokeCap.Round))
                        drawLine(LokaColors.mintAccent, Offset(3.dp.toPx(),12.dp.toPx()), Offset(8.dp.toPx(),22.dp.toPx()), 5.dp.toPx(), cap = androidx.compose.ui.graphics.StrokeCap.Round)
                    }
                    ProfilePortrait(state.displayName, Modifier.size(116.dp).align(Alignment.Center), own = true)
                    FilledIconButton(onClick = { choosingAvatar = true }, modifier = Modifier.align(Alignment.BottomEnd)) { Glyph("camera", color = MaterialTheme.colorScheme.onPrimary, description = "Change profile picture") }
                }
                Spacer(Modifier.width(18.dp))
                Column(Modifier.weight(1f)) {
                    Row(verticalAlignment = Alignment.CenterVertically) {
                        Text(state.displayName, fontFamily = LokaDisplay.font, fontSize = 26.sp, modifier = Modifier.weight(1f))
                        IconButton(onClick = { editing = true }) { Glyph("edit", description = "Edit your name") }
                    }
                    Text("Here for good chats\nand great games.", color = LokaColors.muted)
                }
            }
        }
        item {
            Row(horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                Button(onClick = { editing = true }, modifier = Modifier.weight(1f), shape = RoundedCornerShape(16.dp)) { Glyph("edit", color = MaterialTheme.colorScheme.onPrimary); Spacer(Modifier.width(8.dp)); Text("Edit profile") }
                FilledIconButton(onClick = { open("My LOKA") }) { Glyph("qr", color = MaterialTheme.colorScheme.onPrimary, description = "Show my contact QR code") }
            }
        }
        item {
            Row(Modifier.height(IntrinsicSize.Max), horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                Column(Modifier.weight(1f).fillMaxHeight().clip(RoundedCornerShape(22.dp)).background(LokaColors.yellow).padding(18.dp)) {
                    Glyph("game", color = Color(0xFF2C0C40))
                    Text("Games played", color = Color(0xFF2C0C40), fontWeight = FontWeight.Bold)
                    Text("Coming soon", color = Color(0xFF2C0C40), fontSize = 18.sp)
                }
                ProfileCount("Friends", state.trusted.size, LokaColors.mintAccent, Modifier.weight(1f).fillMaxHeight())
            }
        }
        item {
            SettingsGroup("SETTINGS") {
                Row(Modifier.fillMaxWidth().padding(18.dp), verticalAlignment = Alignment.CenterVertically) {
                    Glyph("group"); Spacer(Modifier.width(12.dp))
                    Column(Modifier.weight(1f)) { Text("Nearby visibility", fontWeight = FontWeight.Bold); Text("Let nearby people find and chat with you.", fontSize = 12.sp, color = LokaColors.muted) }
                    Switch(state.peopleVisible, model::showNearbyName)
                }
                SettingsDivider()
                SettingsRow("lock", "Privacy & trusted contacts", "Control who can find and message you", { open("Privacy") })
                SettingsDivider()
                SettingsRow("chat", "Chats & backups", "History and encrypted backups", backups)
                SettingsDivider()
                SettingsRow("palette", "Theme", "Choose your style", { choosingTheme = true })
            }
        }
        item { Surface(color = LokaColors.mint, shape = RoundedCornerShape(22.dp)) { Row(Modifier.padding(18.dp)) {
            Glyph("lock", color = LokaColors.mintAccent); Spacer(Modifier.width(12.dp))
            Column { Text("You choose who can find you.", fontWeight = FontWeight.Bold); Text("Stay in control. Chat and connect safely, offline.", color = LokaColors.muted, fontSize = 13.sp) }
        } } }
        item {
            SettingsGroup("PREFERENCES & HELP") {
                SettingsRow("group", "Community sharing", "Wi-Fi and mobile sharing preferences", { open("Community sharing") })
                SettingsDivider()
                SettingsRow("nearby", "Local connection", "Chat nearby without Internet", { open("Local connection") })
                SettingsDivider()
                SettingsRow("nearby", "Router-free Wi-Fi", "Phone-to-phone messaging. No Internet needed.", { open("Router-free Wi-Fi") })
                SettingsDivider()
                SettingsRow("nearby", "Background messaging", "Keep messages arriving when you leave LOKA", { open("Background messaging") })
                SettingsDivider()
                SettingsRow("info", "Help & app info", "Getting started and about LOKA", { open("Help & app info") })
            }
        }
        item {
            Column(Modifier.fillMaxWidth().padding(vertical = 8.dp), horizontalAlignment = Alignment.CenterHorizontally) {
                Text("LOKA", fontSize = 15.sp, fontWeight = FontWeight.Bold, letterSpacing = 2.sp, color = LokaColors.green)
                Spacer(Modifier.height(6.dp))
                Text("Your world, closer.", fontSize = 12.sp, color = LokaColors.muted)
                Spacer(Modifier.height(20.dp))
            }
        }
    }
    if (choosingTheme) ThemeChoices { choosingTheme = false }
    if (choosingAvatar) AvatarPickerSheet { choosingAvatar = false }
    if (editing) AlertDialog(onDismissRequest = { editing = false }, title = { Text("Edit profile") },
        text = { Column(Modifier.verticalScroll(rememberScrollState()), verticalArrangement = Arrangement.spacedBy(12.dp)) {
            ProfilePortrait(state.displayName, Modifier.size(92.dp).clickable { choosingAvatar = true }, own = true)
            TextButton(onClick = { choosingAvatar = true }) { Text("Change avatar") }
            OutlinedTextField(name, { name = it.take(40) }, singleLine = true, label = { Text("Your name") })
            Text("This name is saved on your phone.", fontSize = 12.sp, color = LokaColors.muted)
        } },
        confirmButton = { TextButton(onClick = { model.setDisplayName(name); editing = false }) { Text("Save") } },
        dismissButton = { TextButton(onClick = { editing = false }) { Text("Cancel") } })
}

@Composable
private fun SettingsGroup(label: String, content: @Composable ColumnScope.() -> Unit) {
    Column(verticalArrangement = Arrangement.spacedBy(10.dp)) {
        Text(label, Modifier.padding(start = 16.dp), fontSize = 10.sp, letterSpacing = 1.3.sp, fontWeight = FontWeight.SemiBold, color = LokaColors.muted)
        Surface(shape = RoundedCornerShape(20.dp), color = LokaColors.surface) { Column(content = content) }
    }
}

@Composable
private fun SettingsRow(icon: String, title: String, subtitle: String, action: () -> Unit) {
    Row(Modifier.fillMaxWidth().clickable(onClick = action).padding(horizontal = 18.dp, vertical = 18.dp), verticalAlignment = Alignment.CenterVertically) {
        Box(Modifier.size(40.dp).background(LokaColors.mint, RoundedCornerShape(12.dp)), contentAlignment = Alignment.Center) {
            Glyph(icon, Modifier.size(21.dp))
        }
        Spacer(Modifier.width(16.dp))
        Column(Modifier.weight(1f)) {
            Text(title, fontSize = 16.sp, fontWeight = FontWeight.SemiBold, color = LokaColors.ink)
            Spacer(Modifier.height(4.dp))
            Text(subtitle, fontSize = 12.sp, lineHeight = 18.sp, color = LokaColors.muted)
        }
        Spacer(Modifier.width(12.dp))
        Glyph("chevron", Modifier.size(16.dp), LokaColors.muted)
    }
}

@Composable
private fun SettingsDivider() { HorizontalDivider(Modifier.padding(start = 74.dp, end = 18.dp), color = LokaColors.line.copy(alpha = .65f)) }

@Composable
private fun ProfileDetailScreen(page: String, state: LabState, model: LabViewModel, tools: () -> Unit, backups: () -> Unit) {
    val context = LocalContext.current
    var reset by remember { mutableStateOf(false) }
    if (reset) AlertDialog(onDismissRequest = { reset = false }, title = { Text("Delete all LOKA data?") }, text = { Text("This removes your profile, friends, messages and device identity from this phone. LOKA will close; reopen it to start again. Android also resets app permissions. Saved backup files and messages on other phones remain. Delete exported backups in their storage provider.") }, confirmButton = { TextButton(onClick = {
        val manager = context.getSystemService(android.app.ActivityManager::class.java)
        if (!manager.clearApplicationUserData()) model.reportError("Could not clear app data. Try again from Android Settings.")
    }) { Text("Delete all data", color = MaterialTheme.colorScheme.error) } }, dismissButton = { Column { TextButton(onClick = { reset = false; backups() }) { Text("Back up first") }; TextButton(onClick = { reset = false }) { Text("Cancel") } } })
    var forget by remember { mutableStateOf<TrustedDevice?>(null) }
    LazyColumn(contentPadding = PaddingValues(20.dp), verticalArrangement = Arrangement.spacedBy(18.dp)) {
        when (page) {
            "My LOKA" -> item { MyContactCard(state, model) }
            "Privacy" -> {
                item { TextButton(onClick = { reset = true }) { Text("Delete all app data", color = MaterialTheme.colorScheme.error) } }
                item { SettingsGroup("YOUR CONVERSATIONS") {
                    Column(Modifier.padding(20.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
                        Text("You choose who can message you", fontSize = 19.sp, fontWeight = FontWeight.Bold)
                        Text("Only devices you have verified can send you readable personal messages. A network connection does not add someone to your contacts.", fontSize = 14.sp, lineHeight = 21.sp, color = LokaColors.muted)
                        Text("Encryption is experimental in this preview and is awaiting independent review.", fontSize = 12.sp, color = LokaColors.muted)
                    }
                } }
                item { Text("TRUSTED CONTACTS · ${state.trusted.size}", fontSize = 10.sp, letterSpacing = 1.sp, color = LokaColors.muted, modifier = Modifier.padding(start = 16.dp)) }
                if (state.trusted.isEmpty()) item {
                    Surface(shape = RoundedCornerShape(20.dp), color = LokaColors.surface) {
                        Text("Your verified contacts will appear here. Add a friend from Chats using their contact QR or link.", Modifier.padding(20.dp), color = LokaColors.muted, fontSize = 14.sp)
                    }
                }
                items(state.trusted, key = { it.id }) { friend ->
                    Surface(shape = RoundedCornerShape(18.dp), color = LokaColors.surface) {
                        Row(Modifier.fillMaxWidth().padding(16.dp), verticalAlignment = Alignment.CenterVertically) {
                            Avatar(friend.label(), Modifier.size(44.dp), peerID = friend.id); Spacer(Modifier.width(12.dp))
                            Text(friend.label(), Modifier.weight(1f), fontWeight = FontWeight.SemiBold)
                            TextButton(onClick = { forget = friend }) { Text("Remove") }
                        }
                    }
                }
            }
            "Help & app info" -> {
                item { Surface(shape = RoundedCornerShape(20.dp), color = LokaColors.surface) {
                    Column(Modifier.fillMaxWidth().padding(24.dp), horizontalAlignment = Alignment.CenterHorizontally) {
                        Text("LOKA", fontSize = 30.sp, fontWeight = FontWeight.ExtraBold, color = LokaColors.green)
                        Spacer(Modifier.height(6.dp)); Text("Your world, closer.", color = LokaColors.muted, fontSize = 13.sp)
                        Spacer(Modifier.height(14.dp)); Text("Version ${BuildConfig.VERSION_NAME} · Early preview", color = LokaColors.muted, fontSize = 12.sp)
                    }
                } }
                item { SettingsGroup("GETTING STARTED") {
                    Column(Modifier.padding(20.dp), verticalArrangement = Arrangement.spacedBy(16.dp)) {
                        HelpParagraph("Add a friend", "Open Chats and tap +. Scan their contact QR or paste their link, then compare the security code before adding them.")
                        HelpParagraph("Keep your chats", "Open Settings → Chats to save an encrypted backup. Store its recovery key separately; you need it to restore your history.")
                        HelpParagraph("Send a message", "Both people must verify each other. Delivery needs a working local route. Saved or queued messages are not delivery receipts.")
                    }
                } }
                item { SettingsGroup("ABOUT THIS PREVIEW") {
                    Text("Text messaging and encrypted history are available. Phone-number registration, automatic network setup, Internet messaging and automatic cloud backups are still in development. Encryption is experimental and awaiting independent review.", Modifier.padding(20.dp), color = LokaColors.muted, fontSize = 13.sp, lineHeight = 20.sp)
                } }
            }
        }
        item { Spacer(Modifier.height(8.dp)) }
    }
    forget?.let { friend -> AlertDialog(onDismissRequest = { forget = null }, title = { Text("Remove trusted contact?") },
        text = { Text("You will no longer authorize messages from this device. Saved history stays on your phone. You can verify their contact code again later.") },
        confirmButton = { TextButton(onClick = { model.forget(friend.id); forget = null }) { Text("Remove") } },
        dismissButton = { TextButton(onClick = { forget = null }) { Text("Cancel") } }) }
}

@Composable
private fun HelpParagraph(title: String, body: String) {
    Column(verticalArrangement = Arrangement.spacedBy(6.dp)) {
        Text(title, fontSize = 15.sp, fontWeight = FontWeight.SemiBold)
        Text(body, fontSize = 13.sp, lineHeight = 20.sp, color = LokaColors.muted)
    }
}

@Composable
private fun AddFriendDialog(state: LabState, model: LabViewModel, initialLink: String, scan: () -> Unit, image: () -> Unit, share: () -> Unit, dismiss: () -> Unit) {
    var name by remember { mutableStateOf("") }
    var link by remember(initialLink) { mutableStateOf(initialLink) }
    val key = remember(link) { runCatching { ContactCode.decode(link) }.getOrNull() }
    val code = key?.let { fingerprint(it) }
    var saved by remember { mutableStateOf(false) }
    var details by remember { mutableStateOf(false) }
    if (saved) {
        AlertDialog(onDismissRequest = dismiss, title = { Text("Friend saved") },
            text = { Text("They’re saved on this phone. Share your LOKA QR so they can add you too. Keep both apps open while testing messages.") },
            confirmButton = { TextButton(onClick = share) { Text("Share My LOKA") } },
            dismissButton = { TextButton(onClick = dismiss) { Text("Done") } })
        return
    }
    AlertDialog(onDismissRequest = dismiss, title = { Text("Add someone") },
        text = { Column(Modifier.verticalScroll(androidx.compose.foundation.rememberScrollState()), verticalArrangement = Arrangement.spacedBy(12.dp)) {
            Text("Scan your friend’s QR or paste the link they shared with you.", fontSize = 13.sp, color = LokaColors.muted)
            if (link.isBlank()) OutlinedButton(onClick = scan, modifier = Modifier.fillMaxWidth()) { Text("Scan QR") }
            if (link.isBlank()) TextButton(onClick = image) { Text("Choose a saved QR image") }
            if (code == null) OutlinedTextField(link, { link = it.take(2049) }, label = { Text("Paste their contact link") }, maxLines = 3)
            OutlinedTextField(name, { name = it.take(40) }, label = { Text("Name on your phone") }, singleLine = true)
            PhoneContactNameField { name = it }
            if (code != null) {
                Text("Ask your friend to open My LOKA. Check that the codes match before adding them.", fontSize = 12.sp, color = LokaColors.muted)
                SelectionContainer { Text(code, fontSize = 11.sp) }
            } else if (link.isNotBlank()) Text("This is not a valid LOKA contact link.", fontSize = 12.sp, color = MaterialTheme.colorScheme.error)
            TextButton(onClick = { details = !details }) { Text(if (details) "Hide details" else "More about adding friends") }
            if (details) Text("Friends are saved on this phone. Your friend needs to add you too. LOKA Number search and contact syncing are not available yet.", fontSize = 12.sp, color = LokaColors.muted)
        } }, confirmButton = { TextButton(onClick = {
            if (key != null && code != null && code != state.deviceId) {
                model.importKey(Base64.encodeToString(key, Base64.NO_WRAP))
                if (model.state.value.trusted.any { it.id == code }) {
                    model.renameContact(code, name); saved = true
                }
            }
        }, enabled = code != null && code != state.deviceId && state.ready) { Text("Codes match · Add friend") } },
        dismissButton = { TextButton(onClick = dismiss) { Text("Cancel") } })
}

@Composable
private fun ContactCodeScreen(state: LabState, model: LabViewModel, scan: () -> Unit, image: () -> Unit, paste: () -> Unit) {
    var scanMode by rememberSaveable { mutableStateOf(false) }
    LazyColumn(contentPadding = PaddingValues(24.dp), verticalArrangement = Arrangement.spacedBy(20.dp)) {
        item { Row(horizontalArrangement = Arrangement.spacedBy(10.dp)) {
            FilterChip(colors = FilterChipDefaults.filterChipColors(selectedContainerColor = LokaColors.mint, selectedLabelColor = LokaColors.green), selected = !scanMode, onClick = { scanMode = false }, label = { Text("My code") })
            FilterChip(colors = FilterChipDefaults.filterChipColors(selectedContainerColor = LokaColors.mint, selectedLabelColor = LokaColors.green), selected = scanMode, onClick = { scanMode = true; scan() }, label = { Text("Scan code") })
        } }
        if (!scanMode) item { MyContactCard(state, model) }
        else item {
            Surface(shape = RoundedCornerShape(28.dp), color = LokaColors.surface) {
                Column(Modifier.fillMaxWidth().padding(24.dp), verticalArrangement = Arrangement.spacedBy(20.dp), horizontalAlignment = Alignment.CenterHorizontally) {
                    Glyph("qr", Modifier.size(64.dp), color = LokaColors.green)
                    Text("Meet. Scan. Say hello.", fontSize = 24.sp, fontWeight = FontWeight.Bold)
                    Text("Ask your friend to open My code. Scan it, then review their details before adding them.", color = LokaColors.muted)
                    Button(onClick = scan, modifier = Modifier.fillMaxWidth()) { Text("Open camera") }
                    OutlinedButton(onClick = image, modifier = Modifier.fillMaxWidth()) { Text("Choose QR image") }
                    TextButton(onClick = paste) { Text("Paste contact link") }
                }
            }
        }
        item { Text("Both people add each other. A nearby relay does not need your contact code.", color = LokaColors.muted, fontSize = 13.sp) }
    }
}

@Composable
private fun MyContactCard(state: LabState, model: LabViewModel) {
    val context = LocalContext.current
    val scope = rememberCoroutineScope()
    val link = remember(state.publicKey) { runCatching { ContactCode.encode(Base64.decode(state.publicKey, Base64.NO_WRAP)) }.getOrNull() }
    val qr by produceState<android.graphics.Bitmap?>(null, link) {
        value = link?.let { withContext(Dispatchers.Default) { ContactQr.bitmap(it) } }
    }
    val save = rememberLauncherForActivityResult(ActivityResultContracts.CreateDocument("image/png")) { uri ->
        val image = qr
        if (uri != null && image != null) scope.launch {
            runCatching { withContext(Dispatchers.IO) {
                context.contentResolver.openOutputStream(uri).use { stream ->
                    requireNotNull(stream); check(image.compress(android.graphics.Bitmap.CompressFormat.PNG, 100, stream))
                }
            } }.onFailure { model.reportError("Could not save the QR image. Please try again.") }
        }
    }
    Surface(shape = RoundedCornerShape(22.dp), color = LokaColors.surface) {
        Column(Modifier.padding(20.dp), verticalArrangement = Arrangement.spacedBy(12.dp), horizontalAlignment = Alignment.CenterHorizontally) {
            ProfilePortrait(state.displayName, Modifier.size(64.dp), own = true)
            Text(state.displayName.ifBlank { "Your LOKA code" }, fontWeight = FontWeight.Bold, fontSize = 24.sp)
            Text("A new conversation starts here", color = LokaColors.green, fontSize = 14.sp)
            Text("Let your friend scan this QR, or send them your LOKA link. Your phone number stays private.", fontSize = 13.sp, color = LokaColors.muted, lineHeight = 20.sp)
            qr?.let { Image(it.asImageBitmap(), contentDescription = "Your LOKA contact QR code", modifier = Modifier.widthIn(max = 232.dp).fillMaxWidth().aspectRatio(1f).background(Color.White).padding(12.dp)) }
            Button(onClick = {
                runCatching { context.startActivity(Intent.createChooser(Intent(Intent.ACTION_SEND).apply { type = "text/plain"; putExtra(Intent.EXTRA_TEXT, link) }, "Share LOKA contact link")) }
                    .onFailure { model.reportError("No app available to share the contact link.") }
            }, enabled = link != null, modifier = Modifier.fillMaxWidth()) { Text("Share My LOKA") }
            OutlinedButton(onClick = { save.launch("loka-contact.png") }, enabled = qr != null, modifier = Modifier.fillMaxWidth()) { Text("Save QR image") }
        }
    }
}

@Composable
private fun NearbySignal(level: Int) {
    val active = when { level == 0 -> LokaColors.muted; level <= 2 -> MaterialTheme.colorScheme.error; level <= 4 -> Color(0xFFB86E00); else -> LokaColors.green }
    if (level == 0) { Text("—", color = LokaColors.muted, modifier = Modifier.semantics { contentDescription = "Signal not measured" }); return }
    Row(Modifier.height(24.dp).semantics { contentDescription = if (level == 0) "Signal unavailable" else "Signal $level of 6" }, verticalAlignment = Alignment.Bottom, horizontalArrangement = Arrangement.spacedBy(2.dp)) {
        repeat(6) { index ->
            val color by androidx.compose.animation.animateColorAsState(if (index < level) active else LokaColors.muted.copy(alpha = 0.20f), label = "Signal bar")
            Box(Modifier.width(3.dp).height((5 + index * 3).dp).background(color, RoundedCornerShape(1.dp)))
        }
    }
}

@Composable
private fun Avatar(name: String, modifier: Modifier = Modifier, avatarID: String? = null, peerID: String? = null) {
    ProfilePortrait(name, modifier, avatarID = avatarID, peerID = peerID)
}

@Composable
private fun ChatIllustration() {
    Box(Modifier.size(160.dp, 110.dp), contentAlignment = Alignment.Center) {
        Canvas(Modifier.fillMaxSize()) {
            drawCircle(LokaColors.yellow.copy(alpha = .25f), radius = 52.dp.toPx(), center = center)
            drawCircle(LokaColors.mintAccent.copy(alpha = .4f), radius = 3.dp.toPx(), center = Offset(size.width * .13f, size.height * .25f))
            drawCircle(LokaColors.mintAccent.copy(alpha = .4f), radius = 5.dp.toPx(), center = Offset(size.width * .87f, size.height * .78f))
        }
        Box(Modifier.offset(x = (-20).dp, y = (-12).dp).size(84.dp, 64.dp).clip(RoundedCornerShape(18.dp)).background(LokaColors.surface), contentAlignment = Alignment.Center) {
            Row(horizontalArrangement = Arrangement.spacedBy(6.dp)) { repeat(3) { Box(Modifier.size(7.dp).clip(CircleShape).background(LokaColors.mintAccent)) } }
        }
        Box(Modifier.offset(x = 26.dp, y = 20.dp).size(84.dp, 64.dp).clip(RoundedCornerShape(18.dp, 18.dp, 4.dp, 18.dp)).background(LokaColors.green), contentAlignment = Alignment.Center) {
            Glyph("chat", Modifier.size(32.dp), MaterialTheme.colorScheme.onPrimary)
        }
    }
}

@Composable
internal fun Glyph(kind: String, modifier: Modifier = Modifier.size(22.dp), color: Color = LokaColors.green, description: String? = null) {
    Canvas(modifier.then(if (description != null) Modifier.semantics { contentDescription = description } else Modifier)) {
        val s = size.width / 24f
        fun line(x: Float, y: Float, a: Float, b: Float) = drawLine(color, Offset(x*s,y*s), Offset(a*s,b*s), 1.8f*s, cap = androidx.compose.ui.graphics.StrokeCap.Round)
        when (kind) {
            "plus" -> { line(12f,4f,12f,20f); line(4f,12f,20f,12f) }
            "chevron" -> { line(9f,6f,15f,12f); line(15f,12f,9f,18f) }
            "info" -> { drawCircle(color,9*s,center,style=Stroke(1.8f*s)); drawCircle(color,1*s,Offset(12*s,7*s)); line(12f,11f,12f,17f) }
            "qr" -> {
                listOf(Offset(3*s,3*s),Offset(14*s,3*s),Offset(3*s,14*s)).forEach { offset ->
                    drawRect(color,offset,Size(7*s,7*s),style=Stroke(1.5f*s))
                    drawRect(color,offset+Offset(2*s,2*s),Size(3*s,3*s))
                }
                line(15f,14f,15f,18f); line(18f,14f,21f,14f); line(18f,18f,21f,18f); line(21f,18f,21f,21f); line(14f,21f,18f,21f)
            }
            "game" -> {
                drawRoundRect(color, Offset(2*s,6*s), Size(20*s,14*s), androidx.compose.ui.geometry.CornerRadius(5*s), style=Stroke(1.8f*s))
                line(6f,12f,12f,12f); line(9f,9f,9f,15f)
                drawCircle(color, 1.3f*s, Offset(17*s,10*s)); drawCircle(color, 1.3f*s, Offset(19*s,14*s))
            }
            "spark" -> { line(6f,5f,9f,9f); line(16f,4f,14f,9f); line(20f,14f,15f,14f) }
            "settings" -> {
                drawCircle(color,7*s,center,style=Stroke(1.8f*s)); drawCircle(color,2.5f*s,center,style=Stroke(1.8f*s))
                repeat(8) { i -> val angle = i * kotlin.math.PI / 4
                    drawLine(color,center+Offset(kotlin.math.cos(angle).toFloat()*7*s,kotlin.math.sin(angle).toFloat()*7*s),
                        center+Offset(kotlin.math.cos(angle).toFloat()*10*s,kotlin.math.sin(angle).toFloat()*10*s),2*s,cap=androidx.compose.ui.graphics.StrokeCap.Round)
                }
            }
            "camera" -> { drawRoundRect(color,Offset(3*s,7*s),Size(18*s,13*s),androidx.compose.ui.geometry.CornerRadius(3*s),style=Stroke(1.8f*s)); drawCircle(color,4*s,Offset(12*s,13*s),style=Stroke(1.8f*s)); line(7f,7f,9f,3f); line(9f,3f,15f,3f); line(15f,3f,17f,7f) }
            "mic" -> {
                drawRoundRect(color, Offset(9*s,2*s), Size(6*s,12*s), androidx.compose.ui.geometry.CornerRadius(3*s))
                drawArc(color,0f,180f,false,Offset(5*s,3*s),Size(14*s,14*s),style=Stroke(1.8f*s))
                line(12f,17f,12f,21f); line(8f,21f,16f,21f)
            }
            "back" -> { line(17f,12f,5f,12f); line(5f,12f,11f,6f); line(5f,12f,11f,18f) }
            "forward" -> { line(9f,5f,16f,12f); line(16f,12f,9f,19f) }
            "send" -> { val p = Path().apply { moveTo(3*s,4*s); lineTo(21*s,12*s); lineTo(3*s,20*s); lineTo(6*s,12*s); close() }; drawPath(p,color); line(7f,12f,14f,12f) }
            "search" -> { drawCircle(color,6*s,Offset(10*s,10*s), style=Stroke(1.8f*s)); line(15f,15f,21f,21f) }
            "group" -> { drawCircle(color,3*s,Offset(9*s,7*s),style=Stroke(1.8f*s)); drawCircle(color,2.5f*s,Offset(17*s,9*s),style=Stroke(1.8f*s)); drawArc(color,180f,180f,false,Offset(2*s,13*s),Size(14*s,12*s),style=Stroke(1.8f*s)); drawArc(color,270f,90f,false,Offset(12*s,14*s),Size(10*s,10*s),style=Stroke(1.8f*s)) }
            "user" -> { drawCircle(color,3.5f*s,Offset(12*s,7*s),style=Stroke(1.8f*s)); drawArc(color,180f,180f,false,Offset(4*s,13*s),Size(16*s,14*s),style=Stroke(1.8f*s)) }
            "lock" -> { drawRoundRect(color,Offset(5*s,10*s),Size(14*s,11*s),androidx.compose.ui.geometry.CornerRadius(2*s),style=Stroke(1.8f*s)); drawArc(color,180f,180f,false,Offset(8*s,3*s),Size(8*s,12*s),style=Stroke(1.8f*s)); line(12f,14f,12f,17f) }
            "edit" -> { line(5f,18f,17f,6f); line(17f,6f,20f,9f); line(20f,9f,8f,21f); line(5f,18f,5f,21f); line(5f,21f,8f,21f) }
            "spark" -> { line(6f,5f,9f,9f); line(16f,4f,14f,9f); line(20f,14f,15f,14f) }
            "settings" -> { drawCircle(color,7*s,center,style=Stroke(2*s)); drawCircle(color,2.5f*s,center,style=Stroke(1.8f*s)); repeat(8) { val a=it*Math.PI/4; drawLine(color,center+Offset((kotlin.math.cos(a)*7*s).toFloat(),(kotlin.math.sin(a)*7*s).toFloat()),center+Offset((kotlin.math.cos(a)*10*s).toFloat(),(kotlin.math.sin(a)*10*s).toFloat()),2*s) } }
            "palette" -> { drawCircle(color,8*s,center,style=Stroke(1.8f*s)); drawCircle(color,1.5f*s,Offset(8*s,8*s)); drawCircle(color,1.5f*s,Offset(15*s,7*s)); drawCircle(color,1.5f*s,Offset(17*s,13*s)) }
            "wifi", "wifi_off" -> { drawArc(color,225f,90f,false,Offset(1*s,3*s),Size(22*s,22*s),style=Stroke(1.8f*s)); drawArc(color,225f,90f,false,Offset(5*s,7*s),Size(14*s,14*s),style=Stroke(1.8f*s)); drawCircle(color,1.6f*s,Offset(12*s,19*s)); if (kind == "wifi_off") line(3f,3f,21f,21f) }
            "offline" -> { drawCircle(color,7*s,center,style=Stroke(1.6f*s)); line(4f,4f,20f,20f) }
            "nearby" -> { drawCircle(color,2*s,center); drawCircle(color,6*s,center,style=Stroke(1.6f*s)); drawArc(color,210f,120f,false,Offset(1*s,1*s),Size(22*s,22*s),style=Stroke(1.6f*s)); drawArc(color,30f,120f,false,Offset(1*s,1*s),Size(22*s,22*s),style=Stroke(1.6f*s)) }
            else -> { drawRoundRect(color,Offset(3*s,4*s),Size(18*s,14*s),androidx.compose.ui.geometry.CornerRadius(4*s),style=Stroke(1.8f*s)); line(6f,18f,5f,21f); line(5f,21f,10f,18f); line(7f,9f,17f,9f); line(7f,13f,13f,13f) }
        }
    }
}
private fun time(timestamp: Long): String = SimpleDateFormat("h:mm a", Locale.getDefault()).format(Date(timestamp))

@Composable private fun MessageRouteFlow(message: ChatMessage, friendName: String, relayName: String) {
    val relayCount = message.reportedHops?.let { (it - 1).coerceIn(0, 6) } ?: if (!message.route?.carrier.isNullOrEmpty()) 1 else 0
    val complete = !message.outgoing || message.delivered
    val expiry = message.route?.expiresAt ?: (message.timestamp + message.lifetime)
    val expiryText = SimpleDateFormat("h:mm a", Locale.getDefault()).format(Date(expiry))
    fun connection(index: Int): String {
        if ((message.outgoing && index == 0) || (!message.outgoing && index == relayCount)) {
            val label = when(message.route?.transport) { "ble" -> "Bluetooth"; "wifi" -> "Local Wi-Fi"; "aware" -> "Wi-Fi Aware"; "classic" -> "Bluetooth Classic"; else -> "Transport not recorded" }
            return label + if(message.outgoing) " · local attempt" else " · received here"
        }
        return "Connection not reported"
    }
    Column(verticalArrangement = Arrangement.spacedBy(10.dp)) {
        Text("Delivery route", fontWeight = FontWeight.SemiBold)
        RouteStep(if(message.outgoing) "Your phone" else friendName, "Encrypted before sending")
        repeat(relayCount) { index ->
            Text("↓  " + connection(index), fontSize = 12.sp, color = LokaColors.muted)
            RouteStep(if(relayCount == 1) relayName else "Nearby phone ${index + 1}",
                (if(message.reportedHops == null) "Relay selected" else "Relay reported") + " · encrypted\n" + if (message.route != null || message.outgoing) "Copy expires $expiryText" else "Expiry not recorded")
        }
        Text("↓  " + connection(relayCount), fontSize = 12.sp, color = LokaColors.muted)
        RouteStep(if(message.outgoing) friendName else "Your phone", if(complete) "Received and decrypted" else "Waiting for delivery · encrypted")
        if (!complete) Text("Delivery window ends $expiryText", fontSize = 12.sp, color = LokaColors.muted)
        Text("Relay phones cannot read this message. Only recorded route details are shown.", fontSize = 12.sp, color = LokaColors.muted)
    }
}
@Composable private fun RouteStep(title: String, detail: String) {
    Row(Modifier.fillMaxWidth().background(LokaColors.mint, RoundedCornerShape(14.dp)).padding(12.dp), horizontalArrangement = Arrangement.spacedBy(12.dp)) {
        Glyph("lock", Modifier.size(24.dp), LokaColors.green, "Message security")
        Column(verticalArrangement = Arrangement.spacedBy(4.dp)) { Text(title, fontWeight = FontWeight.SemiBold, fontSize = 14.sp); Text(detail, color = LokaColors.muted, fontSize = 12.sp) }
    }
}

/** Shared visual language imported from UX; illustrations never represent real peers. */
internal object LokaDisplay {
    val font = FontFamily(Font(R.font.lilita_one))
}

@Composable
private fun LokaWordmark(compact: Boolean = false) {
    Row(verticalAlignment = Alignment.CenterVertically, modifier = Modifier.clearAndSetSemantics { contentDescription = "LOKA" }) {
        LokaBrandRays(true, compact)
        listOf(Triple("L", 44, -3f), Triple("O", 41, 2f), Triple("K", 45, -2f), Triple("A", 43, 2f)).forEach { (letter, size, tilt) ->
            Text(letter, fontFamily = LokaDisplay.font, fontSize = (if (compact) size * .8f else size.toFloat()).sp, modifier = Modifier.rotate(tilt))
        }
        LokaBrandRays(false, compact)
    }
}

@Composable private fun LokaBrandRays(left: Boolean, compact: Boolean) {
    Canvas(Modifier.size(if (compact) 24.dp else 32.dp, if (compact) 36.dp else 44.dp)) {
        fun ray(x1: Float, y1: Float, x2: Float, y2: Float) {
            fun x(value: Float) = size.width * if (left) 1f - value else value
            drawLine(LokaColors.yellow, Offset(x(x1), size.height*y1), Offset(x(x2), size.height*y2), (if (compact) 4.dp else 6.dp).toPx(), cap = androidx.compose.ui.graphics.StrokeCap.Round)
        }
        ray(.22f,.08f,.12f,.31f); ray(.76f,.31f,.43f,.45f); ray(.81f,.68f,.47f,.63f)
    }
}

@Composable
private fun LokaHeroTitle(text: String) {
    Column {
        text.split("\n").forEachIndexed { index, line ->
            Text(line, fontFamily = LokaDisplay.font, fontSize = if (index == 0) 36.sp else 34.sp, lineHeight = 40.sp)
        }
    }
}

@Composable
private fun OnboardingArt(resource: Int) {
    Image(androidx.compose.ui.res.painterResource(resource), contentDescription = null,
        modifier = Modifier.fillMaxWidth().height(220.dp).clip(RoundedCornerShape(28.dp)),
        contentScale = androidx.compose.ui.layout.ContentScale.Crop)
}

@Composable
private fun NearbyRequestStack(state: LabState, model: LabViewModel) {
    val incoming = state.chatRequests.filter { !it.outgoing && it.phase == org.loka.core.ContactConsentBook.Phase.INCOMING && it.request.expires > state.now }.sortedWith(compareBy({ it.request.expires }, { it.request.id }))
    var later by remember { mutableStateOf(emptySet<String>()) }
    var focused by remember { mutableStateOf<String?>(null) }
    val ids = incoming.map { it.request.id }
    LaunchedEffect(ids) { later = later.intersect(ids.toSet()) }
    val available = incoming.filter { it.request.id !in later }
    val index = available.indexOfFirst { it.request.id == focused }.coerceAtLeast(0)
    val threshold = with(LocalDensity.current) { 70.dp.toPx() }
    if (incoming.isEmpty()) return
    Column(Modifier.animateContentSize(), verticalArrangement = Arrangement.spacedBy(10.dp)) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            Text("Chat requests (${incoming.size})", Modifier.weight(1f), fontWeight = FontWeight.Bold)
            if (incoming.any { it.request.id in later }) TextButton(onClick = { later = emptySet(); focused = null }) { Text("Show later") }
        }
        if (available.isEmpty()) Text("Requests set aside for later.", color = LokaColors.muted, fontSize = 12.sp)
        else {
            val request = available[index]
            Box(Modifier.fillMaxWidth().padding(bottom = if (available.size > 1) 7.dp else 0.dp)) {
                if (available.size > 1) Box(Modifier.matchParentSize().offset(y = 7.dp).padding(horizontal = 7.dp).background(LokaColors.green.copy(alpha = .18f), RoundedCornerShape(18.dp)))
                Surface(shape = RoundedCornerShape(18.dp), color = LokaColors.mint,
                    modifier = Modifier.fillMaxWidth().pointerInput(request.request.id) {
                        var distance = 0f
                        detectHorizontalDragGestures(onDragStart = { distance = 0f }, onHorizontalDrag = { change, amount -> change.consume(); distance += amount }, onDragEnd = {
                            if (distance < -threshold) model.decideChat(request.request.id, false)
                            else if (distance > threshold) { later = later + request.request.id; focused = null }
                        })
                    }) {
                    Column(Modifier.padding(14.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                        Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                            Avatar(request.peerName, Modifier.size(44.dp), avatarID = state.nearbyPeople.firstOrNull { it.id == request.peer }?.avatarID)
                            Text("${request.peerName} wants to chat", Modifier.weight(1f), fontWeight = FontWeight.SemiBold)
                        }
                        Text("Accept to add each other.", fontSize = 12.sp, color = LokaColors.muted)
                        Row {
                            Button(onClick = { model.decideChat(request.request.id, true) }) { Text("Accept") }
                            TextButton(onClick = { model.decideChat(request.request.id, false) }) { Text("Decline") }
                            TextButton(onClick = { later = later + request.request.id; focused = null }) { Text("Later") }
                        }
                        Text("Swipe left to decline · right for later", fontSize = 11.sp, color = LokaColors.muted)
                    }
                }
            }
            if (available.size > 1) Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.SpaceBetween) {
                TextButton(onClick = { focused = available[(index + available.size - 1) % available.size].request.id }) { Text("Previous") }
                Text("${index + 1} of ${available.size}", fontSize = 12.sp)
                TextButton(onClick = { focused = available[(index + 1) % available.size].request.id }) { Text("Next") }
            }
        }
    }
}

@Composable
private fun NearbyRadar(people: List<org.loka.core.NearbyProfile>, active: Boolean) {
    val names = people.map { it.name }
    val purple = LokaColors.green
    val transition = androidx.compose.animation.core.rememberInfiniteTransition(label = "Nearby activity")
    val pulse by transition.animateFloat(initialValue = 0f, targetValue = 1f, animationSpec = androidx.compose.animation.core.infiniteRepeatable(androidx.compose.animation.core.tween(4200, easing = androidx.compose.animation.core.LinearEasing), androidx.compose.animation.core.RepeatMode.Restart), label = "Expanding nearby rings")
    Column(Modifier.fillMaxWidth(), horizontalAlignment = Alignment.CenterHorizontally) {
        BoxWithConstraints(Modifier.widthIn(max = 420.dp).fillMaxWidth().aspectRatio(1f), contentAlignment = Alignment.Center) {
            val diameter = maxWidth
            Canvas(Modifier.fillMaxSize()) {
                val width = size.minDimension
                drawCircle(purple.copy(alpha = .18f), radius = width*.40f)
                repeat(5) { index ->
                    val phase = if (active) (pulse + index*.2f) % 1f else index*.2f
                    val radius = width*(.09f + phase*.31f)
                    drawCircle(purple.copy(alpha = .08f + (1f-phase)*.16f), radius = radius, style = Stroke(width*.045f))
                    drawCircle(purple.copy(alpha = .3f), radius = radius + width*.023f, style = Stroke(1.dp.toPx()))
                }
                names.take(6).forEachIndexed { index, _ ->
                    val angle = (index * 60 - 120) * Math.PI / 180
                    val point = center + Offset((kotlin.math.cos(angle)*width*.34f).toFloat(), (kotlin.math.sin(angle)*width*.34f).toFloat())
                    drawLine(purple.copy(alpha = .35f), center, point, 1.dp.toPx())
                    val r = width*.105f
                    drawArc(if (index%2==0) purple else LokaColors.mintAccent, (index*55+120).toFloat(), 70f, false, point-Offset(r,r), Size(r*2,r*2), style = Stroke(5.dp.toPx(), cap = androidx.compose.ui.graphics.StrokeCap.Round))
                    drawLine(LokaColors.yellow, point+Offset(r*.8f,-r*.8f), point+Offset(r*1.05f,-r*1.12f), 4.dp.toPx(), cap = androidx.compose.ui.graphics.StrokeCap.Round)
                    drawCircle(LokaColors.mintAccent, 3.dp.toPx(), point+Offset(-r*.8f,r*.8f))
                }
                drawCircle(purple, radius = width*.045f, style = Stroke(4.dp.toPx()))
                drawCircle(LokaColors.mintAccent, radius = width*.02f)
            }
            names.take(6).forEachIndexed { index, name ->
                val angle = (index * 60 - 120) * Math.PI / 180
                Avatar(name, Modifier.offset(diameter * (kotlin.math.cos(angle)*.34).toFloat(), diameter * (kotlin.math.sin(angle)*.34).toFloat()).size(diameter*.17f), avatarID = people[index].avatarID)
            }
        }
        Text("${names.size} ${if (names.size == 1) "person" else "people"} nearby", fontFamily = LokaDisplay.font, fontSize = 24.sp)
        Text("Chosen names · chat requests need approval", fontSize = 12.sp, color = LokaColors.muted)
    }
}

private fun Modifier.lokaDoodles() = drawBehind {
    val palette = listOf(Color(0xFFA969E0), Color(0xFFFFCE32), Color(0xFF55CCA6), Color(0xFFFF7F85))
    repeat(24) { index ->
        val x = size.width * (((index * 37 + 13) % 100) / 100f)
        val y = size.height * (((index * 29 + 7) % 100) / 100f)
        val c = palette[index % palette.size].copy(alpha = .13f)
        val radius = 8.dp.toPx()
        if (index % 3 == 0) drawCircle(c, radius, Offset(x, y), style = Stroke(3.dp.toPx()))
        else {
            drawLine(c, Offset(x - radius, y - radius), Offset(x + radius, y + radius), 3.dp.toPx(), cap = androidx.compose.ui.graphics.StrokeCap.Round)
            if (index % 3 == 1) drawLine(c, Offset(x - radius, y + radius), Offset(x + radius, y - radius), 3.dp.toPx(), cap = androidx.compose.ui.graphics.StrokeCap.Round)
        }
    }
}


@Composable
private fun ProfileCount(label: String, count: Int, color: Color, modifier: Modifier) {
    Column(modifier.clip(RoundedCornerShape(22.dp)).background(color).padding(20.dp)) {
        Glyph("group", color = Color(0xFF2C0C40))
        Text(label, color = Color(0xFF2C0C40), fontSize = 13.sp, fontWeight = FontWeight.SemiBold)
        Text("$count", color = Color(0xFF2C0C40), fontSize = 30.sp, fontWeight = FontWeight.ExtraBold)
    }
}
