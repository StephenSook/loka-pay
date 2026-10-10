package org.loka.core.pay

import org.junit.Assert.assertArrayEquals
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertThrows
import org.junit.Assert.assertTrue
import org.junit.Test

/** Every vector in protocol/vectors/payment-v1.json, byte for byte (the same file the Swift and JS ports test). */
class PaymentVectorTest {
    private val deployment = Vectors.deployment
    private val server = Vectors.serverKey
    private val ed = JcaEd25519Verifier
    private val note0 by lazy { SignedNote.validate(Vectors.list("notes")[0].bytes("wireHex"), deployment) }

    private fun expect(code: String, name: String = code, block: () -> Unit) {
        val e = assertThrows(name, PaymentException::class.java) { block() }
        assertEquals(name, code, e.error.code)
    }

    private fun transportPayload(text: String, kind: PaymentTransport.Kind): ByteArray {
        val decoded = PaymentTransport.decode(text) ?: throw AssertionError("not payment content: $text")
        assertEquals(kind, decoded.kind)
        return decoded.payload
    }

    @Test fun `constants match the spec values this port hardcodes`() {
        val c = Vectors.constants
        assertEquals(c.getString("p256OrderHex"), P256Rules.fixed32(P256Rules.ORDER).toHex())
        assertEquals(c.getString("p256HalfOrderHex"), P256Rules.fixed32(P256Rules.HALF_ORDER).toHex())
        val prefixes = c.getJSONObject("prefixes")
        assertEquals(prefixes.getString("note"), NoteV1.PREFIX)
        assertEquals(prefixes.getString("ack"), Ack.PREFIX)
        assertEquals(prefixes.getString("conf"), Confirmation.PREFIX)
        assertEquals(prefixes.getString("allow"), AllowanceCertificate.PREFIX)
        assertEquals(prefixes.getString("merch"), MerchantCertificate.PREFIX)
        val sizes = c.getJSONObject("sizes")
        assertEquals(sizes.getInt("NOTE_V1"), NoteV1.SIZE)
        assertEquals(sizes.getInt("noteWire"), SignedNote.WIRE_SIZE)
        assertEquals(sizes.getInt("ACK_V1"), Ack.SIZE)
        assertEquals(sizes.getInt("ackWire"), Ack.WIRE_SIZE)
        assertEquals(sizes.getInt("CONF_V1"), Confirmation.SIZE)
        assertEquals(sizes.getInt("confWire"), Confirmation.WIRE_SIZE)
        assertEquals(sizes.getInt("ALLOW_V1"), AllowanceCertificate.SIZE)
        assertEquals(c.getInt("mintDecimals"), Money.DECIMALS)
        val status = c.getJSONObject("confStatus")
        assertEquals(status.getInt("settled"), Confirmation.Status.SETTLED.code)
        assertEquals(status.getInt("failed_on_chain"), Confirmation.Status.FAILED_ON_CHAIN.code)
        assertEquals(status.getInt("refused_off_chain"), Confirmation.Status.REFUSED_OFF_CHAIN.code)
    }

    @Test fun `every valid note re-encodes byte-exact, validates and round-trips its transport`() {
        val notes = Vectors.list("notes")
        assertTrue(notes.size >= 4)
        for (n in notes) {
            val name = n.getString("name")
            val f = n.getJSONObject("fields")
            assertEquals(name, Vectors.constants.getString("programIdHex"), f.getString("programIdHex"))
            assertEquals(name, 0, f.getInt("clusterId"))
            assertArrayEquals(name, deployment.mint, Base58.decode(f.getString("mintBase58")))
            assertEquals(name, "USD", f.getString("currency"))
            val note = NoteV1.create(deployment, f.u64("allowanceId"), f.bytes("payeeKeyHashHex"), f.u64("amount"),
                f.getInt("serial"), f.i64("expiry"))
            assertArrayEquals(name, n.bytes("noteHex"), note.encode())
            assertEquals(name, 141, note.encode().size)
            assertArrayEquals(name, n.bytes("noteIdHex"), note.noteId)
            assertEquals(name, note, NoteV1.decode(n.bytes("noteHex")))

            val signed = SignedNote.validate(n.bytes("wireHex"), deployment)
            assertEquals(name, note, signed.note)
            assertArrayEquals(name, n.bytes("wireHex"), signed.wire)
            assertArrayEquals(name, n.bytes("signatureHex"), signed.signature)
            assertArrayEquals(name, n.bytes("payerPublicKeyHex"), signed.payerPublicKey)
            assertArrayEquals(name, n.bytes("noteIdHex"), signed.noteId)
            assertArrayEquals(name, Vectors.keyHash("payer"), signed.payerKeyHash)
            assertEquals(name, n.getString("transport"), PaymentTransport.encode(PaymentTransport.Kind.NOTE, signed.wire))
            assertArrayEquals(name, signed.wire, transportPayload(n.getString("transport"), PaymentTransport.Kind.NOTE))
        }
    }

