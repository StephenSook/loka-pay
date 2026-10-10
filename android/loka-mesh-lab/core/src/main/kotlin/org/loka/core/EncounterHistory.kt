package org.loka.core

import kotlin.math.pow

/** Shadow-only encounter history. Inputs are authenticated connected identities,
 * never advertisements, names or individual radio handles. No routing authority. */
class EncounterHistory(private val capacity: Int = 64) {
    data class Record(val identity: String, val encounters: Int, val lastEncounter: Long, val estimate: Double)
    private data class Session(val since: Long, var counted: Boolean = false)
    private val records = mutableMapOf<String, Record>()
    private val active = mutableMapOf<String, Session>()
    private var lastObservation: Long? = null
    init { require(capacity in 1..256) }
    @Synchronized fun clear() { records.clear(); active.clear(); lastObservation = null }
    @Synchronized fun saved(now: Long): List<Record> = records.values.filter { now >= it.lastEncounter && now - it.lastEncounter < 86_400_000 }.sortedBy { it.identity }
    @Synchronized fun restore(saved: List<Record>, now: Long) {
        require(now >= 0 && saved.size <= capacity && saved.map { it.identity }.toSet().size == saved.size)
        require(saved.all { it.identity.matches(Regex("[0-9a-f]{64}")) && it.encounters in 1..1_000_000 && it.lastEncounter >= 0 && it.estimate.isFinite() && it.estimate in 0.0..1.0 })
        val valid = saved.filter { now >= it.lastEncounter && now - it.lastEncounter < 86_400_000 }
        clear(); valid.forEach { records[it.identity] = it }; lastObservation = now
    }
    @Synchronized fun observe(identities: Set<String>, now: Long) {
        require(now >= 0)
        val last = lastObservation
        if (last != null && now < last) clear()
        else if (last != null && now - last > 30_000) active.clear() // Suspension is not observed contact time.
        lastObservation = now
        records.entries.removeAll { now - it.value.lastEncounter >= 86_400_000 }
        val peers = identities.filter { it.matches(Regex("[0-9a-f]{64}")) }.sorted().take(capacity).toSet()
        active.keys.retainAll(peers)
        for (id in peers) {
            val session = active.getOrPut(id) { Session(now) }
            val old = records[id]
            if (session.counted || now - session.since < 5_000) continue
            session.counted = true
            if (old != null && now - old.lastEncounter < 60_000) continue
            if (old == null && records.size >= capacity) {
                val victim = records.values.minWith(compareBy<Record> { it.lastEncounter }.thenBy { it.identity })
                records.remove(victim.identity)
            }
            val previous = old?.let { decay(it, now) } ?: 0.0
            records[id] = Record(id, minOf((old?.encounters ?: 0) + 1, 1_000_000), now, previous + (1 - previous) * 0.75)
        }
    }
    @Synchronized fun snapshot(now: Long): List<Record> = records.values
        .filter { now >= it.lastEncounter && now - it.lastEncounter < 86_400_000 }
        .map { it.copy(estimate = decay(it, now)) }.sortedBy { it.identity }
    private fun decay(record: Record, now: Long) = record.estimate * 0.98.pow((now - record.lastEncounter).coerceAtLeast(0) / 60_000.0)
}

/** Development diagnostics only. Aliases are scoped to one process, not stable device identifiers. */
class EncounterTrace {
    data class Sample(val time: Long, val peers: List<Int>)
    data class Snapshot(val version: Int = 1, val scope: String, val samples: List<Sample>, val dropped: Int)
    private var scope = java.util.UUID.randomUUID().toString()
    private var start: Long? = null
    private var last: Long? = null
    private val aliases = mutableMapOf<String, Int>()
    private val samples = mutableListOf<Sample>()
    private var dropped = 0
    @Synchronized fun clear() {
        scope = java.util.UUID.randomUUID().toString(); start = null; last = null
        aliases.clear(); samples.clear(); dropped = 0
    }
    @Synchronized fun observe(identities: Set<String>, now: Long) {
        require(now >= 0)
        if (last?.let { now < it } == true) clear()
        if (start == null) start = now
        last = now
        val peers = identities.filter { it.matches(Regex("[0-9a-f]{64}")) }.sorted().take(64)
        if (samples.size >= 512 || aliases.size + peers.count { it !in aliases } > 256) {
            dropped = minOf(dropped.toLong() + 1, Int.MAX_VALUE.toLong()).toInt(); return
        }
        val ids = peers.map { aliases.getOrPut(it) { aliases.size + 1 } }.sorted()
        samples.add(Sample(now - start!!, ids))
    }
    @Synchronized fun snapshot() = Snapshot(scope = scope, samples = samples.toList(), dropped = dropped)
}
