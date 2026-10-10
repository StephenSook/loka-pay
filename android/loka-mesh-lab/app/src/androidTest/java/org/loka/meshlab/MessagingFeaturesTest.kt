package org.loka.meshlab

import android.app.Application
import android.app.NotificationManager
import android.content.Intent
import android.os.Build
import android.util.Base64
import androidx.lifecycle.ViewModelProvider
import androidx.lifecycle.ViewModelStore
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import kotlinx.coroutines.*
import kotlinx.coroutines.flow.first
import org.junit.Assert.*
import org.junit.Test
import org.junit.runner.RunWith
import org.loka.core.*
import org.loka.core.transport.*
import java.security.KeyPairGenerator
import java.security.KeyStore
import java.util.UUID
import java.util.concurrent.CopyOnWriteArrayList

@RunWith(AndroidJUnit4::class)
class MessagingFeaturesTest {
    @Test fun encryptedIncomingVoiceReceiptsNotificationsAndDuplicateSendGuard() = runBlocking {
        check(Build.HARDWARE.contains("ranchu") || Build.HARDWARE.contains("goldfish")) { "Run only on an isolated emulator" }
        val instrumentation = InstrumentationRegistry.getInstrumentation()
        val app = instrumentation.targetContext.applicationContext as Application
        if (Build.VERSION.SDK_INT >= 33) instrumentation.uiAutomation.executeShellCommand("pm grant ${app.packageName} android.permission.POST_NOTIFICATIONS").close()
        val name = "messages-test-${UUID.randomUUID()}.db"; val vmStore = ViewModelStore()
        val writes = CopyOnWriteArrayList<ByteArray>()
        lateinit var wire: TransportListener
        val provider = object : AndroidTransportProvider {
            override val name = "isolated test"
            override val setupHint = "test"
            override val setupAction = "test"
            override val requiredPermissions = emptyArray<String>()
            override fun visibilityRequest(): Intent? = null
            override fun factory(scope: CoroutineScope, allowed: (String) -> Boolean) = TransportFactory { listener ->
                wire = listener
                object : LokaTransport {
                    override val capabilities = emptySet<TransportCapability>()
                    override fun start() = listener.onRunning(true)
                    override fun refreshPeers() = Unit
                    override fun connect(peer: String) = Unit
                    override fun send(peer: String, frame: ByteArray) { writes += frame }
                    override fun disconnect(peer: String) = Unit
                    override fun stop() = listener.onRunning(false)
                }
            }
        }
        val generator = KeyPairGenerator.getInstance("RSA").apply { initialize(3072) }
        val friend = LabCrypto(generator.generateKeyPair()); val stranger = LabCrypto(generator.generateKeyPair())
        lateinit var model: LabViewModel
        try {
            instrumentation.runOnMainSync { model = ViewModelProvider(vmStore, LabViewModel.Factory(app, provider, name))[LabViewModel::class.java] }
            withTimeout(10000) { model.state.first { it.ready } }
            model.importKey(Base64.encodeToString(friend.publicKey, Base64.NO_WRAP)); model.importKey(Base64.encodeToString(stranger.publicKey, Base64.NO_WRAP))
            val destination = Base64.decode(model.state.value.publicKey, Base64.NO_WRAP)
            wire.onLink("test", true)
            val incomingID = UUID.randomUUID().toString()
            val packet = friend.encrypt(destination, ChatContent("T", incomingID, "notification fixture".toByteArray()).encode(), System.currentTimeMillis())
            LocalNotifications.visibleFriend = null
            wire.onFrame("test", PacketCodec.encode(packet)); wire.onFrame("test", PacketCodec.encode(packet))
            assertEquals(1, model.state.value.chatMessages.count { it.id == incomingID })
            assertTrue(writes.any { ChatContent.decode(friend.decrypt(PacketCodec.decode(it)))?.id == incomingID })
            withTimeout(5000) {
                while (app.getSystemService(NotificationManager::class.java).activeNotifications.none { it.tag == friend.deviceId }) delay(50)
            }
            val notification = app.getSystemService(NotificationManager::class.java).activeNotifications.first { it.tag == friend.deviceId }.notification
            assertEquals("New message", notification.extras.getCharSequence("android.text").toString())
            assertEquals("reply", notification.actions.single().remoteInputs.single().resultKey)
            assertNull(model.state.value.chatMessages.first { it.id == incomingID }.readAt)
            model.markRead(setOf(incomingID)); delay(150)
            assertNull(model.state.value.chatMessages.first { it.id == incomingID }.readAt) // background/notification is not read
            LocalNotifications.visibleFriend = friend.deviceId
            model.markRead(setOf(incomingID))
            withTimeout(5000) { model.state.first { it.chatMessages.first { m -> m.id == incomingID }.readReceiptQueued } }
            assertTrue(writes.any { ChatContent.decode(friend.decrypt(PacketCodec.decode(it)))?.let { c -> c.kind == "B" && c.id == incomingID } == true })
            LocalNotifications.visibleFriend = null
            instrumentation.runOnMainSync {
                model.send(friend.deviceId, "one tap")
                model.send(friend.deviceId, "one tap")
            }
            val sent = withTimeout(10000) { model.state.first { it.sending.isEmpty() && it.chatMessages.any { m -> m.outgoing } } }.chatMessages.single { it.outgoing }
            assertEquals("one tap", sent.body)
            fun ack(sender: LabCrypto) = wire.onFrame("test", PacketCodec.encode(sender.encrypt(destination, ChatContent("A", sent.id).encode(), System.currentTimeMillis())))
            ack(stranger); assertFalse(model.state.value.chatMessages.first { it.id == sent.id }.delivered)
            ack(friend); assertTrue(model.state.value.chatMessages.first { it.id == sent.id }.delivered)
            fun control(sender: LabCrypto, content: ChatContent) = wire.onFrame("test", PacketCodec.encode(sender.encrypt(destination, content.encode(), System.currentTimeMillis())))
            control(stranger, ChatContent("H", sent.id, index = 6))
            assertNull(model.state.value.chatMessages.first { it.id == sent.id }.reportedHops)
            control(friend, ChatContent("H", sent.id, index = 3))
            assertEquals(3, model.state.value.chatMessages.first { it.id == sent.id }.reportedHops)
            val readTime = System.currentTimeMillis()
            control(stranger, ChatContent("B", sent.id, readTime.toString().toByteArray()))
            assertNull(model.state.value.chatMessages.first { it.id == sent.id }.readAt)
            control(friend, ChatContent("B", sent.id, (readTime + 1000000).toString().toByteArray()))
            assertNull(model.state.value.chatMessages.first { it.id == sent.id }.readAt)
            control(friend, ChatContent("B", sent.id, readTime.toString().toByteArray()))
            assertEquals(readTime, model.state.value.chatMessages.first { it.id == sent.id }.readAt)
            val reactionID = UUID.randomUUID().toString()
            control(stranger, ChatContent("R", reactionID, "${sent.id}|😂".toByteArray()))
            assertNull(model.state.value.chatMessages.first { it.id == sent.id }.peerReaction)
            control(friend, ChatContent("R", reactionID, "${sent.id}|❤️".toByteArray()))
            assertEquals("❤️", ChatContent.reactionEmoji(model.state.value.chatMessages.first { it.id == sent.id }.peerReaction))
            assertEquals(1, model.state.value.chatMessages.count { it.id == sent.id })
            instrumentation.runOnMainSync { model.react(sent.id, "👍") }
            val reacted = withTimeout(10000) { model.state.first { it.chatMessages.first { m -> m.id == sent.id }.reactionPacket != null } }.chatMessages.first { it.id == sent.id }
            assertEquals("👍", ChatContent.reactionEmoji(reacted.myReaction))
            val eventID = reacted.myReaction!!.split('|')[1]
            control(stranger, ChatContent("A", eventID)); assertNotNull(model.state.value.chatMessages.first { it.id == sent.id }.reactionPacket)
            control(friend, ChatContent("A", eventID)); assertNull(model.state.value.chatMessages.first { it.id == sent.id }.reactionPacket)
            HistoryStore(app, name).use { store ->
                val saved = store.load().first { it.id == sent.id }
                assertEquals(readTime, saved.readAt); assertNotNull(saved.deliveredAt); assertEquals(3, saved.reportedHops); assertEquals("❤️", ChatContent.reactionEmoji(saved.peerReaction))
                assertEquals(saved, HistoryFormat.decode(HistoryFormat.encode(listOf(saved))).single())
            }
            val voiceID = UUID.randomUUID().toString(); val audio = ByteArray(2400) { (it % 233).toByte() }
            ChatContent.voice(voiceID, audio).reversed().forEach { part -> wire.onFrame("test", PacketCodec.encode(friend.encrypt(destination, part.encode(), System.currentTimeMillis()))) }
            val voice = model.state.value.chatMessages.single { it.id == voiceID }
            assertTrue(voice.voice); assertArrayEquals(audio, Base64.decode(voice.body, Base64.NO_WRAP))
            val photoBitmap = android.graphics.Bitmap.createBitmap(16, 16, android.graphics.Bitmap.Config.ARGB_8888)
            val photoStream = java.io.ByteArrayOutputStream(); photoBitmap.compress(android.graphics.Bitmap.CompressFormat.JPEG, 70, photoStream); photoBitmap.recycle()
            val photoBytes = photoStream.toByteArray(); val photoID = UUID.randomUUID().toString()
            ChatContent.image(photoID, photoBytes).reversed().forEach { part -> wire.onFrame("test", PacketCodec.encode(friend.encrypt(destination, part.encode(), System.currentTimeMillis()))) }
            val photo = model.state.value.chatMessages.single { it.id == photoID }
            assertTrue(photo.image); assertFalse(photo.voice); assertArrayEquals(photoBytes, Base64.decode(photo.body, Base64.NO_WRAP))
            assertTrue(writes.any { ChatContent.decode(friend.decrypt(PacketCodec.decode(it)))?.let { content -> content.kind == "A" && content.id == photoID } == true })
            HistoryStore(app, name).use { store ->
                assertTrue(store.load().first { it.id == sent.id }.delivered)
                assertTrue(store.load().first { it.id == voiceID }.voice)
            }
            val actionID = UUID.randomUUID().toString()
            model.sendFromNotification(friend.deviceId, "notification reply fixture", actionID)
            model.sendFromNotification(friend.deviceId, "notification reply fixture", actionID)
            assertEquals(1, model.state.value.chatMessages.count { it.body == "notification reply fixture" && it.outgoing })
        } finally {
            runCatching { model.forget(friend.deviceId); model.forget(stranger.deviceId) }
            LocalNotifications.visibleFriend = null; LocalNotifications.cancel(app, friend.deviceId)
            instrumentation.runOnMainSync { vmStore.clear() }
            app.deleteDatabase(name); java.io.File(app.noBackupFilesDir, "loka-outbox-v1-$name.json").delete()
            KeyStore.getInstance("AndroidKeyStore").apply { load(null); deleteEntry("loka-history-storage-v1-$name") }
        }
    }
}
