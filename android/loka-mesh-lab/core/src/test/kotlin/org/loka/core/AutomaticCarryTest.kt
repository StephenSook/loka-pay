package org.loka.core

import org.junit.Assert.*
import org.junit.Test
import java.security.KeyPairGenerator

class AutomaticCarryTest {
    private fun identity() = LabCrypto(KeyPairGenerator.getInstance("RSA").apply { initialize(3072) }.generateKeyPair())
    @Test fun `ordinary queued message selects a later peer once persists selection and delivers after restart`() {
        val a = identity(); val b = identity(); val c = identity(); val d = identity()
        var now = 1800000000000L
        var sourceDisk = emptyList<ByteArray>(); var relayDisk = emptyList<ByteArray>()
        val writes = mutableListOf<Pair<String, ByteArray>>()
        val peers = mutableMapOf<String,String>()
        fun source() = MeshEngine(a, { now }, { true }, { peer, frame -> writes.add(peer to frame) }, {}, { _, _ -> }, saveCarry = { sourceDisk = it }).apply { carryPeer = peers::get }
        val first = source()
        val id = first.send(c.publicKey, "ordinary chat", automatic = true)
        assertEquals("", PacketCodec.decode(sourceDisk.single()).carrier)
        first.linkUp("b"); assertTrue(writes.isEmpty()) // no authenticated capability yet
        peers["b"] = b.deviceId; first.tick()
        val assigned = PacketCodec.decode(sourceDisk.single())
        assertEquals(id, assigned.id); assertEquals(b.deviceId, assigned.carrier)
        assertEquals("ordinary chat", c.decrypt(assigned)); assertTrue(LabCrypto.verify(assigned))
        assertEquals("b", writes.single().first)
        assertFalse(LabCrypto.verify(assigned.copy(carrier = d.deviceId)))
        val restored = source(); restored.restoreCarry(sourceDisk)
        peers["d"] = d.deviceId; writes.clear(); restored.linkUp("d")
        assertTrue(writes.isEmpty()); assertEquals(b.deviceId, PacketCodec.decode(sourceDisk.single()).carrier)
        restored.linkUp("b"); assertEquals(1, writes.size)
        val relayWrites = mutableListOf<ByteArray>()
        fun relay() = MeshEngine(b, { now }, { false }, { _, frame -> relayWrites.add(frame) }, {}, { _, _ -> }, saveCarry = { relayDisk = it }).apply { carryPeer = { if(it == "c") c.deviceId else d.deviceId } }
        relay().receive("a", writes.single().second)
        assertEquals(1, relayDisk.size)
        now += 600000
        val restarted = relay(); restarted.restoreCarry(relayDisk); restarted.linkUp("d")
        assertTrue(relayWrites.isEmpty()) // carrier cannot mint another carrier
        restarted.linkUp("c"); assertEquals(1, relayWrites.size)
        val arrived = mutableListOf<String>()
        val destination = MeshEngine(c, { now }, { true }, { _, _ -> }, {}, { _, text -> arrived.add(text) })
        destination.receive("b", relayWrites.single()); destination.receive("b", relayWrites.single())
        assertEquals(listOf("ordinary chat"), arrived)
        assertEquals(5, PacketCodec.decode(relayWrites.single()).remainingHops)
        assertEquals(assigned.expiresAt, PacketCodec.decode(relayWrites.single()).expiresAt)
    }
    @Test fun `direct route needs no relay and selection write failure never leaks another copy`() {
        val a = identity(); val b = identity(); val c = identity(); val now = 1800000000000L
        var fail = false; var disk = emptyList<ByteArray>(); val writes = mutableListOf<ByteArray>()
        val identities = mutableMapOf("c" to c.deviceId, "b" to b.deviceId)
        val engine = MeshEngine(a, { now }, { true }, { _, frame -> writes.add(frame) }, {}, { _, _ -> }, saveCarry = { if(fail) error("full") else disk = it }).apply { carryPeer = identities::get }
        engine.linkUp("c"); engine.send(c.publicKey,"direct",automatic = true)
        assertEquals("direct", c.decrypt(PacketCodec.decode(writes.single())))
        assertEquals("", PacketCodec.decode(disk.single()).carrier)
        engine.linkDown("c"); fail = true; writes.clear(); engine.linkUp("b")
        assertTrue(writes.isEmpty()); assertEquals("", PacketCodec.decode(disk.single()).carrier)
        fail = false; engine.tick(); assertEquals(b.deviceId, PacketCodec.decode(disk.single()).carrier)
        assertEquals(1, writes.size)
    }
    @Test fun `failed direct write yields to an available relay without user action`() {
        val a = identity(); val b = identity(); val c = identity(); val now = 1800000000000L
        val writes = mutableListOf<String>(); var disk = emptyList<ByteArray>()
        val engine = MeshEngine(a, { now }, { true }, { peer, _ -> if (peer == "c") error("link lost") else writes.add(peer) }, {}, { _, _ -> }, saveCarry = { disk = it }).apply {
            carryPeer = { if(it == "c") c.deviceId else b.deviceId }
        }
        engine.linkUp("c"); engine.send(c.publicKey,"fallback",automatic = true)
        engine.linkUp("b")
        assertEquals(listOf("b"), writes); assertEquals(b.deviceId, PacketCodec.decode(disk.single()).carrier)
    }