    @Test fun `every invalid note fails with the spec's error name`() {
        val cases = Vectors.list("invalidNotes")
        assertTrue(cases.size >= 15)
        val seen = mutableSetOf<String>()
        for (c in cases) {
            val expected = c.getString("error")
            expect(expected, c.getString("name")) { SignedNote.validate(c.bytes("wireHex"), deployment) }
            seen += expected
        }
        // The vectors cover every section 6 error at least once.
        assertEquals(setOf("length", "prefix", "cluster", "currency", "amount_zero", "wrong_program", "wrong_mint",
            "bad_pubkey", "high_s", "bad_signature"), seen)
    }

    @Test fun `section 6 reports the first failure in table order`() {
        val n0 = Vectors.list("notes")[0]
        val good = n0.bytes("wireHex")
        val highS = n0.bytes("highSTwinSignatureHex")
        // Each fault breaks one check; with all applied, removing them in order walks the table.
        val faults: List<Pair<String, (ByteArray) -> ByteArray>> = listOf(
            "length" to { w -> w + byteArrayOf(0) },
            "prefix" to { w -> w.copyOf().also { it[15] = '2'.code.toByte() } },
            "cluster" to { w -> w.copyOf().also { it[48] = 2 } },
            "currency" to { w -> w.copyOf().also { "EUR".toByteArray().copyInto(it, 129) } },
            "amount_zero" to { w -> w.copyOf().also { ByteArray(8).copyInto(it, 121) } },
            "wrong_program" to { w -> w.copyOf().also { it[16] = (it[16].toInt() xor 1).toByte() } },
            "wrong_mint" to { w -> w.copyOf().also { it[49] = (it[49].toInt() xor 1).toByte() } },
            "bad_pubkey" to { w -> w.copyOf().also { it[205] = 4 } },
            "high_s" to { w -> w.copyOf().also { highS.copyInto(it, 141) } },
        )
        for (start in faults.indices) {
            var wire = good
            // Apply the length fault last so the other offsets still refer to the 238-byte layout.
            for (i in faults.indices.reversed()) if (i >= start) wire = faults[i].second(wire)
            expect(faults[start].first, "faults from ${faults[start].first}") { SignedNote.validate(wire, deployment) }
        }
        // With only the body changed after signing, the last check fails.
        expect("bad_signature") { SignedNote.validate(good.copyOf().also { it[140] = 1 }, deployment) }
        SignedNote.validate(good, deployment)
    }

    @Test fun `the ack vector builds, verifies and is bound to its note and payee`() {
        val acks = Vectors.list("acks")
        assertTrue(acks.isNotEmpty())
        for (a in acks) {
            val f = a.getJSONObject("fields")
            assertArrayEquals(note0.noteId, f.bytes("noteIdHex"))
            assertArrayEquals(a.bytes("ackHex"), Ack.body(note0.noteId, f.i64("receivedAt")))
            val ack = Ack.verify(a.bytes("wireHex"), note0)
            assertEquals(f.i64("receivedAt"), ack.receivedAt)
            assertArrayEquals(a.bytes("merchantPublicKeyHex"), ack.merchantPublicKey)
            assertArrayEquals(a.bytes("wireHex"), ack.wire)
            val built = Ack.build(note0, f.i64("receivedAt"), a.bytes("signatureHex"), a.bytes("merchantPublicKeyHex"))
            assertArrayEquals(a.bytes("wireHex"), built.wire)
            assertEquals(a.getString("transport"), PaymentTransport.encode(PaymentTransport.Kind.ACK, ack.wire))
            assertArrayEquals(ack.wire, transportPayload(a.getString("transport"), PaymentTransport.Kind.ACK))
        }
        val wire = acks[0].bytes("wireHex")
        val noteForB = SignedNote.validate(Vectors.list("notes")[2].bytes("wireHex"), deployment)
        expect("payee_mismatch") { Ack.verify(wire, noteForB) }
        expect("bad_signature") { Ack.verify(wire.copyOf().also { it[55] = (it[55].toInt() xor 1).toByte() }, note0) }
        expect("length") { Ack.verify(wire.copyOf(152), note0) }
    }

