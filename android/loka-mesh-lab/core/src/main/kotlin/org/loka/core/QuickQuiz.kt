package org.loka.core

import java.util.UUID

/** Radio-independent application events, inside existing authenticated encrypted packets. */
data class GameEvent(val kind: String, val id: String, val session: String, val pack: String,
    val expires: Long, val revision: Int = 0, val value: String = "-", val ref: String = "-") {
    fun encode() = "L1|G|1|$kind|$id|$session|$pack|$expires|$revision|$value|$ref".also { decode(it) }
    companion object {
        fun uuid(s: String) { require(UUID.fromString(s).toString() == s) }
        fun identity(s: String) { require(s.matches(Regex("[0-9a-f]{64}"))) }
        fun decode(text: String): GameEvent {
            require(text.length <= 1024 && text.all { it.code in 32..126 })
            val p = text.split('|'); require(p.size == 11 && p.take(3) == listOf("L1", "G", "1"))
            require(p[3] in listOf("C", "K", "I", "J", "S", "M", "U", "A", "R", "E"))
            uuid(p[4]); uuid(p[5]); identity(p[6]); if (p[10] != "-") uuid(p[10])
            val at = p[7].toLong(); val rev = p[8].toInt()
            require(at >= 0 && at.toString() == p[7] && rev in 0..10 && rev.toString() == p[8] && p[9].length <= 450)
            return GameEvent(p[3], p[4], p[5], p[6], at, rev, p[9], p[10])
        }
    }
}

data class QuizMove(val choice: Int, val id: String)
data class QuizSession(val id: String, val host: String, val guest: String, val expires: Long,
    val phase: String, val moves: List<QuizMove> = emptyList()) {
    val gameId get() = "quick_quiz"
    val gameVersion get() = 1
    val rulesVersion get() = 1
    val revision get() = moves.size
    val turn get() = if (revision % 2 == 0) host else guest
    fun scores(answers: List<Int>) = listOf(0, 1).map { player -> moves.withIndex().count { it.index % 2 == player && it.value.choice == answers[it.index] } }
}

