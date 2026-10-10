package org.loka.core

import org.junit.Assert.*
import org.junit.Test
import org.loka.core.backup.BackupCipher

class BackupCipherTest {
    @Test fun independentRecoveryKeyAndFreshNonceProtectEachArchive() {
        val code = BackupCipher.recoveryCode()
        val plain = "private chat history".toByteArray()
        val first = BackupCipher.encrypt(plain, code)
        assertArrayEquals(plain, BackupCipher.decrypt(first, code))
        assertFalse(first.contentEquals(BackupCipher.encrypt(plain, code)))
        assertFalse(String(first).contains("private chat history"))
    }
    @Test fun wrongKeyModifiedTruncatedAndUnsupportedFilesFailClosed() {
        val code = BackupCipher.recoveryCode()
        val archive = BackupCipher.encrypt("secret".toByteArray(), code)
        assertTrue(runCatching { BackupCipher.decrypt(archive, BackupCipher.recoveryCode()) }.isFailure)
        for (i in listOf(0, 8, 20, archive.lastIndex)) {
            val modified = archive.copyOf().apply { this[i] = (this[i].toInt() xor 1).toByte() }
            assertTrue(runCatching { BackupCipher.decrypt(modified, code) }.isFailure)
        }
        assertTrue(runCatching { BackupCipher.decrypt(archive.copyOf(archive.size - 1), code) }.isFailure)
        assertTrue(runCatching { BackupCipher.decrypt(ByteArray(BackupCipher.MAX_BYTES + 1), code) }.isFailure)
        assertTrue(runCatching { BackupCipher.decrypt(archive, "password") }.isFailure)
    }
}
