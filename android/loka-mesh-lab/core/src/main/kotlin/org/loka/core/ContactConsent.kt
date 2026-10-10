package org.loka.core

import java.util.Base64
import java.util.UUID

/** Experimental consent content. Never pass radio handles here as authenticated identities. */
data class ContactConsent(val kind: String, val id: String, val expires: Long, val name: String = "") {
    fun encode(): String = "LC1|$kind|$id|$expires|${Base64.getEncoder().encodeToString(name.toByteArray(Charsets.UTF_8))}"
        .also { require(decode(it) == this) }

    companion object {
        const val LIFETIME = 300_000L
        fun decode(text: String): ContactConsent {
            require(text.toByteArray(Charsets.UTF_8).size <= 256)
            val p = text.split('|')
            require(p.size == 5 && p[0] == "LC1" && p[1] in listOf("R", "A", "K", "D"))
            require(UUID.fromString(p[2]).toString() == p[2])
            val expires = p[3].toLong()
            require(expires >= 0 && expires.toString() == p[3])
            val bytes = Base64.getDecoder().decode(p[4])
            require(bytes.size <= 128 && Base64.getEncoder().encodeToString(bytes) == p[4])
            val name = ChatContent.utf8(bytes)
            val scalars = name.codePoints().toArray()
            require(scalars.none { Character.getType(it) in listOf(Character.CONTROL.toInt(), Character.FORMAT.toInt(), Character.LINE_SEPARATOR.toInt(), Character.PARAGRAPH_SEPARATOR.toInt()) })
            fun edgeSpace(cp: Int) = cp in listOf(0x20, 0xa0, 0x1680, 0x202f, 0x205f, 0x3000) || cp in 0x2000..0x200a
            require(if (p[1] in listOf("R", "A")) scalars.isNotEmpty() && !edgeSpace(scalars.first()) && !edgeSpace(scalars.last()) else name.isEmpty())
            return ContactConsent(p[1], p[2], expires, name)
        }
    }
}

/** Pure experiment: no key import, network, notifications or persistence side effects.
 * Call only after the existing envelope's signature, destination and expiry are verified.
 * Production activation additionally requires atomic persistence, admission budgets and UI.
 */
