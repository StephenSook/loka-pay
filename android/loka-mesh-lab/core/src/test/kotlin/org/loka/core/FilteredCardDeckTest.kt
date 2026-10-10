package org.loka.core
import org.junit.Test
import org.junit.Assert.*
import java.time.LocalDate
class FilteredCardDeckTest {
    private val cards=listOf(
        PartyCard("a","x","Clean", "clean",setOf("group"),2,20,false),
        PartyCard("b","x","Clean 2", "clean",setOf("group"),2,20,false),
        PartyCard("c","x","Dirty", "dirty",setOf("group"),2,20,false,setOf("dirty"),true),
        PartyCard("d","x","Drink", "clean",setOf("group"),2,20,false,setOf("drinking"),false,true),
        PartyCard("e","x","Both", "dirty",setOf("group"),2,20,false,setOf("dirty","drinking"),true,true))
    @Test fun allCombinationsRequireBothRestrictionFlags(){val d=FilteredCardDeck(cards,"seed");assertEquals(setOf("a","b"),d.eligible(setOf("clean"),true,true).map{it.id}.toSet());assertEquals(setOf("c"),d.eligible(setOf("dirty"),true,true).map{it.id}.toSet());assertEquals(setOf("d"),d.eligible(setOf("drinking"),true,true).map{it.id}.toSet());assertEquals(5,d.eligible(setOf("clean","dirty","drinking"),true,true).size);assertEquals(2,d.eligible(setOf("clean","dirty","drinking"),false,false).size)}
    @Test fun invalidDraftDoesNotChangeCardAndFiltersKeepShownIds(){val d=FilteredCardDeck(cards,"seed");d.apply(setOf("clean"),false,false);val first=d.current!!.id;try{d.apply(setOf("dirty"),false,false);fail()}catch(_:IllegalArgumentException){};assertEquals(first,d.current!!.id);assertEquals(setOf("clean"),d.filters);d.apply(setOf("clean","dirty"),true,false);assertNotEquals(first,d.current!!.id);val seen=mutableSetOf(first,d.current!!.id);while(true){d.draw(true,false);val c=d.current ?: break;assertTrue(seen.add(c.id))};assertEquals(3,seen.size);assertNull(d.current);d.shuffleAgain(true,false);assertNotNull(d.current)}
    @Test fun platformsShareGoldenShuffleOrder(){val d=FilteredCardDeck(cards,"seed");d.apply(setOf("clean","drinking","dirty"),true,true);val order=mutableListOf<String>();while(d.current!=null){order.add(d.current!!.id);d.draw(true,true)};assertEquals(listOf("b","e","c","d","a"),order)}
    @Test fun ageBoundaryNeedsExactBirthdayAndRejectsInvalidDates(){val today=LocalDate.of(2026,10,6);assertNull(CardAge.eligible(2005,21,today));assertTrue(CardAge.eligible(2005,21,today,10,6)!!);assertFalse(CardAge.eligible(2005,21,today,10,7)!!);assertNull(CardAge.eligible(2005,21,today,2,30));assertFalse(CardAge.eligible(2008,21,today)!!);assertTrue(CardAge.eligible(2000,21,today)!!)}
    @Test fun peekIsReadOnlyAndMatchesTheNextDraw(){val d=FilteredCardDeck(cards,"seed");d.apply(setOf("clean"),false,false);val current=d.current;val shown=d.shown;val upcoming=d.peek(false,false);repeat(5){assertEquals(upcoming,d.peek(false,false))};assertEquals(current,d.current);assertEquals(shown,d.shown);assertEquals(setOf("clean"),upcoming!!.tags);d.draw(false,false);assertEquals(upcoming,d.current);assertNull(d.peek(false,false))}
    @Test fun playerCountAndAudienceExcludeCoupleAndGroupOnlyCards() {
        val shared=PartyCard("shared","x","Shared","clean",setOf("friends","couples","group"),2,20,false)
        val couple=shared.copy(id="couple",modes=setOf("couples"),max=2)
        val friends=shared.copy(id="friends",modes=setOf("friends"),max=2)
        val group=shared.copy(id="group",modes=setOf("group"),min=3,max=6)
        val d=FilteredCardDeck(listOf(shared,couple,friends,group),"audience")
        fun ids(a:CardAudience)=d.eligible(setOf("clean"),false,false,a).map{it.id}.toSet()
        assertEquals(setOf("shared","friends"),ids(CardAudience(2,"friends")))
        assertEquals(setOf("shared","couple"),ids(CardAudience(2,"couples")))
        assertEquals(setOf("shared","group"),ids(CardAudience(6,"group")))
        assertEquals(setOf("shared"),ids(CardAudience(7,"group")))
        assertTrue(ids(CardAudience(2,"group")).isEmpty())
        d.apply(setOf("clean"),false,false,CardAudience(2,"couples"))
        val previous=d.current;val seen=d.shown
        try{d.apply(setOf("clean"),false,false,CardAudience(4,"couples"));fail()}catch(_:IllegalArgumentException){}
        assertEquals(previous,d.current);assertEquals(seen,d.shown);assertEquals(CardAudience(2,"couples"),d.audience)
        d.apply(setOf("clean"),false,false,CardAudience(2,"friends"))
        while(d.current!=null){assertTrue(d.audience.accepts(d.current!!));d.draw(false,false)}
        d.shuffleAgain(false,false);assertTrue(d.audience.accepts(d.current!!))
    }
    @Test fun drinkingRulesAndGroupRulesMatchTheActualGame() {
        val drink=cards[3].copy(game="truth_or_drink")
        assertEquals("Answer the question or take a drink. You can always skip.",drink.playRule("friends"))
        assertTrue(drink.copy(game="do_or_drink").playRule("group").startsWith("Do the dare or take a drink."))
        val vote=cards[0].copy(instructions=mapOf("friends" to "Choose between the two of you.","group" to "Vote for a player."))
        assertEquals("Choose between the two of you.",vote.playRule("friends"));assertEquals("Vote for a player.",vote.playRule("group"))
    }
    @Test fun birthdayFormattingAndExactDatesDoNotBypassAgeValidation() {
        val today=LocalDate.of(2026,10,6)
        assertEquals("01/01/2000",CardBirthday.format("01012000"))
        assertEquals("01/01/2000",CardBirthday.format("01/01/2000"))
        assertEquals("01/0",CardBirthday.format("010"))
        assertEquals("01/01/200",CardBirthday.format("0101200"))
        assertNull(CardBirthday.eligible("29021900",21,today))
        assertNull(CardBirthday.eligible("31042000",21,today))
        assertNull(CardBirthday.eligible("01012027",21,today))
        assertNull(CardBirthday.eligible("0101",21,today))
        assertTrue(CardBirthday.eligible("29022000",21,today)!!)
        assertTrue(CardBirthday.eligible("06102005",21,today)!!)
        assertFalse(CardBirthday.eligible("07102005",21,today)!!)
    }
}
