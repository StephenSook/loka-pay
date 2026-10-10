package org.loka.core

import org.junit.Assert.*
import org.junit.Test
import java.security.KeyPairGenerator

class LocalLinkPolicyTest {
    @Test fun `probe reply skips queued payload without replacing in flight fragment`() {
        val sent = byteArrayOf(1); val next = byteArrayOf(2); val probe = byteArrayOf(127)
        val queue = java.util.ArrayDeque<ByteArray>().apply { add(sent); add(next) }
        org.loka.core.transport.BleFraming.prioritizeControl(queue, probe, true)
        assertArrayEquals(sent, queue.poll()) // completion still removes the actual in-flight item
        assertArrayEquals(probe, queue.poll())
        assertArrayEquals(next, queue.poll())
        queue.add(next)
        org.loka.core.transport.BleFraming.prioritizeControl(queue, probe, false)
        assertArrayEquals(probe, queue.poll()); assertArrayEquals(next, queue.poll())
    }
    @Test fun `automatic admission survives handle changes but respects manual control and blocks`() {
        assertTrue(LocalLinkPolicy.permits("ble:new-address", true, emptySet(), emptySet()))
        assertFalse(LocalLinkPolicy.permits("ble:new-address", false, setOf("ble:old-address"), emptySet()))
        assertFalse(LocalLinkPolicy.permits("ble:blocked", true, setOf("ble:blocked"), setOf("ble:blocked")))
        assertFalse(LocalLinkPolicy.permits("classic:unknown", true, emptySet(), emptySet()))
    }
    @Test fun `local wifi and aware admission obey the same opt out and block rules`() {
        for (peer in listOf("wifi:session", "aware:out:session")) {
            assertTrue(LocalLinkPolicy.permits(peer, true, emptySet(), emptySet()))
            assertFalse(LocalLinkPolicy.permits(peer, false, emptySet(), emptySet()))
            assertFalse(LocalLinkPolicy.permits(peer, true, setOf(peer), setOf(peer)))
        }
        assertFalse(LocalLinkPolicy.permits("internet:host", true, emptySet(), emptySet()))
    }
    @Test fun `automatic next hop never authorizes an unknown sender to deliver plaintext`() {
        val generator = KeyPairGenerator.getInstance("RSA").apply { initialize(3072) }
        val recipient = LabCrypto(generator.generateKeyPair())
        val stranger = LabCrypto(generator.generateKeyPair())
        val received = mutableListOf<String>()
        val now = 1_800_000_000_000L
        val mesh = MeshEngine(recipient, { now }, { false }, { _, _ -> }, {}, { _, text -> received.add(text) })
        val link = "ble:untrusted-route"
        assertTrue(LocalLinkPolicy.permits(link, true, emptySet(), emptySet()))
        mesh.linkUp(link)
        mesh.receive(link, PacketCodec.encode(stranger.encrypt(recipient.publicKey, "Uninvited", now)))
        assertTrue(received.isEmpty())
    }
    @Test fun `ingress has bounded burst and refills with elapsed time`() {
        var now = 0L
        val budget = LinkIngressBudget { now }
        repeat(8) { assertTrue(budget.take()) }
        assertFalse(budget.take())
        now = 249; assertFalse(budget.take())
        now = 250; assertTrue(budget.take()); assertFalse(budget.take())
        now = 100_000; repeat(8) { assertTrue(budget.take()) }; assertFalse(budget.take())
    }
}
