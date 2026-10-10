package org.loka.core

import org.junit.Assert.*
import org.junit.Test

class AwareDiscoveryTest {
    @Test fun boundedDiscoveryRejectsWrongKindInjectedFieldsAndNonAscii() {
        val valid = "Q|${"a".repeat(32)}|${"b".repeat(32)}|12345678-1234-1234-1234-123456789abc"
        assertNotNull(AwareDiscovery.decode(valid.toByteArray(), "Q"))
        assertNull(AwareDiscovery.decode(valid.toByteArray(), "A"))
        assertNull(AwareDiscovery.decode((valid + "|extra").toByteArray(), "Q"))
        assertNull(AwareDiscovery.decode(valid.replaceFirst('a', '\n').toByteArray(), "Q"))
        assertNull(AwareDiscovery.decode(valid.replaceFirst('a', 'é').toByteArray(), "Q"))
        assertNull(AwareDiscovery.decode(ByteArray(161), "Q"))
        assertNull(AwareDiscovery.decode(valid.replace("12345678-1234-1234-1234-123456789abc", "short").toByteArray(), "Q"))
        val response = valid.replaceFirst("Q|", "A|")
        assertEquals("b".repeat(32), AwareDiscovery.decode(response.toByteArray(), "A")!![2])
    }
}