class ContactConsentBook(private val own: String) {
    enum class Phase { OUTGOING, INCOMING, APPROVED, COMPLETE, DECLINED }
    data class Entry(val peer: String, val request: ContactConsent, val outgoing: Boolean,
        val phase: Phase, val peerName: String, val responseName: String = "")
    private val entries = linkedMapOf<String, Entry>()
    private val blocked = mutableSetOf<String>()
    init { checkIdentity(own) }
    private fun checkIdentity(value: String) { require(value.matches(Regex("[0-9a-f]{64}"))) }
    private fun prune(now: Long) { require(now >= 0); entries.entries.removeAll { it.value.request.expires <= now } }
    private fun valid(peer: String, content: ContactConsent, now: Long) {
        checkIdentity(peer); require(peer != own && peer !in blocked)
        ContactConsent.decode(content.encode())
        require(content.expires > now && content.expires - now <= ContactConsent.LIFETIME)
    }
    @Synchronized fun snapshot(now: Long): List<Entry> { prune(now); return entries.values.toList() }
    @Synchronized fun begin(peer: String, name: String, now: Long, id: String = UUID.randomUUID().toString()): ContactConsent {
        prune(now); require(now <= Long.MAX_VALUE - ContactConsent.LIFETIME)
        val request = ContactConsent("R", id, now + ContactConsent.LIFETIME, name)
        valid(peer, request, now)
        require(entries.size < 32 && id !in entries && entries.values.none { it.peer == peer })
        entries[id] = Entry(peer, request, true, Phase.OUTGOING, "")
        return request
    }
    /** Returns only a control reply. A received request never approves itself. */
    @Synchronized fun receive(peer: String, content: ContactConsent, now: Long): ContactConsent? {
        prune(now); valid(peer, content, now)
        val current = entries[content.id]
        if (current == null) {
            require(content.kind == "R" && entries.size < 32 && entries.values.count { !it.outgoing } < 16)
            require(entries.values.none { it.peer == peer })
            entries[content.id] = Entry(peer, content, false, Phase.INCOMING, content.name)
            return null
        }
        require(current.peer == peer && current.request.expires == content.expires)
        when (content.kind) {
            "R" -> {
                require(!current.outgoing && current.request == content)
                return when (current.phase) {
                    Phase.APPROVED, Phase.COMPLETE -> ContactConsent("A", content.id, content.expires, current.responseName)
                    Phase.DECLINED -> ContactConsent("D", content.id, content.expires)
                    else -> null
                }
            }
            "A" -> {
                require(current.outgoing && current.phase in listOf(Phase.OUTGOING, Phase.COMPLETE))
                require(current.phase != Phase.COMPLETE || current.peerName == content.name)
                entries[content.id] = current.copy(phase = Phase.COMPLETE, peerName = content.name)
                return ContactConsent("K", content.id, content.expires)
            }
            "K" -> {
                require(!current.outgoing && current.phase in listOf(Phase.APPROVED, Phase.COMPLETE))
                entries[content.id] = current.copy(phase = Phase.COMPLETE)
            }
            "D" -> {
                require(current.outgoing && current.phase in listOf(Phase.OUTGOING, Phase.DECLINED))
                entries[content.id] = current.copy(phase = Phase.DECLINED)
            }
        }
        return null
    }
    @Synchronized fun decide(id: String, accept: Boolean, name: String, now: Long): ContactConsent {
        prune(now)
        val current = entries.getValue(id)
        require(!current.outgoing && current.phase == Phase.INCOMING)
        val reply = ContactConsent(if (accept) "A" else "D", id, current.request.expires, if (accept) name else "")
        valid(current.peer, reply, now)
        entries[id] = current.copy(phase = if (accept) Phase.APPROVED else Phase.DECLINED, responseName = reply.name)
        return reply
    }
    data class Saved(val entries: List<Entry>, val blocked: Set<String>)
    @Synchronized fun saved(now: Long) = Saved(snapshot(now), blocked.toSet())
    @Synchronized fun restore(saved: Saved, now: Long) {
        require(saved.entries.size <= 32 && saved.blocked.size <= 128)
        saved.blocked.forEach { checkIdentity(it); require(it != own) }
        val live = saved.entries.filter { it.request.expires > now }
        require(live.map { it.peer }.distinct().size == live.size && live.map { it.request.id }.distinct().size == live.size)
        require(live.count { !it.outgoing } <= 16)
        live.forEach {
            checkIdentity(it.peer); require(it.peer != own && it.peer !in saved.blocked)
            ContactConsent.decode(it.request.encode()); require(it.request.kind == "R" && it.request.expires - now <= ContactConsent.LIFETIME)
            require(if (it.outgoing) it.phase in listOf(Phase.OUTGOING, Phase.COMPLETE, Phase.DECLINED) else it.phase in listOf(Phase.INCOMING, Phase.APPROVED, Phase.COMPLETE, Phase.DECLINED))
            if (it.peerName.isNotEmpty()) ContactConsent("R", it.request.id, it.request.expires, it.peerName).encode()
            if (!it.outgoing) require(it.peerName == it.request.name)
            if (!it.outgoing && it.phase in listOf(Phase.APPROVED, Phase.COMPLETE)) ContactConsent("A", it.request.id, it.request.expires, it.responseName).encode()
            if (it.outgoing && it.phase == Phase.COMPLETE) require(it.peerName.isNotEmpty())
        }
        entries.clear(); live.forEach { entries[it.request.id] = it }; blocked.clear(); blocked.addAll(saved.blocked)
    }
    @Synchronized fun replaceCrossedOutgoing(peer: String, incomingID: String, now: Long): Boolean {
        prune(now)
        val old = entries.values.firstOrNull { it.peer == peer && it.outgoing && it.phase == Phase.OUTGOING } ?: return false
        if (incomingID >= old.request.id) return false
        entries.remove(old.request.id); return true
    }
    @Synchronized fun block(peer: String) {
        checkIdentity(peer); require(peer != own && (peer in blocked || blocked.size < 128))
        blocked.add(peer); entries.entries.removeAll { it.value.peer == peer }
    }
}
