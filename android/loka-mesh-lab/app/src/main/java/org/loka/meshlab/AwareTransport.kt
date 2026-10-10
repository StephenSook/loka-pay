package org.loka.meshlab

import android.Manifest
import android.annotation.SuppressLint
import android.content.*
import android.content.pm.PackageManager
import android.net.*
import android.net.wifi.aware.*
import android.os.*
import kotlinx.coroutines.*
import kotlinx.coroutines.channels.Channel
import org.loka.core.transport.*
import java.io.DataInputStream
import java.io.DataOutputStream
import java.net.*
import java.util.UUID
import java.util.concurrent.ConcurrentHashMap

/** Android Aware experiment; discovery/PSK exchange is not authenticated contact identity. */
@SuppressLint("MissingPermission")
@androidx.annotation.RequiresApi(29)
class AwareTransport(private val context: Context, private val scope: CoroutineScope,
    private val allowed: (String) -> Boolean, private val listener: TransportListener) : LokaTransport {
    override val capabilities = emptySet<TransportCapability>()
    private val handler = Handler(Looper.getMainLooper())
    private val manager = context.getSystemService(WifiAwareManager::class.java)
    private val connectivity = context.getSystemService(ConnectivityManager::class.java)
    private val token = UUID.randomUUID().toString().replace("-", "")
    private var enabled = false
    private var attaching = false
    private var generation = 0
    private var session: WifiAwareSession? = null
    private var publisher: PublishDiscoverySession? = null
    private var subscriber: SubscribeDiscoverySession? = null
    private var registered = false
    private val attempts = linkedMapOf<String, Long>()
    private val links = ConcurrentHashMap<String, Link>()
    private var sequence = 0
    private class Link(val id: String, val nonce: String, val psk: String, val server: ServerSocket?) {
        var callback: ConnectivityManager.NetworkCallback? = null
        @Volatile var socket: Socket? = null
        var opening = false
        var replyCount = 0
        @Volatile var up = false
        val queuedBytes = java.util.concurrent.atomic.AtomicInteger()
        val queue = Channel<ByteArray>(32)
        var job: Job? = null
    }
    private val receiver = object : BroadcastReceiver() {
        override fun onReceive(c: Context, intent: Intent) {
            if (manager?.isAvailable != true) { clear(); listener.onDiagnostic("Wi-Fi Aware temporarily unavailable; other routes remain enabled") }
            else attach()
        }
    }
    override fun start() { handler.post {
        if (enabled) return@post
        val permission = if (Build.VERSION.SDK_INT >= 33) Manifest.permission.NEARBY_WIFI_DEVICES else Manifest.permission.ACCESS_FINE_LOCATION
        if (!context.packageManager.hasSystemFeature(PackageManager.FEATURE_WIFI_AWARE) || context.checkSelfPermission(permission) != PackageManager.PERMISSION_GRANTED) {
            listener.onDiagnostic("Wi-Fi Aware unavailable or nearby Wi-Fi permission missing"); return@post
        }
        enabled = true
        val filter = IntentFilter(WifiAwareManager.ACTION_WIFI_AWARE_STATE_CHANGED)
        if (Build.VERSION.SDK_INT >= 33) context.registerReceiver(receiver, filter, Context.RECEIVER_EXPORTED) else context.registerReceiver(receiver, filter)
        registered = true; attach()
    } }
    private fun attach() {
        if (!enabled || attaching || session != null || manager?.isAvailable != true) return
        attaching = true
        val epoch = generation
        try { manager.attach(object : AttachCallback() {
            override fun onAttached(value: WifiAwareSession) {
                if (!enabled || epoch != generation) { value.close(); return }
                attaching = false
                session = value
                try { value.publish(PublishConfig.Builder().setServiceName("loka-aware-v0").setServiceSpecificInfo(token.toByteArray()).build(), object : DiscoverySessionCallback() {
                    override fun onPublishStarted(s: PublishDiscoverySession) { if (session !== value) s.close() else publisher = s }
                    override fun onMessageReceived(peer: PeerHandle, message: ByteArray) {
                        if (session !== value) return
                        val fields = org.loka.core.AwareDiscovery.decode(message, "Q") ?: return
                        val id = "aware:in:${fields[1]}"; val pub = publisher ?: return
                        links[id]?.let { existing ->
                            if (existing.nonce == fields[2] && existing.psk == fields[3] && existing.replyCount++ < 2) sendDiscovery(pub, peer, "A|$token|${existing.nonce}|${existing.psk}".toByteArray())
                            return
                        }
                        if (!admit(id)) return
                        val server = runCatching { ServerSocket(0).apply { soTimeout = 20_000 } }.getOrNull() ?: return
                        val link = Link(id, fields[2], fields[3], server); links[id] = link
                        request(pub, peer, link)
                        sendDiscovery(pub, peer, "A|$token|${link.nonce}|${link.psk}".toByteArray())
                    }
                    override fun onSessionConfigFailed() { if (session === value) { clear(); retryAttach() } }
                    override fun onSessionTerminated() { if (session === value) { clear(); retryAttach() } }
                }, handler)
                value.subscribe(SubscribeConfig.Builder().setServiceName("loka-aware-v0").build(), object : DiscoverySessionCallback() {
                    override fun onSubscribeStarted(s: SubscribeDiscoverySession) { if (session !== value) s.close() else subscriber = s }
                    override fun onServiceDiscovered(peer: PeerHandle, info: ByteArray?, filter: MutableList<ByteArray>?) {
                        if (session !== value || info == null || info.size != 32) return
                        val remote = info.toString(Charsets.US_ASCII)
                        if (!remote.matches(Regex("[a-f0-9]{32}")) || token <= remote) return
                        val id = "aware:out:$remote"; val sub = subscriber ?: return
                        if (!admit(id) || links.containsKey(id)) return
                        val nonce = UUID.randomUUID().toString().replace("-", "")
                        val link = Link(id, nonce, UUID.randomUUID().toString(), null); links[id] = link
                        sendDiscovery(sub, peer, "Q|$token|$nonce|${link.psk}".toByteArray())
                        for (delay in listOf(3_000L, 6_000L)) handler.postDelayed({
                            if (links[id] === link && link.callback == null && subscriber === sub)
                                sendDiscovery(sub, peer, "Q|$token|$nonce|${link.psk}".toByteArray())
                        }, delay)
                        expireSetup(link)
                    }
                    override fun onMessageReceived(peer: PeerHandle, message: ByteArray) {
                        if (session !== value) return
                        val fields = org.loka.core.AwareDiscovery.decode(message, "A") ?: return
                        val link = links["aware:out:${fields[1]}"] ?: return
                        if (link.nonce != fields[2] || link.psk != fields[3] || link.callback != null) return
                        subscriber?.let { request(it, peer, link) }
                    }
                    override fun onSessionConfigFailed() { if (session === value) { clear(); retryAttach() } }
                    override fun onSessionTerminated() { if (session === value) { clear(); retryAttach() } }
                }, handler) } catch (_: Exception) { clear(); retryAttach() }
            }
            override fun onAttachFailed() { if (epoch == generation) { attaching = false; retryAttach() } }
        }, handler) } catch (_: Exception) { attaching = false; listener.onDiagnostic("Wi-Fi Aware could not start; other routes remain available") }
    }
    private fun sendDiscovery(session: DiscoverySession, peer: PeerHandle, message: ByteArray) {
        runCatching { session.sendMessage(peer, sequence++, message) }
    }
    private fun retryAttach() { handler.postDelayed({ attach() }, 15_000) }
    private fun admit(id: String): Boolean {
        val now = SystemClock.elapsedRealtime()
        attempts.entries.removeAll { now - it.value >= 30_000 }
        if (!enabled || links.size >= 2 || !allowed(id) || id in attempts || attempts.size >= 32) return false
        attempts[id] = now; return true
    }
    private fun expireSetup(link: Link) { handler.postDelayed({ if (links[link.id] === link && !link.up) close(link.id) }, 25_000) }
    private fun request(discovery: DiscoverySession, peer: PeerHandle, link: Link) {
        try {
            val builder = WifiAwareNetworkSpecifier.Builder(discovery, peer).setPskPassphrase(link.psk)
            link.server?.let { builder.setPort(it.localPort).setTransportProtocol(6) }
            val callback = object : ConnectivityManager.NetworkCallback() {
                override fun onCapabilitiesChanged(network: Network, capabilities: NetworkCapabilities) { handler.post {
                    if (links[link.id] !== link || link.opening) return@post
                    val info = capabilities.transportInfo as? WifiAwareNetworkInfo ?: return@post
                    val address = info.peerIpv6Addr ?: return@post
                    if (link.server == null && info.port !in 1..65535) return@post
                    link.opening = true
                    link.job = scope.launch(Dispatchers.IO) {
                        try {
                            val socket = if (link.server != null) {
                                var accepted: Socket? = null
                                repeat(4) {
                                    if (accepted == null) {
                                        val candidate = link.server.accept()
                                        if (candidate.inetAddress.address.contentEquals(address.address)) accepted = candidate else candidate.close()
                                    }
                                }
                                checkNotNull(accepted)
                            } else network.socketFactory.createSocket().apply { connect(InetSocketAddress(address, info.port), 10_000) }
                            link.socket = socket; link.server?.close()
                            socket.soTimeout = 30_000; socket.tcpNoDelay = true
                            val input = DataInputStream(socket.getInputStream()); val output = DataOutputStream(socket.getOutputStream())
                            output.writeInt(0x4c574630); output.flush(); require(input.readInt() == 0x4c574630)
                            withContext(Dispatchers.Main) {
                                check(links[link.id] === link && allowed(link.id))
                                link.up = true; listener.onPeer(TransportPeer(link.id, "Nearby LOKA device", true)); listener.onLink(link.id, true)
                                listener.onDiagnostic("Wi-Fi Aware link established (no access point)")
                            }
                            launch { try {
                                var first = true
                                for (frame in link.queue) {
                                    output.writeInt(frame.size); output.write(frame); output.flush(); if (link.queuedBytes.addAndGet(-frame.size) == 0) listener.onTransferOpportunity(link.id)
                                    if (first) { first = false; listener.onDiagnostic("Wi-Fi Aware: first packet written") }
                                }
                            } finally { runCatching { socket.close() } } }
                            var firstReceived = true
                            while (isActive) {
                                val count = input.readInt(); require(count in 1..16384)
                                val frame = ByteArray(count); input.readFully(frame)
                                if (firstReceived) { firstReceived = false; listener.onDiagnostic("Wi-Fi Aware: first packet received") }
                                listener.onFrame(link.id, frame); delay(250)
                            }
                        } catch (_: Exception) { /* bounded retry via discovery */ }
                        finally { runCatching { link.socket?.close() }; handler.post { if (links[link.id] === link) close(link.id) } }
                    }
                } }
                override fun onUnavailable() { handler.post { if (links[link.id] === link) close(link.id) } }
                override fun onLost(network: Network) = onUnavailable()
            }
            link.callback = callback
            connectivity.requestNetwork(NetworkRequest.Builder().addTransportType(NetworkCapabilities.TRANSPORT_WIFI_AWARE).setNetworkSpecifier(builder.build()).build(), callback, 20_000)
            expireSetup(link)
        } catch (_: Exception) { close(link.id) }
    }
    private fun close(id: String) {
        val link = links.remove(id) ?: return
        link.callback?.let { runCatching { connectivity.unregisterNetworkCallback(it) } }
        runCatching { link.server?.close() }; runCatching { link.socket?.close() }; link.queue.close(); link.job?.cancel()
        if (link.up) listener.onLink(id, false)
    }
    private fun clear() {
        generation++
        links.keys.toList().forEach(::close)
        val old = session; session = null; publisher?.close(); publisher = null; subscriber?.close(); subscriber = null; old?.close(); attaching = false
    }
    override fun queuedBytes(peer: String) = links[peer]?.queuedBytes?.get()?.coerceAtLeast(0) ?: 0
    override fun send(peer: String, frame: ByteArray) {
        require(frame.size in 1..16384)
        val link = checkNotNull(links[peer]); check(link.up)
        link.queuedBytes.addAndGet(frame.size)
        if (!link.queue.trySend(frame.clone()).isSuccess) { link.queuedBytes.addAndGet(-frame.size); error("Wi-Fi Aware queue full") }
    }
    override fun refreshPeers() = Unit
    override fun connect(peer: String) = Unit
    override fun disconnect(peer: String) { handler.post { close(peer) } }
    override fun stop() { handler.post { enabled = false; if (registered) { context.unregisterReceiver(receiver); registered = false }; clear(); attempts.clear() } }
}
