package org.loka.core.pay

import org.json.JSONObject
import org.junit.Assert.assertArrayEquals
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
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
        val store = SerialReservations(file, JvmDirectorySync)
        assertFalse(store.isInitialized())
        store.initialize()
        assertTrue(store.isInitialized())
        assertEquals("loka-pay-serials-v1\n", file.readText())
        assertEquals(0, store.reserve(42UL))
        assertEquals(1, store.reserve(42UL))
        val reopened = SerialReservations(file, JvmDirectorySync)
        reopened.initialize() // an existing store is only checked: no reset
        assertEquals(2, reopened.reserve(42UL))
        assertEquals(0, reopened.reserve(43UL))
        assertEquals(0, reopened.reserve(ULong.MAX_VALUE))
        for (expected in 3..255) assertEquals(expected, reopened.reserve(42UL))
        assertEquals(0, reopened.remaining(42UL))
        assertEquals(255, reopened.remaining(43UL))
        expect("serials_exhausted") { reopened.reserve(42UL) }
        expect("serials_exhausted") { SerialReservations(file, JvmDirectorySync).reserve(42UL) }
        assertEquals("loka-pay-serials-v1\n42 256\n43 1\n18446744073709551615 1\n", file.readText())
        assertEquals(listOf("serials.txt"), File(temp.root, "pay").list()!!.toList())
    }

    @Test fun `a missing store is never read as empty, so a vanished file cannot hand out serial 0 again`() {
        val file = File(temp.root, "pay/serials.txt")
        val store = SerialReservations(file, JvmDirectorySync)
        expect("storage") { store.reserve(42UL) } // never initialised
        expect("storage") { store.remaining(42UL) }
        assertFalse(File(temp.root, "pay").exists()) // a reservation does not create the store
        store.initialize()
        assertEquals(0, store.reserve(42UL))
        assertTrue(file.delete()) // the file vanishes after a signed reservation
        expect("storage") { store.reserve(42UL) }
        expect("storage") { SerialReservations(file, JvmDirectorySync).reserve(42UL) }
        expect("storage") { store.remaining(42UL) }
        assertFalse(file.exists())
    }

    /** Records each directory sync with the store's contents at that moment. */
    private class RecordingSync(private val file: File) : DirectorySync {
        val calls = mutableListOf<Pair<File, String?>>()
        var failNext = false
        override fun sync(directory: File) {
            calls += directory to (if (file.isFile) file.readText() else null)
            if (failNext) { failNext = false; throw java.io.IOException("fsync refused (test)") }
        }
    }

    @Test fun `every reservation syncs the directory after the rename, and initialisation syncs the folder and its parent`() {
        val file = File(temp.root, "pay/serials.txt")
        val sync = RecordingSync(file)
        val store = SerialReservations(file, sync)
        store.initialize()
        val dir = File(temp.root, "pay").canonicalFile
        assertEquals(listOf(dir to "loka-pay-serials-v1\n", temp.root.canonicalFile to "loka-pay-serials-v1\n"), sync.calls)
        sync.calls.clear()
        assertEquals(0, store.reserve(9UL))
        // One directory sync, after the renamed file already holds the advanced counter.
        assertEquals(listOf(dir to "loka-pay-serials-v1\n9 1\n"), sync.calls)
        assertEquals(1, store.reserve(9UL))
        assertEquals(dir to "loka-pay-serials-v1\n9 2\n", sync.calls.last())
        assertEquals(2, sync.calls.size)
    }

    @Test fun `a failed directory sync refuses to return the serial, and that serial is never reused`() {
        val file = File(temp.root, "pay/serials.txt")
        val sync = RecordingSync(file)
        val store = SerialReservations(file, sync)
        store.initialize()
        sync.failNext = true
        expect("storage") { store.reserve(5UL) } // serial 0 is not returned
        assertEquals(1, store.reserve(5UL)) // and it is burned, not handed out later
        // Initialising an existing store only checks it: no write, so no sync.
        val before = sync.calls.size
        store.initialize()
        assertEquals(before, sync.calls.size)
    }

    @Test fun `initialising over a damaged store checks it and never replaces it`() {
        val file = File(temp.root, "serials.txt")
        file.writeText("loka-pay-serials-v1\n42 257\n")
        expect("storage") { SerialReservations(file, JvmDirectorySync).initialize() }
        assertEquals("loka-pay-serials-v1\n42 257\n", file.readText())
    }

    @Test fun `a damaged serial file fails closed and is never reset`() {
        val file = File(temp.root, "serials.txt")
        for (bad in listOf("not a table", "loka-pay-serials-v1\n42 257\n", "loka-pay-serials-v1\n42 1\n42 2\n",
            "loka-pay-serials-v1\n042 1\n", "loka-pay-serials-v1\n42 1", "loka-pay-serials-v1\n-1 1\n",
            "loka-pay-serials-v1\n18446744073709551616 1\n", "")) {
            file.writeText(bad)
            expect("storage") { SerialReservations(file, JvmDirectorySync).reserve(42UL) }
            assertEquals(bad, file.readText())
        }
    }

    @Test fun `a signed payment snapshot carries its own merchant and refuses a different one`() {
        val n0 = SignedNote.validate(Vectors.list("notes")[0].bytes("wireHex"), deployment) // pays merchant A
        val payment = SignedPayment(n0, merchant(0))
        assertEquals("Campus Coffee Cart", payment.merchantName)
        assertArrayEquals(n0.note.payeeKeyHash, payment.merchantKeyHash)
        assertEquals(Vectors.list("notes")[0].getString("transport"), payment.transport)
        expect("payee_mismatch") { SignedPayment(n0, merchant(1)) } // merchant B's certificate cannot label it
    }

    @Test fun `transport length limits are the largest valid payloads, and every vector fits`() {
        assertEquals(1027, PaymentTransport.maxTextLength(PaymentTransport.Kind.ALLOWANCE)) // 763 bytes
        assertEquals(333, PaymentTransport.maxTextLength(PaymentTransport.Kind.MERCHANT)) // 243 bytes
        for (kind in PaymentTransport.Kind.entries) {
            val max = PaymentTransport.maxPayloadBytes(kind)
            assertEquals(kind.name, PaymentTransport.maxTextLength(kind), PaymentTransport.encode(kind, ByteArray(max)).length)
        }
        val byKind = mapOf("notes" to PaymentTransport.Kind.NOTE, "acks" to PaymentTransport.Kind.ACK,
            "confs" to PaymentTransport.Kind.CONFIRMATION, "allowances" to PaymentTransport.Kind.ALLOWANCE,
            "merchants" to PaymentTransport.Kind.MERCHANT, "markers" to PaymentTransport.Kind.MARKER,
            "receipts" to PaymentTransport.Kind.RECEIPT)
        for ((key, kind) in byKind) for (v in Vectors.list(key)) {
            assertTrue(key, v.getString("transport").length <= PaymentTransport.maxTextLength(kind))
        }
        // A maximal allowance: 16 earmarks.
        val maxList = Earmarks.encode(List(16) { i -> ByteArray(32) { i.toByte() } })
        assertEquals(PaymentTransport.maxPayloadBytes(PaymentTransport.Kind.ALLOWANCE), AllowanceCertificate.SIZE + 64 + maxList.size)
    }

    @Test fun `concurrent reservations on one file never hand out a serial twice`() {
        val file = File(temp.root, "serials.txt")
        SerialReservations(file, JvmDirectorySync).initialize()
        val seen = Collections.synchronizedList(mutableListOf<Int>())
        val exhausted = Collections.synchronizedList(mutableListOf<Int>())
        val start = CountDownLatch(1)
        val threads = List(8) {
            thread {
                val store = SerialReservations(file, JvmDirectorySync) // separate instances share one lock per file
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
