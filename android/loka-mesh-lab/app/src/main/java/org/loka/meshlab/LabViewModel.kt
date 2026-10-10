package org.loka.meshlab

import android.app.Application
import android.os.Build
import android.util.Base64
import androidx.core.content.edit
import androidx.lifecycle.AndroidViewModel
import androidx.lifecycle.ViewModel
import androidx.lifecycle.ViewModelProvider
import androidx.lifecycle.viewModelScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import org.loka.core.LabCrypto
import org.loka.core.MeshNode
import org.loka.core.ChatContent
import org.loka.core.VoiceAssembly
import org.loka.core.Packet
import org.loka.core.transport.TransportCapability
import org.loka.core.transport.TransportListener
import org.loka.core.transport.TransportPeer
import org.loka.core.fingerprint
import java.util.concurrent.ConcurrentHashMap

data class TrustedDevice(val id: String, val key: String, val name: String = "")
data class ChatMessage(val id: String, val peerId: String, val body: String,
    val outgoing: Boolean, val timestamp: Long = System.currentTimeMillis(),
    val peerName: String = "", val activeQueue: Boolean = false, val voice: Boolean = false,
    val delivered: Boolean = false, val image: Boolean = false, val packetIds: List<String> = emptyList(), val reportedHops: Int? = null,
    val myReaction: String? = null, val peerReaction: String? = null, val reactionPacket: String? = null, val deliveredAt: Long? = null, val readAt: Long? = null, val readReceiptQueued: Boolean = false, val lifetime: Long = org.loka.core.MAX_LIFETIME_MS, val route: org.loka.core.LocalRouteEvidence? = null)
/** Sent-time order; IDs break equal-time ties consistently across arrival/restart. */
internal val chatMessageOrder = compareBy<ChatMessage> { it.timestamp }.thenBy { it.id }

data class LabState(
    val partySession: org.loka.core.PartySession? = null,
    val partyGames: List<PartyGame> = emptyList(),
    val partyCard: org.loka.core.PartyCard? = null,
    val partyStatus: String = "Loading cards…",
    val partyCanAct: Boolean = false,
    val partyPaused: Boolean = false,
    val partyPackHash: String = "",
    val partyPackets: Map<String, String> = emptyMap(),
    val partyError:String? = null,
    val quizSession: org.loka.core.QuizSession? = null,
    val quizQuestions: List<QuizQuestion> = emptyList(),
    val quizStatus: String = "Loading games…",
    val quizCanAnswer: Boolean = false,
    val quizPaused: Boolean = false,
    val nearbyPeople: List<org.loka.core.NearbyProfile> = emptyList(),
    val openAcceptedFriend: String? = null,
    val chatRequests: List<org.loka.core.ContactConsentBook.Entry> = emptyList(),
    val peopleVisible: Boolean = true,
    val typingUntil: Map<String, Long> = emptyMap(),
    val ready: Boolean = false,
    val sending: Set<String> = emptySet(),
    val now: Long = System.currentTimeMillis(),
    val displayName: String = "You",
    val onboardingComplete: Boolean = false,
    val error: String? = null,
    val chatMessages: List<ChatMessage> = emptyList(),
    val historySaveFailed: Boolean = false,
    val backupBusy: Boolean = false,
    val backupCode: String? = null,
    val backupStatus: String = "No backup saved yet",
    val historyContacts: List<TrustedDevice> = emptyList(),
    val running: Boolean = false,
    val relayEnabled: Boolean = true,
    val deviceId: String = "Creating device key…",
    val publicKey: String = "",
    val peers: List<TransportPeer> = emptyList(),
    val peerSeenAt: Map<String, Long> = emptyMap(),
    val signalSeenAt: Map<String, Long> = emptyMap(),
    val allowed: Set<String> = emptySet(),
    val automaticNearby: Boolean = true,
    val connected: Set<String> = emptySet(),
    val capabilities: Set<TransportCapability> = emptySet(),
    val transportName: String = "",
    val setupHint: String = "",
    val setupAction: String = "Set up link",
    val trusted: List<TrustedDevice> = emptyList(),
    val events: List<String> = emptyList(),
    val messages: List<String> = emptyList(),
)

