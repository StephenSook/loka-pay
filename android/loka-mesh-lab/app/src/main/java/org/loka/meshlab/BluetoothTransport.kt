package org.loka.meshlab

import android.annotation.SuppressLint
import android.bluetooth.BluetoothAdapter
import android.bluetooth.BluetoothDevice
import android.bluetooth.BluetoothManager
import android.bluetooth.BluetoothServerSocket
import android.bluetooth.BluetoothSocket
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.os.Build
import kotlinx.coroutines.*
import org.loka.core.MAX_FRAME_BYTES
import org.loka.core.transport.LokaTransport
import org.loka.core.transport.TransportCapability
import org.loka.core.transport.TransportListener
import org.loka.core.transport.TransportPeer
import java.io.DataInputStream
import java.io.DataOutputStream
import java.util.UUID
import java.util.concurrent.ConcurrentHashMap

@SuppressLint("MissingPermission") // UI gates operations behind runtime permissions.
class BluetoothTransport(
    private val context: Context,
    private val scope: CoroutineScope,
    private val allowed: (String) -> Boolean,
    private val listener: TransportListener,
) : LokaTransport {
    override val capabilities = setOf(TransportCapability.DISCOVERY,
        TransportCapability.PEER_PREPARATION, TransportCapability.VISIBILITY)
    private fun log(text: String) = listener.onDiagnostic(text)
    private val adapter = context.getSystemService(BluetoothManager::class.java)?.adapter
    private val sockets = ConcurrentHashMap<String, BluetoothSocket>()
    private val connecting = ConcurrentHashMap<String, BluetoothSocket>()
    private var server: BluetoothServerSocket? = null
    private var acceptJob: Job? = null
    private var registered = false
    @Volatile private var running = false
    private val serviceId = UUID.fromString("aeb94f08-56ba-4a25-9c42-f1a01105ca7d")

    private val receiver = object : BroadcastReceiver() {
        override fun onReceive(context: Context, intent: Intent) {
            runCatching {
                if (intent.action == BluetoothAdapter.ACTION_STATE_CHANGED) {
                    if (intent.getIntExtra(BluetoothAdapter.EXTRA_STATE, -1) == BluetoothAdapter.STATE_OFF) {
                        log("Bluetooth disabled; stopping local transport")
                        stop()
                    }
                    return
                }
                if (intent.action == BluetoothAdapter.ACTION_DISCOVERY_FINISHED) {
                    log("Discovery finished"); return
                }
                @Suppress("DEPRECATION")
                val device = intent.getParcelableExtra<BluetoothDevice>(BluetoothDevice.EXTRA_DEVICE) ?: return
                listener.onPeer(TransportPeer(device.address, device.name ?: "Unnamed device",
                    device.bondState == BluetoothDevice.BOND_BONDED,
                    intent.getShortExtra(BluetoothDevice.EXTRA_RSSI, Short.MIN_VALUE)
                        .takeIf { it != Short.MIN_VALUE }?.toInt()))
            }.onFailure { log("Discovery event failed: ${it.message}") }
        }
    }

    @Synchronized override fun start() {
        check(adapter?.isEnabled == true) { "Enable Bluetooth in system settings first" }
        if (running) return
        try {
            val socket = adapter.listenUsingRfcommWithServiceRecord("LOKA Mesh Lab", serviceId)
            server = socket
            if (!registered) {
                val filter = IntentFilter().apply {
                    addAction(BluetoothAdapter.ACTION_STATE_CHANGED)
                    addAction(BluetoothDevice.ACTION_FOUND)
                    addAction(BluetoothDevice.ACTION_BOND_STATE_CHANGED)
                    addAction(BluetoothAdapter.ACTION_DISCOVERY_FINISHED)
                }
                if (Build.VERSION.SDK_INT >= 33) context.registerReceiver(receiver, filter, Context.RECEIVER_EXPORTED)
                else context.registerReceiver(receiver, filter)
                registered = true
            }
            refreshPeers()
            running = true
            listener.onRunning(true)
            acceptJob = scope.launch(Dispatchers.IO) {
                while (isActive && running) {
                    try { attach(socket.accept(), socket) }
                    catch (error: Exception) {
                        synchronized(this@BluetoothTransport) {
                            // An old accept loop must never stop a newly started listener.
                            if (running && server === socket) {
                                log("Listener failed: ${error.message}")
                                stop()
                            }
                        }
                        break
                    }
                }
            }
            log("Listening on paired Bluetooth RFCOMM; allow only experiment links")
        } catch (error: Exception) {
            stop()
            throw error
        }
    }
    override fun refreshPeers() {
        adapter?.bondedDevices?.forEach {
            listener.onPeer(TransportPeer(it.address, it.name ?: "Unnamed device", true))
        }
    }
    override fun discover() {
        check(running) { "Start lab first" }
        adapter?.cancelDiscovery()
        check(adapter?.startDiscovery() == true) { "Discovery could not start; check Bluetooth/location settings" }
        log("Discovery started")
    }
    override fun preparePeer(peer: String) {
        check(running) { "Start lab first" }
        check(allowed(peer)) { "Allow this experiment link first" }
        check(adapter?.getRemoteDevice(peer)?.createBond() == true) { "Pairing could not start" }
    }
    @Synchronized override fun connect(peer: String) {
        check(running) { "Start lab first" }
        check(allowed(peer)) { "Allow this experiment link first" }
        check(!sockets.containsKey(peer)) { "Already connected" }
        val generation = checkNotNull(server) { "Local listener is not running" }
        val device = checkNotNull(adapter).getRemoteDevice(peer)
        check(device.bondState == BluetoothDevice.BOND_BONDED) { "Pair the device first" }
        val socket = device.createRfcommSocketToServiceRecord(serviceId)
        if (connecting.putIfAbsent(peer, socket) != null) {
            socket.close(); log("Connection already pending"); return
        }
        scope.launch(Dispatchers.IO) {
            val timeout = launch { delay(15_000); runCatching { socket.close() } }
            try {
                adapter.cancelDiscovery()
                socket.connect(); timeout.cancel()
                attach(socket, generation)
            } catch (error: Exception) {
                runCatching { socket.close() }; log("Connect failed: ${error.message}")
            } finally { timeout.cancel(); connecting.remove(peer, socket) }
        }
    }
    @Synchronized private fun attach(socket: BluetoothSocket, generation: BluetoothServerSocket) {
        val peer = socket.remoteDevice.address
        if (!running || server !== generation || !socket.isConnected || !allowed(peer) ||
            sockets.putIfAbsent(peer, socket) != null) {
            socket.close(); log("Rejected link $peer (not allowed, stopped, stale, or duplicate)"); return
        }
        listener.onLink(peer, true)
        scope.launch(Dispatchers.IO) {
            try {
                val input = DataInputStream(socket.inputStream)
                while (isActive && running) {
                    val length = input.readInt()
                    require(length in 1..MAX_FRAME_BYTES) { "Invalid frame size" }
                    val frame = ByteArray(length).also(input::readFully)
                    listener.onFrame(peer, frame)
                }
            } catch (error: Exception) { if (running) log("Link $peer closed: ${error.message}") }
            finally {
                closeLink(peer, socket)
            }
        }
    }
    override fun send(peer: String, frame: ByteArray) {
        require(frame.size in 1..MAX_FRAME_BYTES)
        val socket = sockets[peer] ?: return
        scope.launch(Dispatchers.IO) {
            try {
                synchronized(socket) {
                    DataOutputStream(socket.outputStream).apply {
                        writeInt(frame.size); write(frame); flush()
                    }
                }
            } catch (error: Exception) {
                log("Send failed: ${error.message}"); closeLink(peer, socket)
            }
        }
    }
    @Synchronized private fun closeLink(peer: String, socket: BluetoothSocket) {
        runCatching { socket.close() }
        // Stale read/write completions may not disconnect a replacement connection.
        if (sockets.remove(peer, socket)) listener.onLink(peer, false)
    }
    @Synchronized override fun disconnect(peer: String) {
        connecting.remove(peer)?.let { runCatching { it.close() } }
        sockets.remove(peer)?.let { runCatching { it.close() }; listener.onLink(peer, false) }
    }
    @Synchronized override fun stop() {
        running = false
        runCatching { adapter?.cancelDiscovery() }
        runCatching { server?.close() }; server = null
        acceptJob?.cancel(); acceptJob = null
        connecting.keys.toList().forEach(::disconnect)
        sockets.keys.toList().forEach(::disconnect)
        if (registered) {
            runCatching { context.unregisterReceiver(receiver) }
            registered = false
        }
        listener.onRunning(false)
    }
}
