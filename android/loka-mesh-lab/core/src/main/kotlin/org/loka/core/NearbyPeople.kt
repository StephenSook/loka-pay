package org.loka.core

import java.util.Base64
import java.util.UUID

data class NearbyProfile(val handle: String, val id: String, val key: ByteArray, val name: String, val carryVersion: Int = 0, val avatarID: String? = null, val avatarShared: Boolean = false, val avatarUpdatedAt: Long = 0)
data class NearbySaved(val book: ContactConsentBook.Saved, val keys: Map<String, String>)

/** Direct-link profile/consent coordinator. All public entry points serialize on this object. */
class NearbyPeople(private val crypto: LabCrypto, private val name: () -> String,
    private val visible: () -> Boolean, private val send: (String, ByteArray) -> Unit,
    private val save: (NearbySaved) -> Unit, private val authorize: (ByteArray, String) -> Unit,
    private val changed: (List<NearbyProfile>, List<ContactConsentBook.Entry>) -> Unit,
    private val clock: () -> Long = System::currentTimeMillis, private val avatar: () -> String? = { null }) {
    private val book = ContactConsentBook(crypto.deviceId)
    private val links = linkedSetOf<String>()
    private val profiles = linkedMapOf<String, NearbyProfile>()
    private val challenges = mutableMapOf<String, Pair<String, Long>>()
    private val keys = mutableMapOf<String, String>()
    private val helloAt = mutableMapOf<String, Long>()
    var routeLoad: (String) -> Int = { 0 }
    var routePreference: (String) -> Int = { 0 }
    private fun candidates(id: String) = profiles.values.filter { it.id == id && it.handle in links }
        .sortedWith(compareBy<NearbyProfile> { routeLoad(it.handle).coerceAtLeast(0) }.thenBy { routePreference(it.handle) }.thenBy { it.handle })
    // Encrypt once and try only authenticated aliases of this recipient. Queue acceptance is not delivery.
    private fun encryptedPeer(id: String, content: String, routes: List<NearbyProfile> = candidates(id)) {
        val first = routes.firstOrNull() ?: return
        val frame = encrypted + PacketCodec.encode(crypto.encrypt(first.key, content, clock()))
        for (route in routes) if (runCatching { send(route.handle, frame) }.isSuccess) return
    }
    var trusted: (String) -> Boolean = { false }
    var typingChanged: (String, Long) -> Unit = { _, _ -> }
    private val responsive = mutableMapOf<String, Long>()
    private val sentTyping = mutableMapOf<String, Pair<Long, Boolean>>()
    private val receivedTyping = mutableMapOf<String, Long>()
    private val capabilityAt = mutableMapOf<String, Long>()
    private data class AvatarOffer(val key: ByteArray, val nonce: String, var value: String, var at: Long)
    private val avatarOffers = mutableMapOf<String, AvatarOffer>()
    private val profileNonces = mutableMapOf<String, String>()
    private val avatarAt = mutableMapOf<String, Long>()
    private var lastRetry = 0L
    private var window = 0L
    private var admitted = 0
    var onFailure: (() -> Unit)? = null
    private var failed = false
    companion object {
        private val hello = "LP1H".toByteArray()
        private val encrypted = "LP1E".toByteArray()
        fun controls(frame: ByteArray) = frame.size >= 4 && (frame.copyOfRange(0,4).contentEquals(hello) || frame.copyOfRange(0,4).contentEquals(encrypted))
        fun displayName(raw: String): String {
            val cleaned = raw.trim().codePoints().filter { Character.getType(it) !in listOf(Character.CONTROL.toInt(), Character.FORMAT.toInt(), Character.LINE_SEPARATOR.toInt(), Character.PARAGRAPH_SEPARATOR.toInt()) }.toArray()
            var result = String(cleaned, 0, minOf(cleaned.size, 40)).trim()
            while (result.toByteArray().size > 128) result = result.substring(0, result.offsetByCodePoints(result.length, -1))
            return result.ifBlank { "LOKA user" }
        }
        fun displayProfiles(values: List<NearbyProfile>): List<NearbyProfile> {
            val result = linkedMapOf<String, NearbyProfile>()
            values.forEach { p -> if (result[p.id]?.let { p.avatarUpdatedAt > it.avatarUpdatedAt } != false) result[p.id] = p }
            return result.values.toList()
        }
        fun avatarID(raw: String?): String? = raw?.takeIf { value -> (0..41).any { value == "avatar_$it" } }
        fun bars(dbm: Int?): Int = when { dbm == null || dbm !in -127..-1 -> 0; dbm >= -50 -> 6; dbm >= -60 -> 5; dbm >= -67 -> 4; dbm >= -74 -> 3; dbm >= -82 -> 2; else -> 1 }
    }
    @Synchronized fun restore(state: NearbySaved?) {
        if (state != null) {
            book.restore(state.book, clock()); require(state.keys.size <= 32)
            state.keys.forEach { (id, value) -> val key = Base64.getDecoder().decode(value); LabCrypto.parsePublicKey(key); require(fingerprint(key) == id); keys[id] = value }
            require(book.snapshot(clock()).all { it.peer in keys })
        }
        commit(); publish()
    }
    private fun ownName() = displayName(name())
    private fun publish() { changed(profiles.values.toList(), book.snapshot(clock())) }
    private fun commit() {
        check(!failed)
        val saved = book.saved(clock())
        keys.keys.retainAll(saved.entries.map { it.peer }.toSet())
        try {
            save(NearbySaved(saved, keys.toMap()))
            saved.entries.filter { (it.outgoing && it.phase == ContactConsentBook.Phase.COMPLETE) || (!it.outgoing && it.phase in listOf(ContactConsentBook.Phase.APPROVED, ContactConsentBook.Phase.COMPLETE)) }
                .forEach { authorize(Base64.getDecoder().decode(keys.getValue(it.peer)), it.peerName) }
        } catch (e: Exception) { failed = true; profiles.clear(); publish(); onFailure?.invoke(); throw e }
    }
    private fun emit(handle: String, data: ByteArray) { runCatching { send(handle, data) } }
    private fun encrypted(handle: String, key: ByteArray, content: String) {
        emit(handle, encrypted + PacketCodec.encode(crypto.encrypt(key, content, clock())))
    }
    @Synchronized fun link(handle: String, up: Boolean) {
        if (failed) return
        if (!up) { links.remove(handle); profiles[handle]?.let { typingChanged(it.id, 0) }; responsive.remove(handle); profiles.remove(handle); challenges.remove(handle); helloAt.remove(handle); capabilityAt.remove(handle); avatarOffers.remove(handle); profileNonces.remove(handle); avatarAt.remove(handle); publish(); return }
        if (links.size >= 32 && handle !in links) return
        links.add(handle); hello(handle)
    }
    private fun hello(handle: String) {
        val now = clock()
        if (helloAt[handle]?.let { now - it < 30_000 } == true) return
        val nonce = UUID.randomUUID().toString()
        challenges[handle] = nonce to now; helloAt[handle] = now
        emit(handle, hello + "$nonce|${Base64.getEncoder().encodeToString(crypto.publicKey)}".toByteArray())
    }
    @Synchronized fun receive(handle: String, frame: ByteArray) {
        if (failed || handle !in links || frame.size !in 5..4096 || !controls(frame)) return
        val now = clock()
        if (now - window >= 10_000 || now < window) { window = now; admitted = 0 }
        if (++admitted > 32) return
        runCatching {
            if (frame.copyOfRange(0,4).contentEquals(hello)) {
                if (!visible()) return
                val p = String(frame.copyOfRange(4,frame.size), Charsets.US_ASCII).split('|')
                require(p.size == 2 && UUID.fromString(p[0]).toString() == p[0])
                val key = Base64.getDecoder().decode(p[1]); require(Base64.getEncoder().encodeToString(key) == p[1]); LabCrypto.parsePublicKey(key)
                require(fingerprint(key) != crypto.deviceId && fingerprint(key) !in book.saved(now).blocked)
                encrypted(handle, key, "LP1|P|${p[0]}|${Base64.getEncoder().encodeToString(ownName().toByteArray())}")
                val value = avatarID(avatar()) ?: "-"
                avatarOffers[handle] = AvatarOffer(key, p[0], value, now)
                encrypted(handle, key, "LP1|I|${p[0]}|$now|$value")
                if (handle !in profiles) hello(handle)
                return
            }
            val packet = PacketCodec.decode(frame.copyOfRange(4,frame.size)); packet.validate(now)
            require(packet.destination == crypto.deviceId && packet.source != crypto.deviceId && packet.source !in book.saved(now).blocked)
            val known = profiles[handle]
            require(challenges[handle] != null || known?.id == packet.source)
            val text = crypto.decrypt(packet)
            if (text.startsWith("LP1|P|")) {
                val p = text.split('|'); require(p.size == 4)
                val challenge = challenges[handle] ?: return
                require(p[2] == challenge.first && now - challenge.second in 0..60_000)
                val bytes = Base64.getDecoder().decode(p[3]); require(Base64.getEncoder().encodeToString(bytes) == p[3])
                val profileName = ChatContent.utf8(bytes)
                ContactConsent("R", p[2], now + ContactConsent.LIFETIME, profileName).encode()
                if (now - challenge.second <= 2_000) responsive[handle] = now
                challenges.remove(handle); profileNonces[handle] = p[2]; avatarAt.remove(handle)
                profiles[handle] = NearbyProfile(handle, packet.source, packet.senderPublicKey, profileName)
                encrypted(handle, packet.senderPublicKey, "LP1|V|2"); encrypted(handle, packet.senderPublicKey, "LP1|V|3"); capabilityAt[handle] = now; publish(); retry(handle); return
            }
            require(known?.id == packet.source)
            if (text.startsWith("LP1|I|")) {
                val p = text.split('|'); require(p.size == 5 && p[2] == profileNonces[handle])
                val at = p[3].toLong(); require(at >= 0 && at.toString() == p[3] && now - at in -2_000..60_000 && at > (avatarAt[handle] ?: -1))
                require(p[4] == "-" || avatarID(p[4]) != null)
                avatarAt[handle] = at
                profiles[handle] = checkNotNull(known).copy(avatarID = avatarID(p[4]), avatarShared = true, avatarUpdatedAt = at)
                publish(); return
            }
            if (text == "LP1|V|2" || text == "LP1|V|3") {
                profiles[handle] = checkNotNull(known).copy(carryVersion = maxOf(known.carryVersion, text.last().digitToInt())); publish(); return
            }
            if (text.startsWith("LP1|T|")) {
                require(trusted(packet.source))
                val parts = text.split('|'); require(parts.size == 4 && parts[3] in listOf("0", "1"))
                val at = parts[2].toLong(); require(at >= 0 && at.toString() == parts[2] && now - at in -2_000..8_000)
                receivedTyping.entries.removeAll { now - it.value > 8_000 }
                require(at > (receivedTyping[packet.source] ?: -1L))
                if (receivedTyping.size >= 32 && packet.source !in receivedTyping) return
                receivedTyping[packet.source] = at
                typingChanged(packet.source, if (parts[3] == "1") minOf(now + 8_000, at + 8_000) else 0)
                return
            }
            if (text == "LP1|X") { profiles.remove(handle); publish(); return }
            val consent = ContactConsent.decode(text)
            require(visible() || consent.kind != "R" || book.snapshot(now).any { it.peer == packet.source })
            require(consent.expires > now && consent.expires - now <= ContactConsent.LIFETIME)
            val before = book.saved(now)
            val crossed = consent.kind == "R" && book.replaceCrossedOutgoing(packet.source, consent.id, now)
            val response = try { book.receive(packet.source, consent, now) } catch (e: Exception) { book.restore(before, now); throw e }
            keys[packet.source] = Base64.getEncoder().encodeToString(packet.senderPublicKey)
            val reply = if (crossed) book.decide(consent.id, true, ownName(), now) else response
            commit(); publish()
            if (reply != null) encryptedPeer(packet.source, reply.encode())
        }
    }
    /** Ephemeral direct-link hint; never stored, relayed or retried. No draft text. */
    @Synchronized fun typing(id: String, active: Boolean) {
        if (failed || !trusted(id)) return
        val now = clock()
        val candidates = candidates(id)
        val ready = candidates.filter { now - (responsive[it.handle] ?: 0) in 0..60_000 }
        val profile = ready.firstOrNull()
        if (profile == null) { candidates.firstOrNull()?.let { hello(it.handle) }; return }
        sentTyping.entries.removeAll { now - it.value.first > 8_000 }
        val previous = sentTyping[id]
        if (previous != null && previous.second == active && now - previous.first < 4_000) return
        if (sentTyping.size >= 32 && id !in sentTyping) return
        val stamp = maxOf(now, (previous?.first ?: -1L) + 1)
        sentTyping[id] = stamp to active
        encryptedPeer(id, "LP1|T|$stamp|${if (active) 1 else 0}", ready)
    }
    @Synchronized fun request(id: String) {
        check(!failed && visible())
        val profile = candidates(id).first()
        book.begin(id, ownName(), clock()); keys[id] = Base64.getEncoder().encodeToString(profile.key)
        commit(); publish(); retryPeer(id)
    }
    @Synchronized fun decide(id: String, accept: Boolean) {
        check(!failed); book.decide(id, accept, ownName(), clock()); commit(); publish(); profiles.values.map { it.id }.distinct().forEach(::retryPeer)
    }
    @Synchronized fun block(id: String) {
        check(!failed); book.block(id); profiles.entries.removeAll { it.value.id == id }; commit(); publish()
    }
    @Synchronized fun visibilityChanged() {
        // Drop profile bindings on this device. Remote bindings expire with the link;
        // withdrawal is encrypted and authenticated, using a new profile exchange on re-enable.
        if (!visible()) profiles.values.forEach { encrypted(it.handle, it.key, "LP1|X") }
    }
    private fun retry(handle: String) { profiles[handle]?.let { retryPeer(it.id) } }
    private fun retryPeer(id: String) {
        val e = book.snapshot(clock()).firstOrNull { it.peer == id } ?: return
        val kind = when (e.phase) {
            ContactConsentBook.Phase.OUTGOING -> "R"
            ContactConsentBook.Phase.APPROVED -> "A"
            ContactConsentBook.Phase.COMPLETE -> if (e.outgoing) "K" else "A"
            ContactConsentBook.Phase.DECLINED -> if (e.outgoing) return else "D"
            else -> return
        }
        val name = if (kind == "R") e.request.name else if (kind == "A") e.responseName else ""
        encryptedPeer(id, ContactConsent(kind, e.request.id, e.request.expires, name).encode())
    }
    @Synchronized fun tick() {
        if (failed) return
        links.filter { it !in profiles }.forEach(::hello)
        val now = clock()
        if (visible()) {
            val value = avatarID(avatar()) ?: "-"
            avatarOffers.forEach { (handle, offer) ->
                if (offer.value != value && profiles[handle]?.id == fingerprint(offer.key) && now - offer.at >= 2_000) {
                    val stamp = maxOf(now, offer.at + 1)
                    encrypted(handle, offer.key, "LP1|I|${offer.nonce}|$stamp|$value")
                    offer.value = value; offer.at = stamp
                }
            }
        }
        if (now - lastRetry >= 15_000) {
            lastRetry = now
            profiles.values.toList().forEach { p ->
            val interval = if (p.carryVersion >= 2) 120_000L else 15_000L
            if (now - (capabilityAt[p.handle] ?: 0L) >= interval) {
                if (p.carryVersion != 3) encrypted(p.handle, p.key, "LP1|V|2")
                if (p.carryVersion != 2) encrypted(p.handle, p.key, "LP1|V|3")
                capabilityAt[p.handle] = now
            }
            }
            profiles.values.map { it.id }.distinct().forEach { id ->
                if (book.snapshot(now).none { it.peer == id && it.phase == ContactConsentBook.Phase.COMPLETE }) retryPeer(id)
            }
            publish()
        }
    }
}