    @Test fun `confirmation vectors verify with the server key`() {
        val confs = Vectors.list("confs")
        assertTrue(confs.size >= 3)
        for (c in confs) {
            val f = c.getJSONObject("fields")
            val conf = Confirmation.verify(c.bytes("wireHex"), server, ed)
            assertArrayEquals(c.bytes("confHex"), c.bytes("wireHex").copyOf(Confirmation.SIZE))
            assertArrayEquals(f.bytes("noteIdHex"), conf.noteId)
            assertArrayEquals(f.bytes("txSignatureHex"), conf.txSignature)
            assertArrayEquals(f.bytes("txSignatureHex"), Base58.decode(f.getString("txSignatureBase58")))
            assertEquals(f.u64("slot"), conf.slot)
            assertEquals(f.i64("blockTime"), conf.blockTime)
            assertEquals(f.i64("uploadedAt"), conf.uploadedAt)
            assertEquals(f.getInt("statusCode"), conf.status.code)
            assertEquals(f.getInt("errorCode"), conf.errorCode)
            assertEquals(c.getString("transport"), PaymentTransport.encode(PaymentTransport.Kind.CONFIRMATION, c.bytes("wireHex")))
            assertArrayEquals(c.bytes("wireHex"), transportPayload(c.getString("transport"), PaymentTransport.Kind.CONFIRMATION))
        }
        val wire = confs[0].bytes("wireHex")
        expect("bad_signature") { Confirmation.verify(wire.copyOf().also { it[128] = 2 }, server, ed) }
        expect("bad_signature") { Confirmation.verify(wire, ByteArray(32), ed) }
        expect("length") { Confirmation.verify(wire + byteArrayOf(0), server, ed) }
    }

    @Test fun `earmark lists encode canonically and refuse duplicates or disorder`() {
        val lists = Vectors.list("earmarks")
        assertTrue(lists.size >= 3)
        for (e in lists) {
            val list = e.bytes("listHex")
            assertArrayEquals(e.bytes("hashHex"), Earmarks.hash(list))
            val hashes = Earmarks.decode(list)
            assertArrayEquals(list, Earmarks.encode(hashes.reversed()))
        }
        val a = Vectors.keyHash("merchantA")
        val b = Vectors.keyHash("merchantB")
        expect("earmark_list") { Earmarks.encode(listOf(a, a)) }
        expect("earmark_list") { Earmarks.decode(byteArrayOf(0, 2) + b + a) } // not sorted
        expect("earmark_list") { Earmarks.decode(byteArrayOf(0, 2) + a) } // short
    }

    @Test fun `allowance certificates verify, and swapped lists, keys or deployments are refused`() {
        val all = Vectors.list("allowances")
        assertTrue(all.size >= 2)
        for (a in all) {
            val f = a.getJSONObject("fields")
            val cert = AllowanceCertificate.verify(a.bytes("wireHex"), deployment, server, ed)
            assertArrayEquals(a.bytes("allowHex"), a.bytes("wireHex").copyOf(AllowanceCertificate.SIZE))
            assertEquals(f.u64("allowanceId"), cert.allowanceId)
            assertArrayEquals(f.bytes("payerKeyHashHex"), cert.payerKeyHash)
            assertArrayEquals(Vectors.keyHash("payer"), cert.payerKeyHash)
            assertEquals(f.u64("cap"), cert.cap)
            assertEquals(f.u64("offlineLimit"), cert.offlineLimit)
            assertEquals(f.i64("expiry"), cert.expiry)
            assertEquals(f.u64("bond"), cert.bond)
            assertArrayEquals(f.bytes("earmarkListHex"), Earmarks.encode(cert.earmarks))
            assertEquals(a.getString("transport"), PaymentTransport.encode(PaymentTransport.Kind.ALLOWANCE, a.bytes("wireHex")))
            assertArrayEquals(a.bytes("wireHex"), transportPayload(a.getString("transport"), PaymentTransport.Kind.ALLOWANCE))
        }
        val earmarked = AllowanceCertificate.verify(all[1].bytes("wireHex"), deployment, server, ed)
        assertTrue(earmarked.allows(Vectors.keyHash("merchantA")))
        assertFalse(earmarked.allows(Vectors.keyHash("merchantB")))
        assertTrue(AllowanceCertificate.verify(all[0].bytes("wireHex"), deployment, server, ed).allows(Vectors.keyHash("merchantB")))

        val wire = all[1].bytes("wireHex")
        // Same signed body, but the attached list replaced with an unrestricted one.
        expect("earmark_mismatch") { AllowanceCertificate.verify(wire.copyOf(185 + 64) + byteArrayOf(0, 0), deployment, server, ed) }
        expect("bad_signature") { AllowanceCertificate.verify(wire, deployment, Vectors.publicKey("merchantA").copyOfRange(1, 33), ed) }
        expect("bad_signature") { AllowanceCertificate.verify(wire.copyOf().also { it[130] = 9 }, deployment, server, ed) }
        val otherProgram = Deployment(ByteArray(32) { 7 }, 0, deployment.mint)
        expect("wrong_program") { AllowanceCertificate.verify(wire, otherProgram, server, ed) }
        expect("cluster") { AllowanceCertificate.verify(wire, Deployment(deployment.programId, 1, deployment.mint), server, ed) }
        expect("wrong_mint") { AllowanceCertificate.verify(wire, Deployment(deployment.programId, 0, ByteArray(32)), server, ed) }
        expect("length") { AllowanceCertificate.verify(wire.copyOf(185 + 64 + 1), deployment, server, ed) }
    }