    @Test fun `multiple radios to one identity send one copy per retry window`() {
        val a = identity(); val c = identity(); var now = 1800000000000L; var writes = 0
        val engine = MeshEngine(a, { now }, { true }, { _,_ -> writes++ }, {}, { _,_ -> }, saveCarry = {}).apply { carryPeer = { c.deviceId } }
        engine.linkUp("radio1"); engine.linkUp("radio2")
        engine.send(c.publicKey, "one copy", automatic = true); assertEquals(1, writes)
        engine.linkUp("radio3"); assertEquals(1, writes)
        now += 15000; engine.tick(); assertEquals(2, writes)
    }

    @Test fun `receipt retry priority preserves an ordinary message slot`() {
        val a = identity(); val b = identity(); var now = 1800000000000L
        val writes = mutableListOf<ByteArray>()
        val engine = MeshEngine(a, { now }, { true }, { _, frame -> writes.add(frame) }, {}, { _, _ -> },
            sendUrgentFrame = { _, frame -> writes.add(frame) })
        engine.linkUp("b")
        repeat(5) { engine.send(b.publicKey, "data $it") }
        repeat(4) { engine.send(b.publicKey, ChatContent("A", java.util.UUID.randomUUID().toString()).encode(), urgent = true) }
        writes.clear(); now += 15000; engine.tick()
        val texts = writes.map { b.decrypt(PacketCodec.decode(it)) }
        assertEquals(4, texts.size)
        assertEquals(3, texts.count { it.startsWith("L1|A|") })
        assertEquals(1, texts.count { it.startsWith("data ") })
    }
    @Test fun `ready wifi wins equal backlog and busy routes yield without duplicate radio copies`() {
        val a = identity(); val b = identity(); var now = 1800000000000L
        val writes = mutableListOf<String>()
        val load = mutableMapOf("ble:b" to 0, "wifi:b" to 0)
        val engine = MeshEngine(a, { now }, { true }, { peer, _ -> writes.add(peer) }, {}, { _, _ -> }, saveCarry = {}).apply {
            carryPeer = { b.deviceId }; routeLoad = { load[it] ?: 0 }
            routePreference = { if(it.startsWith("wifi:")) 0 else 1 }
        }
        engine.linkUp("ble:b"); engine.linkUp("wifi:b")
        engine.send(b.publicKey, "wifi first", automatic = true)
        assertEquals(listOf("wifi:b"), writes)
        load["wifi:b"] = 1000; writes.clear()
        engine.send(b.publicKey, "fallback", automatic = true)
        assertEquals(listOf("ble:b"), writes)
        load["ble:b"] = 1000; writes.clear()
        val held = engine.send(b.publicKey, "held", automatic = true)
        assertTrue(writes.isEmpty()); assertTrue(engine.queued().any { PacketCodec.decode(it).id == held })
        load["wifi:b"] = 0; engine.tick()
        assertEquals(listOf("wifi:b"), writes)
    }
    @Test fun `repeated accepted writes back off but a fresh message and new link remain immediate`() {
        val a = identity(); val b = identity(); var now = 1800000000000L
        val writes = mutableListOf<ByteArray>()
        val engine = MeshEngine(a, { now }, { true }, { _, frame -> writes.add(frame) }, {}, { _, _ -> }, saveCarry = {}).apply { carryPeer = { b.deviceId } }
        engine.linkUp("b"); val old = engine.send(b.publicKey, "old", automatic = true)
        val expiry = PacketCodec.decode(writes.single()).expiresAt
        now += 15000; engine.tick(); assertEquals(2, writes.size)
        now += 15000; engine.tick(); assertEquals(2, writes.size)
        now += 15000; engine.tick(); assertEquals(3, writes.size)
        now += 60000; engine.tick(); assertEquals(4, writes.size)
        now += 119000; engine.tick(); assertEquals(4, writes.size)
        now += 1000; engine.tick(); assertEquals(5, writes.size)
        val fresh = engine.send(b.publicKey, "fresh", automatic = true)
        assertEquals(fresh, PacketCodec.decode(writes.last()).id)
        assertEquals(expiry, engine.queued().map(PacketCodec::decode).first { it.id == old }.expiresAt)
        engine.linkDown("b"); now += 16000; val count = writes.size; engine.linkUp("new-b")
        assertEquals(count + 2, writes.size)
    }
    @Test fun `fresh blocked message goes first on drain then older data makes progress`() {
        val a = identity(); val b = identity(); var now = 1800000000000L; var busy = true
        val writes = mutableListOf<String>()
        val engine = MeshEngine(a, { now }, { true }, { _, frame -> writes.add(PacketCodec.decode(frame).id); busy = true }, {}, { _, _ -> }, saveCarry = {}).apply {
            carryPeer = { b.deviceId }; routeLoad = { if (busy) 1000 else 0 }
        }
        engine.linkUp("b"); val older = engine.send(b.publicKey, "older", automatic = true)
        now += 1000; val fresh = engine.send(b.publicKey, "fresh", automatic = true)
        assertTrue(writes.isEmpty())
        busy = false; engine.tick(); assertEquals(listOf(fresh), writes)
        now += 16000; busy = false; engine.tick(); assertEquals(listOf(fresh, older), writes)
    }
}
