package org.loka.core

import org.junit.Assert.*
import org.junit.BeforeClass
import org.junit.Test
import org.loka.core.transport.*
import java.security.KeyPairGenerator

/** Contract integration: the production node is exercised using an injected local transport. */
class MeshNodeTest {
    companion object {
        private lateinit var identities: Map<String, LabCrypto>
        @BeforeClass @JvmStatic fun keys() {
            val generator = KeyPairGenerator.getInstance("RSA").apply { initialize(3072) }
            identities = listOf("A", "B", "C").associateWith { LabCrypto(generator.generateKeyPair()) }
        }
    }
    private class Network {
        val transports = mutableMapOf<String, TestTransport>()
        val frames = ArrayDeque<Triple<String, String, ByteArray>>()
        val writes = mutableListOf<Pair<String, String>>()
        val failedWrites = mutableSetOf<Pair<String, String>>()
        fun drain() {
            var steps = 0
            while (frames.isNotEmpty()) {
                check(++steps < 100) { "Unexpected relay loop" }
                val (source, destination, bytes) = frames.removeFirst()
                val receiver = transports.getValue(destination)
                if (receiver.running && source in receiver.links) receiver.listener.onFrame(source, bytes)
            }
        }
    }
    private class TestTransport(
        private val name: String,
        private val network: Network,
        val listener: TransportListener,
    ) : LokaTransport {
        override val capabilities = emptySet<TransportCapability>()
        var running = false
        val links = mutableSetOf<String>()
        override fun start() { running = true; listener.onRunning(true) }
        override fun refreshPeers() = Unit
        override fun connect(peer: String) {
            val other = network.transports.getValue(peer)
            check(running && other.running)
            if (links.add(peer)) listener.onLink(peer, true)
            if (other.links.add(name)) other.listener.onLink(name, true)
        }
        override fun send(peer: String, frame: ByteArray) {
            check(peer in links)
            check((name to peer) !in network.failedWrites) { "Simulated transport rejection" }
            network.writes.add(name to peer)
            network.frames.add(Triple(name, peer, frame.copyOf()))
        }
        override fun disconnect(peer: String) {
            if (links.remove(peer)) listener.onLink(peer, false)
            val other = network.transports.getValue(peer)
            if (other.links.remove(name)) other.listener.onLink(name, false)
        }
        override fun stop() {
            links.toList().forEach(::disconnect)
            running = false; listener.onRunning(false)
        }
    }
    private class Lab {
        val network = Network()
        val delivered = mutableListOf<Pair<String, String>>()
        val running = mutableMapOf<String, Boolean>()
        val links = mutableMapOf<String, MutableSet<String>>()
        val diagnostics = mutableMapOf<String, MutableList<String>>()
        val nodes = identities.mapValues { (name, crypto) ->
            MeshNode(crypto, TransportFactory { listener ->
                TestTransport(name, network, listener).also { network.transports[name] = it }
            }, trusted = { id -> id in listOf(identities.getValue("A").deviceId, identities.getValue("C").deviceId) },
                listener = object : TransportListener {
                    override fun onPeer(peer: TransportPeer) = Unit
                    override fun onLink(peer: String, connected: Boolean) {
                        val neighbors = links.getOrPut(name) { mutableSetOf() }
                        if (connected) neighbors.add(peer) else neighbors.remove(peer)
                    }
                    override fun onFrame(peer: String, frame: ByteArray) { fail("Raw frames must stay inside the mesh node") }
                    override fun onRunning(value: Boolean) { running[name] = value }
                    override fun onDiagnostic(text: String) { diagnostics.getOrPut(name) { mutableListOf() }.add(text) }
                }, message = { _, text -> delivered.add(name to text) }, clock = { 1_800_000_000_000L })
        }
        init { nodes.values.forEach(MeshNode::start) }
    }
    @Test fun `injected transport carries bidirectional three-node encrypted relay`() {
        val lab = Lab()
        lab.nodes.getValue("A").connect("B")
        lab.nodes.getValue("B").connect("C")
        lab.nodes.getValue("A").send(identities.getValue("C").publicKey, "Hello C")
        lab.network.drain()
        lab.nodes.getValue("C").send(identities.getValue("A").publicKey, "Hello A")
        lab.network.drain()
        assertEquals(listOf("C" to "Hello C", "A" to "Hello A"), lab.delivered)
        assertFalse(lab.network.writes.any { it == ("A" to "C") || it == ("C" to "A") })
        assertTrue(lab.diagnostics.getValue("B").any { it.startsWith("Relay") })
        assertFalse(lab.diagnostics.getValue("B").any { it.contains("Hello") })
        assertTrue(lab.nodes.getValue("A").capabilities.isEmpty()) // No discovery or pairing required by messaging.
    }
    @Test fun `stopped relay links disappear and queued ciphertext resumes on reconnect`() {
        val lab = Lab()
        lab.nodes.getValue("A").connect("B")
        lab.nodes.getValue("B").connect("C")
        lab.nodes.getValue("B").stop()
        assertEquals(false, lab.running["B"])
        assertTrue(lab.links.values.all { it.isEmpty() })
        lab.nodes.getValue("A").send(identities.getValue("C").publicKey, "During partition")
        lab.network.drain()
        assertTrue(lab.delivered.isEmpty())
        lab.nodes.getValue("B").start()
        lab.nodes.getValue("A").connect("B")
        lab.network.drain() // B retains ciphertext until a C link exists.
        assertTrue(lab.delivered.isEmpty())
        lab.nodes.getValue("B").connect("C")
        lab.network.drain()
        assertEquals(listOf("C" to "During partition"), lab.delivered)
    }
    @Test fun `rejected queued write does not suppress link state and replays on reconnect`() {
        val lab = Lab()
        lab.nodes.getValue("A").send(identities.getValue("C").publicKey, "Awaiting approval")
        lab.network.failedWrites.add("A" to "C")
        lab.nodes.getValue("A").connect("C")
        assertTrue("C" in lab.links.getValue("A"))
        lab.network.drain()
        assertTrue(lab.delivered.isEmpty())
        assertTrue(lab.diagnostics.getValue("A").any { it.contains("remains queued") })
        lab.network.failedWrites.clear()
        lab.nodes.getValue("A").disconnect("C")
        lab.nodes.getValue("A").connect("C")
        lab.network.drain()
        assertEquals(listOf("C" to "Awaiting approval"), lab.delivered)
    }
    @Test fun `one rejected link does not interrupt another viable encrypted route`() {
        val lab = Lab()
        lab.nodes.getValue("A").connect("C")
        lab.nodes.getValue("A").connect("B")
        lab.nodes.getValue("B").connect("C")
        lab.network.failedWrites.add("A" to "C")
        val id = lab.nodes.getValue("A").send(identities.getValue("C").publicKey, "Use another link")
        assertTrue(id.isNotBlank())
        lab.network.drain()
        assertEquals(listOf("C" to "Use another link"), lab.delivered)
    }
    @Test fun `destination receipts traverse an untrusted relay and recover after lost return writes`() {
        val network = Network()
        var clock = 1_800_000_000_000L
        val saved = mutableMapOf<String, MutableSet<String>>()
        val confirmed = mutableSetOf<String>()
        val expected = mutableMapOf<String, Pair<String, String>>()
        val receiptFor = mutableSetOf<Pair<String, String>>()
        val observedFrames = mutableListOf<Packet>()
        lateinit var nodes: Map<String, MeshNode>
        nodes = identities.mapValues { (name, crypto) ->
            MeshNode(crypto, TransportFactory { listener ->
                TestTransport(name, network, listener).also { network.transports[name] = it }
            }, trusted = { id ->
                // Relay B has no contacts. Only A and C trust each other.
                name != "B" && id == identities.getValue(if (name == "A") "C" else "A").deviceId
            }, listener = object : TransportListener {
                override fun onPeer(peer: TransportPeer) = Unit
                override fun onLink(peer: String, connected: Boolean) = Unit
                override fun onFrame(peer: String, frame: ByteArray) = fail("Raw frame leaked")
                override fun onRunning(running: Boolean) = Unit
                override fun onDiagnostic(text: String) = Unit
            }, message = { _, _ -> fail("Typed packet callback required") }, clock = { clock },
                packetMessage = { packet, text ->
                    assertNotEquals("B", name)
                    observedFrames.add(packet)
                    val content = checkNotNull(ChatContent.decode(text))
                    if (content.kind == "A") {
                        val original = expected[content.id]
                        if (original != null && original.first == name &&
                            content.acknowledges(content.id, original.second, packet.source)) {
                            confirmed.add(content.id)
                        }
                    } else {
                        assertEquals("T", content.kind)
                        saved.getOrPut(name) { mutableSetOf() }.add(content.id)
                        if (receiptFor.add(name to content.id))
                            nodes.getValue(name).send(packet.senderPublicKey, ChatContent("A", content.id).encode())
                    }
                })
        }
        nodes.values.forEach(MeshNode::start)
        nodes.getValue("A").connect("B"); nodes.getValue("B").connect("C")
        fun send(source: String, destination: String): String {
            val id = java.util.UUID.randomUUID().toString()
            expected[id] = source to identities.getValue(destination).deviceId
            nodes.getValue(source).send(identities.getValue(destination).publicKey,
                ChatContent("T", id, "Non-sensitive relay fixture".toByteArray()).encode())
            return id
        }
        // Delivery succeeds but the returning receipt cannot cross B→A initially.
        network.failedWrites.add("B" to "A")
        val first = send("A", "C"); network.drain()
        assertEquals(setOf(first), saved["C"])
        assertFalse(first in confirmed)
        assertNull(saved["B"])
        // A relay's own signed claim must not establish destination delivery.
        val fake = identities.getValue("B").encrypt(identities.getValue("A").publicKey,
            ChatContent("A", first).encode(), clock)
        network.transports.getValue("A").listener.onFrame("B", PacketCodec.encode(fake))
        assertFalse(first in confirmed)
        network.failedWrites.clear()
        clock += 15_001
        nodes.values.forEach(MeshNode::tick); network.drain()
        assertTrue(first in confirmed)
        assertEquals(1, saved.getValue("C").size)
        val second = send("C", "A"); network.drain()
        assertEquals(setOf(first, second), confirmed)
        assertEquals(setOf(second), saved["A"])
        assertFalse(network.writes.any { it == ("A" to "C") || it == ("C" to "A") })
        assertTrue(observedFrames.all { it.remainingHops == MAX_HOPS - 1 && LabCrypto.verify(it) })
        observedFrames.forEach { packet ->
            assertTrue("Relay must not decrypt destination text or receipts",
                runCatching { identities.getValue("B").decrypt(packet) }.isFailure)
        }
        // Relay-off negative control: fresh traffic cannot bypass B.
        nodes.getValue("B").relayEnabled = false
        val blocked = send("A", "C"); network.drain()
        assertFalse(blocked in saved.getValue("C")); assertFalse(blocked in confirmed)
    }

}
