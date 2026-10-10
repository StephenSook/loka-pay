package org.loka.core.pay

import java.io.File
import java.io.FileOutputStream
import java.io.IOException
import java.nio.channels.FileChannel
import java.nio.file.AtomicMoveNotSupportedException
import java.nio.file.Files
import java.nio.file.StandardCopyOption
import java.nio.file.StandardOpenOption
import java.util.concurrent.ConcurrentHashMap

/**
 * Makes a directory's entries durable (fsync on the directory), so a rename inside it survives
 * a power loss. The core supplies [JvmDirectorySync]; the Android app supplies one built on
 * android.system.Os. An implementation throws when it cannot sync; it never returns silently.
 */
fun interface DirectorySync {
    fun sync(directory: File)
}

/** fsync of a directory through a read-only FileChannel (works on Linux and macOS JVMs). */
object JvmDirectorySync : DirectorySync {
    override fun sync(directory: File) {
        FileChannel.open(directory.toPath(), StandardOpenOption.READ).use { it.force(true) }
    }
}

/**
 * Durable serial reservation for the payer ("the phone durably reserves the next serial before
 * signing", PLAN.md shared contracts). [reserve] makes the advanced counter crash-durable BEFORE
 * it returns a serial: the new table is written to a temporary file and fsynced, renamed over
 * the store atomically, and then the directory is fsynced so the rename itself survives a power
 * loss. A crash or a cancelled signature therefore never hands the same serial to two notes.
 *
 * A missing store is never read as empty. The store exists only after the explicit first-run
 * [initialize], which records the empty table durably. After that, a store that is missing,
 * unreadable or does not parse exactly fails every operation with `storage`, and nothing resets
 * a counter (a reset would reuse serials).
 *
 * File format, one counter per allowance:
 * ```
 * loka-pay-serials-v1
 * <allowance id, decimal u64> <next serial, 0 to 256>
 * ```
 */
class SerialReservations(private val file: File, private val directorySync: DirectorySync) {

    /** True when the store file exists (it may still be damaged; operations check that). */
    fun isInitialized(): Boolean = file.isFile

    /**
     * First-run initialisation: creates an empty store durably (file, its folder and the folder's
     * entry in its parent are all synced). A store that already exists is only checked, never
     * replaced, so calling this again cannot reset counters.
     */
    fun initialize(): Unit = locked(create = true) { target ->
        if (target.exists()) {
            load(target)
        } else {
            save(target, emptyMap())
            target.parentFile.parentFile?.let { sync(it) }
        }
    }

    /** Returns the next unused serial (0 to 255) for [allowanceId] after persisting it. Throws `serials_exhausted` after 256. */
    fun reserve(allowanceId: ULong): Int = locked(create = false) { target ->
        val table = load(target)
        val next = table[allowanceId] ?: 0
        if (next >= 256) fail(PaymentError.SERIALS_EXHAUSTED)
        table[allowanceId] = next + 1
        save(target, table)
        next
    }

    /** Serials not yet reserved for [allowanceId]. */
    fun remaining(allowanceId: ULong): Int = locked(create = false) { target -> 256 - (load(target)[allowanceId] ?: 0) }

    private fun <T> locked(create: Boolean, body: (File) -> T): T {
        val target = canonical(create)
        val lock = LOCKS.computeIfAbsent(target.path) { Any() }
        return synchronized(lock) { body(target) }
    }

    /** The canonical path, so one file has one lock in this process. Only [initialize] creates the folder. */
    private fun canonical(create: Boolean): File = try {
        val dir = file.absoluteFile.parentFile ?: fail(PaymentError.STORAGE)
        if (create && !dir.isDirectory && !dir.mkdirs() && !dir.isDirectory) fail(PaymentError.STORAGE)
        if (!dir.isDirectory) fail(PaymentError.STORAGE)
        File(dir.canonicalFile, file.name)
    } catch (e: IOException) {
        throw PaymentException(PaymentError.STORAGE, e)
    }

    private fun load(target: File): MutableMap<ULong, Int> {
        if (!target.isFile) fail(PaymentError.STORAGE) // missing after initialisation: refuse, never "empty"
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
        // The rename is durable only once the directory entry is synced.
        sync(target.parentFile)
    }

    private fun sync(directory: File) {
        try {
            directorySync.sync(directory)
        } catch (e: PaymentException) {
            throw e
        } catch (e: Exception) {
            throw PaymentException(PaymentError.STORAGE, e)
        }
    }

    private companion object {
        const val HEADER = "loka-pay-serials-v1"
        val ENTRY = Regex("^(0|[1-9][0-9]{0,19}) (0|[1-9][0-9]{0,2})$")
        val LOCKS = ConcurrentHashMap<String, Any>()
    }
}
