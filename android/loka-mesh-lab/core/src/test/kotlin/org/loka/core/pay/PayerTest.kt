package org.loka.core.pay

import org.json.JSONObject
import org.junit.Assert.assertArrayEquals
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertThrows
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test
import org.junit.rules.TemporaryFolder
import java.io.File
import java.util.Collections
import java.util.concurrent.CountDownLatch
import kotlin.concurrent.thread

/** Pins, the payer-side refusals before signing, and the durable serial store. */
class PayerTest {
    @get:Rule val temp = TemporaryFolder()

    private val deployment = Vectors.deployment
    private val ed = JcaEd25519Verifier

    private fun expect(code: String, block: () -> Unit) {
        val e = assertThrows(code, PaymentException::class.java) { block() }
        assertEquals(code, e.error.code)
    }

    private fun allowance(i: Int) = AllowanceCertificate.verify(Vectors.list("allowances")[i].bytes("wireHex"), deployment, Vectors.serverKey, ed)
    private fun merchant(i: Int) = MerchantCertificate.verify(Vectors.list("merchants")[i].bytes("wireHex"), deployment, Vectors.serverKey, ed)

    @Test fun `pins parse the vector deployment and both server key spellings`() {
        val c = Vectors.constants
        val hexKey = Vectors.keys.getJSONObject("serverEd25519").getString("publicKeyHex")
        val pins = Pins.parse("devnet", c.getString("programIdBase58"), c.getString("mintBase58"), hexKey)
        assertArrayEquals(deployment.programId, pins.deployment.programId)
        assertArrayEquals(deployment.mint, pins.deployment.mint)
        assertEquals(0, pins.deployment.clusterId)
        assertArrayEquals(Vectors.serverKey, pins.serverPublicKey)
        val b58 = Pins.parse("devnet", c.getString("programIdBase58"), c.getString("mintBase58"), Base58.encode(Vectors.serverKey))
        assertArrayEquals(Vectors.serverKey, b58.serverPublicKey)
        assertNull(Pins.parse("devnet", c.getString("programIdBase58"), c.getString("mintBase58"), null).serverPublicKey)
        assertNull(Pins.parse("devnet", c.getString("programIdBase58"), c.getString("mintBase58"), "").serverPublicKey)
        assertEquals(1, Pins.parse("mainnet", c.getString("programIdBase58"), c.getString("mintBase58"), null).deployment.clusterId)
        assertThrows(IllegalArgumentException::class.java) { Pins.parse("testnet", c.getString("programIdBase58"), c.getString("mintBase58"), null) }
        assertThrows(IllegalArgumentException::class.java) { Pins.parse("devnet", "not-base58!", c.getString("mintBase58"), null) }
        assertThrows(IllegalArgumentException::class.java) { Pins.parse("devnet", c.getString("programIdBase58"), "1111", null) }
        assertThrows(IllegalArgumentException::class.java) { Pins.parse("devnet", c.getString("programIdBase58"), c.getString("mintBase58"), "abcd") }
    }

    @Test fun `the repository's config pins parse, and a null server key stays not published`() {
        val pinsFile = Vectors.sharedFile("loka.pins", "config/pins.json")
        val json = JSONObject(pinsFile.readText(Charsets.UTF_8))
        val serverField = if (json.isNull("serverEd25519PublicKey")) null else json.getString("serverEd25519PublicKey")
        val pins = Pins.parse(json.getString("cluster"), json.getString("programId"), json.getString("mint"), serverField)
        assertEquals(32, pins.deployment.programId.size)
        if (serverField == null) assertNull(pins.serverPublicKey) else assertEquals(32, pins.serverPublicKey!!.size)
    }

    @Test fun `the payer's note for a one dollar payment equals the vector note`() {
        val n0 = Vectors.list("notes")[0]
        val note = PayerChecks.noteFor(deployment, allowance(0), merchant(0), Vectors.keyHash("payer"),
            amount = 1_000_000UL, serial = 0, now = 1_791_590_400)
        assertArrayEquals(n0.bytes("noteHex"), note.encode())
        assertEquals(allowance(0).expiry, note.expiry)
    }