/** Caller serializes operations. Persist before network effects; failed persistence rolls back state. */
class QuickQuiz(
    val own: String, val pack: String, private val answers: List<Int>,
    private val clock: () -> Long,
    private val save: (String) -> Unit,
    private val send: (String, String) -> String,
    private val discard: (String) -> Unit,
) {
    companion object { fun canQueue(queuedPackets: Int) = queuedPackets in 0 until 96 }
    data class Pending(val peer: String, val event: GameEvent, var packet: String = "-")
    var session: QuizSession? = null; private set
    private var outbox = linkedMapOf<String, Pending>()
    private var recent = linkedMapOf<String, Long>()
    private val ackAt = mutableMapOf<String, Long>()
    private var draft: Pair<Int, QuizMove>? = null
    private var lastPeer = 0L
    private var recovering = false
    var notice = "Choose a friend to play"; private set
    val pendingCount get() = outbox.size
    val paused get() = recovering || clock() - lastPeer > 90_000
    val canAnswer get() = session?.let { it.phase == "active" && it.revision < answers.size && it.turn == own && !paused && draft == null && outbox.values.none { p -> p.event.kind in listOf("M", "U", "S", "J") } } == true
    init { GameEvent.identity(own); GameEvent.identity(pack); require(answers.size == 10 && answers.all { it in 0..3 }) }
    private fun event(kind: String, value: String = "-", ref: String = "-", revision: Int = session?.revision ?: 0) =
        GameEvent(kind, UUID.randomUUID().toString(), checkNotNull(session).id, pack, clock() + 120_000, revision, value, ref)
    private fun peer() = checkNotNull(session).let { if (it.host == own) it.guest else it.host }
    private fun enqueue(e: GameEvent) { require(outbox.size < 8); outbox[e.id] = Pending(peer(), e) }
    private fun remove(id: String): String? = outbox.remove(id)?.packet?.takeIf { it != "-" }
    private fun body(s: QuizSession) = s.phase + ";" + if (s.moves.isEmpty()) "-" else s.moves.joinToString(",") { "${it.choice}:${it.id}" }
    private fun moves(raw: String): List<QuizMove> = if (raw == "-") emptyList() else raw.split(',').map { item ->
        val p = item.split(':'); require(p.size == 2); GameEvent.uuid(p[1]); val c = p[0].toInt(); require(c in 0..3 && c.toString() == p[0]); QuizMove(c, p[1])
    }.also { require(it.size <= 10 && it.map { m -> m.id }.toSet().size == it.size) }
    private fun snapshot() { enqueue(event("S", body(checkNotNull(session)))) }
    private fun transaction(block: () -> Unit) {
        val before = export(); val beforeRecent = recent.toMap(); val previousNotice = notice; val previousLast = lastPeer; val previousRecovery = recovering
        try { block(); save(export()) } catch (e: Exception) { restore(before); recent = LinkedHashMap(beforeRecent); lastPeer = previousLast; recovering = previousRecovery; notice = previousNotice; throw e }
    }
    fun invite(friend: String) {
        GameEvent.identity(friend); require(friend != own && (session == null || session!!.phase == "ended" || session!!.expires <= clock()))
        val stale = outbox.values.map { it.packet }
        transaction {
            outbox.clear(); draft = null; session = QuizSession(UUID.randomUUID().toString(), own, friend, clock() + 86_400_000, "inviting")
            recovering = false; lastPeer = clock(); enqueue(event("C")); notice = "Inviting…"
        }
        stale.filter { it != "-" }.forEach(discard); flush()
    }
    fun accept() {
        require(session?.phase == "invited" && session?.guest == own && session!!.expires > clock())
        transaction { session = session!!.copy(phase = "joining", expires = clock() + 86_400_000); enqueue(event("J")); notice = "Waiting for your friend" }
        flush()
    }
    fun answer(choice: Int) {
        require(canAnswer && choice in 0..3)
        transaction {
            val s = session!!; val action = UUID.randomUUID().toString()
            if (s.host == own) {
                session = s.copy(moves = s.moves + QuizMove(choice, action))
                enqueue(event("U", choice.toString(), action)); notice = "Waiting for your friend"
            } else { draft = s.revision to QuizMove(choice, action); enqueue(event("M", choice.toString(), action)); notice = "Waiting for confirmation" }
        }; flush()
    }
    fun resume() {
        val s = checkNotNull(session); require(s.phase in listOf("active", "joining") && s.expires > clock())
        transaction { recovering = true; if (s.host == own) snapshot() else enqueue(event("R")); notice = "Reconnecting…" }; flush()
    }
    fun end() {
        require(session != null)
        val stale = outbox.values.map { it.packet }
        transaction { outbox.clear(); draft = null; session = session!!.copy(phase = "ended"); enqueue(event("E")); notice = "Game ended" }
        stale.filter { it != "-" }.forEach(discard); flush()
    }
    fun receive(sender: String, text: String) {
        GameEvent.identity(sender); require(sender != own)
        val e = GameEvent.decode(text); val now = clock()
        require(e.pack == pack && e.expires > now && e.expires <= now + 150_000)
        if (e.kind == "C") {
            require(e.revision == 0 && e.value == "-" && e.ref == "-")
            // No session membership is created by a capability request.
            respond(sender, e, "K"); return
        }
        val old = session
        if (e.kind == "I" && old?.id != e.session) {
            require(e.revision == 0 && e.value == "-" && e.ref == "-")
            require(old == null || old.phase == "ended" || old.expires <= now)
            require(e.id !in recent.filterValues { it > now } && recent.count { it.value > now } < 64)
            val stale = outbox.values.map { it.packet }
            transaction {
                outbox.clear(); draft = null; recent.entries.removeAll { it.value <= now }
                session = QuizSession(e.session, sender, own, e.expires, "invited")
                recent[e.id] = e.expires; lastPeer = now; notice = "Game invitation"
            }
            stale.filter { it != "-" }.forEach(discard); acknowledge(sender, e); return
        }
        val s = checkNotNull(session)
        require(e.session == s.id && sender == peer() && s.expires > now)
        if (e.kind in listOf("I", "J", "K")) require(e.revision == 0 && e.value == "-")
        if (e.kind in listOf("I", "J", "R", "E", "S")) require(e.ref == "-")
        if (e.kind in listOf("A", "R", "E")) require(e.value == "-")
        if (e.kind == "A") require(e.ref != "-")

        val discarded = mutableListOf<String>()
        var ack = e.kind != "A" && e.kind != "K"
        transaction {
            lastPeer = now
            when (e.kind) {
                "K" -> {
                    require(s.host == own && s.phase == "inviting" && e.value == "-")
                    val request = outbox[e.ref]; require(request?.event?.kind == "C")
                    remove(e.ref)?.let(discarded::add); enqueue(event("I")); session = s.copy(phase = "waiting", expires = now + 120_000); notice = "Waiting for your friend"
                }
                "I" -> { require(s.host == sender && s.phase in listOf("invited", "joining", "active", "ended")) }
                "J" -> {
                    require(s.host == own && s.phase in listOf("waiting", "active") && e.value == "-")
                    if (s.phase == "waiting") { session = s.copy(phase = "active", expires = now + 86_400_000); snapshot() }
                }
                "A" -> {
                    val p = outbox[e.ref]
                    if (p != null) { require(p.event.kind !in listOf("M", "C") && e.revision >= p.event.revision); remove(e.ref)?.let(discarded::add); if (p.event.kind == "S") {
                        recovering = false
                        outbox.values.filter { it.event.kind == "I" || it.event.kind == "U" && it.event.revision <= e.revision }.map { it.event.id }.forEach { remove(it)?.let(discarded::add) }
                    } }
                }
                "M" -> {
                    require(s.host == own && s.phase == "active" && e.ref != "-")
                    val choice = e.value.toInt(); require(choice in 0..3 && choice.toString() == e.value)
                    val existing = s.moves.indexOfFirst { it.id == e.ref }
                    if (existing >= 0) { require(existing % 2 == 1 && existing == e.revision && s.moves[existing].choice == choice); if (outbox.values.none { it.event.kind == "S" }) snapshot() }
                    else {
                        require(e.revision == s.revision && s.turn == sender && s.revision < 10 && outbox.values.none { it.event.kind in listOf("S", "U") })
                        session = s.copy(moves = s.moves + QuizMove(choice, e.ref)); enqueue(event("U", choice.toString(), e.ref))
                    }
                    // A move is confirmed by an authoritative commit/snapshot, never by A alone.
                    ack = false
                }
                "U" -> {
                    require(sender == s.host && s.phase == "active" && e.ref != "-")
                    val choice = e.value.toInt(); require(choice in 0..3 && choice.toString() == e.value && e.revision > 0)
                    if (e.revision <= s.revision) require(s.moves[e.revision - 1] == QuizMove(choice, e.ref))
                    else if (e.revision != s.revision + 1) { if (outbox.values.none { it.event.kind == "R" }) enqueue(event("R")); recovering = true; ack = false }
                    else {
                        require(s.moves.none { it.id == e.ref })
                        if (s.turn == own) require(draft == (s.revision to QuizMove(choice, e.ref)))
                        session = s.copy(moves = s.moves + QuizMove(choice, e.ref)); if (draft?.second?.id == e.ref) draft = null
                        outbox.values.filter { it.event.kind == "M" && it.event.ref == e.ref }.map { it.event.id }.forEach { remove(it)?.let(discarded::add) }
                        recovering = false
                    }
                }
                "S" -> {
                    require(sender == s.host && s.phase in listOf("joining", "active", "ended"))
                    val fields = e.value.split(';'); require(fields.size == 2 && fields[0] in listOf("active", "ended"))
                    val log = moves(fields[1]); require(log.size == e.revision)
                    if (log.size < s.revision) { require(s.moves.take(log.size) == log) }
                    else {
                        require(log.take(s.revision) == s.moves && !(s.phase == "ended" && fields[0] != "ended"))
                        draft?.let { (rev, move) -> if (log.size > rev) require(log[rev] == move) }
                        session = s.copy(phase = fields[0], moves = log, expires = if (s.phase == "joining") now + 86_400_000 else s.expires)
                        outbox.values.filter { it.event.kind in listOf("J", "R") || it.event.kind == "M" && log.any { m -> m.id == it.event.ref } }.map { it.event.id }.forEach { remove(it)?.let(discarded::add) }
                        draft?.let { (rev, move) ->
                            if (log.size > rev || fields[0] == "ended") draft = null
                            else if (outbox.values.none { it.event.kind == "M" }) enqueue(event("M", move.choice.toString(), move.id, rev))
                        }
                        recovering = false
                    }
                }
                "R" -> { require(s.host == own && s.phase in listOf("active", "ended") && e.value == "-"); if (outbox.values.none { it.event.kind == "S" }) snapshot() }
                "E" -> {
                    require(e.value == "-"); session = s.copy(phase = "ended"); draft = null
                    outbox.keys.toList().forEach { remove(it)?.let(discarded::add) }; recovering = false
                }
                else -> error("Unsupported event")
            }
            if (ack) { recent.entries.removeAll { it.value <= now }; require(e.id in recent || recent.size < 64); recent[e.id] = e.expires }
            notice = if (session!!.phase == "ended") "Game ended" else if (session!!.revision == 10) "Quiz complete" else if (recovering) "Reconnecting…" else if (session!!.phase == "active" && session!!.turn == own) "Your turn" else "Waiting for your friend"
        }
        discarded.forEach(discard); if (ack) acknowledge(sender, e); flush()
    }
    private fun respond(sender: String, e: GameEvent, kind: String) {
        val key = "$sender:${e.id}"
        if (ackAt[key]?.let { clock() - it < 15_000 } == true) return
        if (ackAt.size >= 64) ackAt.clear()
        val response = GameEvent(kind, UUID.randomUUID().toString(), e.session, pack, clock() + 120_000, session?.takeIf { it.id == e.session }?.revision ?: 0, ref = e.id)
        runCatching { val packet = send(sender, response.encode()); discard(packet); ackAt[key] = clock() }
    }
    private fun acknowledge(sender: String, e: GameEvent) = respond(sender, e, "A")
    fun tick() {
        val expired = outbox.values.filter { it.event.expires <= clock() }
        if (expired.isNotEmpty() || session?.let { it.expires <= clock() && it.phase != "ended" } == true) {
            transaction {
                expired.forEach { outbox.remove(it.event.id) }; recovering = true; notice = "Reconnecting…"
                if (session!!.expires <= clock() || session!!.phase in listOf("inviting", "waiting", "invited")) { session = session!!.copy(phase = "ended"); notice = "Game or invitation expired" }
            }; expired.map { it.packet }.filter { it != "-" }.forEach(discard)
        }; flush()
    }
    private fun flush() {
        // The existing mesh owns retries. At most one new game envelope per application tick.
        val item = outbox.values.firstOrNull { it.packet == "-" && it.event.expires > clock() } ?: return
        runCatching {
            val packet = send(item.peer, item.event.encode()); item.packet = packet
            try { save(export()) } catch (e: Exception) { item.packet = "-"; discard(packet); throw e }
        }.onFailure { notice = "Waiting for a local connection" }
    }
    fun export(): String {
        val s = session
        val header = if (s == null) "Q1|$pack\n-" else "Q1|$pack\n${s.id}|${s.host}|${s.guest}|${s.expires}|${body(s)}"
        return (listOf(header) + listOfNotNull(draft?.let { "V|${it.first}|${it.second.choice}|${it.second.id}" }) + outbox.values.map { "P|${it.peer}|${it.packet}|${it.event.encode()}" } + recent.map { "D|${it.key}|${it.value}" }).joinToString("\n").also { require(it.length <= 16384) }
    }
    fun restore(raw: String) {
        require(raw.length <= 16384)
        val lines = raw.split('\n'); require(lines.size in 2..75 && lines[0] == "Q1|$pack")
        val next = if (lines[1] == "-") null else {
            val p = lines[1].split('|'); require(p.size == 5); GameEvent.uuid(p[0]); GameEvent.identity(p[1]); GameEvent.identity(p[2]); require(own in p.take(3) && p[1] != p[2])
            val b = p[4].split(';'); require(b.size == 2 && b[0] in listOf("inviting", "waiting", "invited", "joining", "active", "ended"))
            QuizSession(p[0], p[1], p[2], p[3].toLong(), b[0], moves(b[1]))
        }
        val pending = linkedMapOf<String, Pending>(); val seen = linkedMapOf<String, Long>(); var nextDraft: Pair<Int, QuizMove>? = null
        for (line in lines.drop(2)) {
            if (line.startsWith("V|")) {
                val p = line.split('|'); require(p.size == 4 && nextDraft == null)
                val rev = p[1].toInt(); val choice = p[2].toInt(); GameEvent.uuid(p[3])
                require(rev in 0..9 && choice in 0..3 && next?.guest == own && rev == next.revision && rev % 2 == 1)
                nextDraft = rev to QuizMove(choice, p[3])
            } else if (line.startsWith("P|")) {
                val p = line.split('|', limit = 4); require(p.size == 4); GameEvent.identity(p[1]); if (p[2] != "-") GameEvent.uuid(p[2])
                val e = GameEvent.decode(p[3]); require(e.pack == pack && e.session == next?.id && p[1] == if (next.host == own) next.guest else next.host)
                require(pending.put(e.id, Pending(p[1], e, p[2])) == null)
            } else { val p = line.split('|'); require(p.size == 3 && p[0] == "D"); GameEvent.uuid(p[1]); require(seen.put(p[1], p[2].toLong()) == null) }
        }
        require(pending.size <= 8 && seen.size <= 64)
        session = next; draft = nextDraft; outbox = pending; recent = seen; recovering = next?.phase in listOf("joining", "active"); lastPeer = 0; notice = if (next == null) "Choose a friend to play" else "Reconnecting…"
    }
}
