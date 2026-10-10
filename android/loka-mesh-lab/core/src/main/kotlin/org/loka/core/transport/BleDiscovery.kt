package org.loka.core.transport

/** Ephemeral radio role election only. These tokens never identify or authorize a person. */
object BleDiscovery {
    fun initiates(local: ByteArray, remote: ByteArray?): Boolean {
        if (local.size != 8) return false
        // Tokenless LOKA services (including Apple peripherals) use Android as
        // initiator. This is service discovery, never identity or chat approval.
        if (remote == null) return true
        if (remote.size != 8) return false
        for (i in local.indices) {
            val comparison = (local[i].toInt() and 255).compareTo(remote[i].toInt() and 255)
            if (comparison != 0) return comparison < 0
        }
        return false
    }
}
