package org.loka.core

import org.junit.Assert.*
import org.junit.Test
import java.util.UUID

class QuickQuizTest {
    private val host = "a".repeat(64); private val guest = "b".repeat(64); private val pack = "c".repeat(64)
    private val answers = listOf(0,1,3,2,1,2,3,0,2,0)
    private data class Frame(val sender: String, val to: String, val text: String)
    private inner class Lab {
        var now = 1_000_000L
        val frames = mutableListOf<Frame>()
        val saved = mutableMapOf<String,String>()
        val discarded = mutableListOf<String>()
        fun engine(id: String) = QuickQuiz(id, pack, answers, { now }, { saved[id] = it }, { peer, text -> frames += Frame(id, peer, text); UUID.randomUUID().toString() }, discarded::add)
        var a = engine(host); var b = engine(guest)
        fun drain() { var budget = 100; while (frames.isNotEmpty()) { check(budget-- > 0); val f = frames.removeAt(0); (if (f.to == host) a else b).receive(f.sender, f.text); a.tick(); b.tick() } }
        fun start() { a.invite(guest); drain(); assertEquals("invited", b.session!!.phase); b.accept(); drain(); assertTrue(a.canAnswer) }
    }
    @Test fun invitationMembershipAndTenDeterministicAnswers() {
        val lab = Lab(); lab.start()
        repeat(10) { i -> (if (i % 2 == 0) lab.a else lab.b).answer(answers[i]); lab.drain(); assertEquals(i + 1, lab.a.session!!.revision); assertEquals(lab.a.session!!.moves, lab.b.session!!.moves) }
        assertEquals(listOf(5,5), lab.b.session!!.scores(answers)); assertFalse(lab.a.canAnswer); assertFalse(lab.b.canAnswer)
    }
    @Test fun duplicateCommitAndLostAcknowledgmentNeverAdvanceTwice() {
        val lab = Lab(); lab.start(); lab.a.answer(0)
        val commit = lab.frames.removeAt(0); lab.b.receive(host, commit.text); lab.frames.clear() // Lose ACK.
        lab.now += 16000; lab.b.receive(host, commit.text); lab.drain()
        assertEquals(1, lab.a.session!!.revision); assertEquals(1, lab.b.session!!.revision)
        assertTrue(lab.b.canAnswer)
    }
    @Test fun restartAfterAppliedMoveAndLostCommitRecoversFromSnapshot() {
        val lab = Lab(); lab.start(); lab.a.answer(0); lab.drain(); lab.b.answer(1)
        val move = lab.frames.removeAt(0); lab.a.receive(guest, move.text); lab.frames.clear() // Lose authoritative commit.
        lab.b = lab.engine(guest).also { it.restore(lab.saved.getValue(guest)) }
        assertFalse(lab.b.canAnswer); lab.b.resume(); lab.drain()
        assertEquals(2, lab.b.session!!.revision); assertEquals(lab.a.session!!.moves, lab.b.session!!.moves)
        assertEquals(listOf(1,1), lab.b.session!!.scores(answers))
    }
    @Test fun reorderRequestsRecoveryAndConflictingPrefixIsRejected() {
        val lab = Lab(); lab.start()
        val gap = GameEvent("U", UUID.randomUUID().toString(), lab.a.session!!.id, pack, lab.now + 120000, 2, "1", UUID.randomUUID().toString())
        lab.b.receive(host, gap.encode()); assertTrue(lab.b.paused); lab.drain(); assertEquals(0, lab.b.session!!.revision)
        lab.a.answer(0); lab.drain()
        val conflict = gap.copy(kind = "S", revision = 1, value = "active;3:${UUID.randomUUID()}", ref = "-")
        assertThrows(IllegalArgumentException::class.java) { lab.b.receive(host, conflict.encode()) }
        assertEquals(1, lab.b.session!!.revision)
    }
    @Test fun rejectsUnauthorizedWrongTurnExpiredUnsupportedAndChatReceiptForgery() {
        val lab = Lab(); lab.start()
        assertThrows(IllegalArgumentException::class.java) { lab.b.answer(2) }
        val e = GameEvent("M", UUID.randomUUID().toString(), lab.a.session!!.id, pack, lab.now + 120000, 0, "0", UUID.randomUUID().toString())
        assertThrows(IllegalArgumentException::class.java) { lab.a.receive("d".repeat(64), e.encode()) }
        assertThrows(IllegalArgumentException::class.java) { lab.a.receive(guest, e.encode()) }
        assertThrows(IllegalArgumentException::class.java) { lab.a.receive(guest, e.copy(expires = lab.now).encode()) }
        assertThrows(IllegalArgumentException::class.java) { GameEvent.decode(e.encode().replace("L1|G|1|", "L1|G|2|")) }
        assertThrows(IllegalArgumentException::class.java) { ChatContent.decode(e.encode()) }
        assertThrows(IllegalArgumentException::class.java) { lab.a.receive(guest, e.copy(pack = "d".repeat(64)).encode()) }
    }
    @Test fun boundsRetriesInvitationAndStorageAndRollsBackFailedSave() {
        val lab = Lab(); lab.a.invite(guest); lab.frames.clear(); lab.now += 120001; lab.a.tick()
        assertEquals(0, lab.a.pendingCount); assertEquals("ended", lab.a.session!!.phase)
        assertThrows(IllegalArgumentException::class.java) { lab.a.restore("x".repeat(16385)) }
        val failed = QuickQuiz(host,pack,answers,{lab.now},{ error("Disk full") },{_,_->error("Must not send")},{})
        assertThrows(IllegalStateException::class.java) { failed.invite(guest) }; assertNull(failed.session)
        lab.a.invite(guest); lab.drain(); lab.b.accept(); lab.drain()
        repeat(8) { lab.b.resume() }
        assertThrows(IllegalArgumentException::class.java) { lab.b.resume() }; assertEquals(8, lab.b.pendingCount)
    }
    @Test fun refusesAcknowledgmentOfUnappliedGuestMove() {
        val lab = Lab(); lab.start(); lab.a.answer(0); lab.drain(); lab.b.answer(1)
        val move = GameEvent.decode(lab.frames.last().text)
        val forged = move.copy(kind="A",id=UUID.randomUUID().toString(),ref=move.id,value="-")
        assertThrows(IllegalArgumentException::class.java) { lab.b.receive(host,forged.encode()) }
        assertEquals(1,lab.b.pendingCount); assertEquals(1,lab.b.session!!.revision)
    }
    @Test fun answerSurvivesExpiredMoveAndRestartsWithSameActionId() {
        val lab = Lab(); lab.start(); lab.a.answer(0); lab.drain(); lab.b.answer(1)
        val original = GameEvent.decode(lab.frames.removeAt(0).text)
        lab.frames.clear(); lab.now += 120001; lab.b.tick()
        lab.b = lab.engine(guest).also { it.restore(lab.saved.getValue(guest)) }
        lab.b.resume(); lab.drain()
        assertEquals(2,lab.a.session!!.revision)
        assertEquals(original.ref,lab.a.session!!.moves[1].id)
        assertEquals(lab.a.session!!.moves,lab.b.session!!.moves)
    }

}
