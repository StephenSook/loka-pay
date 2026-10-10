package org.loka.core

import org.junit.Assert.*
import org.junit.BeforeClass
import org.junit.Test
import java.io.ByteArrayOutputStream
import java.io.DataOutputStream
import java.security.KeyPairGenerator

class MeshEngineTest {
    companion object {
        private lateinit var a: LabCrypto
        private lateinit var b: LabCrypto
        private lateinit var c: LabCrypto
        @BeforeClass @JvmStatic fun keys() {
            val generator = KeyPairGenerator.getInstance("RSA").apply { initialize(3072) }
            a = LabCrypto(generator.generateKeyPair())
            b = LabCrypto(generator.generateKeyPair())
            c = LabCrypto(generator.generateKeyPair())
        }
    }
    private val now = 1_800_000_000_000L
    @Test fun `newly verified destination bypasses relay retry delay without duplicate writes`() {
        var time = now
        var destinationVerified = false
        val writes = mutableListOf<String>()
        val engine = MeshEngine(a, { time }, { true }, { peer, _ -> writes.add(peer) }, {}, { _, _ -> }, saveCarry = {})
        engine.carryPeer = { if (it == "relay") b.deviceId else if (destinationVerified) c.deviceId else null }
        engine.linkUp("relay"); engine.linkUp("destination")
        engine.send(c.publicKey, "fast handoff", automatic = true)
        assertEquals(listOf("relay"), writes)
        time += 1_000; destinationVerified = true; engine.tick()
        assertEquals(listOf("relay", "destination"), writes)
        engine.tick()
        assertEquals(2, writes.size)
    }
    private fun rejects(block: () -> Unit) {
        try { block(); fail("Expected rejection") } catch (_: IllegalArgumentException) { }
    }
    @Test fun `only local receipts receive priority and retry preserves it`() {
        var time = now
        val normal = mutableListOf<ByteArray>(); val urgent = mutableListOf<ByteArray>()
        val engine = MeshEngine(a, { time }, { true }, { _, frame -> normal.add(frame) }, {}, { _, _ -> },
            sendUrgentFrame = { _, frame -> urgent.add(frame) })
        engine.linkUp("peer")
        val content = ChatContent("A", java.util.UUID.randomUUID().toString()).encode()
        val id = engine.send(b.publicKey, content, urgent = true)
        assertEquals(content, b.decrypt(PacketCodec.decode(urgent.single())))
        assertTrue(normal.isEmpty())
        time += 15_000; engine.tick()
        assertEquals(2, urgent.size)
        rejects { engine.send(b.publicKey, "ordinary text", urgent = true) }
        engine.receive("ingress", PacketCodec.encode(c.encrypt(b.publicKey, content, time)))
        assertEquals(1, normal.size) // A relay cannot inspect or elevate encrypted receipts.
        engine.discard(listOf(id))
    }
    @Test fun `ciphertext is decryptable only by recipient`() {
        val packet = a.encrypt(c.publicKey, "Hello C", now)
        assertEquals("Hello C", c.decrypt(packet))
        rejects { b.decrypt(packet) }
        assertFalse(packet.ciphertext.toString(Charsets.UTF_8).contains("Hello C"))
        assertTrue(LabCrypto.verify(packet))
    }
    @Test fun `codec preserves the encrypted envelope`() {
        val packet = a.encrypt(c.publicKey, "Hello C 🌍", now)
        val decoded = PacketCodec.decode(PacketCodec.encode(packet))
        decoded.validate(now)
        assertEquals(packet.id, decoded.id)
        assertEquals("Hello C 🌍", c.decrypt(decoded))
    }
    @Test fun `ciphertext and destination tampering fails signature verification`() {
        val packet = a.encrypt(c.publicKey, "Hello C", now)
        assertFalse(LabCrypto.verify(packet.copy(destination = b.deviceId)))
        assertFalse(LabCrypto.verify(packet.copy(ciphertext = packet.ciphertext.clone().apply { this[0] = (this[0].toInt() xor 1).toByte() })))
    }
    @Test fun `relay can decrement hop budget without changing ciphertext`() {
        val packet = a.encrypt(c.publicKey, "Hello C", now)
        val forwarded = packet.copy(remainingHops = 3)
        assertTrue(LabCrypto.verify(forwarded))
        assertEquals("Hello C", c.decrypt(forwarded))
    }
    @Test fun `malformed oversized truncated and trailing frames are rejected`() {
        rejects { PacketCodec.decode(ByteArray(MAX_FRAME_BYTES + 1)) }
        val malformed = ByteArrayOutputStream().apply {
            DataOutputStream(this).apply {
                writeInt(0); writeUTF("id"); writeUTF("src"); writeUTF("dst")
                writeLong(now); writeLong(now + 1); writeInt(2); writeInt(Int.MAX_VALUE)
            }
        }.toByteArray()
        rejects { PacketCodec.decode(malformed) }
        val frame = PacketCodec.encode(a.encrypt(c.publicKey, "hello", now))
        rejects { PacketCodec.decode(frame + byteArrayOf(1)) }
        assertTrue(runCatching { PacketCodec.decode(frame.copyOf(10)) }.isFailure)
    }
    @Test fun `expired invalid ttl and excessive lifetime rejected`() {
        val packet = a.encrypt(c.publicKey, "hello", now)
        rejects { packet.validate(now + MAX_LIFETIME_MS) }
        rejects { packet.copy(remainingHops = -1).validate(now) }
        rejects { packet.copy(remainingHops = MAX_HOPS + 1).validate(now) }
        rejects { packet.copy(expiresAt = now + MAX_LIFETIME_MS + 1).validate(now) }
    }
    @Test fun `A to B to C and response use only allowed links and never expose text at B`() {
        val nodes = mapOf("A" to a, "B" to b, "C" to c)
        val delivered = mutableListOf<Pair<String, String>>()
        val events = mutableMapOf<String, MutableList<String>>()
        val frames = ArrayDeque<Triple<String, String, ByteArray>>()
        val engines = nodes.mapValues { (name, crypto) ->
            MeshEngine(crypto, { now }, { true },
                { peer, frame -> frames.add(Triple(name, peer, frame)) },
                { events.getOrPut(name) { mutableListOf() }.add(it) },
                { _, text -> delivered.add(name to text) })
        }
        fun drain() {
            var count = 0
            while (frames.isNotEmpty()) {
                check(++count < 100) { "Relay loop" }
                val (from, to, frame) = frames.removeFirst()
                assertFalse((from == "A" && to == "C") || (from == "C" && to == "A"))
                engines.getValue(to).receive(from, frame)
            }
        }
        engines.getValue("A").linkUp("B"); engines.getValue("B").linkUp("A")
        engines.getValue("B").linkUp("C"); engines.getValue("C").linkUp("B")
        engines.getValue("A").send(c.publicKey, "Hello C"); drain()
        engines.getValue("C").send(a.publicKey, "Hello A"); drain()
        assertEquals(listOf("C" to "Hello C", "A" to "Hello A"), delivered)
        assertTrue(events.getValue("B").any { it.startsWith("Relay") })
        assertFalse(events.getValue("B").any { it.contains("Hello") })
    }
    @Test fun `temporary partition queues ciphertext for new link`() {
        val forwarded = mutableListOf<ByteArray>()
        var delivered = ""
        val relay = MeshEngine(b, { now }, { true }, { _, frame -> forwarded.add(frame) }, {}, { _, _ -> fail() })
        relay.receive("A", PacketCodec.encode(a.encrypt(c.publicKey, "after gap", now)))
        assertTrue(forwarded.isEmpty())
        relay.linkUp("C")
        val recipient = MeshEngine(c, { now }, { true }, { _, _ -> }, {}, { _, text -> delivered = text })
        recipient.receive("B", forwarded.single())
        assertEquals("after gap", delivered)
    }
    @Test fun `duplicate packets deliver once`() {
        var count = 0
        val engine = MeshEngine(c, { now }, { true }, { _, _ -> }, {}, { _, _ -> count++ })
        val frame = PacketCodec.encode(a.encrypt(c.publicKey, "once", now))
        engine.receive("B", frame); engine.receive("D", frame)
        assertEquals(1, count)
    }
    @Test fun `untrusted sender never reaches message callback`() {
        val engine = MeshEngine(c, { now }, { false }, { _, _ -> }, {}, { _, _ -> fail() })
        engine.receive("B", PacketCodec.encode(a.encrypt(c.publicKey, "no trust", now)))
    }
    @Test fun `expired queued packets never replay`() {
        var clock = now
        val frames = mutableListOf<ByteArray>()
        val relay = MeshEngine(b, { clock }, { true }, { _, frame -> frames.add(frame) }, {}, { _, _ -> })
        relay.receive("A", PacketCodec.encode(a.encrypt(c.publicKey, "expired", now)))
        clock += MAX_LIFETIME_MS
        relay.linkUp("C")
        assertTrue(frames.isEmpty())
    }
    @Test fun `relay disabled does not forward or retain other devices packets`() {
        val frames = mutableListOf<ByteArray>()
        val relay = MeshEngine(b, { now }, { true }, { _, frame -> frames.add(frame) }, {}, { _, _ -> })
        relay.receive("A", PacketCodec.encode(a.encrypt(c.publicKey, "queued", now)))
        relay.relayEnabled = false
        relay.linkUp("C")
        relay.receive("A", PacketCodec.encode(a.encrypt(c.publicKey, "disabled", now)))
        assertTrue(frames.isEmpty())
    }
    @Test fun `hop budget zero stops relay but permits destination delivery`() {
        val packet = a.encrypt(c.publicKey, "last hop", now).copy(remainingHops = 0)
        var delivered = ""
        val relay = MeshEngine(b, { now }, { true }, { _, _ -> fail() }, {}, { _, _ -> fail() })
        relay.linkUp("C"); relay.receive("A", PacketCodec.encode(packet))
        val recipient = MeshEngine(c, { now }, { true }, { _, _ -> }, {}, { _, text -> delivered = text })
        recipient.receive("B", PacketCodec.encode(packet))
        assertEquals("last hop", delivered)
    }
    @Test fun `text byte budget and untrusted destinations are enforced`() {
        rejects { a.encrypt(c.publicKey, "", now) }
        rejects { a.encrypt(c.publicKey, "🌍".repeat(600), now) }
        val engine = MeshEngine(a, { now }, { false }, { _, _ -> }, {}, { _, _ -> })
        rejects { engine.send(c.publicKey, "hello") }
    }
}
