package org.loka.meshlab

import android.app.Application
import android.content.Intent
import android.net.Uri
import androidx.lifecycle.ViewModelProvider
import androidx.lifecycle.ViewModelStore
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.runBlocking
import kotlinx.coroutines.withTimeout
import org.junit.Assert.*
import org.junit.Test
import org.junit.runner.RunWith
import org.loka.core.backup.BackupCipher
import org.loka.core.transport.*
import java.io.File
import java.security.KeyStore
import java.util.UUID

@RunWith(AndroidJUnit4::class)
class BackupViewModelTest {
    @Test fun exportedHistoryCanRestoreWithoutGrantingTrustOrSendingOldMessages() = runBlocking {
        val instrumentation = InstrumentationRegistry.getInstrumentation()
        val app = instrumentation.targetContext.applicationContext as Application
        val name = "backup-test-${UUID.randomUUID()}.db"
        val vmStore = ViewModelStore()
        val archiveFile = File(app.cacheDir, "backup-test-${UUID.randomUUID()}.lokabackup")
        val outputFile = File(app.cacheDir, "export-test-${UUID.randomUUID()}.lokabackup")
        var writes = 0
        val provider = object : AndroidTransportProvider {
            override val name = "Test local transport"
            override val setupHint = "Test"
            override val setupAction = "Test"
            override val requiredPermissions = emptyArray<String>()
            override fun visibilityRequest(): Intent? = null
            override fun factory(scope: CoroutineScope, allowed: (String) -> Boolean) = TransportFactory { listener ->
                object : LokaTransport {
                    override val capabilities = emptySet<TransportCapability>()
                    override fun start() = Unit
                    override fun refreshPeers() = Unit
                    override fun connect(peer: String) = Unit
                    override fun send(peer: String, frame: ByteArray) { writes++ }
                    override fun disconnect(peer: String) = Unit
                    override fun stop() = Unit
                }
            }
        }
        lateinit var model: LabViewModel
        try {
            instrumentation.runOnMainSync { model = ViewModelProvider(vmStore, LabViewModel.Factory(app, provider, name))[LabViewModel::class.java] }
            withTimeout(10000) { model.state.first { it.ready } }
            val historical = ChatMessage(UUID.randomUUID().toString(), "c".repeat(64), "A saved conversation", true, 100L, "Carol", true)
            val code = BackupCipher.recoveryCode()
            archiveFile.writeBytes(BackupCipher.encrypt(HistoryFormat.encode(listOf(historical)), code))
            model.restoreBackup(Uri.fromFile(archiveFile), code) {}
            val restored = withTimeout(10000) { model.state.first { !it.backupBusy && it.chatMessages.isNotEmpty() } }
            assertEquals(historical.copy(activeQueue = false), restored.chatMessages.single())
            assertTrue(restored.trusted.none { it.id == historical.peerId })
            assertEquals("Carol", restored.historyContacts.single().name)
            assertEquals("", restored.historyContacts.single().key)
            assertEquals(0, writes)
            model.send(historical.peerId, "Must not send to unverified restored contact")
            withTimeout(5000) { model.state.first { it.error != null } }
            assertEquals(0, writes); assertEquals(1, model.state.value.chatMessages.size)
            model.clearError()
            model.prepareBackup()
            val prepared = withTimeout(10000) { model.state.first { !it.backupBusy && it.backupCode != null } }
            val exportCode = checkNotNull(prepared.backupCode)
            model.saveBackup(Uri.fromFile(outputFile))
            withTimeout(10000) { model.state.first { !it.backupBusy && it.backupCode == null } }
            assertFalse(String(outputFile.readBytes()).contains(historical.body))
            assertEquals(listOf(historical.copy(activeQueue = false)), HistoryFormat.decode(BackupCipher.decrypt(outputFile.readBytes(), exportCode)))
            model.restoreBackup(Uri.fromFile(archiveFile), BackupCipher.recoveryCode()) {}
            withTimeout(10000) { model.state.first { !it.backupBusy && it.error != null } }
            assertEquals(1, model.state.value.chatMessages.size)
            assertEquals(0, writes)
        } finally {
            instrumentation.runOnMainSync { vmStore.clear() }
            archiveFile.delete(); outputFile.delete(); app.deleteDatabase(name)
            KeyStore.getInstance("AndroidKeyStore").apply { load(null); deleteEntry("loka-history-storage-v1-$name") }
        }
    }
}
