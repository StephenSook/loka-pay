package org.loka.meshlab

import androidx.test.ext.junit.runners.AndroidJUnit4
import org.junit.Assert.*
import org.junit.Test
import org.junit.runner.RunWith
import org.loka.core.LabCrypto
import org.loka.core.PacketCodec

/** Exercises the actual AndroidKeyStore provider, which desktop JVM tests cannot cover. */
@RunWith(AndroidJUnit4::class)
class KeystoreEnvelopeTest {
    @Test fun keystoreSignsAndDecryptsTheLabEnvelope() {
        val crypto = DeviceIdentity.load()
        val packet = crypto.encrypt(crypto.publicKey, "Keystore round trip 🌍", System.currentTimeMillis())
        val decoded = PacketCodec.decode(PacketCodec.encode(packet))
        decoded.validate(System.currentTimeMillis())
        assertTrue(LabCrypto.verify(decoded))
        assertEquals("Keystore round trip 🌍", crypto.decrypt(decoded))
        assertEquals(crypto.deviceId, DeviceIdentity.load().deviceId)
    }
}
