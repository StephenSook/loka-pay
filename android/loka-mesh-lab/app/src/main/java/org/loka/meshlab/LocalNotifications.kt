package org.loka.meshlab

import android.bluetooth.BluetoothAdapter
import android.bluetooth.BluetoothManager
import kotlinx.coroutines.flow.distinctUntilChanged
import kotlinx.coroutines.flow.map
import android.Manifest
import android.app.*
import android.content.*
import android.content.pm.PackageManager
import android.net.Uri
import android.os.Build
import android.os.IBinder
import androidx.core.app.NotificationCompat
import androidx.core.app.NotificationManagerCompat
import androidx.core.app.RemoteInput
import kotlinx.coroutines.*

object LocalNotifications {
    const val FRIEND_ACTION = "loka.friendDecision"
    const val REQUESTS = "loka.requests"
    const val CHAT = "loka.messages"
    const val CONNECTION = "loka.connection"
    const val REPLY = "loka.reply"
    const val OPEN = "loka.openFriend"
    const val ONGOING = 1
    @Volatile var visibleFriend: String? = null
    fun channels(context: Context) {
        val nm = context.getSystemService(NotificationManager::class.java)
        nm.createNotificationChannel(NotificationChannel(REQUESTS, "Friend requests", NotificationManager.IMPORTANCE_HIGH))
        nm.createNotificationChannel(NotificationChannel(CHAT, "Messages", NotificationManager.IMPORTANCE_HIGH))
        nm.createNotificationChannel(NotificationChannel(CONNECTION, "Local connection", NotificationManager.IMPORTANCE_LOW))
    }
    fun open(context: Context, friend: String = ""): PendingIntent = PendingIntent.getActivity(context, 0,
        Intent(context, MainActivity::class.java).setAction(OPEN).setData(Uri.parse("loka-notification://chat/$friend"))
            .putExtra("friend", friend).addFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP or Intent.FLAG_ACTIVITY_CLEAR_TOP), PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE)
    fun message(context: Context, friend: String, name: String, status: String = "New message", reply: Boolean = true) {
        if (visibleFriend == friend && status == "New message") return
        channels(context)
        if (Build.VERSION.SDK_INT >= 33 && context.checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED) return
        val builder = NotificationCompat.Builder(context, CHAT).setSmallIcon(R.drawable.ic_loka)
            .setContentTitle(name.ifBlank { "LOKA" }).setContentText(status).setCategory(NotificationCompat.CATEGORY_MESSAGE)
            .setVisibility(NotificationCompat.VISIBILITY_PRIVATE).setContentIntent(open(context, friend)).setAutoCancel(true)
            .setOnlyAlertOnce(true).setGroup("loka.chats")
        if (reply) {
            val intent = Intent(context, NotificationReplyReceiver::class.java).setAction(REPLY)
                .setData(Uri.parse("loka-notification://reply/$friend")).putExtra("friend", friend)
                .putExtra("actionID", java.util.UUID.randomUUID().toString())
            val flags = PendingIntent.FLAG_UPDATE_CURRENT or (if (Build.VERSION.SDK_INT >= 31) PendingIntent.FLAG_MUTABLE else 0)
            val action = NotificationCompat.Action.Builder(0, "Reply", PendingIntent.getBroadcast(context, 0, intent, flags))
                .addRemoteInput(RemoteInput.Builder("reply").setLabel("Message").build()).setAllowGeneratedReplies(false)
                .setSemanticAction(NotificationCompat.Action.SEMANTIC_ACTION_REPLY)
            if (Build.VERSION.SDK_INT >= 31) action.setAuthenticationRequired(true)
            builder.addAction(action.build())
        }
        NotificationManagerCompat.from(context).notify(friend, 2, builder.build())
    }
    @Synchronized fun requests(context: Context, entries: List<org.loka.core.ContactConsentBook.Entry>) {
        channels(context)
        val pending = entries.filter { !it.outgoing && it.phase == org.loka.core.ContactConsentBook.Phase.INCOMING }
        val ids = pending.map { it.request.id }.toSet()
        val prefs = context.getSharedPreferences("loka-profile", Context.MODE_PRIVATE)
        val previous = prefs.getStringSet("notified-request-ids", emptySet()).orEmpty().toSet()
        val manager = NotificationManagerCompat.from(context)
        (previous - ids).forEach { manager.cancel("request.$it", 3) }
        if (Build.VERSION.SDK_INT >= 33 && context.checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED) return
        pending.filter { it.request.id !in previous }.forEach { entry ->
            val builder = NotificationCompat.Builder(context, REQUESTS).setSmallIcon(R.drawable.ic_loka)
                .setContentTitle("Friend request").setContentText("${entry.peerName} wants to chat with you.")
                .setVisibility(NotificationCompat.VISIBILITY_PRIVATE).setAutoCancel(true).setOnlyAlertOnce(true)
                .setContentIntent(open(context))
            listOf(true to "Accept", false to "Decline").forEach { (accept, title) ->
                val intent = Intent(context, NotificationFriendActivity::class.java).setAction(FRIEND_ACTION)
                    .setData(Uri.parse("loka-notification://request/${entry.request.id}/$accept"))
                    .putExtra("request", entry.request.id).putExtra("accept", accept)
                    .addFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP or Intent.FLAG_ACTIVITY_CLEAR_TOP)
                val action = NotificationCompat.Action.Builder(0, title, PendingIntent.getActivity(context, 0, intent,
                    PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE))
                if (Build.VERSION.SDK_INT >= 31) action.setAuthenticationRequired(true)
                builder.addAction(action.build())
            }
            manager.notify("request.${entry.request.id}", 3, builder.build())
        }
        prefs.edit().putStringSet("notified-request-ids", ids.take(32).toSet()).apply()
    }
    fun cancel(context: Context, friend: String) { NotificationManagerCompat.from(context).cancel(friend, 2) }
}

