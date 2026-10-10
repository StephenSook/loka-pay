package org.loka.core

import org.junit.Assert.*
import org.junit.Test

class EncounterHistoryTest {
    @Test fun `trace redacts identities bounds samples and resets scope on clock reversal`() {
        val trace = EncounterTrace()
        trace.observe(setOf("a".repeat(64), "invalid"),100)
        trace.observe(setOf("a".repeat(64)),6100)
        assertEquals(listOf(1), trace.snapshot().samples.first().peers)
        assertEquals(6000L, trace.snapshot().samples.last().time)
        assertFalse(trace.snapshot().toString().contains("a".repeat(64)))
        repeat(600) { trace.observe(emptySet(), 6200L + it) }
        assertEquals(512, trace.snapshot().samples.size)
        assertEquals(90, trace.snapshot().dropped)
        val scope = trace.snapshot().scope
        trace.observe(emptySet(),1)
        assertNotEquals(scope, trace.snapshot().scope)
        assertEquals(0L,trace.snapshot().samples.single().time)
        trace.clear(); assertTrue(trace.snapshot().samples.isEmpty())
    }
    private val a = "a".repeat(64)
    private val b = "b".repeat(64)
    @Test fun `restore preserves decay age rejects invalid records atomically and requalifies sessions`() {
        val h = EncounterHistory(); h.observe(setOf(a),0); h.observe(setOf(a),6000)
        val restarted = EncounterHistory(); restarted.restore(h.saved(66000),66000)
        assertEquals(h.snapshot(66000), restarted.snapshot(66000))
        restarted.observe(setOf(a),66000); assertEquals(1,restarted.snapshot(66000).single().encounters)
        restarted.observe(setOf(a),72000); assertEquals(2,restarted.snapshot(72000).single().encounters)
        val previous = restarted.saved(72000)
        for (invalid in listOf(previous + previous, listOf(previous.single().copy(estimate = Double.NaN)), listOf(previous.single().copy(identity = "bad")))) {
            assertTrue(runCatching { restarted.restore(invalid,72000) }.isFailure)
            assertEquals(previous,restarted.saved(72000))
        }
        restarted.restore(previous,1); assertTrue(restarted.saved(1).isEmpty())
        restarted.restore(previous,86_472_000); assertTrue(restarted.saved(86_472_000).isEmpty())
    }
    @Test fun `meaningful session counts once and reconnect churn does not inflate history`() {
        val h = EncounterHistory()
        h.observe(setOf(a, "radio-handle"), 0)
        h.observe(setOf(a), 4_000); assertTrue(h.snapshot(4_000).isEmpty())
        h.observe(setOf(a), 6_000)
        assertEquals(1, h.snapshot(6_000).single().encounters)
        assertEquals(0.75, h.snapshot(6_000).single().estimate, 0.000001)
        h.observe(setOf(a), 8_000)
        h.observe(emptySet(), 9_000); h.observe(setOf(a), 10_000); h.observe(setOf(a), 16_000)
        assertEquals(1, h.snapshot(16_000).single().encounters)
        h.observe(emptySet(), 66_000); h.observe(setOf(a), 67_000); h.observe(setOf(a), 73_000)
        assertEquals(2, h.snapshot(73_000).single().encounters)
    }
    @Test fun `suspension capacity decay expiration and clock reversal remain bounded`() {
        val h = EncounterHistory(1)
        h.observe(setOf(a), 0); h.observe(setOf(a), 31_000); assertTrue(h.snapshot(31_000).isEmpty())
        h.observe(setOf(a), 37_000)
        assertEquals(0.75 * 0.98, h.snapshot(97_000).single().estimate, 0.000001)
        h.observe(setOf(b), 38_000); h.observe(setOf(b), 44_000)
        assertEquals(b, h.snapshot(44_000).single().identity)
        assertTrue(h.snapshot(86_444_000).isEmpty())
        h.observe(setOf(a), 1); assertTrue(h.snapshot(1).isEmpty())
        h.clear(); assertTrue(h.snapshot(1).isEmpty())
        assertTrue(EncounterHistory().snapshot(1).isEmpty())
    }
}