    @Test fun `merchant certificates verify, including a UTF-8 name`() {
        val all = Vectors.list("merchants")
        assertTrue(all.size >= 2)
        for (m in all) {
            val f = m.getJSONObject("fields")
            val cert = MerchantCertificate.verify(m.bytes("wireHex"), deployment, server, ed)
            assertArrayEquals(m.bytes("merchHex"), m.bytes("wireHex").copyOf(m.bytes("wireHex").size - 64))
            assertEquals(f.getString("displayName"), cert.displayName)
            assertArrayEquals(f.bytes("merchantKeyHashHex"), cert.merchantKeyHash)
            assertEquals(m.getString("transport"), PaymentTransport.encode(PaymentTransport.Kind.MERCHANT, m.bytes("wireHex")))
            assertArrayEquals(m.bytes("wireHex"), transportPayload(m.getString("transport"), PaymentTransport.Kind.MERCHANT))
        }
        val wire = all[0].bytes("wireHex")
        expect("bad_signature") { MerchantCertificate.verify(wire.copyOf().also { it[120] = 'X'.code.toByte() }, deployment, server, ed) }
        expect("bad_signature") { MerchantCertificate.verify(wire, deployment, ByteArray(32) { 1 }, ed) }
        expect("wrong_program") { MerchantCertificate.verify(wire, Deployment(ByteArray(32), 0, deployment.mint), server, ed) }
    }

    @Test fun `marker and receipts rebuild byte for byte and take their status only from the CONF`() {
        val ack = Ack.verify(Vectors.list("acks")[0].bytes("wireHex"), note0)
        val marker = Vectors.list("markers")[0]
        assertArrayEquals(marker.bytes("wireHex"), Bundles.marker(note0, ack))
        assertArrayEquals(marker.bytes("wireHex"), transportPayload(marker.getString("transport"), PaymentTransport.Kind.MARKER))
        assertEquals(marker.getString("transport"), PaymentTransport.encode(PaymentTransport.Kind.MARKER, Bundles.marker(note0, ack)))

        val receipts = Vectors.list("receipts")
        val confs = Vectors.list("confs")
        val settled = receipts[0].bytes("wireHex")
        assertEquals(595, settled.size)
        assertArrayEquals(settled, Bundles.receipt(note0, ack, confs[0].bytes("wireHex")))
        assertArrayEquals(receipts[1].bytes("wireHex"), Bundles.receipt(note0, ack, null))
        for (r in receipts) {
            assertEquals(r.getString("transport"), PaymentTransport.encode(PaymentTransport.Kind.RECEIPT, r.bytes("wireHex")))
            assertArrayEquals(r.bytes("wireHex"), transportPayload(r.getString("transport"), PaymentTransport.Kind.RECEIPT))
            if (r.has("verifyUrlFragment")) assertEquals(r.getString("verifyUrlFragment"), "r=" + Base64Url.encode(r.bytes("wireHex")))
        }
        assertEquals(VerifiedReceipt.Status.SETTLED, VerifiedReceipt.verify(settled, deployment, server, ed).status)
        assertEquals(VerifiedReceipt.Status.PENDING, VerifiedReceipt.verify(receipts[1].bytes("wireHex"), deployment, server, ed).status)
        assertEquals(VerifiedReceipt.Status.FAILED_ON_CHAIN,
            VerifiedReceipt.verify(Bundles.receipt(note0, ack, confs[1].bytes("wireHex")), deployment, server, ed).status)
        assertEquals(VerifiedReceipt.Status.REFUSED_OFF_CHAIN,
            VerifiedReceipt.verify(Bundles.receipt(note0, ack, confs[2].bytes("wireHex")), deployment, server, ed).status)
        expect("receipt_flag") { VerifiedReceipt.verify(settled.copyOf().also { it[238 + 153] = 7 }, deployment, server, ed) }
        expect("length") { VerifiedReceipt.verify(settled.copyOf(594), deployment, server, ed) }
    }

