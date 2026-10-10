package org.loka.meshlab

import org.json.JSONObject
import org.junit.Assert.assertArrayEquals
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test
import org.loka.core.pay.AllowanceCertificate
import org.loka.core.pay.Base58
import org.loka.core.pay.Confirmation
import org.loka.core.pay.Deployment
import org.loka.core.pay.MerchantCertificate
import org.loka.core.pay.hexToBytes
import java.io.File

/**
 * The app-only glue of the pay screen that can run without a device: the BouncyCastle Ed25519
 * verifier against the shared vectors, and the pins compiled into BuildConfig. Keystore,
 * StrongBox and BiometricPrompt are device-only and are not exercised here.
 */
class PayConfigTest {
    private fun shared(property: String): File {
        val path = System.getProperty(property) ?: throw AssertionError("-D$property is not set (app/build.gradle.kts sets it)")
        return File(path).also { if (!it.isFile) throw AssertionError("missing $path") }
    }

    private val vectors by lazy { JSONObject(shared("loka.paymentVectors").readText()) }
    private fun list(key: String) = vectors.getJSONArray(key).let { a -> List(a.length()) { a.getJSONObject(it) } }
    private val constants get() = vectors.getJSONObject("constants")
    private val deployment get() = Deployment(hexToBytes(constants.getString("programIdHex")), 0, hexToBytes(constants.getString("mintHex")))
    private val serverKey get() = hexToBytes(vectors.getJSONObject("keys").getJSONObject("serverEd25519").getString("publicKeyHex"))

    @Test fun `the BouncyCastle verifier accepts every server-signed vector and refuses tampering`() {
        val bc = BouncyCastleEd25519Verifier
        var checked = 0
        for (c in list("confs")) { Confirmation.verify(hexToBytes(c.getString("wireHex")), serverKey, bc); checked++ }
        for (a in list("allowances")) { AllowanceCertificate.verify(hexToBytes(a.getString("wireHex")), deployment, serverKey, bc); checked++ }
        for (m in list("merchants")) { MerchantCertificate.verify(hexToBytes(m.getString("wireHex")), deployment, serverKey, bc); checked++ }
        assertTrue(checked >= 7)
        val conf = hexToBytes(list("confs")[0].getString("wireHex"))
        val body = conf.copyOf(139)
        val sig = conf.copyOfRange(139, 203)
        assertTrue(bc.verify(serverKey, body, sig))
        assertFalse(bc.verify(serverKey, body.copyOf().also { it[128] = 2 }, sig))
        assertFalse(bc.verify(serverKey, body, sig.copyOf().also { it[0] = (it[0].toInt() xor 1).toByte() }))
        assertFalse(bc.verify(serverKey.copyOf(31), body, sig))
        assertFalse(bc.verify(serverKey, body, sig.copyOf(63)))
    }

    @Test fun `BuildConfig pins match config pins json, and a missing server key is reported, not invented`() {
        val pins = JSONObject(shared("loka.pins").readText())
        assertEquals(pins.getString("cluster"), BuildConfig.PINS_CLUSTER)
        assertEquals(pins.getString("programId"), BuildConfig.PINS_PROGRAM_ID)
        assertEquals(pins.getString("mint"), BuildConfig.PINS_MINT)
        val status = PayConfig.status()
        if (pins.isNull("serverEd25519PublicKey")) {
            assertEquals("", BuildConfig.PINS_SERVER_ED25519)
            assertTrue(status is PayConfig.Status.ServerKeyNotPinned)
        } else {
            assertEquals(pins.getString("serverEd25519PublicKey"), BuildConfig.PINS_SERVER_ED25519)
            assertTrue(status is PayConfig.Status.Ready)
        }
        val deploymentOf = when (status) {
            is PayConfig.Status.Ready -> status.pins.deployment
            is PayConfig.Status.ServerKeyNotPinned -> status.pins.deployment
            is PayConfig.Status.Unavailable -> throw AssertionError(status.reason)
        }
        assertArrayEquals(Base58.decode(pins.getString("programId")), deploymentOf.programId)
    }

    @Test fun `pins status covers ready, not pinned and unreadable`() {
        val program = constants.getString("programIdBase58")
        val mint = constants.getString("mintBase58")
        val ready = PayConfig.status("devnet", program, mint, vectors.getJSONObject("keys").getJSONObject("serverEd25519").getString("publicKeyHex"))
        assertTrue(ready is PayConfig.Status.Ready)
        assertArrayEquals(serverKey, (ready as PayConfig.Status.Ready).serverPublicKey)
        assertTrue(PayConfig.status("devnet", program, mint, "") is PayConfig.Status.ServerKeyNotPinned)
        assertTrue(PayConfig.status("", "", "", "") is PayConfig.Status.Unavailable)
        assertTrue(PayConfig.status("devnet", program, "not base58!", "") is PayConfig.Status.Unavailable)
    }
}
