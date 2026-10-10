package org.loka.core

import org.junit.Assert.*
import org.junit.Test

class ContactConsentTest {
    private val alice = "a".repeat(64)
    private val bob = "b".repeat(64)
    private val stranger = "c".repeat(64)
    private val id = "11111111-1111-4111-8111-111111111111"
    private fun rejects(action: () -> Unit) { try { action(); fail("Expected rejection") } catch (_: IllegalArgumentException) {} catch (_: java.nio.charset.CharacterCodingException) {} }
    @Test fun sharedWireVectorAndMalformedInput() {
        val request = ContactConsent("R", id, 300000, "Mary")
        assertEquals("LC1|R|$id|300000|TWFyeQ==", request.encode())
        assertEquals(request, ContactConsent.decode(request.encode()))
        listOf("LC1|R|$id|0300000|TWFyeQ==", "LC1|R|$id|300000|/w==", "LC1|K|$id|300000|TWFyeQ==",
            "LC1|R|$id|300000|TWFyeQ", "LC1|R|bad|300000|TWFyeQ==", "LC1|R|$id|300000|").forEach { rejects { ContactConsent.decode(it) } }
        listOf(" Mary", "Mary\n", "\u202eMary", "\udb40\udc01Mary", "Mary\u2028Test", "\ud800", "a".repeat(129)).forEach { rejects { request.copy(name = it).encode() } }
    }
    @Test fun explicitApprovalAndLostRepliesRecoverWithoutNewRequests() {
        val a = ContactConsentBook(alice); val b = ContactConsentBook(bob)
        val request = a.begin(bob, "Alice", 0, id)
        assertNull(b.receive(alice, request, 1))
        assertEquals(ContactConsentBook.Phase.INCOMING, b.snapshot(1).single().phase)
        rejects { b.receive(alice, ContactConsent("K", id, request.expires), 2) }
        val accept = b.decide(id, true, "Bob", 3)
        assertEquals(ContactConsentBook.Phase.APPROVED, b.snapshot(3).single().phase)
        assertEquals(accept, b.receive(alice, request, 4)) // lost acceptance
        val ack = a.receive(bob, accept, 5)!!
        assertEquals(ack, a.receive(bob, accept, 6)) // lost acknowledgement
        b.receive(alice, ack, 7); b.receive(alice, ack, 8)
        assertEquals(ContactConsentBook.Phase.COMPLETE, a.snapshot(8).single().phase)
        assertEquals(ContactConsentBook.Phase.COMPLETE, b.snapshot(8).single().phase)
        assertEquals("Bob", a.snapshot(8).single().peerName)
        assertEquals("Alice", b.snapshot(8).single().peerName)
    }
    @Test fun acceptanceIsBoundToPeerRequestAndDeadline() {
        val a = ContactConsentBook(alice); val request = a.begin(bob, "Alice", 0, id)
        val accept = request.copy(kind = "A", name = "Bob")
        rejects { a.receive(stranger, accept, 1) }
        rejects { a.receive(bob, accept.copy(expires = accept.expires - 1), 1) }
        rejects { a.receive(bob, accept.copy(id = "22222222-2222-4222-8222-222222222222"), 1) }
        assertEquals(ContactConsentBook.Phase.OUTGOING, a.snapshot(1).single().phase)
        a.receive(bob, accept, 2)
        rejects { a.receive(bob, accept.copy(name = "Changed"), 3) }
        rejects { a.receive(bob, accept.copy(kind = "D", name = ""), 3) }
        rejects { a.receive(bob, accept, 300000) }
        assertTrue(a.snapshot(300000).isEmpty())
    }
    @Test fun declineAndBlockCannotBeOverriddenByRetries() {
        val a = ContactConsentBook(alice); val b = ContactConsentBook(bob)
        val request = a.begin(bob, "Alice", 0, id); b.receive(alice, request, 1)
        val decline = b.decide(id, false, "", 2)
        assertEquals(decline, b.receive(alice, request, 3))
        a.receive(bob, decline, 4)
        rejects { a.receive(bob, request.copy(kind = "A", name = "Bob"), 5) }
        b.block(alice)
        rejects { b.receive(alice, request, 6) }
        rejects { b.begin(alice, "Bob", 6) }
    }
    @Test fun boundedInboxAndSingleOutstandingPeer() {
        val b = ContactConsentBook(bob)
        for (i in 1..16) b.receive(i.toString(16).padStart(64, '0'), ContactConsent("R", java.util.UUID.randomUUID().toString(), 300000, "Guest"), 0)
        rejects { b.receive(alice, ContactConsent("R", id, 300000, "Alice"), 0) }
        assertEquals(16, b.snapshot(0).size)
        assertTrue(b.snapshot(300000).isEmpty())
        val a = ContactConsentBook(alice); a.begin(bob, "Alice", 0, id)
        rejects { a.begin(bob, "Alice", 1) }
        rejects { a.begin(alice, "Alice", 1) }
        rejects { a.begin(stranger, "Alice", Long.MAX_VALUE) }
    }
}
