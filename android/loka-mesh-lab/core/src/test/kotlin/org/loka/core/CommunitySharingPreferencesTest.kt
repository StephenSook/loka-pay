package org.loka.core

import org.junit.Assert.*
import org.junit.Test

class CommunitySharingPreferencesTest {
    @Test fun defaultsDoNotOptIntoMobile() {
        val draft = CommunitySharingPreferences()
        assertTrue(draft.enabled); assertTrue(draft.wifi); assertFalse(draft.mobile)
        assertNull(draft.wifiLimit.bytes()); assertEquals(100_000_000L, draft.mobileLimit.bytes())
    }
    @Test fun emptyNetworkSelectionNeedsCorrection() {
        assertEquals("Choose Wi-Fi or mobile data, or turn community sharing off.", CommunitySharingPreferences(wifi = false).error())
        assertNull(CommunitySharingPreferences(enabled = false, wifi = false).error())
    }
    @Test fun customValuesRejectInvalidAndOverflow() {
        listOf("", "0", "-1", "NaN", "1e3", "999999999999999999999999", "0.0000001").forEach {
            assertNotNull(it, SharingLimit("Custom", it).error())
        }
        assertEquals(500_000_000L, SharingLimit("Custom", "0.5", "GB").bytes())
        assertEquals(1L, SharingLimit("Custom", "0.000001", "MB").bytes())
    }
    @Test fun inactiveCustomFieldsDoNotBlockOptOut() {
        val invalid = SharingLimit("Custom", "")
        assertNotNull(CommunitySharingPreferences(wifiLimit = invalid).error())
        assertNull(CommunitySharingPreferences(enabled = false, wifiLimit = invalid).error())
        assertNull(CommunitySharingPreferences(wifi = false, mobile = true, wifiLimit = invalid).error())
    }
    @Test fun mobileCannotBeUnlimitedAndPresetsReplaceInvalidCustom() {
        assertNotNull(CommunitySharingPreferences(mobile = true, mobileLimit = SharingLimit()).error())
        assertNull(CommunitySharingPreferences(wifiLimit = SharingLimit("500 MB", "invalid")).error())
        assertEquals(5_000_000_000L, SharingLimit("5 GB").bytes())
    }
}