class LabViewModel(
    application: Application,
    private val transportProvider: AndroidTransportProvider,
    private val historyName: String = "loka-history-v1.db",
    private val backgroundSession: Boolean = true,
) : AndroidViewModel(application) {
    class Factory(
        private val application: Application,
        private val provider: AndroidTransportProvider,
        private val historyName: String = "loka-history-v1.db",
    ) : ViewModelProvider.Factory {
        override fun <T : ViewModel> create(modelClass: Class<T>): T {
            require(modelClass == LabViewModel::class.java)
            @Suppress("UNCHECKED_CAST")
            return LabViewModel(application, provider, historyName, backgroundSession = false) as T
        }
    }
    @Volatile private var testExcludedPeer: String? = null
    private val gameDispatcher = Dispatchers.IO.limitedParallelism(1)
    private var party: org.loka.core.PartyCards? = null
    private val partyKeys = ConcurrentHashMap<String, ByteArray>()
    private var quiz: org.loka.core.QuickQuiz? = null
    private val peopleDispatcher = Dispatchers.IO.limitedParallelism(1)
    private val mutable = MutableStateFlow(LabState())
    val state = mutable.asStateFlow()
    private val preferences = application.getSharedPreferences("lab-trusted-keys", 0)
    private val profile = application.getSharedPreferences("loka-profile", 0)
    private val contactNames = application.getSharedPreferences("loka-contact-names", 0)
    private val routeCache = ConcurrentHashMap<String, org.loka.core.LocalRouteEvidence>()
    private val keys = ConcurrentHashMap<String, ByteArray>()
    private val allowed = ConcurrentHashMap.newKeySet<String>()
    private val blocked = ConcurrentHashMap.newKeySet<String>()
    // Device-local explicit transport consent; never contact/key trust. No cloud backup.
    private val linkApprovals = application.getSharedPreferences("loka-link-approvals-$historyName", 0)
    @Volatile private var people: org.loka.core.NearbyPeople? = null
    @Volatile private var node: MeshNode? = null
    @Volatile private var history: HistoryStore? = null
    private val acknowledged = org.loka.core.ReceiptWindow()
    private val encounterTrace = org.loka.core.EncounterTrace()
    private val encounterHistory = org.loka.core.EncounterHistory()
    private var savedEncounters: List<org.loka.core.EncounterHistory.Record>? = null
    private var encounterStorageAvailable = true
    private var lastOutbox: ByteArray? = null
    private val voiceAssembly = VoiceAssembly()
    private val outbox = android.util.AtomicFile(java.io.File(application.noBackupFilesDir, "loka-outbox-v1-$historyName.json"))
    private val sendMutex = kotlinx.coroutines.sync.Mutex()
    private val replyActions = application.getSharedPreferences("loka-reply-actions", 0)
    private var pendingBackup: ByteArray? = null
    private val transportListener = object : TransportListener {
        override fun onPeer(peer: TransportPeer) {
            val measured = peer.signalDbm?.takeIf { it in -127..-1 }
            val now = System.currentTimeMillis()
            mutable.update { old ->
                val updated = peer.copy(signalDbm = measured ?: old.peers.firstOrNull { it.id == peer.id }?.signalDbm)
                val peers = (old.peers.filter { it.id != peer.id } + updated).takeLast(64)
                val ids = peers.map { it.id }.toSet()
                old.copy(peers = peers.sortedBy { it.displayName },
                    peerSeenAt = (old.peerSeenAt + (peer.id to now)).filterKeys { it in ids },
                    signalSeenAt = (if (measured != null) old.signalSeenAt + (peer.id to now) else old.signalSeenAt).filterKeys { it in ids })
            }
        }
        override fun onLink(peer: String, connected: Boolean) {
            viewModelScope.launch(peopleDispatcher) { people?.link(peer, connected) }
            mutable.update { it.copy(connected = if (connected) it.connected + peer else it.connected - peer) }
        }
        override fun onRunning(running: Boolean) {
            mutable.update { it.copy(running = running, connected = if (running) it.connected else emptySet()) }
            if (!running && backgroundSession && !localConnectionEnabled) getApplication<Application>().stopService(android.content.Intent(getApplication(), LocalConnectionService::class.java))
        }
        override fun onFrame(peer: String, frame: ByteArray) = Unit // Consumed inside MeshNode.
        override fun onDiagnostic(text: String) = log(text)
    }

    init {
        viewModelScope.launch(Dispatchers.IO) {
            runCatching {
                allowed.addAll(linkApprovals.getStringSet("approved", emptySet()).orEmpty()
                    .filter { it.isNotBlank() && it.length <= 160 }.take(32))
                blocked.addAll(linkApprovals.getStringSet("blocked", emptySet()).orEmpty().take(64))
                mutable.update { it.copy(allowed = allowed.toSet(), automaticNearby = linkApprovals.getBoolean("automatic", true)) }
                preferences.all.values.filterIsInstance<String>().forEach { value ->
                    runCatching {
                        val key = Base64.decode(value, Base64.NO_WRAP)
                        LabCrypto.parsePublicKey(key); keys[fingerprint(key)] = key
                    }
                }
                val crypto = DeviceIdentity.load()
                history = HistoryStore(application, historyName)
                runCatching { encounterHistory.restore(history!!.loadEncounters(System.currentTimeMillis()), System.currentTimeMillis()) }
                    .onFailure { encounterStorageAvailable = false; log("Encounter history unavailable; shadow tracking remains temporary") }
                val localNode = MeshNode(crypto, transportProvider.factory(viewModelScope) { peer ->
                    org.loka.core.LocalLinkPolicy.permits(peer, state.value.automaticNearby, allowed, blocked)
                },
                    trusted = keys::containsKey, listener = transportListener,
                    message = { _, _ -> }, packetMessage = ::receiveContent, control = { handle, frame ->
                        if (org.loka.core.NearbyPeople.controls(frame)) { viewModelScope.launch(peopleDispatcher) { people?.receive(handle, frame) }; true } else false
                    }, saveCarry = history!!::saveCarry)
                localNode.routePreference = { handle -> if (handle.startsWith("wifi:") || handle.startsWith("aware:")) 0 else 1 }
                localNode.observeRoute = ::observeRoute
                localNode.carryPeer = { handle -> state.value.nearbyPeople.firstOrNull { it.handle == handle && it.carryVersion >= 2 && it.id != testExcludedPeer }?.id }
                localNode.carryVersion = { id -> maxOf(if (keys.containsKey(id)) profile.getInt("carry-v3-$id", 0) else 0, state.value.nearbyPeople.filter { it.id == id }.maxOfOrNull { it.carryVersion } ?: 0) }

                val savedHistory = history!!.load()
                node = localNode
                runCatching {
                    val pack = QuizPack.load(application)
                    val game = org.loka.core.QuickQuiz(crypto.deviceId, pack.hash, pack.questions.map { it.answer }, System::currentTimeMillis,
                        save = history!!::saveGame,
                        send = { id, text ->
                            require(org.loka.core.QuickQuiz.canQueue(localNode.queued().size)) { "Chat traffic is using the local queue" }
                            val key = keys[id] ?: error("Friend is no longer verified")
                            localNode.send(key, text, automatic = true, lifetimeMs = org.loka.core.GameEvent.decode(text).expires - System.currentTimeMillis())
                        }, discard = { id -> localNode.discard(listOf(id)) })
                    history!!.loadGame()?.let(game::restore)
                    quiz = game; mutable.update { it.copy(quizQuestions = pack.questions) }; publishQuiz()
                }.onFailure { mutable.update { it.copy(quizStatus = "Could not open saved games. Existing game data was preserved.") } }
                runCatching {
                    val catalog = PartyCatalog.load(application)
                    mutable.update { it.copy(partyGames = catalog.games, partyPackHash = catalog.hash) }
                    localNode.applicationPeer = { id ->
                        val st = state.value
                        st.partyPackHash.isNotEmpty() && (st.nearbyPeople.any { it.id == id } || st.partySession?.let { it.expires > System.currentTimeMillis() && id in it.members } == true)
                    }
                    localNode.applicationContent = ::partyTraffic
                    localNode.applicationPacket = { packet -> state.value.partyPackets[packet.id] == packet.destination }
                    val game = org.loka.core.PartyCards(crypto.deviceId, catalog.hash, catalog.games.flatMap { it.cards }, System::currentTimeMillis,
                        save = { raw ->
                            val keep = party?.peers.orEmpty()
                            val publicKeys = org.json.JSONObject()
                            partyKeys.filterKeys { it in keep }.forEach { (id, key) -> publicKeys.put(id, Base64.encodeToString(key, Base64.NO_WRAP)) }
                            history!!.saveParty(org.json.JSONObject().put("state", raw).put("keys", publicKeys).toString())
                        }, send = { id, text ->
                            require(localNode.queued().size < 96)
                            val key = partyKeys[id] ?: state.value.nearbyPeople.firstOrNull { it.id == id }?.key ?: error("Player identity unavailable")
                            val event=org.loka.core.PartyEvent.decode(text)
                            val id=localNode.send(key,text,automatic=true,lifetimeMs=event.expires-System.currentTimeMillis())
                            if(BuildConfig.DEBUG)localNode.queued().asSequence().map{org.loka.core.PacketCodec.decode(it)}.firstOrNull{it.id==id}?.let{traceParty(event,it,true)};id
                        }, discard = { localNode.discard(listOf(it)) })
                    party = game
                    history!!.loadParty()?.let { raw ->
                        val saved = org.json.JSONObject(raw); val entries = saved.getJSONObject("keys"); require(entries.length() <= 3)
                        val savedKeys=entries.keys().asSequence().associateWith { id -> Base64.decode(entries.getString(id), Base64.NO_WRAP).also{key->org.loka.core.LabCrypto.parsePublicKey(key);require(fingerprint(key)==id)} }
                        val rawState=saved.getString("state")
                        if(org.loka.core.stalePartyCatalog(rawState,catalog.hash)) {
                            mutable.update{it.copy(partyError="The saved nearby round uses an older card pack. Start a new round.")}
                        }else{game.restore(rawState);require(savedKeys.keys.all{it in game.peers});partyKeys.putAll(savedKeys)}
                    }
                    publishParty()
                }.onFailure { mutable.update { it.copy(partyStatus = "Could not open saved cards. Existing data was preserved.",partyError="Could not open saved cards. Existing data was preserved.") }; party = null }
                val restoredCarry=history!!.loadCarry().filter { bytes ->
                    val packet=org.loka.core.PacketCodec.decode(bytes)
                    packet.source!=crypto.deviceId || keys.containsKey(packet.destination) || state.value.partyPackets[packet.id]==packet.destination
                }
                localNode.restoreCarry(restoredCarry)
                history!!.saveCarry(restoredCarry)
                val directory = org.loka.core.NearbyPeople(crypto,
                    name = { profile.getString("display-name", "LOKA user") ?: "LOKA user" },
                    visible = { profile.getBoolean("people-visible", true) },
                    send = localNode::sendControl, save = history!!::saveNearby,
                    authorize = { key, name ->
                        val id = fingerprint(key)
                        if (!keys.containsKey(id)) {
                            check(contactNames.edit().putString(id, name.take(40)).commit())
                            check(preferences.edit().putString(id, Base64.encodeToString(key, Base64.NO_WRAP)).commit())
                            keys[id] = key; mutable.update { it.copy(trusted = trustedList()) }
                        }
                    }, changed = { profiles, requests ->
                        val appearances = application.getSharedPreferences("loka-appearance", 0)
                        appearances.edit().apply {
                            org.loka.core.NearbyPeople.displayProfiles(profiles).filter { it.avatarShared && keys.containsKey(it.id) }.forEach { p ->
                                if (p.avatarID == null) remove("peer-avatar-${p.id}") else putString("peer-avatar-${p.id}", p.avatarID)
                            }
                        }.apply()
                        val capable = profiles.filter { it.carryVersion >= 3 && keys.containsKey(it.id) }
                        if (capable.isNotEmpty()) profile.edit { capable.forEach { putInt("carry-v3-${it.id}", 3) } }
                        mutable.update { it.copy(nearbyPeople = profiles, chatRequests = requests) }; localNode.tick(); LocalNotifications.requests(application, requests) },
                    avatar = { application.getSharedPreferences("loka-appearance", 0).getString("avatar", null)?.toIntOrNull()?.let { "avatar_$it" } })
                directory.trusted = keys::containsKey
                directory.typingChanged = { id, until -> mutable.update { it.copy(typingUntil = (it.typingUntil.filterValues { time -> time > System.currentTimeMillis() } + (id to until)).filterValues { time -> time > 0 }) } }
                directory.onFailure = { reportError("Could not save chat requests. Your existing chats are safe.") }
                runCatching { directory.routeLoad = { localNode.routeLoad(it) }
                directory.routePreference = { localNode.routePreference(it) }
                directory.restore(history!!.loadNearby()); people = directory }
                    .onFailure { reportError("Could not open chat requests. Your existing chats are safe.") }
                runCatching {
                    if (outbox.baseFile.exists()) {
                        require(outbox.baseFile.length() <= 3_000_000)
                        val frames = org.json.JSONArray(outbox.openRead().use { it.readBytes().toString(Charsets.UTF_8) })
                        require(frames.length() <= 128)
                        for (i in 0 until frames.length()) runCatching { Base64.decode(frames.getString(i), Base64.NO_WRAP).let { if (org.loka.core.PacketCodec.decode(it).version == 0) localNode.restore(it) } }
                    }
                }.onFailure { reportError("Could not restore the pending queue. Saved chats were preserved.") }
                val queuedIDs = localNode.queued().map { org.loka.core.PacketCodec.decode(it).id }.toSet()
                val restoredHistory = savedHistory.map { it.copy(activeQueue = it.packetIds.any(queuedIDs::contains)) }
                mutable.update { it.copy(peopleVisible = profile.getBoolean("people-visible", true), ready = true, onboardingComplete = profile.getBoolean("onboarding-complete", false), chatMessages = restoredHistory, historyContacts = historyContacts(savedHistory),
                    backupStatus = profile.getString("last-backup", "No backup saved yet") ?: "No backup saved yet", capabilities = localNode.capabilities,
                    transportName = transportProvider.name, setupHint = transportProvider.setupHint,
                    setupAction = transportProvider.setupAction, displayName = profile.getString("display-name", "You") ?: "You", deviceId = crypto.deviceId,
                    publicKey = Base64.encodeToString(crypto.publicKey, Base64.NO_WRAP), trusted = trustedList()) }
                log("${Build.MANUFACTURER} ${Build.MODEL}; Android ${Build.VERSION.RELEASE}; LOKA preview ${BuildConfig.VERSION_NAME}")
                resumeLocalConnection()
            }.onFailure { reportError("Could not open this device or its encrypted history. Existing history was not erased.") }
            while (true) { delay(2_000); viewModelScope.launch(gameDispatcher) { runCatching { quiz?.tick(); publishQuiz(); party?.tick(); publishParty() }.onFailure { reportError("Could not save game progress") } }; node?.tick(); people?.tick(); retryReadReceipts(); persistOutbox(); observeEncounters(); saveRelayDiagnostic(); mutable.update { it.copy(now = System.currentTimeMillis()) } }
        }
    }
    private fun observeEncounters() {
        val current = state.value
        val peers = current.nearbyPeople.filter { it.handle in current.connected && it.id !in blocked }.map { it.id }.toSet()
        val observedAt = System.currentTimeMillis()
        encounterHistory.observe(peers, observedAt)
        if (BuildConfig.DEBUG) encounterTrace.observe(peers, observedAt)
        val now = System.currentTimeMillis()
        val records = encounterHistory.saved(now)
        if (encounterStorageAvailable && records != savedEncounters) runCatching {
            history?.saveEncounters(records, now) ?: error("Encounter storage not ready")
            savedEncounters = records
        }.onFailure { encounterStorageAvailable = false; log("Encounter history could not be saved; shadow tracking remains temporary") }
    }
    private fun observeRoute(packet: Packet, handle: String?, outgoing: Boolean) {
        if (outgoing && packet.source != state.value.deviceId) return
        val route = org.loka.core.LocalRouteEvidence(org.loka.core.LocalRouteEvidence.transport(handle), packet.carrier, System.currentTimeMillis(), packet.expiresAt)
        if (routeCache.size >= 256) routeCache.clear()
        routeCache[packet.id] = route
        if (outgoing) state.value.chatMessages.firstOrNull { it.outgoing && packet.id in it.packetIds }?.let { old ->
            if (old.route?.transport != route.transport || old.route?.carrier != route.carrier) runCatching { updateMessage(old.copy(route = route)) }
        }
    }
    private fun trustedList() = keys.entries.map {
        TrustedDevice(it.key, Base64.encodeToString(it.value, Base64.NO_WRAP), contactNames.getString(it.key, "") ?: "")
    }.sortedBy { it.id }
    private val carryTrace = java.util.ArrayDeque<String>()
    @Synchronized fun log(text: String) {
        mutable.update { it.copy(events = (it.events + "${System.currentTimeMillis()} $text").takeLast(200)) }
        if (text.startsWith("CARRY ")) runCatching {
            carryTrace.addLast("${System.currentTimeMillis()} ${text.take(240)}")
            while (carryTrace.size > 500) carryTrace.removeFirst()
            java.io.File(getApplication<Application>().cacheDir, "loka-carry-events.json").writeText(org.json.JSONArray(carryTrace.toList()).toString())
        }
    }
    private fun saveRelayDiagnostic() {
        if (!BuildConfig.DEBUG) return
        runCatching {
            val trace = encounterTrace.snapshot()
            val traceJSON = org.json.JSONObject().put("version", trace.version).put("scope", trace.scope).put("dropped", trace.dropped)
                .put("samples", org.json.JSONArray(trace.samples.map { org.json.JSONObject().put("time", it.time).put("peers", org.json.JSONArray(it.peers)) }))
            java.io.File(getApplication<Application>().cacheDir, "loka-encounter-trace.json").writeText(traceJSON.toString())
            val s = state.value
            val value = org.json.JSONObject().put("time",System.currentTimeMillis()).put("own",s.deviceId.take(8)).put("ready",s.ready).put("relay",s.relayEnabled)
                .put("trusted",org.json.JSONArray(keys.keys.map { it.take(8) }))
                .put("peers",org.json.JSONArray(s.nearbyPeople.map { org.json.JSONObject().put("id",it.id.take(8)).put("version",it.carryVersion).put("route",it.handle.substringBefore(":" )).put("connected",it.handle in s.connected).put("queuedBytes",node?.routeLoad?.invoke(it.handle) ?: 0) }))
                .put("pending",org.json.JSONArray(node?.diagnostic() ?: emptyList<String>()))
                .put("party",org.json.JSONObject().put("phase",s.partySession?.phase ?: "none").put("revision",s.partySession?.revision ?: 0).put("members",s.partySession?.members?.size ?: 0).put("canAct",s.partyCanAct).put("paused",s.partyPaused).put("pendingPackets",org.json.JSONArray(s.partyPackets.keys)))
                .put("shadowEncounterRecords",encounterHistory.snapshot(System.currentTimeMillis()).size)
                .put("excluded",testExcludedPeer?.take(8) ?: "")
            java.io.File(getApplication<Application>().cacheDir,"loka-route-state.json").writeText(value.toString())
        }
    }
    fun debugExcludePeer(id: String?) {
        if (!BuildConfig.DEBUG) return
        testExcludedPeer = id?.takeIf { it.matches(Regex("[0-9a-f]{64}")) }
        saveRelayDiagnostic()
    }
    fun reportError(text: String) { mutable.update { it.copy(error = text) }; log("Error: $text") }
    fun clearError() { mutable.update { it.copy(error = null) } }
    fun chooseBackup(enabled: Boolean) { profile.edit { putBoolean("backup-setup-requested", enabled) } }
    fun backupSetupRequested(): Boolean = profile.getBoolean("backup-setup-requested", false)
    fun completeOnboarding() {
        profile.edit { putBoolean("onboarding-complete", true) }
        mutable.update { it.copy(onboardingComplete = true) }
    }
    fun setDisplayName(text: String) {
        val name = text.trim().take(40).ifEmpty { "You" }
        profile.edit { putString("display-name", name) }
        mutable.update { it.copy(displayName = name) }
    }
    fun renameContact(id: String, text: String) {
        if (!keys.containsKey(id)) return
        contactNames.edit { putString(id, text.trim().take(40)) }
        mutable.update { it.copy(trusted = trustedList()) }
    }
    private fun action(block: () -> Unit) { runCatching(block).onFailure { reportError(it.message ?: "Please try again") } }
    private fun localNode() = checkNotNull(node) { "Local node is not ready" }
    fun start() = action {
        profile.edit { putBoolean("local-connection-enabled", true) }
        clearError(); startConnectionService(); localNode().start()
    }
    internal val localConnectionEnabled: Boolean get() = profile.getBoolean("local-connection-enabled", true)
    // A radio outage pauses transports but preserves the user's enabled preference,
    // identity, contact trust and service-owned radio-state receiver.
    internal fun pauseForRadioChange() = action { node?.stop() }
    fun resumeLocalConnection(serviceAlreadyRunning: Boolean = false) {
        if (!state.value.ready || state.value.running || !localConnectionEnabled) return
        val app = getApplication<Application>()
        if (transportProvider.requiredPermissions.any { app.checkSelfPermission(it) != android.content.pm.PackageManager.PERMISSION_GRANTED }) return
        if (transportProvider.activationRequest() != null) return // OS activation needs an explicit user action.
        action { if (!serviceAlreadyRunning) startConnectionService(); localNode().start() }
    }
    fun stop() = action {
        profile.edit { putBoolean("local-connection-enabled", false) }
        localNode().stop(); getApplication<Application>().stopService(android.content.Intent(getApplication(), LocalConnectionService::class.java)); log("Local connection stopped")
    }
    fun discover() = action { localNode().discover() }
    fun refresh() = action { localNode().refreshPeers() }
    fun preparePeer(peer: String) = action { localNode().preparePeer(peer) }
    fun connect(peer: String) = action { localNode().connect(peer) }
    fun disconnect(peer: String) = action { localNode().disconnect(peer) }
    fun allow(peer: String, value: Boolean) {
        if (!value && peer !in blocked && blocked.size >= 64) {
            reportError("The blocked-link list is full. Turn off local connection to stop nearby traffic."); return
        }
        if (peer.isBlank() || peer.length > 160 || (value && peer !in allowed && allowed.size >= 32)) {
            reportError("Too many saved connections. Remove an old connection first."); return
        }
        val saved = allowed.toMutableSet().apply { if (value) add(peer) else remove(peer) }
        val denied = blocked.toMutableSet().apply { if (value) remove(peer) else if (size < 64) add(peer) }
        if (!linkApprovals.edit().putStringSet("approved", saved).putStringSet("blocked", denied).commit()) {
            reportError("Could not save connection approval. Please try again."); return
        }
        blocked.clear(); blocked.addAll(denied)
        if (value) allowed.add(peer) else { allowed.remove(peer); node?.disconnect(peer) }
        mutable.update { it.copy(allowed = allowed.toSet()) }
    }
    fun automaticNearby(value: Boolean) {
        linkApprovals.edit { putBoolean("automatic", value) }
        mutable.update { it.copy(automaticNearby = value) }
        state.value.peers.filter { it.id.startsWith("ble:") }.forEach { peer ->
            if (!org.loka.core.LocalLinkPolicy.permits(peer.id, value, allowed, blocked)) node?.disconnect(peer.id)
            else if (peer.readyToConnect) action { localNode().connect(peer.id) }
        }
    }
    fun relay(value: Boolean) {
        node?.relayEnabled = value
        mutable.update { it.copy(relayEnabled = value) }
        log("Relay ${if (value) "on" else "off"}")
    }
    fun importKey(text: String) = action {
        val key = Base64.decode(text.trim(), Base64.DEFAULT)
        LabCrypto.parsePublicKey(key)
        val id = fingerprint(key)
        check(id != state.value.deviceId) { "Import another device's key" }
        keys[id] = key
        preferences.edit { putString(id, Base64.encodeToString(key, Base64.NO_WRAP)) }
        mutable.update { it.copy(trusted = trustedList()) }; log("Manually trusted $id")
    }
    fun typing(id: String, active: Boolean) { viewModelScope.launch(peopleDispatcher) { people?.typing(id, active) } }
    fun requestChat(id: String) { viewModelScope.launch(Dispatchers.IO) { runCatching { checkNotNull(people).request(id) }.onFailure { reportError("Could not send the request. Please try again shortly.") } } }
    fun consumeAcceptedFriend() { mutable.update { it.copy(openAcceptedFriend = null) } }
    fun decideChat(id: String, accept: Boolean) { viewModelScope.launch(peopleDispatcher) {
        runCatching {
            val entry = state.value.chatRequests.firstOrNull { it.request.id == id && !it.outgoing &&
                it.phase == org.loka.core.ContactConsentBook.Phase.INCOMING && it.request.expires > System.currentTimeMillis() }
                ?: error("Request expired")
            checkNotNull(people).decide(id, accept)
            if (accept && keys.containsKey(entry.peer)) mutable.update { it.copy(openAcceptedFriend = entry.peer) }
        }.onFailure { reportError("This request is no longer available, or your choice could not be saved. Check Nearby.") }
    } }
    fun decideNotificationRequest(id: String, accept: Boolean) { viewModelScope.launch {
        if (id.length > 128) return@launch
        repeat(70) {
            if (state.value.ready) { decideChat(id, accept); return@launch }
            delay(100)
        }
        reportError("Open Nearby to review this request.")
    } }

    fun showNearbyName(value: Boolean) {
        profile.edit { putBoolean("people-visible",value) }; mutable.update { it.copy(peopleVisible=value) }
        viewModelScope.launch(Dispatchers.IO) { people?.visibilityChanged() }
    }
    fun forget(id: String) {
        if (runCatching { checkNotNull(people).block(id) }.isFailure) { reportError("Could not remove this friend safely. Please try again."); return }

        keys.remove(id); preferences.edit { remove(id) }
        node?.discard(node?.queued().orEmpty().mapNotNull { frame ->
            org.loka.core.PacketCodec.decode(frame).takeIf { it.destination == id }?.id
        })
        persistOutbox()
        LocalNotifications.cancel(getApplication(), id)
        mutable.update { it.copy(trusted = trustedList()) }; log("Removed trust for $id")
    }
    private fun startConnectionService() {
        if (!backgroundSession) return
        val app = getApplication<Application>()
        androidx.core.content.ContextCompat.startForegroundService(app, android.content.Intent(app, LocalConnectionService::class.java))
    }

    fun send(id: String, text: String, onQueued: () -> Unit = {}) = submit(id, text, false, onQueued)
    fun sendVoice(id: String, bytes: ByteArray, onQueued: () -> Unit = {}) {
        if (bytes.size !in 1..ChatContent.MAX_VOICE) { reportError("Voice note is too large. Record a shorter one."); return }
        submit(id, Base64.encodeToString(bytes, Base64.NO_WRAP), true, onQueued)
    }
    fun sendImage(id: String, bytes: ByteArray, onQueued: () -> Unit = {}) {
        if (!ChatContent.validImage(bytes)) { reportError("Choose a smaller photo."); return }
        submit(id, Base64.encodeToString(bytes, Base64.NO_WRAP), false, onQueued, image = true)
    }
    private fun submit(id: String, body: String, voice: Boolean, onQueued: () -> Unit, image: Boolean = false) {
        synchronized(this) {
            if (id in state.value.sending) return
            mutable.update { it.copy(sending = it.sending + id) }
        }
        viewModelScope.launch(Dispatchers.IO) {
            try {
                sendMutex.lock()
                try { queueMessage(id, body, voice, image) } finally { sendMutex.unlock() }
                kotlinx.coroutines.withContext(Dispatchers.Main) { onQueued() }
            } catch (_: Exception) { reportError("Could not queue this message. Your draft is still here.") }
            finally { mutable.update { it.copy(sending = it.sending - id) } }
        }
    }
    suspend fun sendFromNotification(id: String, text: String, actionID: String) = kotlinx.coroutines.withContext(Dispatchers.IO) {
        sendMutex.lock()
        try {
            if (!replyActions.contains(actionID)) {
                queueMessage(id, text, false)
                replyActions.edit { if (replyActions.all.size >= 128) clear(); putBoolean(actionID, true) }
            }
            LocalNotifications.message(getApplication(), id, "LOKA", "Reply queued · waiting for delivery", false)
        } finally { sendMutex.unlock() }
    }
    private fun queueMessage(id: String, body: String, voice: Boolean, image: Boolean = false) {
        val key = checkNotNull(keys[id])
        val logicalID = java.util.UUID.randomUUID().toString()
        val parts = if (image) ChatContent.image(logicalID, Base64.decode(body, Base64.NO_WRAP)) else if (voice) ChatContent.voice(logicalID, Base64.decode(body, Base64.NO_WRAP)) else {
            require(body.isNotBlank() && body.toByteArray(Charsets.UTF_8).size in 1..1400)
            listOf(ChatContent("T", logicalID, body.toByteArray(Charsets.UTF_8)))
        }
        require(localNode().queued().size + parts.size <= 120) { "Queue full" }
        val message = ChatMessage(logicalID, id, body, true, peerName = contactNames.getString(id, "") ?: "", activeQueue = true, voice = voice, image = image, lifetime = org.loka.core.CARRY_LIFETIME_MS)
        check(recordMessage(message))
        val packets = parts.map { localNode().send(key, it.encode(), automatic = true) }
        val current = state.value.chatMessages.first { it.id == logicalID }
        updateMessage(current.copy(packetIds = packets, route = packets.mapNotNull { routeCache[it] }.lastOrNull()))
        if (state.value.chatMessages.first { it.id == logicalID }.delivered) localNode().discard(packets)
        persistOutbox()
    }
    fun markRead(ids: Set<String>) {
        viewModelScope.launch(Dispatchers.IO) {
            ids.forEach { id ->
                val message = state.value.chatMessages.firstOrNull { it.id == id && !it.outgoing } ?: return@forEach
                if (LocalNotifications.visibleFriend != message.peerId) return@forEach
                if (message.readAt == null) runCatching { updateMessage(message.copy(readAt = System.currentTimeMillis())) }
            }
            retryReadReceipts()
        }
    }
    private val readReceiptLock = Any()
    private fun retryReadReceipts() = synchronized(readReceiptLock) {
        state.value.chatMessages.filter { !it.outgoing && it.readAt != null && !it.readReceiptQueued }.take(4).forEach { message ->
            val key = keys[message.peerId] ?: return@forEach
            runCatching {
                if (localNode().queued().size >= 120) return@runCatching
                localNode().send(key, ChatContent("B", message.id, message.readAt.toString().toByteArray(Charsets.UTF_8)).encode(), urgent = true, automatic = true)
                updateMessage(message.copy(readReceiptQueued = true)); persistOutbox()
            }
        }
    }
    fun react(messageID: String, emoji: String) {
        viewModelScope.launch(Dispatchers.IO) {
            sendMutex.lock()
            try {
                require(emoji in ChatContent.REACTIONS)
                val original = state.value.chatMessages.first { it.id == messageID }
                val key = checkNotNull(keys[original.peerId])
                val id = java.util.UUID.randomUUID().toString()
                val now = System.currentTimeMillis()
                val content = ChatContent("R", id, "$messageID|$emoji".toByteArray(Charsets.UTF_8))
                require(localNode().queued().size < 120)
                val packetID = localNode().send(key, content.encode(), automatic = true)
                val latest = state.value.chatMessages.first { it.id == messageID }
                updateMessage(latest.copy(myReaction = "$now|$id|$emoji", reactionPacket = packetID))
                latest.reactionPacket?.let { localNode().discard(listOf(it)) }
                persistOutbox()
            } catch (_: Exception) { reportError("Could not save your reaction. Try again.") }
            finally { sendMutex.unlock() }
        }
    }
    private val partyTrace=java.util.ArrayDeque<org.json.JSONObject>()
    private fun traceParty(event:org.loka.core.PartyEvent,packet:Packet,outgoing:Boolean) {
        if(!BuildConfig.DEBUG)return
        partyTrace.addLast(org.json.JSONObject().put("timeMs",System.currentTimeMillis()).put("direction",if(outgoing)"submitted" else "applied").put("kind",event.kind).put("event",event.id).put("reference",event.ref).put("revision",event.revision).put("packet",packet.id).put("transport",routeCache[packet.id]?.transport ?: "queued").put("links",7-packet.remainingHops).put("bytes",org.loka.core.PacketCodec.encode(packet).size))
        while(partyTrace.size>128)partyTrace.removeFirst()
        runCatching{java.io.File(getApplication<Application>().cacheDir,"loka-party-events.json").writeText(org.json.JSONArray(partyTrace.toList()).toString())}
    }
    private fun partyTraffic(id:String,text:String):Boolean {
        val st=state.value
        return org.loka.core.PartyEvent.permitted(id,text,st.partyPackHash,st.partySession,System.currentTimeMillis())
    }
    private fun publishParty() {
        val game = party ?: return
        mutable.update { it.copy(partySession = game.session, partyCard = game.current, partyStatus = game.notice,
            partyCanAct = game.canAct, partyPaused = game.paused, partyPackets = game.packetPermissions()) }
    }
    private fun partyAction(block: (org.loka.core.PartyCards) -> Unit) {
        viewModelScope.launch(gameDispatcher) {
            runCatching { block(checkNotNull(party)); mutable.update{it.copy(partyError=null)};publishParty() }.onFailure { mutable.update { it.copy(partyError = "Could not apply the card action. Check the turn or connection and try again.") } }
        }
    }
    fun inviteCards(players: List<String>, settings: org.loka.core.PartySettings) = partyAction { game ->
        require(players.size in 1..3)
        val oldKeys = partyKeys.toMap()
        val newKeys = players.associateWith { id -> state.value.nearbyPeople.firstOrNull { it.id == id }?.key ?: error("Player is not verified nearby") }
        partyKeys.clear(); partyKeys.putAll(newKeys)
        try { quiz?.session?.takeIf { it.phase != "ended" }?.let { quiz?.end(); publishQuiz() }; game.invite(players, settings) }
        catch (e: Exception) { partyKeys.clear(); partyKeys.putAll(oldKeys); throw e }
    }
    fun acceptCards() = partyAction { quiz?.session?.takeIf { old -> old.phase != "ended" }?.let { quiz?.end(); publishQuiz() }; it.accept() }
    fun cardAction(kind: String) = partyAction { it.act(kind) }
    fun resumeCards() = partyAction { it.resume() }
    fun endCards() = partyAction { it.end() }
    private fun publishQuiz() {
        val game = quiz ?: return
        mutable.update { it.copy(quizSession = game.session, quizStatus = game.notice, quizCanAnswer = game.canAnswer, quizPaused = game.paused) }
    }
    private fun gameAction(block: (org.loka.core.QuickQuiz) -> Unit) {
        viewModelScope.launch(gameDispatcher) {
            runCatching { block(checkNotNull(quiz)); publishQuiz() }
                .onFailure { reportError("Game action could not be applied. Check the invitation, turn or connection and try again.") }
        }
    }
    fun inviteQuiz(id: String) = gameAction { game -> require(party?.session?.phase !in listOf("active", "lobby", "joining")); require(keys.containsKey(id)); game.invite(id) }
    fun acceptQuiz() = gameAction { it.accept() }
    fun answerQuiz(choice: Int) = gameAction { it.answer(choice) }
    fun resumeQuiz() = gameAction { it.resume() }
    fun endQuiz() = gameAction { it.end() }
    private fun receiveContent(packet: Packet, text: String) {
        if (text.startsWith("L1|G|2|")) {
            viewModelScope.launch(gameDispatcher) {
                runCatching {
                    val game = checkNotNull(party)
                    val oldKeys = partyKeys.toMap()
                    val event = org.loka.core.PartyEvent.decode(text)
                    if (event.kind == "I" && event.session != game.session?.id) {
                        val key = state.value.nearbyPeople.firstOrNull { it.id == packet.source }?.key ?: keys[packet.source] ?: error("Inviter identity is not verified")
                        require(fingerprint(key) == packet.source); partyKeys.clear(); partyKeys[packet.source] = key
                    }
                    try { game.receive(packet.source, text); publishParty();traceParty(event,packet,false) }
                    catch (e: Exception) { partyKeys.clear(); partyKeys.putAll(oldKeys); throw e }
                }.onFailure { log("Party event rejected: unsupported, expired or unauthorized") }
            }
            return
        }
        if (text.startsWith("L1|G|")) {
            viewModelScope.launch(gameDispatcher) {
                runCatching { checkNotNull(quiz).receive(packet.source, text); publishQuiz() }
                    .onFailure { log("Game event rejected: unsupported, expired or invalid session event") }
            }
            return
        }
        val content = ChatContent.decode(text)
        if (content?.kind == "B") {
            val viewedAt = ChatContent.utf8(content.data).toLong(); require(viewedAt - 30_000 <= packet.createdAt)
            val original = state.value.chatMessages.firstOrNull { it.outgoing && it.id == content.id && it.peerId == packet.source } ?: return
            updateMessage(original.copy(delivered = true, deliveredAt = minOf(original.deliveredAt ?: packet.createdAt, packet.createdAt), readAt = original.readAt ?: viewedAt))
            node?.discard(original.packetIds); persistOutbox(); return
        }
        if (content?.kind == "H") {
            val original = state.value.chatMessages.firstOrNull { it.outgoing && it.id == content.id && it.peerId == packet.source } ?: return
            if (original.reportedHops == null) updateMessage(original.copy(reportedHops = content.index))
            return
        }
        if (content?.kind == "R") {
            val fields = ChatContent.utf8(content.data).split('|')
            val original = state.value.chatMessages.firstOrNull { it.id == fields[0] && it.peerId == packet.source } ?: return
            val next = "${packet.createdAt}|${content.id}|${fields[1]}"
            if (ChatContent.newerReaction(original.peerReaction, next)) updateMessage(original.copy(peerReaction = next))
            acknowledge(packet.senderPublicKey, content.id, carrier = packet.carrier, automatic = packet.version >= 2, returnVia = packet.grants.take(6 - packet.remainingHops).map { it.target }.reversed()); return
        }
        if (content?.kind == "A") {
            val reaction = state.value.chatMessages.firstOrNull { it.peerId == packet.source && it.myReaction?.split('|')?.getOrNull(1) == content.id }
            if (reaction != null) {
                reaction.reactionPacket?.let { node?.discard(listOf(it)) }
                updateMessage(reaction.copy(reactionPacket = null)); persistOutbox(); return
            }
            val original = state.value.chatMessages.firstOrNull { it.outgoing && content.acknowledges(it.id, it.peerId, packet.source) } ?: return
            updateMessage(original.copy(delivered = true, deliveredAt = minOf(original.deliveredAt ?: packet.createdAt, packet.createdAt))); node?.discard(original.packetIds); persistOutbox(); return
        }
        val logicalID = content?.id ?: packet.id
        if (state.value.chatMessages.any { it.id == logicalID && it.peerId == packet.source && !it.outgoing }) {
            if (content != null) acknowledge(packet.senderPublicKey, logicalID, state.value.chatMessages.first { it.id == logicalID }.reportedHops, packet.carrier, packet.version >= 2, packet.grants.take(6 - packet.remainingHops).map { it.target }.reversed()); return
        }
        val voice = content?.kind == "V"
        val image = content?.kind == "I"
        val body = if (voice || image) {
            val bytes = voiceAssembly.accept(packet.source, content!!, packet.expiresAt, System.currentTimeMillis()) ?: return
            Base64.encodeToString(bytes, Base64.NO_WRAP)
        } else if (content != null) ChatContent.utf8(content.data) else text
        val message = ChatMessage(logicalID, packet.source, body, false, packet.createdAt,
            peerName = contactNames.getString(packet.source, "") ?: "", voice = voice, image = image, reportedHops = 7 - packet.remainingHops, route = routeCache[packet.id], lifetime = packet.expiresAt - packet.createdAt)
        if (recordMessage(message)) {
            if (content != null) acknowledge(packet.senderPublicKey, logicalID, message.reportedHops, packet.carrier, packet.version >= 2, packet.grants.take(6 - packet.remainingHops).map { it.target }.reversed())
            // Notification delivery is best effort and must never block the saved-message receipt.
            runCatching { LocalNotifications.message(getApplication(), packet.source, message.peerName, "New message") }
                .onFailure { log("Message saved; notification could not be shown") }
        }
    }
    private fun acknowledge(key: ByteArray, logicalID: String, hops: Int? = null, carrier: String = "", automatic: Boolean = false, returnVia: List<String> = emptyList()) {
        val now = System.currentTimeMillis()
        val sender = fingerprint(key)
        if (!acknowledged.canCreate(sender, logicalID, now)) return
        // A saved-message receipt must survive a failed write or temporary disconnect.
        // The existing bounded outbox retries it until expiry; receipts never acknowledge receipts.
        runCatching {
            val receiptID = localNode().send(key, ChatContent("A", logicalID).encode(), urgent = true, carrier = carrier, automatic = automatic, returnVia = returnVia)
            log("CARRY ${receiptID.take(8)} delivery receipt queued for ${logicalID.take(8)}")
            if (hops != null) runCatching { localNode().send(key, ChatContent("H", logicalID, index = hops).encode(), carrier = carrier, automatic = automatic, returnVia = returnVia) }
            acknowledged.remember(sender, logicalID, now + if (automatic || carrier.isNotEmpty()) org.loka.core.CARRY_LIFETIME_MS else org.loka.core.MAX_LIFETIME_MS, now)
            persistOutbox()
        }.onFailure { log("Delivery receipt could not be saved or queued; duplicate reception can retry") }
    }
    @Synchronized private fun updateMessage(message: ChatMessage) {
        val old = state.value.chatMessages.firstOrNull { it.id == message.id } ?: return
        val keepMine = old.myReaction != null && (message.myReaction == null || ChatContent.newerReaction(message.myReaction, old.myReaction))
        val keepTheirs = old.peerReaction != null && (message.peerReaction == null || ChatContent.newerReaction(message.peerReaction, old.peerReaction))
        val merged = message.copy(route = message.route ?: old.route, delivered = old.delivered || message.delivered, packetIds = message.packetIds.ifEmpty { old.packetIds },
            reportedHops = old.reportedHops ?: message.reportedHops, deliveredAt = listOfNotNull(old.deliveredAt, message.deliveredAt).minOrNull(), readAt = old.readAt ?: message.readAt, readReceiptQueued = old.readReceiptQueued || message.readReceiptQueued,
            myReaction = if (keepMine) old.myReaction else message.myReaction,
            peerReaction = if (keepTheirs) old.peerReaction else message.peerReaction,
            reactionPacket = if (keepMine) old.reactionPacket else message.reactionPacket)
        checkNotNull(history).update(merged)
        mutable.update { it.copy(chatMessages = it.chatMessages.map { existing -> if (existing.id == message.id) merged else existing }) }
    }
    private fun persistOutbox() {
        val frames = node?.queued() ?: return
        runCatching {
            val data = org.json.JSONArray(frames.map { Base64.encodeToString(it, Base64.NO_WRAP) }).toString().toByteArray()
            synchronized(outbox) {
                if (lastOutbox?.contentEquals(data) == true) return
                val stream = outbox.startWrite()
                try { stream.write(data); outbox.finishWrite(stream); lastOutbox = data } catch (e: Exception) { outbox.failWrite(stream); throw e }
            }
        }.onFailure { reportError("Pending messages could not be saved. Keep LOKA open and check free storage.") }
    }
    private fun historyContacts(messages: List<ChatMessage>) = messages.groupBy { it.peerId }.map { (id, entries) ->
        TrustedDevice(id, "", entries.lastOrNull { it.peerName.isNotBlank() }?.peerName.orEmpty())
    }
    @Synchronized private fun recordMessage(message: ChatMessage): Boolean {
        state.value.chatMessages.firstOrNull { it.id == message.id }?.let {
            require(it.peerId == message.peerId && it.outgoing == message.outgoing && it.body == message.body && it.voice == message.voice)
            return true
        }
        val saved = runCatching { checkNotNull(history).append(message) }
            .onFailure { reportError("Message processed, but could not save it on this phone. Check free storage.") }.isSuccess
        mutable.update { old ->
            val messages = (old.chatMessages + if (saved) listOf(message) else emptyList()).distinctBy { it.id }.takeLast(HistoryFormat.MAX_MESSAGES)
            old.copy(chatMessages = messages, historyContacts = historyContacts(messages), historySaveFailed = old.historySaveFailed || !saved)
        }
        return saved
    }
    fun prepareBackup() {
        if (state.value.backupBusy || !state.value.ready) return
        mutable.update { it.copy(backupBusy = true) }
        viewModelScope.launch(Dispatchers.IO) {
            runCatching {
                val code = org.loka.core.backup.BackupCipher.recoveryCode()
                val messages = state.value.chatMessages.map { it.copy(peerName = contactNames.getString(it.peerId, it.peerName) ?: it.peerName) }
                val plain = HistoryFormat.encode(messages)
                try { pendingBackup = org.loka.core.backup.BackupCipher.encrypt(plain, code) } finally { plain.fill(0) }
                mutable.update { it.copy(backupCode = code) }
            }.onFailure { reportError("Could not prepare encrypted backup. Your existing history is unchanged.") }
            mutable.update { it.copy(backupBusy = false) }
        }
    }
    fun cancelBackup() {
        if (state.value.backupBusy) return
        pendingBackup?.fill(0); pendingBackup = null
        mutable.update { it.copy(backupCode = null) }
    }
    fun saveBackup(uri: android.net.Uri) {
        if (state.value.backupBusy) return
        val archive = pendingBackup ?: return
        mutable.update { it.copy(backupBusy = true) }
        viewModelScope.launch(Dispatchers.IO) {
            runCatching {
                getApplication<Application>().contentResolver.openOutputStream(uri, "wt").use { stream ->
                    requireNotNull(stream); stream.write(archive); stream.flush()
                }
                val status = "Backup file saved · " + java.text.DateFormat.getDateTimeInstance().format(java.util.Date())
                profile.edit { putString("last-backup", status) }
                mutable.update { it.copy(backupStatus = status, backupCode = null) }
                pendingBackup?.fill(0); pendingBackup = null
            }.onFailure { reportError("Backup could not be saved. Keep your recovery key and try another location. A partial file may need deleting.") }
            mutable.update { it.copy(backupBusy = false) }
        }
    }
    fun restoreBackup(uri: android.net.Uri, code: String, done: () -> Unit) {
        if (state.value.backupBusy || !state.value.ready) return
        mutable.update { it.copy(backupBusy = true) }
        viewModelScope.launch(Dispatchers.IO) {
            runCatching {
                val archive = getApplication<Application>().contentResolver.openInputStream(uri).use { stream ->
                    requireNotNull(stream)
                    val output = java.io.ByteArrayOutputStream()
                    val buffer = ByteArray(8192)
                    while (true) {
                        val count = stream.read(buffer); if (count == -1) break
                        require(output.size() + count <= org.loka.core.backup.BackupCipher.MAX_BYTES)
                        output.write(buffer, 0, count)
                    }
                    output.toByteArray()
                }
                val plain = org.loka.core.backup.BackupCipher.decrypt(archive, code.trim())
                val restored = try { HistoryFormat.decode(plain) } finally { plain.fill(0) }
                synchronized(this@LabViewModel) {
                val merged = checkNotNull(history).merge((state.value.chatMessages + restored).distinctBy { it.id })
                mutable.update { old ->
                    // Existing live queues stay live; imported rows never enter the network queue.
                    val active = old.chatMessages.filter { it.activeQueue }.map { it.id }.toSet()
                    val messages = merged.map { it.copy(activeQueue = it.id in active) }
                    old.copy(chatMessages = messages, historyContacts = historyContacts(messages), historySaveFailed = false, backupStatus = "History restored · ${restored.size} saved messages")
                }
                }
                viewModelScope.launch(Dispatchers.Main) { done() }
            }.onFailure { reportError("Restore failed. Check the recovery key and file. Existing chats were not replaced.") }
            mutable.update { it.copy(backupBusy = false) }
        }
    }
    override fun onCleared() { node?.stop(); history?.close(); pendingBackup?.fill(0); super.onCleared() }
}
