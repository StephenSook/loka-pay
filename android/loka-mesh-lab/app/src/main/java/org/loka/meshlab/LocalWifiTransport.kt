package org.loka.meshlab

import android.content.Context
import android.net.*
import android.net.nsd.NsdManager
import android.net.nsd.NsdServiceInfo
import kotlinx.coroutines.*
import org.loka.core.transport.*
import java.io.DataInputStream
import java.io.DataOutputStream
import java.net.InetSocketAddress
import java.net.ServerSocket
import java.net.Socket
import java.util.UUID
import java.util.concurrent.ConcurrentHashMap

/** Supplementary shared-Wi-Fi path. Bound to Wi-Fi, never cellular/default Internet routing.
 * Discovery is untrusted. Packet-v0 still authenticates every message at the mesh boundary. */
class LocalWifiTransport(private val context: Context, private val scope: CoroutineScope,
    private val allowed: (String) -> Boolean, private val listener: TransportListener) : LokaTransport {
    override val capabilities = emptySet<TransportCapability>()
    private val connectivity = context.getSystemService(ConnectivityManager::class.java)
    private val nsd = context.getSystemService(NsdManager::class.java)
    private val sockets = ConcurrentHashMap<String, Socket>()
    private val queueLoads = ConcurrentHashMap<String, java.util.concurrent.atomic.AtomicInteger>()
    override fun queuedBytes(peer: String) = queueLoads[peer]?.get()?.coerceAtLeast(0) ?: 0
    private val queues = ConcurrentHashMap<String, kotlinx.coroutines.channels.Channel<ByteArray>>()
    private val jobs = ConcurrentHashMap<String, Job>()
    private var server: ServerSocket? = null
    private var registration: NsdManager.RegistrationListener? = null
    private var callback: ConnectivityManager.NetworkCallback? = null
    private var generation = 0
    private var boundNetwork: Network? = null
    private var boundAddress: java.net.InetAddress? = null
    @Synchronized override fun start() {
        if (callback != null) return
        val cb = object : ConnectivityManager.NetworkCallback() {
            override fun onLinkPropertiesChanged(network: Network, properties: LinkProperties) {
                synchronized(this@LocalWifiTransport) {
                    if (callback !== this) return
                    val address = properties.linkAddresses.map { it.address }.firstOrNull { it.isSiteLocalAddress && it is java.net.Inet4Address } ?: return
                    if (server != null && boundNetwork == network && boundAddress == address) return
                    closeLinks(); boundNetwork = network; boundAddress = address
                    open(address)
                }
            }
            override fun onLost(network: Network) { synchronized(this@LocalWifiTransport) { if (callback === this && boundNetwork == network) closeLinks() } }
        }
        callback = cb
        connectivity.registerNetworkCallback(NetworkRequest.Builder().addTransportType(NetworkCapabilities.TRANSPORT_WIFI).build(), cb)
    }
    private fun open(address: java.net.InetAddress) {
        val epoch = ++generation
        val socket = runCatching { ServerSocket().apply { reuseAddress = true; bind(InetSocketAddress(address, 0), 4) } }.getOrElse {
            listener.onDiagnostic("Local Wi-Fi listener unavailable"); return
        }
        server = socket
        val reg = object : NsdManager.RegistrationListener {
            override fun onServiceRegistered(info: NsdServiceInfo) = Unit
            override fun onRegistrationFailed(info: NsdServiceInfo, error: Int) { listener.onDiagnostic("Local Wi-Fi discovery unavailable") }
            override fun onServiceUnregistered(info: NsdServiceInfo) = Unit
            override fun onUnregistrationFailed(info: NsdServiceInfo, error: Int) = Unit
        }
        registration = reg
        runCatching { nsd.registerService(NsdServiceInfo().apply {
            serviceName = "loka-${UUID.randomUUID().toString().take(8)}"; serviceType = "_loka-v0._tcp."; port = socket.localPort
        }, NsdManager.PROTOCOL_DNS_SD, reg) }
        scope.launch(Dispatchers.IO) {
            while (!socket.isClosed) {
                val client = try { socket.accept() } catch (_: Exception) { break }
                val id = "wifi:${UUID.randomUUID()}"
                synchronized(this@LocalWifiTransport) {
                    if (generation != epoch || sockets.size >= 4 || !allowed(id)) { client.close(); return@synchronized }
                    client.soTimeout = 30_000; client.tcpNoDelay = true
                    sockets[id] = client
                    val queue = kotlinx.coroutines.channels.Channel<ByteArray>(32); queues[id] = queue
                    val load = java.util.concurrent.atomic.AtomicInteger(); queueLoads[id] = load
                    jobs[id] = scope.launch(Dispatchers.IO) {
                        try {
                            val input = DataInputStream(client.getInputStream())
                            // Short protocol preface before announcing the route.
                            require(input.readInt() == 0x4c574630)
                            DataOutputStream(client.getOutputStream()).apply { writeInt(0x4c574630); flush() }
                            launch {
                                try {
                                    val output = DataOutputStream(client.getOutputStream())
                                    var first = true
                                    for (frame in queue) {
                                        output.writeInt(frame.size); output.write(frame); output.flush(); if (load.addAndGet(-frame.size) == 0) listener.onTransferOpportunity(id)
                                        if (first) { first = false; listener.onDiagnostic("Local Wi-Fi: first packet written") }
                                    }
                                } finally { runCatching { client.close() } }
                            }
                            listener.onPeer(TransportPeer(id, "Nearby LOKA device", true))
                            listener.onLink(id, true)
                            listener.onDiagnostic("Local Wi-Fi: link established")
                            var firstReceived = true
                            var lastFrame = 0L
                            while (isActive && !client.isClosed) {
                                val length = input.readInt(); require(length in 1..16384)
                                val wait = 63 - (System.nanoTime() - lastFrame) / 1_000_000
                                if (wait > 0) delay(wait)
                                lastFrame = System.nanoTime()
                                val frame = ByteArray(length); input.readFully(frame)
                                if (firstReceived) { firstReceived = false; listener.onDiagnostic("Local Wi-Fi: first packet received") }
                                listener.onFrame(id, frame)
                            }
                        } catch (_: Exception) { /* Timeout/disconnect returns delivery to other paths. */ }
                        finally { disconnect(id) }
                    }
                }
            }
        }
    }
    override fun send(peer: String, frame: ByteArray) {
        require(frame.size in 1..16384)
        val queue = checkNotNull(queues[peer]); val load = checkNotNull(queueLoads[peer])
        load.addAndGet(frame.size)
        if (!queue.trySend(frame.clone()).isSuccess) { load.addAndGet(-frame.size); error("Local Wi-Fi queue full") }
    }
    override fun refreshPeers() = Unit
    override fun connect(peer: String) = Unit
    override fun disconnect(peer: String) {
        queueLoads.remove(peer)
        queues.remove(peer)?.close()
        sockets.remove(peer)?.let { runCatching { it.close() }; listener.onLink(peer, false) }
        jobs.remove(peer)?.cancel()
    }
    private fun closeLinks() {
        generation++; boundNetwork = null; boundAddress = null
        runCatching { server?.close() }; server = null
        registration?.let { runCatching { nsd.unregisterService(it) } }; registration = null
        sockets.keys.toList().forEach(::disconnect)
    }
    @Synchronized override fun stop() {
        callback?.let { runCatching { connectivity.unregisterNetworkCallback(it) } }; callback = null
        closeLinks()
    }
}
