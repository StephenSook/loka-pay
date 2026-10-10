package org.loka.core

import org.junit.Assert.*
import org.junit.Test
import org.loka.core.transport.BleFraming

class BleFramingTest {
    @Test fun receiptPassesWaitingMediaButNeverSplitsAnActiveFrame() {
        val media = ByteArray(1400) { 42 }; val receipt = ByteArray(1400) { 7 }
        val fifo = java.util.ArrayDeque<ByteArray>()
        repeat(20) { i -> BleFraming.enqueueFrame(fifo, media.copyOf().apply { this[0] = (42 + i).toByte() }, false, false) }
        val fast = java.util.ArrayDeque(fifo)
        BleFraming.enqueueFrame(fifo, receipt, false, true)
        BleFraming.enqueueFrame(fast, receipt, true, true)
        fun receiptPosition(queue: java.util.ArrayDeque<ByteArray>): Int {
            val decoder = BleFraming.Assembler { 0 }; var at = 0
            for (chunk in queue) { at++; if (decoder.accept(chunk)?.contentEquals(receipt) == true) return at }
            error("Receipt missing")
        }
        assertEquals(1554, receiptPosition(fifo)); assertEquals(148, receiptPosition(fast))
        val decoded = fast.mapNotNull(BleFraming.Assembler { 0 }::accept)
        assertEquals(21, decoded.size); assertArrayEquals(media, decoded[0]); assertArrayEquals(receipt, decoded[1])
        assertTrue(decoded.drop(2).withIndex().all { (i, frame) -> frame[0] == (43 + i).toByte() && frame.drop(1).all { it == 42.toByte() } })
        println("Receipt queue experiment: FIFO 1554 chunks; priority 148 chunks; 90.48% fewer until receipt completion (not radio latency)")
    }
    @Test fun receiptAfterPartiallyWrittenFrameAndCapacityReserve() {
        val frame = ByteArray(1400) { 42 }; val receipt = byteArrayOf(99)
        val queue = java.util.ArrayDeque(BleFraming.chunks(frame)); val decoder = BleFraming.Assembler { 0 }
        repeat(10) { assertNull(decoder.accept(queue.removeFirst())) }
        BleFraming.enqueueFrame(queue, receipt, true, false)
        val decoded = queue.mapNotNull(decoder::accept)
        assertArrayEquals(frame, decoded[0]); assertArrayEquals(receipt, decoded[1])
        val full = java.util.ArrayDeque<ByteArray>()
        repeat(25) { i -> BleFraming.enqueueFrame(full, frame.copyOf().apply { this[0] = i.toByte() }, false, false) }
        val before = full.size
        assertTrue(runCatching { BleFraming.enqueueFrame(full, frame, false, false) }.isFailure)
        assertEquals(before, full.size)
        BleFraming.enqueueFrame(full, frame, true, false)
        assertTrue(full.size <= 2048)
    }

    @Test fun repeatedQueuedFramesAreCoalescedWithoutDroppingDistinctMessages() {
        val frame = ByteArray(1400) { 42 }; val q = java.util.ArrayDeque<ByteArray>()
        repeat(100) { BleFraming.enqueueFrame(q, frame.copyOf(), false, false) }
        assertEquals(BleFraming.chunks(frame).size, q.size)
        val other = frame.copyOf().apply { this[100] = 43 }
        BleFraming.enqueueFrame(q, other, true, true)
        val decoded = q.mapNotNull(BleFraming.Assembler { 0 }::accept)
        assertEquals(2, decoded.size); assertArrayEquals(frame, decoded[0]); assertArrayEquals(other, decoded[1])
    }

    @Test fun maximumFrameSurvivesMinimumMtuWithExactBytes() {
        val frame = ByteArray(16384) { (it * 31).toByte() }
        val decoder = BleFraming.Assembler { 10 }
        val chunks = BleFraming.chunks(frame)
        assertTrue(chunks.all { it.size <= 20 })
        val completed = chunks.mapNotNull(decoder::accept)
        assertEquals(1, completed.size); assertArrayEquals(frame, completed.single())
    }
    @Test fun consecutiveSingleAndMultiChunkFramesRemainSeparate() {
        val decoder = BleFraming.Assembler { 10 }
        for (size in listOf(1, 19, 20, 38, 39, 2048)) {
            val frame = ByteArray(size) { it.toByte() }
            assertArrayEquals(frame, BleFraming.chunks(frame).mapNotNull(decoder::accept).single())
        }
    }
    @Test fun rejectsUnstartedTimeoutOversizeAndInvalidFlagsThenRecovers() {
        var now = 0L
        val decoder = BleFraming.Assembler { now }
        fun rejected(bytes: ByteArray) {
            try { decoder.accept(bytes); fail("Malformed chunk accepted") } catch (_: IllegalArgumentException) { }
        }
        rejected(byteArrayOf(2, 1)); rejected(byteArrayOf(4, 1)); rejected(byteArrayOf(1)); rejected(ByteArray(21))
        decoder.accept(byteArrayOf(1, 1)); now = 10001; rejected(byteArrayOf(2, 2))
        val full = BleFraming.chunks(ByteArray(16384)); full.dropLast(2).forEach(decoder::accept)
        decoder.accept(byteArrayOf(0) + ByteArray(19))
        rejected(byteArrayOf(2) + ByteArray(19))
        assertArrayEquals(byteArrayOf(42), decoder.accept(byteArrayOf(3, 42)))
    }
    @Test fun newStartDiscardsTruncatedOldFrame() {
        val decoder = BleFraming.Assembler { 0 }
        decoder.accept(byteArrayOf(1, 99)); assertArrayEquals(byteArrayOf(7), decoder.accept(byteArrayOf(3, 7)))
    }
}
