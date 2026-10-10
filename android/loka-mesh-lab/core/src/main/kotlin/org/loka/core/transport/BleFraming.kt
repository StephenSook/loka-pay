package org.loka.core.transport

import java.io.ByteArrayOutputStream

/** GATT link framing only; encryption/authentication belong to the packet layer. */
object BleFraming {
    /** Receipts may pass waiting frames, never the remainder of a frame already on air.
     * Reserve room for one receipt without increasing the existing 2048-chunk bound. */
    fun enqueueFrame(queue: java.util.ArrayDeque<ByteArray>, frame: ByteArray, urgent: Boolean, inFlight: Boolean) {
        val chunks = chunks(frame)
        val existing = queue.toList()
        if (existing.size >= chunks.size && (0..existing.size - chunks.size).any { start ->
            existing[start].contentEquals(chunks[0]) && chunks.indices.all { existing[start + it].contentEquals(chunks[it]) }
        }) return
        require(queue.size + chunks.size <= if (urgent) 2048 else 1920) { "BLE queue full" }
        if (!urgent) { chunks.forEach(queue::addLast); return }
        var keep = 0
        while (keep < existing.size) {
            val flags = existing[keep][0].toInt() and 255
            if (flags > 3) { keep++; continue } // Link probe stays ahead.
            if ((keep == 0 && inFlight) || flags and 1 == 0) {
                do {
                    val end = existing[keep++][0].toInt() and 255
                    if (end <= 3 && end and 2 != 0) break
                } while (keep < existing.size)
            } else break
        }
        queue.clear()
        existing.take(keep).forEach(queue::addLast)
        chunks.forEach(queue::addLast)
        existing.drop(keep).forEach(queue::addLast)
    }
    fun prioritizeControl(queue: java.util.ArrayDeque<ByteArray>, control: ByteArray, inFlight: Boolean) {
        val active = if (inFlight) queue.pollFirst() else null
        queue.addFirst(control)
        if (active != null) queue.addFirst(active)
    }
    fun chunks(frame: ByteArray): List<ByteArray> {
        require(frame.size in 1..16384)
        return frame.asList().chunked(19).mapIndexed { index, chunk ->
            val flags = (if (index == 0) 1 else 0) or (if ((index + 1) * 19 >= frame.size) 2 else 0)
            byteArrayOf(flags.toByte()) + chunk.toByteArray()
        }
    }
    class Assembler(private val clock: () -> Long) {
        private val bytes = ByteArrayOutputStream()
        private var assembling = false
        private var last = 0L
        private fun reset() { bytes.reset(); assembling = false }
        fun accept(chunk: ByteArray): ByteArray? {
            try {
                require(chunk.size in 2..20)
                val flags = chunk[0].toInt()
                require(flags in 0..3)
                val now = clock()
                if (flags and 1 != 0) { reset(); assembling = true }
                require(assembling && (flags and 1 != 0 || now - last in 0..10000))
                require(bytes.size() + chunk.size - 1 <= 16384)
                last = now; bytes.write(chunk, 1, chunk.size - 1)
                return if (flags and 2 != 0) bytes.toByteArray().also { reset() } else null
            } catch (e: IllegalArgumentException) { reset(); throw e }
        }
    }
}
