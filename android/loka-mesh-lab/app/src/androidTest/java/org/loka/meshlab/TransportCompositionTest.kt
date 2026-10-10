package org.loka.meshlab

import android.app.Application
import android.content.Intent
import android.util.Base64
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
import org.loka.core.LabCrypto
import org.loka.core.PacketCodec
import org.loka.core.ChatContent
import org.loka.core.transport.*
import java.security.KeyPairGenerator
import java.util.concurrent.LinkedBlockingQueue
import java.util.concurrent.TimeUnit

@RunWith(AndroidJUnit4::class)
class TransportCompositionTest {
    @Test fun viewModelUsesInjectedTransportForKeystoreEncryptedMessaging() = runBlocking {
        val instrumentation = InstrumentationRegistry.getInstrumentation()
        val application = instrumentation.targetContext.applicationContext as Application
        val remote = LabCrypto(KeyPairGenerator.getInstance("RSA").apply { initialize(3072) }.generateKeyPair())
        val writes = LinkedBlockingQueue<ByteArray>()
        lateinit var callback: TransportListener
        var closed = false
        val relay = "test:local-relay"
        val provider = object : AndroidTransportProvider {
            override val name = "Test local transport"
            override val setupHint = "No radio required for this integration test."
            override val setupAction = "Prepare"
            override val requiredPermissions = emptyArray<String>()
            override fun visibilityRequest(): Intent? = null
            override fun factory(scope: CoroutineScope, allowed: (String) -> Boolean) = TransportFactory { listener ->
                callback = listener
                object : LokaTransport {
                    override val capabilities = emptySet<TransportCapability>()
                    override fun start() { listener.onRunning(true) }
                    override fun refreshPeers() = Unit
                    override fun connect(peer: String) { check(allowed(peer)); listener.onLink(peer, true) }
                    override fun send(peer: String, frame: ByteArray) { writes.add(frame.copyOf()) }
                    override fun disconnect(peer: String) { listener.onLink(peer, false) }
                    override fun stop() { closed = true; listener.onLink(relay, false); listener.onRunning(false) }
                }
            }
        }
        val historyName = "transport-test-${java.util.UUID.randomUUID()}.db"
        val store = ViewModelStore()
        lateinit var model: LabViewModel
        instrumentation.runOnMainSync {
            model = ViewModelProvider(store, LabViewModel.Factory(application, provider, historyName))[LabViewModel::class.java]
        }
        try {
            withTimeout(10_000) { model.state.first { it.ready } }
            assertEquals(provider.name, model.state.value.transportName)
            assertTrue(model.state.value.capabilities.isEmpty())
            val publicKey = Base64.decode(model.state.value.publicKey, Base64.NO_WRAP)
            instrumentation.runOnMainSync {
                model.importKey(Base64.encodeToString(remote.publicKey, Base64.NO_WRAP))
                model.allow(relay, true)
                model.start(); model.connect(relay)
            }
            assertTrue(model.state.value.running)
            assertEquals(setOf(relay), model.state.value.connected)
            callback.onFrame(relay, PacketCodec.encode(remote.encrypt(publicKey, "Hello from local adapter", System.currentTimeMillis())))
            assertTrue(model.state.value.messages.none { it.contains("Hello from local adapter") })
            assertEquals(remote.deviceId, model.state.value.chatMessages.single().peerId)
            assertFalse(model.state.value.chatMessages.single().outgoing)
            assertEquals("Hello from local adapter", model.state.value.chatMessages.single().body)
            assertFalse(model.state.value.events.any { it.contains("Hello from local adapter") })
            model.send(remote.deviceId, "Reply through injected transport")
            val frame = checkNotNull(writes.poll(10, TimeUnit.SECONDS)) { "No encrypted reply was written" }
            val content = checkNotNull(ChatContent.decode(remote.decrypt(PacketCodec.decode(frame))))
            assertEquals("Reply through injected transport", ChatContent.utf8(content.data))
            val outgoing = withTimeout(5_000) { model.state.first { it.sending.isEmpty() && it.chatMessages.any { message -> message.outgoing } } }
                .chatMessages.single { it.outgoing }
            assertEquals(remote.deviceId, outgoing.peerId)
            assertEquals(content.id, outgoing.id)
            assertTrue(PacketCodec.decode(frame).id in outgoing.packetIds)
            assertEquals("Reply through injected transport", outgoing.body)
            // Simulate adapter loss through the same model entry point used by the
            // service-owned receiver. This must retain trust and replay on restart.
            instrumentation.runOnMainSync { model.pauseForRadioChange() }
            assertTrue(model.localConnectionEnabled)
            assertFalse(model.state.value.running)
            assertTrue(model.state.value.connected.isEmpty())
            assertTrue(model.state.value.trusted.any { it.id == remote.deviceId })
            assertTrue(relay in model.state.value.allowed)
            instrumentation.runOnMainSync {
                model.resumeLocalConnection(serviceAlreadyRunning = true)
                model.connect(relay)
            }
            assertTrue(model.state.value.running)
            assertArrayEquals(frame, writes.poll(5, TimeUnit.SECONDS))
            // Explicit Off must win over a late radio-on callback.
            instrumentation.runOnMainSync {
                model.stop()
                model.resumeLocalConnection(serviceAlreadyRunning = true)
            }
            assertFalse(model.localConnectionEnabled)
            assertFalse(model.state.value.running)

            instrumentation.runOnMainSync { model.stop() }
            assertTrue(closed)
            assertFalse(model.state.value.running)
            assertTrue(model.state.value.connected.isEmpty())
            instrumentation.runOnMainSync { store.clear() }
            instrumentation.runOnMainSync {
                model = ViewModelProvider(store, LabViewModel.Factory(application, provider, historyName))[LabViewModel::class.java]
            }
            val reloaded = withTimeout(10_000) { model.state.first { it.ready } }
            assertTrue(relay in reloaded.allowed)
            instrumentation.runOnMainSync { model.allow(relay, false) }
            assertFalse(relay in model.state.value.allowed)
            assertTrue(application.getSharedPreferences("loka-link-approvals-$historyName", 0)
                .getStringSet("approved", emptySet()).orEmpty().isEmpty())
            assertEquals(2, reloaded.chatMessages.size)
            assertTrue(reloaded.chatMessages.any { it.body == "Hello from local adapter" })
            assertTrue(reloaded.chatMessages.any { it.body == "Reply through injected transport" })
            assertTrue(reloaded.chatMessages.single { it.outgoing }.activeQueue)
            assertFalse(reloaded.chatMessages.single { !it.outgoing }.activeQueue)
            callback.onLink(relay, true)
            assertArrayEquals(frame, writes.poll(5, TimeUnit.SECONDS))
            // Message was saved just as its radio route disappeared. Its receipt must
            // remain queued and be replayed, not discarded after a single send attempt.
            callback.onLink(relay, false)
            val incomingID = java.util.UUID.randomUUID().toString()
            val incoming = remote.encrypt(publicKey,
                ChatContent("T", incomingID, data = "Saved during disconnect".toByteArray()).encode(), System.currentTimeMillis())
            callback.onFrame(relay, PacketCodec.encode(incoming))
            callback.onFrame(relay, PacketCodec.encode(incoming))
            assertEquals(1, model.state.value.chatMessages.count { it.id == incomingID })
            assertTrue(writes.isEmpty())
            callback.onLink(relay, true)
            val replayed = listOfNotNull(writes.poll(5, TimeUnit.SECONDS), writes.poll(5, TimeUnit.SECONDS))
            val receipts = replayed.mapNotNull { ChatContent.decode(remote.decrypt(PacketCodec.decode(it))) }
                .filter { it.kind == "A" && it.id == incomingID }
            assertEquals("Exactly one retained receipt must replay after reconnect", 1, receipts.size)

        } finally {
            instrumentation.runOnMainSync { model.forget(remote.deviceId); store.clear() }
            application.deleteDatabase(historyName)
            application.deleteSharedPreferences("loka-link-approvals-$historyName")
            java.io.File(application.noBackupFilesDir, "loka-outbox-v1-$historyName.json").delete()
            java.security.KeyStore.getInstance("AndroidKeyStore").apply { load(null); deleteEntry("loka-history-storage-v1-$historyName") }
        }
    }
}
