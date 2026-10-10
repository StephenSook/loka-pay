package org.loka.core

/** Bounded flooding for the lab. Calls are serialized; destination ACKs are handled by application content. */
class MeshEngine @JvmOverloads constructor(
    private val crypto: LabCrypto,
    private val clock: () -> Long = System::currentTimeMillis,
    private val trusted: (String) -> Boolean,
    private val sendFrame: (String, ByteArray) -> Unit,
    private val event: (String) -> Unit,
    private val message: (String, String) -> Unit,
    private val packetMessage: ((Packet, String) -> Unit)? = null,
    private val sendUrgentFrame: ((String, ByteArray) -> Unit)? = null,
    private val saveCarry: ((List<ByteArray>) -> Unit)? = null,
) {
    var applicationPeer: (String) -> Boolean = { false }
    var applicationContent: (String, String) -> Boolean = { _, _ -> false }
    var applicationPacket: (Packet) -> Boolean = { false }
    private fun permittedText(id: String, text: String) = trusted(id) || (applicationPeer(id) && applicationContent(id, text))
    var observeRoute: ((Packet, String?, Boolean) -> Unit)? = null
    var routeLoad: (String) -> Int = { 0 }
    var routePreference: (String) -> Int = { 0 }
    private fun orderedLinks() = links.sortedWith(compareBy<String> { routeLoad(it).coerceAtLeast(0) }.thenBy { routePreference(it) }.thenBy { it })
    var carryPeer: (String) -> String? = { null }
    var carryVersion: (String) -> Int = { 2 }
    private data class Pending(val packet: Packet, val incoming: String?, val urgent: Boolean = false)
    private val failedUntil = mutableMapOf<String, Long>()
    private val peerAttempts = mutableMapOf<String, Long>()
    private val attempted = mutableMapOf<String, Long>()
    private val acceptedAttempts = mutableMapOf<String, Int>()
    private val sentTargets = mutableMapOf<String, MutableSet<String>>()
    private fun retryDelay(id: String): Long = 15_000L * (1L shl ((acceptedAttempts[id] ?: 0) - 1).coerceIn(0, 3))
    private fun retryReady(packet: Packet, peer: String): Boolean =
        clock() - (attempted[packet.id] ?: 0L) >= retryDelay(packet.id) ||
            (packet.version >= 2 && carryPeer(peer)?.let { it !in sentTargets[packet.id].orEmpty() } == true)
    private val links = linkedSetOf<String>()
    private val seen = linkedMapOf<String, Long>()
    private val pending = linkedMapOf<String, Pending>()
    var relayEnabled = true
        @Synchronized set(value) {
            field = value
            if (!value) commit(pending.filterValues { it.packet.source == crypto.deviceId })
        }
    @Synchronized fun linkUp(peer: String) {
        links.add(peer); failedUntil.remove(peer); prune(); selectCarriers()
        pending.values.toList().filter { it.incoming != peer }.forEach { transmit(peer, it.packet) }
        event("Link connected: $peer; queued packets replayed")
    }
    @Synchronized fun linkDown(peer: String) { links.remove(peer); event("Link disconnected: $peer") }
    @JvmOverloads @Synchronized fun send(recipient: ByteArray, text: String, urgent: Boolean = false, carrier: String = "", automatic: Boolean = false, returnVia: List<String> = emptyList(), lifetimeMs: Long? = null): String {
        require(!urgent || ChatContent.decode(text)?.kind in listOf("A", "B")) { "Only local receipts may be prioritized" }
        prune()
        require(permittedText(fingerprint(recipient), text)) { "Verify and import the recipient key first" }
        require(fingerprint(recipient) != crypto.deviceId) { "Choose another device" }
        require(pending.size < 128 && seen.size < 2048) { "Queue full; wait for expiry" }
        if (carrier.isNotEmpty() || automatic) require(pending.size < if (urgent) 128 else 112)
        val packet = crypto.encrypt(recipient, text, clock(), carrier, automatic, automatic && (returnVia.isNotEmpty() || carryVersion(fingerprint(recipient)) >= 3), returnVia, lifetimeMs)
        commit(pending + (packet.id to Pending(packet, null, urgent)))
        seen[packet.id] = packet.expiresAt
        if (packet.version > 0) event("CARRY ${packet.id.take(8)} origin committed")
        selectCarriers()
        orderedLinks().forEach { transmit(it, pending.getValue(packet.id).packet) }
        event("${packet.id.take(8)} queued; ${links.size} links; no delivery confirmation")
        return packet.id
    }
    @Synchronized fun receive(peer: String, frame: ByteArray) {
        var traceID = "unknown"
        try {
            prune()
            val packet = PacketCodec.decode(frame)
            if (packet.id.matches(Regex("[0-9a-f-]{36}"))) traceID = packet.id.take(8)
            packet.validate(clock())
            require(LabCrypto.verify(packet)) { "Invalid signature" }
            event("CARRY $traceID ingress src=${packet.source.take(8)} dst=${packet.destination.take(8)} hops=${packet.remainingHops} v=${packet.version} role=${if(packet.destination == crypto.deviceId) "destination" else "relay"} authenticated=${carryPeer(peer)?.take(8) ?: "unknown"}")
            if (packet.version == 1) {
                if (packet.destination == crypto.deviceId && packet.remainingHops == 6) { event("CARRY ${packet.id.take(8)} direct bypass ignored"); return }
                if (packet.destination != crypto.deviceId && packet.carrier != crypto.deviceId) { event("CARRY $traceID ignored not designated carrier"); return }
                require(if (packet.destination == crypto.deviceId) packet.remainingHops == 5 else packet.remainingHops == 6) { "Carry path mismatch" }
            }
            if (packet.version == 2) {
                if (packet.destination != crypto.deviceId && packet.carrier != crypto.deviceId) { event("CARRY $traceID ignored not designated carrier"); return }
                require(if (packet.destination == crypto.deviceId) packet.remainingHops in 5..6 else packet.remainingHops == 6)
            }
            if (packet.version == 3) {
                val holders = packet.holders()
                val index = MAX_HOPS - packet.remainingHops
                require(index in holders.indices)
                if (packet.destination != crypto.deviceId) require(carryPeer(peer) == holders[index] && index + 1 < holders.size && holders[index + 1] == crypto.deviceId) { "Incoming holder mismatch" }
            }
            if (packet.id in seen) {
                if (packetMessage != null && packet.destination == crypto.deviceId && (trusted(packet.source) || applicationPeer(packet.source))) {
                    val text = crypto.decrypt(packet)
                    require(permittedText(packet.source, text))
                    packetMessage.invoke(packet, text)
                }
                event("CARRY ${packet.id.take(8)} duplicate ignored"); return
            }
            // Rate/budget protection: refuse new items rather than evicting live replay records.
            require(seen.size < 2048) { "Replay cache full" }
            if (packet.destination == crypto.deviceId) {
                require(trusted(packet.source) || applicationPeer(packet.source)) { "Sender has no permitted application scope" }
                val text = crypto.decrypt(packet)
                require(permittedText(packet.source, text))
                runCatching { observeRoute?.invoke(packet, peer, false) }
                if (packetMessage != null) packetMessage.invoke(packet, text) else message(packet.source, text)
                seen[packet.id] = packet.expiresAt
                if (packet.version > 0) event("CARRY ${packet.id.take(8)} destination saved")
                event("Received ${packet.id.take(8)}; ${MAX_HOPS - packet.remainingHops + 1} links; age ${clock() - packet.createdAt} ms")
            } else if (relayEnabled && packet.remainingHops > 0) {
                require(pending.size < if (packet.version > 0) 112 else 128) { "Relay queue full" }
                val forwarded = packet.copy(remainingHops = packet.remainingHops - 1)
                commit(pending + (packet.id to Pending(forwarded, peer)))
                seen[packet.id] = packet.expiresAt
                if (packet.version > 0) event("CARRY ${packet.id.take(8)} carrier committed")
                selectCarriers()
                orderedLinks().filter { it != peer }.forEach { transmit(it, pending.getValue(packet.id).packet) }
                event("Relay ${packet.id.take(8)}: ${packet.ciphertext.size} ciphertext bytes; TTL ${forwarded.remainingHops}")
            } else event("CARRY ${packet.id.take(8)} dropped relay off or TTL exhausted")
        } catch (error: Exception) { event("CARRY $traceID rejected ${error.message ?: error.javaClass.simpleName}") }
    }
    @Synchronized fun tick() {
        prune(); selectCarriers()
        if (links.isEmpty()) return
        val eligible = pending.values.filter { item -> orderedLinks().any { peer ->
            peer != item.incoming && canAttempt(peer, item.packet) &&
                retryReady(item.packet, peer)
        } }
            .sortedWith(compareBy<Pending> { attempted[it.packet.id] ?: 0L }.thenByDescending { if ((attempted[it.packet.id] ?: 0L) == 0L) it.packet.createdAt else 0L }.thenBy { it.packet.id })
        // Give receipts a fast lane while reserving progress for ordinary messages.
        val receipts = eligible.filter { it.urgent }.take(3)
        val normal = eligible.filter { !it.urgent }
        val batch = (normal.take(1) + receipts + normal.drop(1) + eligible.filter { it.urgent && it !in receipts }).take(4)
        batch.forEach { item ->
            orderedLinks().filter { it != item.incoming && retryReady(item.packet, it) }.forEach { transmit(it, item.packet) }
        }
    }
    @Synchronized fun diagnostic(): List<String> = listOf("own=${crypto.deviceId.take(8)} relay=$relayEnabled pending=${pending.size} bytes=${pending.values.sumOf { PacketCodec.encode(it.packet).size }}") + pending.values.map {
        val p = it.packet
        "id=${p.id.take(8)} src=${p.source.take(8)} dst=${p.destination.take(8)} v=${p.version} hops=${p.remainingHops} grant=${p.holders().joinToString(",") { id -> id.take(8) }} from=${it.incoming?.let { peer -> carryPeer(peer)?.take(8) } ?: "unknown"} attempted=${attempted[p.id] ?: 0L}"
    }
    @Synchronized fun queued(): List<ByteArray> = pending.values.filter { it.packet.source == crypto.deviceId }.map { PacketCodec.encode(it.packet) }
    @Synchronized fun restore(frame: ByteArray) {
        val packet = PacketCodec.decode(frame); packet.validate(clock())
        require(packet.source == crypto.deviceId && (trusted(packet.destination) || applicationPacket(packet)) && LabCrypto.verify(packet))
        require(pending.size < 128 && seen.size < 2048)
        pending[packet.id] = Pending(packet, null); seen[packet.id] = packet.expiresAt
    }
    @Synchronized fun discard(ids: Collection<String>) {
        runCatching { commit(pending.filterKeys { it !in ids }); ids.forEach { attempted.remove(it) } }
            .onFailure { event("Could not update carry storage") }
    }
    @Synchronized fun restoreCarry(frames: List<ByteArray>) {
        require(frames.size <= 128 && frames.sumOf { it.size } <= 524288)
        val next = pending.toMutableMap()
        for (frame in frames) {
            val packet = PacketCodec.decode(frame)
            require(packet.version in 1..3 && LabCrypto.verify(packet))
            if (packet.expiresAt <= clock()) continue
            packet.validate(clock())
            require(if (packet.source == crypto.deviceId) (trusted(packet.destination) || applicationPacket(packet)) && packet.remainingHops == 6
                else if (packet.version == 3) packet.holders().indexOf(crypto.deviceId).let { it > 0 && packet.remainingHops == MAX_HOPS - it }
                else packet.carrier == crypto.deviceId && packet.remainingHops == 5)
            require(next.size < 128 && packet.id !in next)
            next[packet.id] = Pending(packet, null)
        }
        pending.clear(); pending.putAll(next)
        next.values.filter { it.packet.version > 0 }.forEach {
            seen[it.packet.id] = it.packet.expiresAt; event("CARRY ${it.packet.id.take(8)} restored")
        }
    }
    private fun commit(next: Map<String, Pending>) {
        require(next.size <= 128)
        val frames = next.values.filter { it.packet.version > 0 }.sortedBy { it.packet.id }.map { PacketCodec.encode(it.packet) }
        require(frames.sumOf { it.size } <= 524288)
        val before = pending.values.filter { it.packet.version > 0 }.sortedBy { it.packet.id }.map { PacketCodec.encode(it.packet) }
        if (before.size != frames.size || before.indices.any { !before[it].contentEquals(frames[it]) }) {
            checkNotNull(saveCarry) { "Carry storage unavailable" }(frames)
        }
        pending.clear(); pending.putAll(next)
    }

    private fun prune() {
        val now = clock()
        sentTargets.keys.retainAll(pending.keys)
        peerAttempts.entries.removeAll { now - it.value >= 15_000 }
        failedUntil.entries.removeAll { it.value <= now }
        val keep = pending.filterValues { it.packet.expiresAt > now }
        if (keep.size != pending.size) runCatching { commit(keep) }
            .onFailure { pending.entries.removeAll { it.value.packet.expiresAt <= now }; event("Carry expiry cleanup will retry on restart") }
        seen.entries.removeAll { it.value <= now }
        attempted.keys.retainAll(pending.keys)
        acceptedAttempts.keys.retainAll(pending.keys)
    }
    /** Select once, only after a verified live peer advertises v2; persist authorization before use. */
    private fun selectCarriers() {
        val peers = orderedLinks().filter { (failedUntil[it] ?: 0) <= clock() }.mapNotNull { carryPeer(it) }.distinct()
        for (item in pending.values.toList()) {
            val p = item.packet
            if (p.version == 3) {
                if (p.holders().last() != crypto.deviceId || p.grants.size >= 3 || (p.destination in peers && clock() - p.createdAt < 15_000)) continue
                val candidates = peers.filter { carryVersion(it) >= 3 && it !in p.holders() && it != p.destination }
                val hints = p.returnVia.drop(p.returnVia.indexOf(crypto.deviceId) + 1)
                val target = hints.firstOrNull { it in candidates } ?: candidates.firstOrNull() ?: continue
                runCatching {
                    val updated = crypto.delegate(p, target)
                    commit(pending + (p.id to item.copy(packet = updated)))
                    attempted.remove(p.id)
                    event("CARRY ${p.id.take(8)} next carrier committed depth=${updated.grants.size}")
                }.onFailure { event("Could not save next carrier; message remains queued") }
                continue
            }
            if (p.version != 2 || p.source != crypto.deviceId || p.carrier.isNotEmpty() || (p.destination in peers && clock() - p.createdAt < 15_000)) continue
            val carrier = peers.firstOrNull { it != crypto.deviceId && it != p.destination } ?: continue
            runCatching {
                val updated = crypto.authorizeCarrier(p, carrier)
                commit(pending + (p.id to item.copy(packet = updated)))
                attempted.remove(p.id)
                event("CARRY ${p.id.take(8)} automatic relay selected")
            }.onFailure { event("Could not save relay selection; message remains queued") }
        }
    }
    private fun canAttempt(peer: String, packet: Packet): Boolean {
        if (packet.version < 2) return true
        if ((failedUntil[peer] ?: 0) > clock()) return false
        val identity = carryPeer(peer) ?: return false
        if (packet.version == 3) {
            val index = packet.holders().indexOf(crypto.deviceId)
            if (index < 0 || carryVersion(identity) < 3 || (identity != packet.destination && packet.holders().getOrNull(index + 1) != identity)) return false
        } else if (identity != packet.destination && !(packet.source == crypto.deviceId && packet.carrier.isNotEmpty() && identity == packet.carrier)) return false
        val load = routeLoad(peer).coerceAtLeast(0)
        return if (pending[packet.id]?.urgent == true) load < 16384 else load == 0
    }
    private fun transmit(peer: String, packet: Packet) {
        if (!canAttempt(peer, packet)) return
        val target = carryPeer(peer)
        val attemptKey = packet.id + ":" + (target ?: peer)
        if (packet.version >= 2 && peerAttempts[attemptKey]?.let { clock() - it < 15_000 } == true) return
        attempted[packet.id] = clock()
        try {
            val writer = if (pending[packet.id]?.urgent == true) sendUrgentFrame ?: sendFrame else sendFrame
            writer(peer, PacketCodec.encode(packet))
            if (packet.version >= 2) acceptedAttempts[packet.id] = ((acceptedAttempts[packet.id] ?: 0) + 1).coerceAtMost(4)
            if (packet.version >= 2) peerAttempts[attemptKey] = clock()
            if (packet.version >= 2 && target != null) sentTargets.getOrPut(packet.id) { mutableSetOf() }.add(target)
            runCatching { observeRoute?.invoke(packet, peer, true) }
            if (packet.version > 0) event("CARRY ${packet.id.take(8)} write queued hops=${packet.remainingHops} peer=${target?.take(8) ?: "unknown"}")
        }
        catch (_: Exception) { if (packet.version >= 2) failedUntil[peer] = clock() + 30_000; event("Link write failed; packet remains queued until expiry") }
    }
}
