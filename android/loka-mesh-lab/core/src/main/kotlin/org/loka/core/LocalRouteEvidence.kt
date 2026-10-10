package org.loka.core

/** Local observation only: a queued send is not proof that a remote relay received it. */
data class LocalRouteEvidence(val transport: String, val carrier: String, val at: Long, val expiresAt: Long) {
    fun validate() {
        require(transport in setOf("ble", "wifi", "aware", "classic", "unknown"))
        require(carrier.isEmpty() || carrier.matches(Regex("[0-9a-f]{64}")))
        require(at >= 0 && expiresAt >= 0)
    }
    companion object {
        fun transport(handle: String?) = when {
            handle == null -> "unknown"
            handle.startsWith("aware:") -> "aware"
            handle.startsWith("wifi:") -> "wifi"
            handle.startsWith("ble:") -> "ble"
            handle.matches(Regex("[0-9A-Fa-f]{2}(:[0-9A-Fa-f]{2}){5}")) -> "classic"
            else -> "unknown"
        }
    }
}
