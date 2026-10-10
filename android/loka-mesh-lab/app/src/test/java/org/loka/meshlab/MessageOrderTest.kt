package org.loka.meshlab

import org.junit.Assert.assertEquals
import org.junit.Test

class MessageOrderTest {
    @Test fun delayedArrivalAndReceiptsDoNotChangeConversationOrder() {
        val earlier = ChatMessage("a", "friend", "Earlier", false, 10)
        val later = ChatMessage("c", "friend", "Later", true, 20, deliveredAt = 999, readAt = 1000)
        val tied = ChatMessage("b", "friend", "Same time", false, 20)
        for (arrivals in listOf(listOf(later, tied, earlier), listOf(earlier, later, tied), listOf(tied, earlier, later))) {
            assertEquals(listOf("a", "b", "c"), arrivals.sortedWith(chatMessageOrder).map { it.id })
            assertEquals("c", arrivals.maxWithOrNull(chatMessageOrder)?.id)
        }
    }
}
