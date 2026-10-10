package org.loka.core

import org.junit.Assert.*
import org.junit.Test
import java.util.UUID
import java.security.KeyPairGenerator

class ChatContentTest {
    private fun assertFails(block: () -> Unit) { try { block(); fail("Expected rejection") } catch (_: Exception) {} }
    private val id = "11111111-1111-4111-8111-111111111111"
    @Test fun readReceiptsUseCanonicalBoundedTimestamps() {
        val receipt = ChatContent("B", id, "100".toByteArray())
        assertEquals("L1|B|$id|100", receipt.encode())
        assertEquals("100", ChatContent.utf8(ChatContent.decode(receipt.encode())!!.data))
        listOf("", "-1", "001", "9223372036854775808", "100|extra").forEach { assertFails { ChatContent.decode("L1|B|$id|$it") } }
    }
    @Test fun hopReportsAndReactionsAreBoundedAndOrdered() {
        assertEquals(2, ChatContent.decode("L1|H|$id|2")!!.index)
        listOf("0", "8", "02", "-1").forEach { n -> assertFails { ChatContent.decode("L1|H|$id|$n") } }
        val reaction = ChatContent("R", id, "$id|❤️".toByteArray())
        assertArrayEquals(reaction.data, ChatContent.decode(reaction.encode())!!.data)
        assertFails { ChatContent("R", id, "$id|unbounded arbitrary text".toByteArray()).encode() }
        assertFails { ChatContent("R", id, "bad|👍".toByteArray()).encode() }
        val previous = "100|$id|👍"; val removed = "101|$id|"
        assertTrue(ChatContent.newerReaction(previous, removed))
        assertFalse(ChatContent.newerReaction(removed, previous))
        assertFalse(ChatContent.newerReaction(previous, previous))
        assertEquals("", ChatContent.reactionEmoji(removed))
    }
    @Test fun imagesAreBoundedAndSeparateFromVoiceWithSameLogicalId() {
        val jpeg = javaClass.getResourceAsStream("/image-test.jpg")!!.use { it.readBytes() }
        assertTrue(ChatContent.validImage(jpeg))
        assertFalse(ChatContent.validImage(jpeg.copyOf(jpeg.size - 1)))
        assertFalse(ChatContent.validImage(ByteArray(65537)))
        val bomb = jpeg.copyOf()
        val sof = (0 until bomb.size - 1).first { bomb[it] == 0xff.toByte() && bomb[it + 1] == 0xc0.toByte() }
        bomb[sof + 5] = 0x7f; bomb[sof + 6] = 0xff.toByte()
        assertFalse(ChatContent.validImage(bomb))
        val assembly = VoiceAssembly()
        val image = ChatContent.image(id, jpeg)
        assertTrue(image.size > 1)
        val voice = ChatContent.voice(id, ByteArray(2048))
        assertNull(assembly.accept("friend", voice[0], 100, 0))
        var result: ByteArray? = null
        image.reversed().forEach { result = assembly.accept("friend", ChatContent.decode(it.encode())!!, 100, 0) }
        assertArrayEquals(jpeg, result)
        assertArrayEquals(ByteArray(2048), assembly.accept("friend", voice[1], 100, 0))
        assertFails { ChatContent.decode("L1|I|$id|0|65|YQ==") }
    }
    @Test fun receiptCannotConfirmAnotherRecipientOrMessage() {
        val receipt = ChatContent.decode("L1|A|$id")!!
        assertTrue(receipt.acknowledges(id, "bob", "bob"))
        assertFalse(receipt.acknowledges(id, "bob", "mallory"))
        assertFalse(receipt.acknowledges(UUID.randomUUID().toString(), "bob", "bob"))
        assertFalse(ChatContent("T", id, "hi".toByteArray()).acknowledges(id, "bob", "bob"))
    }
    @Test fun canonicalTextAndVoiceBounds() {
        val text = ChatContent("T", id, "Hello 👋 café".toByteArray())
        assertEquals("Hello 👋 café", ChatContent.utf8(ChatContent.decode(text.encode())!!.data))
        assertNull(ChatContent.decode("legacy text"))
        listOf("L1|A|bad", "L1|A|$id|extra", "L1|T|$id|/w==", "L1|T|$id|YQ", "L1|V|$id|0|97|YQ==", "L1|V|$id|00|1|YQ==").forEach { assertFails { ChatContent.decode(it) } }
        assertFails { ChatContent("T", id, ByteArray(1401)).encode() }
        assertFails { ChatContent.voice(id, ByteArray(98305)) }
    }
    @Test fun voiceReordersDeduplicatesAndSeparatesSenders() {
        val data = ByteArray(98304) { (it % 251).toByte() }
        val chunks = ChatContent.voice(id, data)
        val assembly = VoiceAssembly()
        assertNull(assembly.accept("other", chunks.first(), 100, 0))
        assertNull(assembly.accept("friend", chunks.last(), 100, 0))
        assertNull(assembly.accept("friend", chunks.last(), 100, 0))
        var result: ByteArray? = null
        chunks.dropLast(1).reversed().forEach { result = assembly.accept("friend", it, 100, 0) }
        assertArrayEquals(data, result)
    }
    @Test fun conflictingAndExpiredAssembliesFailClosed() {
        val chunks = ChatContent.voice(id, ByteArray(1500) { 4 })
        val assembly = VoiceAssembly()
        assertNull(assembly.accept("a", chunks[0], 10, 0))
        assertFails { assembly.accept("a", chunks[0].copy(data = ByteArray(1024) { 5 }), 10, 0) }
        assertNull(assembly.accept("a", chunks[1], 20, 11)) // expired first fragment cannot complete
        assertFails { assembly.accept("a", chunks[0], 10, 11) }
        val capped = VoiceAssembly()
        repeat(8) { capped.accept("$it", chunks[0], 100, 0) }
        assertFails { capped.accept("overflow", chunks[0], 100, 0) }
    }
    @Test fun ciphertextRestoreRetryAndCancellationPreservePacket() {
        val gen = KeyPairGenerator.getInstance("RSA").apply { initialize(3072) }
        val a = LabCrypto(gen.generateKeyPair()); val b = LabCrypto(gen.generateKeyPair())
        var now = System.currentTimeMillis(); val written = mutableListOf<ByteArray>()
        fun engine() = MeshEngine(a, { now }, { it == b.deviceId }, { _, bytes -> written += bytes }, {}, { _, _ -> })
        val first = engine(); val packetID = first.send(b.publicKey, ChatContent("T", id, "offline".toByteArray()).encode())
        val saved = first.queued().single(); val restored = engine(); restored.restore(saved); restored.linkUp("b")
        assertArrayEquals(saved, written.single())
        now += 14999; restored.tick(); assertEquals(1, written.size)
        now++; restored.tick(); assertEquals(2, written.size); assertArrayEquals(saved, written.last())
        restored.discard(listOf(packetID)); now += 20000; restored.tick(); assertEquals(2, written.size)
        now += MAX_LIFETIME_MS; assertFails { engine().restore(saved) }
    }
}
