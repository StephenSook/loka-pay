package org.loka.core

import org.junit.Assert.*
import org.junit.Test
import java.security.KeyPairGenerator

class CarryTest {
    private fun identity() = LabCrypto(KeyPairGenerator.getInstance("RSA").apply { initialize(3072) }.generateKeyPair())
    @Test fun `designated carrier survives restart and only destination decrypts after ten minutes`() {
        val a = identity(); val b = identity(); val c = identity(); val stranger = identity()
        var time = 1800000000000L
        var disk = emptyList<ByteArray>(); val writes = mutableListOf<ByteArray>(); val received = mutableListOf<String>()
        fun relay() = MeshEngine(b, { time }, { false }, { _, frame -> writes.add(frame) }, {}, { _, _ -> }, saveCarry = { disk = it })
        val packet = a.encrypt(c.publicKey, "carry across restart", time, b.deviceId)
        val bytes = PacketCodec.encode(packet)
        val destination = MeshEngine(c, { time }, { true }, { _, _ -> }, {}, { _, text -> received.add(text) })
        destination.receive("source", bytes); assertTrue(received.isEmpty())
        var otherDisk = emptyList<ByteArray>()
        MeshEngine(stranger, { time }, { true }, { _, _ -> fail("Wrong carrier forwarded") }, {}, { _, _ -> }, saveCarry = { otherDisk = it }).receive("source", bytes)
        assertTrue(otherDisk.isEmpty())
        relay().receive("source", bytes)
        assertEquals(1, disk.size)
        assertEquals(packet.expiresAt, PacketCodec.decode(disk.single()).expiresAt)
        assertFalse(LabCrypto.verify(packet.copy(carrier = stranger.deviceId)))
        assertFalse(LabCrypto.verify(packet.copy(expiresAt = packet.expiresAt + 1)))
        time += 600000
        val restarted = relay(); restarted.restoreCarry(disk); restarted.linkUp("destination")
        assertEquals(5, PacketCodec.decode(writes.single()).remainingHops)
        destination.receive("carrier", writes.single()); destination.receive("carrier", writes.single())
        assertEquals(listOf("carry across restart"), received)
        try { b.decrypt(packet); fail("Carrier decrypted") } catch (_: IllegalArgumentException) { }
        time = packet.expiresAt; writes.clear(); restarted.tick(); assertTrue(writes.isEmpty()); assertTrue(disk.isEmpty())
    }
    @Test fun `failed durable admission can retry and never forwards before commit`() {
        val a = identity(); val b = identity(); val c = identity()
        val now = 1800000000000L
        var failStorage = true; var commits = 0; var writes = 0
        val relay = MeshEngine(b, { now }, { false }, { _, _ -> assertTrue(commits > 0); writes++ }, {}, { _, _ -> },
            saveCarry = { if (failStorage) error("disk full") else commits++ })
        relay.linkUp("destination")
        val bytes = PacketCodec.encode(a.encrypt(c.publicKey, "retry", now, b.deviceId))
        relay.receive("source", bytes); assertEquals(0, writes)
        failStorage = false; relay.receive("source", bytes)
        assertEquals(1, writes); assertEquals(1, commits)
        relay.receive("source", bytes); assertEquals(1, commits)
    }
    @Test fun `v0 lifetime remains unchanged and malformed carry is rejected`() {
        val a = identity(); val b = identity(); val c = identity(); val now = 1800000000000L
        val legacy = a.encrypt(c.publicKey, "legacy", now)
        assertEquals(0, legacy.version)
        try { legacy.validate(now + 600000); fail("Legacy lifetime changed") } catch (_: IllegalArgumentException) { }
        val carry = a.encrypt(c.publicKey, "carry", now, b.deviceId)
        carry.validate(now + 600000)
        for (bad in listOf(carry.copy(carrier = c.deviceId), carry.copy(expiresAt = now + CARRY_LIFETIME_MS + 1), carry.copy(version = 3))) {
            try { bad.validate(now); fail("Invalid carry accepted") } catch (_: IllegalArgumentException) { }
        }
    }
}
