package org.loka.core

/** Ephemeral transport negotiation, not a trust/identity or secure key-exchange protocol. */
object AwareDiscovery {
    fun decode(bytes: ByteArray, kind: String): List<String>? {
        if (kind !in listOf("Q", "A") || bytes.size !in 1..160 || bytes.any { it.toInt() !in 32..126 }) return null
        val p = bytes.toString(Charsets.US_ASCII).split('|')
        return p.takeIf { it.size == 4 && it[0] == kind && it[1].matches(Regex("[a-f0-9]{32}")) && it[2].matches(Regex("[a-f0-9]{32}")) && it[3].matches(Regex("[a-f0-9-]{36}")) }
    }
}
