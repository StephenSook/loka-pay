package org.loka.core

/** Suppresses new receipt envelopes while an admitted receipt remains live. */
class ReceiptWindow(private val capacity: Int = 500) {
    private val expires = mutableMapOf<String, Long>()
    @Synchronized fun canCreate(sender: String, message: String, now: Long): Boolean {
        expires.entries.removeAll { it.value <= now }
        return "$sender:$message" !in expires && expires.size < capacity
    }
    @Synchronized fun remember(sender: String, message: String, deadline: Long, now: Long) {
        expires.entries.removeAll { it.value <= now }
        require(deadline > now && expires.size < capacity)
        expires["$sender:$message"] = deadline
    }
}
