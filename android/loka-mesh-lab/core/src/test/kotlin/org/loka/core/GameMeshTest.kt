package org.loka.core

import org.junit.Assert.*
import org.junit.Test
import java.security.KeyPairGenerator
import java.util.UUID

class GameMeshTest {
    @Test fun gamesAndChatShareEncryptedRelayWithoutGameChatReceiptsOrUrgency() {
        val generator = KeyPairGenerator.getInstance("RSA").apply { initialize(3072) }
        val a = LabCrypto(generator.generateKeyPair()); val relay = LabCrypto(generator.generateKeyPair()); val c = LabCrypto(generator.generateKeyPair())
        val now = 1_800_000_000_000L
        val frames = ArrayDeque<Triple<String,String,ByteArray>>()
        val games = mutableListOf<GameEvent>(); val chats = mutableListOf<String>()
        val engines = mapOf("a" to a, "b" to relay, "c" to c).mapValues { (name,crypto) ->
            MeshEngine(crypto, {now}, {name != "b"}, {peer,frame -> frames.add(Triple(name,peer,frame))}, {}, {_,_->},
                packetMessage = { _,text ->
                    check(name != "b")
                    if (text.startsWith("L1|G|")) games.add(GameEvent.decode(text)) else chats.add(ChatContent.decode(text)!!.kind)
                }, sendUrgentFrame = {peer,frame -> frames.add(Triple(name,peer,frame))})
        }
        engines.getValue("a").linkUp("b"); engines.getValue("b").linkUp("a"); engines.getValue("b").linkUp("c"); engines.getValue("c").linkUp("b")
        val e = GameEvent("C", UUID.randomUUID().toString(), UUID.randomUUID().toString(), "c".repeat(64), now + 120000)
        engines.getValue("a").send(c.publicKey,e.encode(),lifetimeMs=120000)
        engines.getValue("a").send(c.publicKey,ChatContent("T",UUID.randomUUID().toString(),"hello".toByteArray()).encode())
        engines.getValue("a").send(c.publicKey,ChatContent("A",UUID.randomUUID().toString()).encode(),urgent=true)
        var count = 0
        while (frames.isNotEmpty()) {
            assertTrue(++count < 40)
            val (from,to,bytes) = frames.removeFirst()
            val packet = PacketCodec.decode(bytes)
            assertFalse(packet.ciphertext.toString(Charsets.UTF_8).contains(e.session))
            assertTrue(runCatching { relay.decrypt(packet) }.isFailure)
            engines.getValue(to).receive(from,bytes)
        }
        assertEquals(listOf(e),games); assertEquals(listOf("T","A"),chats)
        assertThrows(IllegalArgumentException::class.java) { engines.getValue("a").send(c.publicKey,e.encode(),urgent=true) }
        // Match the production game admission limit; reserve ordinary and receipt capacity.
        val queue = MeshEngine(a,{now},{true},{_,_->},{},{_,_->},saveCarry={})
        repeat(96) { queue.send(c.publicKey,e.encode(),automatic=true) }
        assertFalse(QuickQuiz.canQueue(queue.queued().size))
        queue.send(c.publicKey,ChatContent("T",UUID.randomUUID().toString(),"still works".toByteArray()).encode(),automatic=true)
        queue.send(c.publicKey,ChatContent("A",UUID.randomUUID().toString()).encode(),urgent=true,automatic=true)
        assertEquals(98,queue.queued().size)
    }
    @Test fun shorterSignedExpiryPreservesDefaultsAndRejectsTampering() {
        val g = KeyPairGenerator.getInstance("RSA").apply { initialize(3072) }
        val a = LabCrypto(g.generateKeyPair()); val b = LabCrypto(g.generateKeyPair())
        val now = 1_800_000_000_000L
        val packet = a.encrypt(b.publicKey,"game",now,automatic=true,lifetimeMs=120000)
        assertEquals(now+120000,packet.expiresAt); assertEquals("game",b.decrypt(packet))
        assertTrue(LabCrypto.verify(packet)); assertFalse(LabCrypto.verify(packet.copy(expiresAt=now+120001)))
        assertThrows(IllegalArgumentException::class.java) { packet.validate(now+120000) }
        assertThrows(IllegalArgumentException::class.java) { a.encrypt(b.publicKey,"game",now,lifetimeMs=0) }
        assertThrows(IllegalArgumentException::class.java) { a.encrypt(b.publicKey,"game",now,lifetimeMs=300001) }
        assertEquals(now+300000,a.encrypt(b.publicKey,"chat",now).expiresAt)
        assertEquals(now+3600000,a.encrypt(b.publicKey,"chat",now,automatic=true).expiresAt)
    }

}
