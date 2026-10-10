package org.loka.core

import org.junit.Assert.*
import org.junit.Test
import org.loka.core.transport.BleDiscovery

class BleDiscoveryTest {
    @Test fun `exactly one initiator for distinct tokens including unsigned bytes`() {
        val random = java.util.Random(12)
        repeat(1000) {
            val a = ByteArray(8).also(random::nextBytes)
            val b = ByteArray(8).also(random::nextBytes)
            if (!a.contentEquals(b)) assertNotEquals(BleDiscovery.initiates(a, b), BleDiscovery.initiates(b, a))
        }
        assertTrue(BleDiscovery.initiates(ByteArray(8), ByteArray(8) { 0xff.toByte() }))
    }
    @Test fun `legacy malformed and self advertisements do not initiate`() {
        val token = ByteArray(8) { 12 }
        assertFalse(BleDiscovery.initiates(token, token.clone()))
        for (size in listOf(0, 1, 7, 9, 32)) assertFalse(BleDiscovery.initiates(token, ByteArray(size)))
    }
    @Test fun `tokenless matching service has an initiator but malformed tokens remain rejected`() {
        assertTrue(BleDiscovery.initiates(ByteArray(8), null))
        assertFalse(BleDiscovery.initiates(ByteArray(7), null))
        assertFalse(BleDiscovery.initiates(ByteArray(8), ByteArray(0)))
    }

}