class NotificationReplyReceiver : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent) {
        if (intent.action != LocalNotifications.REPLY) return
        val friend = intent.getStringExtra("friend") ?: return
        val text = RemoteInput.getResultsFromIntent(intent)?.getCharSequence("reply")?.toString() ?: return
        val actionID = intent.getStringExtra("actionID") ?: return
        if (!friend.matches(Regex("[0-9a-f]{64}")) || text.isBlank() || text.toByteArray().size > 1400) return
        val pending = goAsync()
        val app = context.applicationContext as LokaApplication
        app.notificationScope.launch {
            try {
                withTimeout(7000) {
                    while (!app.messages.state.value.ready) delay(100)
                    app.messages.sendFromNotification(friend, text, actionID)
                }
            } catch (_: Exception) {
                LocalNotifications.message(context, friend, "LOKA", "Reply not saved. Open LOKA to try again.", false)
            } finally { pending.finish() }
        }
    }
}

class LocalConnectionService : Service() {
    private val serviceScope = CoroutineScope(SupervisorJob() + Dispatchers.Main.immediate)
    private var receiverRegistered = false
    private val model get() = (application as LokaApplication).messages
    private val radioReceiver = object : BroadcastReceiver() {
        override fun onReceive(context: Context, intent: Intent) {
            if (intent.action != BluetoothAdapter.ACTION_STATE_CHANGED || !model.localConnectionEnabled) return
            // Read actual adapter state; never trust an exported broadcast's extras.
            val state = runCatching { getSystemService(BluetoothManager::class.java).adapter?.state }.getOrNull()
            when (state) {
                BluetoothAdapter.STATE_TURNING_OFF, BluetoothAdapter.STATE_OFF -> model.pauseForRadioChange()
                BluetoothAdapter.STATE_ON -> model.resumeLocalConnection(serviceAlreadyRunning = true)
            }
            updateNotification()
        }
    }
    override fun onBind(intent: Intent?): IBinder? = null
    private fun waitingCount(): Int {
        val now = System.currentTimeMillis()
        return model.state.value.chatMessages.count { it.outgoing && !it.delivered && now - it.timestamp < it.lifetime }
    }
    private fun notification(): Notification {
        val stop = PendingIntent.getService(this, 0, Intent(this, LocalConnectionService::class.java).setAction("stop"), PendingIntent.FLAG_IMMUTABLE)
        val radioOn = runCatching { getSystemService(BluetoothManager::class.java).adapter?.isEnabled == true }.getOrDefault(false)
        val status = when {
            !radioOn -> "Bluetooth is off · waiting for it to return"
            waitingCount() > 0 -> "${waitingCount()} ${if (waitingCount() == 1) "message" else "messages"} waiting for delivery"
            model.state.value.running -> "Listening for nearby messages · no Internet needed"
            else -> "Local connection paused · open LOKA to check"
        }
        return NotificationCompat.Builder(this, LocalNotifications.CONNECTION).setSmallIcon(R.drawable.ic_loka)
            .setContentTitle("LOKA local connection").setContentText(status)
            .setContentIntent(LocalNotifications.open(this)).setOngoing(true).setSilent(true)
            .addAction(0, "Turn off", stop).build()
    }
    private fun updateNotification() {
        getSystemService(NotificationManager::class.java).notify(LocalNotifications.ONGOING, notification())
    }
    override fun onCreate() {
        super.onCreate(); LocalNotifications.channels(this)
        startForeground(LocalNotifications.ONGOING, notification())
        val filter = IntentFilter(BluetoothAdapter.ACTION_STATE_CHANGED)
        // Bluetooth broadcasts can originate from the privileged Bluetooth process.
        if (Build.VERSION.SDK_INT >= 33) registerReceiver(radioReceiver, filter, Context.RECEIVER_EXPORTED)
        else registerReceiver(radioReceiver, filter)
        receiverRegistered = true
        serviceScope.launch {
            model.state.map { Triple(it.ready, it.running, waitingCount()) }.distinctUntilChanged().collect { (ready, _, _) ->
                // A system restart can arrive before the encrypted stores have loaded.
                if (ready && model.localConnectionEnabled) model.resumeLocalConnection(serviceAlreadyRunning = true)
                updateNotification()
            }
        }
    }
    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        if (intent?.action == "stop") {
            model.stop(); stopSelf(); return START_NOT_STICKY
        }
        if (!model.localConnectionEnabled) { stopSelf(); return START_NOT_STICKY }
        model.resumeLocalConnection(serviceAlreadyRunning = true)
        // Requests OS recovery after process eviction, never after an explicit force-stop.
        return START_STICKY
    }
    override fun onDestroy() {
        if (receiverRegistered) { unregisterReceiver(radioReceiver); receiverRegistered = false }
        serviceScope.cancel()
        super.onDestroy()
    }
}

/** Only the app/system-held immutable PendingIntent can enter this activity. */
class NotificationFriendActivity : Activity() {
    override fun onCreate(savedInstanceState: android.os.Bundle?) {
        super.onCreate(savedInstanceState)
        if (savedInstanceState == null && intent.action == LocalNotifications.FRIEND_ACTION) {
            val id = intent.getStringExtra("request")
            if (id != null && intent.hasExtra("accept")) {
                (application as LokaApplication).messages.decideNotificationRequest(id, intent.getBooleanExtra("accept", false))
            }
        }
        startActivity(Intent(this, MainActivity::class.java).addFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP or Intent.FLAG_ACTIVITY_CLEAR_TOP))
        finish()
    }
}
