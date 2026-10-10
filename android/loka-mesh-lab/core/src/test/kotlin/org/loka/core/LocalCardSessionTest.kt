package org.loka.core
import org.junit.Assert.*
import org.junit.Test

class LocalCardSessionTest {
    private fun cards()=(0 until 60).map{PartyCard("c$it","x","Question $it","clean",setOf("group","friends"),2,20,false,packs=setOf("family"),stage=it%3,namedText="{player}, ask {partner}: Question $it")}
    private fun start(count:Int=20,round:Int=1)=LocalCardSession(cards()).apply{configure(setOf("clean"),false,false,CardAudience(count,if(count==2)"friends" else "group"),List(count){"Person $it"},"family",round,true,false)}
    @Test fun twentyPlayerRoundGivesEveryPersonOneTurnAndNeverRevealsEarly(){
        val s=start();val turns=mutableListOf<Int>();val prompts=mutableSetOf<String>()
        repeat(20){assertFalse(s.revealed);val before=s.frame();s.advance(false,false);assertEquals(before,s.frame());turns+=s.turn;s.reveal();assertTrue(prompts.add(s.deck.current!!.id));s.advance(false,false)}
        assertTrue(s.finished);assertEquals((0 until 20).toList(),turns);assertEquals(20,s.completed)
        val last=s.previous!!.deck.current;s.undo(false,false);assertFalse(s.finished);assertEquals(19,s.turn);assertEquals(last,s.deck.current!!.id);assertTrue(s.revealed)
        s.advance(false,false);assertTrue(s.finished);s.newRound(false,false);assertEquals(0,s.completed);assertFalse(s.revealed);assertFalse(prompts.contains(s.deck.current!!.id))
    }
    @Test fun snapshotRestoresExactCardNextCardAndUndo(){val s=start(4,0);s.reveal();val first=s.deck.current!!.id;s.advance(false,false);s.reveal();s.pause();val state=s.frame();val history=s.previous;val next=s.deck.peek(false,false)!!.id
        val restored=LocalCardSession(cards());restored.restore(state,false,false,history);assertEquals(state,restored.frame());assertEquals(next,restored.deck.peek(false,false)!!.id);restored.resume();restored.undo(false,false);assertEquals(first,restored.deck.current!!.id);assertEquals(0,restored.turn)
    }
    @Test fun namedPartnersRotateAndStageProgresses(){val s=start(4,2);val phases=mutableSetOf<Int>();val partners=mutableSetOf<String>();repeat(8){s.reveal();phases+=s.phase;val text=s.display(s.deck.current!!).text;assertTrue(text.startsWith("Person ${s.turn}, ask Person "));if(s.turn==0)partners+=text.substringAfter("ask ").substringBefore(":");assertEquals(s.phase,s.deck.current!!.stage);s.advance(false,false)};assertEquals(setOf(0,1,2),phases);assertEquals(2,partners.size);s.newRound(false,false);s.reveal();assertTrue(s.display(s.deck.current!!).text.contains("ask Person 3:"))}
    @Test fun cancelledOrCorruptSnapshotsCannotExposeRestrictedContent(){val s=start(4);val safe=s.frame();val restricted=cards()+PartyCard("dirty","x","Adult","dirty",setOf("group"),3,20,false,setOf("dirty"),true)
        val restored=LocalCardSession(restricted);val bad=safe.copy(deck=safe.deck.copy(filters=setOf("dirty"),current="dirty",shown=setOf("dirty")))
        assertThrows(IllegalArgumentException::class.java){restored.restore(bad,false,false)};assertTrue(restored.names.isEmpty())
        assertThrows(IllegalArgumentException::class.java){s.restore(safe.copy(names=listOf("Same","Same")),false,false)};assertEquals(safe,s.frame())
    }
    @Test fun bulkNamesPreserveSpacesAndRejectDuplicateNames(){assertEquals(listOf("Alex","Blair Smith","Casey"),LocalCardSession.parseNames("Alex, Blair Smith\nCasey"));assertFalse(LocalCardSession.validNames(listOf(" Alex ","alex"),2));assertFalse(LocalCardSession.validNames(listOf("A".repeat(41),"B"),2))}
    @Test fun oldCatalogIsRecognizedWithoutRelaxingMalformedArchiveChecks(){val current="a".repeat(64);val old="PC2|${"b".repeat(64)}\n-\n-\n-";assertTrue(stalePartyCatalog(old,current));assertFalse(stalePartyCatalog(old,"b".repeat(64)));assertFalse(stalePartyCatalog("PC2|invalid\n-\n-\n-",current));assertFalse(stalePartyCatalog(old+"x".repeat(16384),current))}

    @Test fun exhaustedColdResumeAvoidsRepeatingLastCardAtShuffle(){val cards=cards().take(2);val s=LocalCardSession(cards);s.configure(setOf("clean"),false,false,CardAudience(2,"friends"),listOf("Alex","Blair"),"family",0,true,false);var last="";repeat(2){s.reveal();last=s.deck.current!!.id;s.advance(false,false)};assertTrue(s.finished);val restored=LocalCardSession(cards);restored.restore(s.frame(),false,false);restored.newRound(false,false);assertNotEquals(last,restored.deck.current!!.id)}

}