    @Test fun `withdraw and refund vector signatures verify with the shared P-256 rules`() {
        val w = Vectors.list("withdraws")[0]
        P256Rules.verify(w.bytes("signatureHex"), w.bytes("withdrawHex"), w.bytes("merchantPublicKeyHex"))
        assertArrayEquals(w.getJSONObject("fields").bytes("destinationHex"), Base58.decode(w.getJSONObject("fields").getString("destinationBase58")))
        val r = Vectors.list("refunds")[0]
        P256Rules.verify(r.bytes("signatureHex"), r.bytes("refundHex"), r.bytes("merchantPublicKeyHex"))
        expect("bad_signature") { P256Rules.verify(r.bytes("signatureHex"), w.bytes("withdrawHex"), r.bytes("merchantPublicKeyHex")) }
    }

    @Test fun `every transport string decodes to its payload, other content is ignored, malformed payloads throw`() {
        var count = 0
        for (key in listOf("notes", "acks", "confs", "allowances", "merchants", "markers", "receipts")) {
            for (v in Vectors.list(key)) {
                val decoded = PaymentTransport.decode(v.getString("transport")) ?: throw AssertionError("$key not decoded")
                assertArrayEquals(v.bytes("wireHex"), decoded.payload)
                assertEquals(v.getString("transport"), PaymentTransport.encode(decoded.kind, decoded.payload))
                count++
            }
        }
        assertTrue(count >= 15)
        assertNull(PaymentTransport.decode("L1|T|abc|aGk"))
        assertNull(PaymentTransport.decode("L1|P|2|N|AAAA"))
        assertNull(PaymentTransport.decode("L1|P|1|Z|AAAA"))
        assertNull(PaymentTransport.decode("L1|P|1|NN|AAAA"))
        assertNull(PaymentTransport.decode("L1|P|1|N|AAAA|extra"))
        assertNull(PaymentTransport.decode("hello"))
        expect("base64url") { PaymentTransport.decode("L1|P|1|N|AAA=") }
        expect("base64url") { PaymentTransport.decode("L1|P|1|N|AA+/") }
        expect("base64url") { PaymentTransport.decode("L1|P|1|N|A") }
        expect("base64url") { PaymentTransport.decode("L1|P|1|N|AA AA") }
        // Non-canonical: "AB" has nonzero unused bits ("AA" is canonical for one zero byte).
        expect("base64url") { Base64Url.decode("AB") }
        assertArrayEquals(byteArrayOf(0), Base64Url.decode("AA"))
        assertArrayEquals(ByteArray(0), Base64Url.decode(""))
    }

    @Test fun `units match the vectors`() {
        val units = Vectors.list("units")
        assertTrue(units.size >= 5)
        for (u in units) {
            val base = u.u64("baseUnits")
            assertEquals(base, Money.parse(u.getString("display")))
            assertEquals(u.getString("display"), Money.display(base))
        }
        assertNull(Money.parse("1.0000001"))
        assertNull(Money.parse("-1"))
        assertNull(Money.parse(""))
        assertNull(Money.parse("1."))
        assertNull(Money.parse(".5"))
        assertNull(Money.parse("1,00"))
        assertNull(Money.parse("١")) // Arabic-Indic digit one: ASCII digits only
        assertNull(Money.parse("18446744073710"))
        assertEquals(18_446_744_073_709_551_615UL, Money.parse("18446744073709.551615"))
        assertEquals("0.000001", Money.display(1UL))
    }

    @Test fun `base58 decodes the vector addresses and signatures and round-trips`() {
        val c = Vectors.constants
        val pairs = mutableListOf(c.getString("programIdBase58") to c.getString("programIdHex"), c.getString("mintBase58") to c.getString("mintHex"))
        for (conf in Vectors.list("confs")) {
            val f = conf.getJSONObject("fields")
            pairs += f.getString("txSignatureBase58") to f.getString("txSignatureHex")
        }
        val wf = Vectors.list("withdraws")[0].getJSONObject("fields")
        pairs += wf.getString("destinationBase58") to wf.getString("destinationHex")
        for ((b58, hex) in pairs) {
            assertEquals(hex, Base58.decode(b58).toHex())
            assertEquals(b58, Base58.encode(hexToBytes(hex)))
        }
        expect("base58") { Base58.decode("0OIl") }
        expect("base58") { Base58.decode("") }
    }
}
