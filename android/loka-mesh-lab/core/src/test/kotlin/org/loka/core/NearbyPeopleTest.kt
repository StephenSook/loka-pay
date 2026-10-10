package org.loka.core

import org.junit.Assert.*
import org.junit.Test
import java.security.KeyPairGenerator

class NearbyPeopleTest {
    class Network {
        var now = 1_000_000L
        val queue = ArrayDeque<Pair<Int, ByteArray>>()
        val peers = arrayOfNulls<NearbyPeople>(2)
        val profiles = Array(2) { emptyList<NearbyProfile>() }
        val requests = Array(2) { emptyList<ContactConsentBook.Entry>() }
        val saved = arrayOfNulls<NearbySaved>(2)
        val trust = Array(2) { mutableSetOf<String>() }
        val visible = arrayOf(true,true)
        val attempts = mutableListOf<Pair<String, ByteArray>>()
        var reject: String? = null
        var failSave = -1
        val avatars = arrayOf<String?>("avatar_6", "avatar_41")
        val crypto = Array(2) { LabCrypto(KeyPairGenerator.getInstance("RSA").apply { initialize(3072) }.generateKeyPair()) }
        init { create(0); create(1); connect() }
        fun create(i: Int) {
            peers[i] = NearbyPeople(crypto[i], { if (i==0) "Alice" else "Bob" }, { visible[i] },
                { handle, frame -> attempts.add(handle to frame); check(handle != reject); queue.add((1-i) to frame) }, { if (failSave==i) error("disk full"); saved[i]=it },
                { key, _ -> trust[i].add(fingerprint(key)) }, { p,r -> profiles[i]=p;requests[i]=r }, { now }, { avatars[i] })
            peers[i]!!.restore(saved[i])
        }
        fun connect() { peers.forEach { it!!.link("direct",true) }; pump() }
        fun pump() { var count=0; while(queue.isNotEmpty()) { check(++count < 100); val (i,f)=queue.removeFirst(); peers[i]!!.receive("direct",f) } }
        fun request() { peers[0]!!.request(crypto[1].deviceId); pump() }
        fun tick() { now += 30_001; peers.forEach { it!!.tick() }; pump() }
    }
    @Test fun controlsChooseRankedAuthenticatedRoutesAndFallbackWithoutReencrypting() {
        val n = Network()
        fun bind(i: Int, handle: String) {
            n.queue.clear(); n.peers[i]!!.link(handle,true)
            val hello = n.queue.first { String(it.second).startsWith("LP1H") }.second
            val nonce = String(hello).removePrefix("LP1H").substringBefore('|')
            val name = java.util.Base64.getEncoder().encodeToString("Peer".toByteArray())
            val frame = "LP1E".toByteArray() + PacketCodec.encode(n.crypto[1-i].encrypt(n.crypto[i].publicKey,"LP1|P|$nonce|$name",n.now))
            n.peers[i]!!.receive(handle,frame); n.queue.clear()
        }
        bind(0,"wifi:peer"); bind(1,"wifi:peer")
        n.peers.forEach { it!!.routePreference = { h -> if (h.startsWith("wifi:")) 0 else 1 } }
        n.attempts.clear(); n.peers[0]!!.request(n.crypto[1].deviceId)
        assertEquals(listOf("wifi:peer"),n.attempts.map { it.first })
        n.pump(); n.attempts.clear(); n.peers[1]!!.decide(n.requests[1].single().request.id,true)
        assertEquals("wifi:peer",n.attempts.single().first); n.pump()
        n.peers[0]!!.trusted = { true }; n.attempts.clear(); n.peers[0]!!.typing(n.crypto[1].deviceId,true)
        assertEquals("wifi:peer",n.attempts.single().first)
        n.now += 4001; n.reject="wifi:peer"; n.attempts.clear()
        n.peers[0]!!.typing(n.crypto[1].deviceId,false)
        assertEquals(listOf("wifi:peer","direct"),n.attempts.map { it.first })
        assertArrayEquals(n.attempts[0].second,n.attempts[1].second)
        n.reject=null; n.now+=4001; n.peers[0]!!.routeLoad = { if(it.startsWith("wifi:")) 100 else 0 }; n.attempts.clear()
        n.peers[0]!!.typing(n.crypto[1].deviceId,true)
        assertEquals("direct",n.attempts.single().first)
        n.peers[0]!!.link("direct",false); n.peers[0]!!.link("wifi:peer",false)
        n.now+=4001; n.attempts.clear(); n.peers[0]!!.typing(n.crypto[1].deviceId,false)
        assertTrue(n.attempts.isEmpty())
    }
    @Test fun bundledAvatarChangesClearAndRejectReplaysWithoutTrust() {
        val n=Network()
        assertEquals("avatar_41",n.profiles[0].single().avatarID)
        assertEquals("avatar_6",n.profiles[1].single().avatarID)
        assertTrue(n.trust.all { it.isEmpty() })
        n.avatars[0]="avatar_17"; n.now+=2_001; n.peers[0]!!.tick(); val update=n.queue.toList(); n.pump()
        assertEquals("avatar_17",n.profiles[1].single().avatarID)
        val latest = n.profiles[1].single()
        val stale = latest.copy(handle="other-link",avatarID="avatar_6",avatarUpdatedAt=latest.avatarUpdatedAt-1)
        assertEquals("avatar_17",NearbyPeople.displayProfiles(listOf(stale,latest)).single().avatarID)
        assertEquals("avatar_17",NearbyPeople.displayProfiles(listOf(latest,stale)).single().avatarID)
        n.avatars[0]=null; n.now+=2_001; n.peers[0]!!.tick(); n.pump()
        assertNull(n.profiles[1].single().avatarID); assertTrue(n.profiles[1].single().avatarShared)
        update.forEach { (i,f) -> n.peers[i]!!.receive("direct",f) }
        assertNull(n.profiles[1].single().avatarID)
        val original = PacketCodec.decode(update.single().second.copyOfRange(4, update.single().second.size))
        val nonce = n.crypto[1].decrypt(original).split('|')[2]
        fun inject(text: String, handle: String = "direct") {
            n.peers[1]!!.receive(handle, "LP1E".toByteArray() + PacketCodec.encode(n.crypto[0].encrypt(n.crypto[1].publicKey, text, n.now)))
        }
        inject("LP1|I|$nonce|${n.now + 1}|../../avatar_1")
        inject("LP1|I|00000000-0000-0000-0000-000000000000|${n.now + 1}|avatar_1")
        inject("LP1|I|$nonce|${n.now - 60_001}|avatar_1")
        inject("LP1|I|$nonce|${n.now + 2_001}|avatar_1")
        inject("LP1|I|$nonce|0${n.now}|avatar_1")
        inject("LP1|I|$nonce|${n.now + 1}|avatar_1", "unbound")
        assertNull(n.profiles[1].single().avatarID)
        inject("LP1|I|$nonce|${n.now + 1}|avatar_1")
        assertEquals("avatar_1",n.profiles[1].single().avatarID)
        n.peers.forEach { it!!.link("direct",false) }; n.connect()
        inject("LP1|I|$nonce|${n.now + 2}|avatar_17")
        assertNull(n.profiles[1].single().avatarID)
        assertNull(NearbyPeople.avatarID("avatar_042")); assertNull(NearbyPeople.avatarID("../../avatar_1"))
        n.visible[0]=false; n.peers[0]!!.visibilityChanged(); n.pump(); n.avatars[0]="avatar_41"; n.now+=2_001; n.peers[0]!!.tick(); n.pump()
        assertTrue(n.profiles[1].isEmpty())
    }
    @Test fun namesNeverAuthorizeUntilRecipientAcceptsAndBothSave() {
        val n=Network(); assertTrue(n.profiles.all { it.single().carryVersion == 3 }); assertEquals("Bob",n.profiles[0].single().name); assertEquals("Alice",n.profiles[1].single().name)
        assertTrue(n.trust.all { it.isEmpty() }); n.request(); assertTrue(n.trust.all { it.isEmpty() })
        n.peers[1]!!.decide(n.requests[1].single().request.id,true); n.pump()
        assertEquals(setOf(n.crypto[1].deviceId),n.trust[0]); assertEquals(setOf(n.crypto[0].deviceId),n.trust[1])
        assertTrue(n.requests.all { it.single().phase==ContactConsentBook.Phase.COMPLETE })
    }
    @Test fun lostAcceptanceSurvivesRestartAndRetries() {
        val n=Network(); n.request(); n.peers[1]!!.decide(n.requests[1].single().request.id,true); n.queue.clear()
        n.peers.forEach { it!!.link("direct",false) }; n.create(1); n.connect(); n.tick()
        assertTrue(n.trust.all { it.size==1 }); assertTrue(n.requests.all { it.single().phase==ContactConsentBook.Phase.COMPLETE })
    }
    @Test fun declineBlockAndExpiryDoNotAuthorize() {
        val n=Network(); n.request(); n.peers[1]!!.decide(n.requests[1].single().request.id,false); n.pump(); n.tick()
        assertTrue(n.trust.all { it.isEmpty() }); assertEquals(ContactConsentBook.Phase.DECLINED,n.requests[0].single().phase)
        n.peers[1]!!.block(n.crypto[0].deviceId); n.create(1); n.peers[0]!!.link("direct",false); n.connect(); assertTrue(n.profiles[1].isEmpty())
        n.now+=300_001; n.tick(); assertTrue(n.requests.all { it.isEmpty() })
    }
    @Test fun noApprovalWhenStorageFails() {
        val n=Network(); n.request(); n.failSave=1
        try { n.peers[1]!!.decide(n.requests[1].single().request.id,true); fail() } catch (_: IllegalStateException) {}
        n.pump(); assertTrue(n.trust.all { it.isEmpty() })
    }
    @Test fun simultaneousRequestsConvergeAndWithdrawalHidesName() {
        val n=Network(); n.peers[0]!!.request(n.crypto[1].deviceId); n.peers[1]!!.request(n.crypto[0].deviceId); n.pump(); n.tick()
        assertTrue(n.trust.all { it.size==1 })
        n.visible[1]=false; n.peers[1]!!.visibilityChanged(); n.pump(); assertTrue(n.profiles[0].isEmpty()); n.tick(); assertTrue(n.profiles[0].isEmpty())
    }
    @Test fun forgedProfileAndWrongLinkAreIgnored() {
        val n=Network(); val frame="LP1Egarbage".toByteArray(); repeat(40) { n.peers[0]!!.receive("other",frame) }
        assertEquals("Bob",n.profiles[0].single().name); assertTrue(n.trust.all { it.isEmpty() })
        assertEquals(listOf(0,0,1,2,3,4,5,6),listOf(null,127,-100,-82,-74,-67,-60,-50).map(NearbyPeople::bars))
    }
    @Test fun typingIsTrustedEphemeralThrottledAndExpires() {
        val n=Network(); val seen=mutableListOf<Long>()
        n.peers[0]!!.trusted = { true }; n.peers[1]!!.typingChanged = { _,until -> seen.add(until) }
        n.peers[0]!!.typing(n.crypto[1].deviceId,true); n.pump(); assertTrue(seen.isEmpty())
        n.peers[1]!!.trusted = { true }; n.now += 4_001
        val before=n.saved[0]
        n.peers[0]!!.typing(n.crypto[1].deviceId,true); val frame=n.queue.first().second; n.pump()
        assertEquals(n.now+8_000,seen.single()); assertSame(before,n.saved[0])
        n.peers[0]!!.typing(n.crypto[1].deviceId,true); assertTrue(n.queue.isEmpty())
        n.peers[0]!!.typing(n.crypto[1].deviceId,false); n.pump(); assertEquals(0L,seen.last())
        n.peers[1]!!.receive("direct",frame); assertEquals(2,seen.size)
        n.now += 9_000; n.peers[1]!!.receive("direct",frame); assertEquals(2,seen.size)
        n.peers[0]!!.link("direct",false); n.peers[0]!!.typing(n.crypto[1].deviceId,true); assertTrue(n.queue.isEmpty())
    }
    @Test fun slowProfileExchangeDoesNotEnableTyping() {
        val n=Network(); n.peers.forEach { it!!.link("direct",false); it.link("direct",true) }
        n.now+=2_501; n.pump(); n.peers[0]!!.trusted={ true }
        n.peers[0]!!.typing(n.crypto[1].deviceId,true); assertTrue(n.queue.isEmpty())
    }

    @Test fun completedExchangeLeavesIdleLinkQuietAndReconnects() {
        val n=Network(); n.request(); n.peers[1]!!.decide(n.requests[1].single().request.id,true); n.pump()
        assertTrue(n.requests.all { it.single().phase == ContactConsentBook.Phase.COMPLETE })
        n.now+=30_001; n.peers.forEach { it!!.tick() }
        assertTrue("Completed consent and confirmed capabilities must not consume the idle link", n.queue.isEmpty())
        n.now+=120_001; n.peers.forEach { it!!.tick() }; assertEquals(2,n.queue.size); n.pump()
        n.peers.forEach { it!!.link("direct",false) }; n.connect()
        assertTrue(n.profiles.all { it.single().carryVersion == 3 }); assertTrue(n.trust.all { it.size == 1 })
    }

}
