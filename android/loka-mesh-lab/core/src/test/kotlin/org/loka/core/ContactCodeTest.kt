package org.loka.core

import org.junit.Assert.*
import org.junit.Test
import org.loka.core.contact.ContactCode
import java.security.KeyPairGenerator

class ContactCodeTest {
    @Test fun contactLinkPreservesExactDeviceIdentity() {
        val key = KeyPairGenerator.getInstance("RSA").apply { initialize(3072) }.generateKeyPair().public.encoded
        val link = ContactCode.encode(key)
        assertArrayEquals(key, ContactCode.decode(link))
        assertEquals(fingerprint(key), ContactCode.fingerprint(link))
    }
    @Test fun untrustedInputsAreRejected() {
        listOf("https://example.com", "loka://contact/v2#abc", "loka://contact/v1#", "loka://contact/v1#abc?phone=123", "loka://contact/v1#abc", "x".repeat(2049)).forEach {
            assertTrue(runCatching { ContactCode.decode(it) }.isFailure)
        }
    }
}