    @Test fun `the payer refuses what a merchant or the program would refuse`() {
        val payer = Vectors.keyHash("payer")
        val now = 1_791_590_400L
        expect("amount_zero") { PayerChecks.check(allowance(0), merchant(0), payer, 0UL, now) }
        expect("payer_mismatch") { PayerChecks.check(allowance(0), merchant(0), Vectors.keyHash("merchantA"), 1UL, now) }
        // remittance_earmarked_merchant_a cannot pay merchant B.
        expect("not_earmarked") { PayerChecks.check(allowance(1), merchant(1), payer, 1UL, now) }
        PayerChecks.check(allowance(1), merchant(0), payer, 1UL, now)
        expect("expired") { PayerChecks.check(allowance(0), merchant(0), payer, 1UL, allowance(0).expiry + 1) }
        PayerChecks.check(allowance(0), merchant(0), payer, 1UL, allowance(0).expiry)
        // five_dollars_unrestricted: cap 5.00, offline limit 3.00.
        expect("over_cap") { PayerChecks.check(allowance(0), merchant(0), payer, 5_000_001UL, now) }
        expect("offline_limit") { PayerChecks.check(allowance(0), merchant(0), payer, 3_000_001UL, now) }
        PayerChecks.check(allowance(0), merchant(0), payer, 3_000_000UL, now)
    }

    @Test fun `serials persist across instances, are per allowance, and stop at 256`() {
        val file = File(temp.root, "pay/serials.txt")
        val store = SerialReservations(file)
        assertEquals(0, store.reserve(42UL))
        assertEquals(1, store.reserve(42UL))
        val reopened = SerialReservations(file)
        assertEquals(2, reopened.reserve(42UL))
        assertEquals(0, reopened.reserve(43UL))
        assertEquals(0, reopened.reserve(ULong.MAX_VALUE))
        for (expected in 3..255) assertEquals(expected, reopened.reserve(42UL))
        assertEquals(0, reopened.remaining(42UL))
        assertEquals(255, reopened.remaining(43UL))
        expect("serials_exhausted") { reopened.reserve(42UL) }
        expect("serials_exhausted") { SerialReservations(file).reserve(42UL) }
        assertEquals("loka-pay-serials-v1\n42 256\n43 1\n18446744073709551615 1\n", file.readText())
        assertTrue(File(temp.root, "pay").list()!!.toList() == listOf("serials.txt"))
    }

    @Test fun `a damaged serial file fails closed and is never reset`() {
        val file = File(temp.root, "serials.txt")
        for (bad in listOf("not a table", "loka-pay-serials-v1\n42 257\n", "loka-pay-serials-v1\n42 1\n42 2\n",
            "loka-pay-serials-v1\n042 1\n", "loka-pay-serials-v1\n42 1", "loka-pay-serials-v1\n-1 1\n",
            "loka-pay-serials-v1\n18446744073709551616 1\n", "")) {
            file.writeText(bad)
            expect("storage") { SerialReservations(file).reserve(42UL) }
            assertEquals(bad, file.readText())
        }
    }

    @Test fun `concurrent reservations on one file never hand out a serial twice`() {
        val file = File(temp.root, "serials.txt")
        val seen = Collections.synchronizedList(mutableListOf<Int>())
        val exhausted = Collections.synchronizedList(mutableListOf<Int>())
        val start = CountDownLatch(1)
        val threads = List(8) {
            thread {
                val store = SerialReservations(file) // separate instances share one lock per file
                start.await()
                repeat(40) {
                    try { seen += store.reserve(7UL) } catch (e: PaymentException) {
                        assertEquals(PaymentError.SERIALS_EXHAUSTED, e.error); exhausted += 1
                    }
                }
            }
        }
        start.countDown()
        threads.forEach { it.join() }
        assertEquals((0..255).toList(), seen.sorted())
        assertEquals(8 * 40 - 256, exhausted.size)
    }
}
