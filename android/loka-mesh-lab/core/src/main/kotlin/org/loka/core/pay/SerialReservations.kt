package org.loka.core.pay

import java.io.File
import java.io.FileOutputStream
import java.io.IOException
import java.nio.file.AtomicMoveNotSupportedException
import java.nio.file.Files
import java.nio.file.StandardCopyOption
import java.util.concurrent.ConcurrentHashMap

/**
 * Durable serial reservation for the payer ("the phone durably reserves the next serial before
 * signing", PLAN.md shared contracts). [reserve] writes the advanced counter to disk (fsync, then
 * an atomic rename) BEFORE it returns a serial, so a crash or a cancelled signature can never
 * hand the same serial to a different note. A reserved serial is never reused.
 *
 * File format, one counter per allowance:
 * ```
 * loka-pay-serials-v1
 * <allowance id, decimal u64> <next serial, 0 to 256>
 * ```
 * A file that does not parse exactly is corruption: every operation then fails with `storage`
 * and never resets a counter (a reset would reuse serials).
 */
class SerialReservations(private val file: File) {

    /** Returns the next unused serial (0 to 255) for [allowanceId] after persisting it. Throws `serials_exhausted` after 256. */
    fun reserve(allowanceId: ULong): Int = locked { target ->
        val table = load(target)
        val next = table[allowanceId] ?: 0
        if (next >= 256) fail(PaymentError.SERIALS_EXHAUSTED)
        table[allowanceId] = next + 1
        save(target, table)
        next
    }

    /** Serials not yet reserved for [allowanceId]. */
    fun remaining(allowanceId: ULong): Int = locked { target -> 256 - (load(target)[allowanceId] ?: 0) }

    private fun <T> locked(body: (File) -> T): T {
        val target = canonical()
        val lock = LOCKS.computeIfAbsent(target.path) { Any() }
        return synchronized(lock) { body(target) }
    }

    /** The parent folder is created and canonicalized, so one file has one lock in this process. */
    private fun canonical(): File = try {
        val dir = file.absoluteFile.parentFile ?: fail(PaymentError.STORAGE)
        if (!dir.isDirectory && !dir.mkdirs() && !dir.isDirectory) fail(PaymentError.STORAGE)
        File(dir.canonicalFile, file.name)
    } catch (e: IOException) {
        throw PaymentException(PaymentError.STORAGE, e)
    }

    private fun load(target: File): MutableMap<ULong, Int> {
        if (!target.exists()) return sortedMapOf()
        val lines = try {
            target.readText(Charsets.UTF_8).split("\n")
        } catch (e: IOException) {
            throw PaymentException(PaymentError.STORAGE, e)
        }
        // Header, entries, and the empty string after the final newline.
        if (lines.size < 2 || lines.first() != HEADER || lines.last() != "") fail(PaymentError.STORAGE)
        val table = sortedMapOf<ULong, Int>()
        for (line in lines.subList(1, lines.size - 1)) {
            val m = ENTRY.matchEntire(line) ?: fail(PaymentError.STORAGE)
            val id = m.groupValues[1].toULongOrNull() ?: fail(PaymentError.STORAGE)
            val next = m.groupValues[2].toIntOrNull()?.takeIf { it in 0..256 } ?: fail(PaymentError.STORAGE)
            if (table.put(id, next) != null) fail(PaymentError.STORAGE)
        }
        return table
    }

    private fun save(target: File, table: Map<ULong, Int>) {
        val text = buildString {
            append(HEADER).append('\n')
            table.toSortedMap().forEach { (id, next) -> append(id).append(' ').append(next).append('\n') }
        }
        val tmp = File(target.parentFile, target.name + ".tmp")
        try {
            FileOutputStream(tmp).use { out ->
                out.write(text.toByteArray(Charsets.UTF_8))
                out.fd.sync()
            }
            try {
                Files.move(tmp.toPath(), target.toPath(), StandardCopyOption.ATOMIC_MOVE, StandardCopyOption.REPLACE_EXISTING)
            } catch (e: AtomicMoveNotSupportedException) {
                throw PaymentException(PaymentError.STORAGE, e)
            }
        } catch (e: IOException) {
            throw PaymentException(PaymentError.STORAGE, e)
        }
    }

    private companion object {
        const val HEADER = "loka-pay-serials-v1"
        val ENTRY = Regex("^(0|[1-9][0-9]{0,19}) (0|[1-9][0-9]{0,2})$")
        val LOCKS = ConcurrentHashMap<String, Any>()
    }
}
