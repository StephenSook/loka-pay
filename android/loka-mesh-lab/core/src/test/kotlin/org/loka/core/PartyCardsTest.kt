package org.loka.core

import org.junit.Assert.*
import org.junit.Test
import java.util.UUID

class PartyCardsTest {
    private val ids=(0..4).map{('a'+it).toString().repeat(64)}
    private val hash="f".repeat(64)
    private val cards=(0..7).map{PartyCard("card_$it","never_have_i_ever","Prompt $it",if(it==7)"dirty" else "clean",setOf("group","friends","couples"),2,20,it==6)}
    private data class Delivery(val from:String,val to:String,val text:String)
    private class Rig(val ids:List<String>,val cards:List<PartyCard>,val hash:String) {
        var now=1_000_000L; val wire=ArrayDeque<Delivery>();val saved=mutableMapOf<String,String>()
        val engines=ids.associateWith{make(it)}.toMutableMap()
        fun make(id:String)=PartyCards(id,hash,cards,{now},{saved[id]=it},{peer,text->wire.addLast(Delivery(id,peer,text));UUID.randomUUID().toString()},{})
        fun pump(){var n=0;while(wire.isNotEmpty()){check(++n<200);val d=wire.removeFirst();engines.getValue(d.to).receive(d.from,d.text)}}
        fun ready(count:Int=3){engines.getValue(ids[0]).invite(ids.drop(1).take(count-1),PartySettings("never_have_i_ever",if(count==2)"friends" else "group"));pump();ids.drop(1).take(count-1).forEach{assertEquals("invited",engines.getValue(it).session!!.phase);engines.getValue(it).accept();pump()};assertTrue(engines.getValue(ids[0]).canAct)}
    }
    private fun rejects(block:()->Unit){try{block();fail("Expected rejection")}catch(_:IllegalArgumentException){}}
    @Test fun groupAcceptsAdvancesWithoutRepeatsAndRejectsWrongTurn() {
        val r=Rig(ids.take(3),cards,hash);r.ready()
        val seen=mutableSetOf<String>()
        repeat(6){rev->val player=r.engines.getValue(ids[rev%3]);assertTrue(player.canAct);assertTrue(seen.add(player.current!!.id));rejects{r.engines.getValue(ids[(rev+1)%3]).act("done")};player.act(if(rev==2)"shuffle" else "done");r.pump();r.engines.values.forEach{assertEquals(rev+1,it.session!!.revision);assertEquals(r.engines.getValue(ids[0]).current?.id,it.current?.id)}}
        assertEquals("complete",r.engines.getValue(ids[0]).session!!.phase)
        r.engines.getValue(ids[0]).end();r.pump();r.engines.values.forEach{assertEquals("ended",it.session!!.phase)}
    }
    @Test fun duplicateCommitLostAckAndRestartSnapshotDoNotAdvanceTwice() {
        val r=Rig(ids.take(2),cards,hash);r.ready(2)
        val host=r.engines.getValue(ids[0]);host.act("done")
        val update=r.wire.removeFirst();val guest=r.engines.getValue(ids[1]);guest.receive(update.from,update.text);r.wire.clear()
        guest.receive(update.from,update.text);assertEquals(1,guest.session!!.revision);assertFalse(host.canAct)
        r.now+=16_000;guest.receive(update.from,update.text);r.pump()
        guest.act("skip");val move=r.wire.removeFirst();host.receive(move.from,move.text);r.wire.clear()
        val restored=r.make(ids[1]);restored.restore(r.saved.getValue(ids[1]));r.engines[ids[1]]=restored
        assertFalse(restored.canAct);restored.resume();r.pump()
        assertEquals(2,restored.session!!.revision);assertEquals(host.session!!.moves,restored.session!!.moves)
        assertEquals(host.current!!.id,restored.current!!.id)
    }
    @Test fun largestFourPlayerRecoveryFitsExistingEncryptedPlaintextLimit() {
        val large=(0..39).map { cards.first().copy(id="card_"+it.toString().padStart(2,'0')) }
        val r=Rig(ids.take(4),large,hash);r.ready(4)
        repeat(24) { revision -> r.engines.getValue(ids[revision%4]).act("shuffle");r.pump() }
        val host=r.engines.getValue(ids[0]);assertEquals("complete",host.session!!.phase)
        host.resume()
        assertTrue(r.wire.all { it.text.toByteArray().size<=2048 })
        r.pump();assertTrue(host.canAct.not())
    }
    @Test fun oldInvitationCannotReopenAfterAnotherSessionOrRestart() {
        val r=Rig(ids.take(2),cards,hash);val host=r.engines.getValue(ids[0]);val guest=r.engines.getValue(ids[1])
        host.invite(listOf(ids[1]),PartySettings("never_have_i_ever","friends"))
        val capability=r.wire.removeFirst();guest.receive(capability.from,capability.text)
        val reply=r.wire.removeFirst();host.receive(reply.from,reply.text)
        val invitation=r.wire.first();r.pump();guest.accept();r.pump();host.end();r.pump()
        r.ready(2);host.end();r.pump()
        val restored=r.make(ids[1]);restored.restore(r.saved.getValue(ids[1]))
        rejects { restored.receive(invitation.from,invitation.text) }
        assertEquals("ended",restored.session!!.phase)
    }
    @Test fun snapshotCannotJoinAPlayerBeforeExplicitAcceptanceAndJoiningExpires() {
        val r=Rig(ids.take(2),cards,hash);val host=r.engines.getValue(ids[0]);val guest=r.engines.getValue(ids[1])
        host.invite(listOf(ids[1]),PartySettings("never_have_i_ever","friends"));r.pump()
        val savedBody=String(java.util.Base64.getDecoder().decode(host.export().lines()[1].split('|')[2])).split(';').toMutableList()
        savedBody[6]=ids.take(2).joinToString(",");savedBody[7]="active"
        val forced=PartyEvent("S",UUID.randomUUID().toString(),host.session!!.id,hash,r.now+120000,value=savedBody.joinToString(";"))
        rejects { guest.receive(ids[0],forced.encode()) };assertEquals("invited",guest.session!!.phase)
        guest.accept();r.wire.clear();r.now+=120001;guest.tick();assertEquals("ended",guest.session!!.phase)
    }
    @Test fun admissionFiltersAndQueueStorageBounds() {
        val r=Rig(ids.take(4),cards,hash)
        rejects{r.engines.getValue(ids[0]).invite(ids.drop(1),PartySettings("never_have_i_ever","friends"))}
        rejects{r.engines.getValue(ids[0]).invite(ids.drop(1)+ids[0],PartySettings("never_have_i_ever","group"))}
        r.ready(4);val host=r.engines.getValue(ids[0]);assertEquals(6,host.remaining().size)
        rejects{host.act("sip")}
        val stranger=PartyEvent("M",UUID.randomUUID().toString(),host.session!!.id,hash,r.now+120000,0,"done",UUID.randomUUID().toString())
        rejects{host.receive(ids[4],stranger.encode())}
        rejects{host.receive(ids[1],stranger.copy(expires=r.now).encode())}
        rejects{PartyEvent.decode(stranger.encode().replace("L1|G|2|","L1|G|9|"))}
        assertTrue(host.export().length<=16384)
        var failSave=true
        val engine=PartyCards(ids[0],hash,cards,{r.now},{if(failSave)error("disk full")},{_,_->error("must not send")},{})
        try{engine.invite(listOf(ids[1]),PartySettings("never_have_i_ever","friends"));fail()}catch(_:IllegalStateException){}
        assertNull(engine.session);failSave=false
    }
}
