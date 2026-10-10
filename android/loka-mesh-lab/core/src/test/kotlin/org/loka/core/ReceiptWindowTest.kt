package org.loka.core

import org.junit.Assert.*
import org.junit.Test

class ReceiptWindowTest {
    @Test fun `one live receipt across five-minute duplicates and separate sender identities`() {
        val window = ReceiptWindow()
        assertTrue(window.canCreate("a", "m", 0))
        window.remember("a", "m", 3600000, 0)
        assertFalse(window.canCreate("a", "m", 300001))
        assertFalse(window.canCreate("a", "m", 3599999))
        assertTrue(window.canCreate("b", "m", 3599999))
        assertTrue(window.canCreate("a", "m", 3600000))
    }
    @Test fun `failed enqueue leaves a retry obligation and expiry releases bounded slots`() {
        val window = ReceiptWindow(1)
        assertTrue(window.canCreate("a", "failed", 0))
        // No remember: transport/store failure must not suppress the next creation.
        assertTrue(window.canCreate("a", "failed", 1))
        window.remember("a", "saved", 300000, 1)
        assertFalse(window.canCreate("b", "other", 299999))
        assertTrue(window.canCreate("b", "other", 300000))
    }
}
