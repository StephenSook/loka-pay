package org.loka.core

/** Link admission is not contact trust. Automatic BLE links carry untrusted ciphertext. */
object LocalLinkPolicy {
    fun permits(peer: String, automatic: Boolean, approved: Set<String>, blocked: Set<String>): Boolean =
        peer !in blocked && (peer in approved || (automatic && listOf("ble:", "wifi:", "aware:").any(peer::startsWith)))
}

/** Per-link work budget before signature verification; monotonic clock supplied by transport. */
class LinkIngressBudget(private val clock: () -> Long) {
    private var tokens = 8.0
    private var previous = clock()
    fun take(): Boolean {
        val now = clock()
        tokens = minOf(8.0, tokens + maxOf(0L, now - previous) / 250.0)
        previous = now
        if (tokens < 1.0) return false
        tokens -= 1.0
        return true
    }
}
