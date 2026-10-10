package org.loka.meshlab

import android.annotation.SuppressLint
import android.app.Application
import android.bluetooth.*
import android.bluetooth.le.*
import android.os.Handler
import android.os.Looper
import android.os.ParcelUuid
import android.os.SystemClock
import org.loka.core.LinkIngressBudget
import org.loka.core.transport.*
import java.util.ArrayDeque
import java.util.concurrent.atomic.AtomicInteger

/** Android central for the existing GATT contract. All session state is main-looper confined.
 * Service tokens elect one initiator, not identity. Only packet-layer trust authorizes chat. */
@SuppressLint("MissingPermission")
@Suppress("DEPRECATION")
class BleClientTransport(private val app: Application, private val token: ByteArray,
    private val allowed: (String) -> Boolean, private val listener: TransportListener) : LokaTransport {
    override val capabilities = emptySet<TransportCapability>()
    private val handler = Handler(Looper.getMainLooper())
    private val queueLoads = java.util.concurrent.ConcurrentHashMap<String, Int>()
    private val postedBytes = java.util.concurrent.ConcurrentHashMap<String, Int>()
    override fun queuedBytes(peer: String) = (queueLoads[peer] ?: 0) + (postedBytes[peer]?.coerceAtLeast(0) ?: 0)
    private val sessions = mutableMapOf<String, Session>()
    private val candidates = linkedMapOf<String, BluetoothDevice>()
    private val attempted = mutableMapOf<String, Long>()
    private var scanner: BluetoothLeScanner? = null
    private var scanning: ScanCallback? = null
    private var running = false
    private var generation = 0L
    private var scanFailures = 0
    private var signalPoll = 0
    private val pendingPosts = AtomicInteger()
    private val probe = byteArrayOf(0x7f, 0x4c, 0x4f, 0x4b, 0x41, 1)
    private val reply = byteArrayOf(0x7f, 0x4c, 0x4f, 0x4b, 0x41, 2)
    private class Session(val id: String) {
        var gatt: BluetoothGatt? = null
        var rx: BluetoothGattCharacteristic? = null
        var ready = false
        var subscribed = false
        var writing = false
        var readingSignal = false
        var operation = 0L
        val queue = ArrayDeque<ByteArray>()
        val assembler = BleFraming.Assembler(SystemClock::elapsedRealtime)
        val budget = LinkIngressBudget(SystemClock::elapsedRealtime)
    }
    private fun log(text: String) {
        if (BuildConfig.DEBUG) android.util.Log.i("LokaBle", text)
        listener.onDiagnostic(text)
    }
    private fun id(device: BluetoothDevice) = "ble:out:" + device.address
    private fun current(gatt: BluetoothGatt): Session? = sessions[id(gatt.device)]?.takeIf { it.gatt === gatt }
    private fun deadline(s: Session, ms: Long) {
        val operation = ++s.operation
        handler.postDelayed({ if (sessions[s.id] === s && s.operation == operation) fail(s, "BLE connection operation timed out") }, ms)
    }
    private fun fail(s: Session, reason: String) {
        if (sessions[s.id] !== s) return
        sessions.remove(s.id); queueLoads.remove(s.id); s.operation++
        attempted[s.id] = SystemClock.elapsedRealtime()
        runCatching { s.gatt?.disconnect() }; runCatching { s.gatt?.close() }
        listener.onLink(s.id, false)
        listener.onPeer(TransportPeer(s.id, "Nearby LOKA device", false))
        log(reason)
    }
    private fun on(gatt: BluetoothGatt, action: (Session) -> Unit) {
        handler.post {
            val s = current(gatt) ?: return@post
            if (!running || !allowed(s.id)) { fail(s, "BLE connection stopped or blocked"); return@post }
            runCatching { action(s) }.onFailure { fail(s, "BLE connection operation failed") }
        }
    }
    private val callback = object : BluetoothGattCallback() {
        override fun onConnectionStateChange(g: BluetoothGatt, status: Int, state: Int) = on(g) { s ->
            if (status != BluetoothGatt.GATT_SUCCESS || state == BluetoothProfile.STATE_DISCONNECTED) fail(s, "BLE nearby route disconnected")
            else if (state == BluetoothProfile.STATE_CONNECTED) {
                deadline(s, 20_000)
                check(g.discoverServices())
            }
        }
        override fun onServicesDiscovered(g: BluetoothGatt, status: Int) = on(g) { s ->
            check(status == BluetoothGatt.GATT_SUCCESS)
            val service = checkNotNull(g.getService(BleTransport.SERVICE))
            s.rx = checkNotNull(service.getCharacteristic(BleTransport.RX))
            val tx = checkNotNull(service.getCharacteristic(BleTransport.TX))
            check(s.rx!!.properties and BluetoothGattCharacteristic.PROPERTY_WRITE != 0)
            check(tx.properties and BluetoothGattCharacteristic.PROPERTY_INDICATE != 0)
            check(g.setCharacteristicNotification(tx, true))
            val cccd = checkNotNull(tx.getDescriptor(BleTransport.CCCD))
            cccd.value = BluetoothGattDescriptor.ENABLE_INDICATION_VALUE
            deadline(s, 12_000); check(g.writeDescriptor(cccd))
        }
        override fun onDescriptorWrite(g: BluetoothGatt, descriptor: BluetoothGattDescriptor, status: Int) = on(g) { s ->
            check(descriptor.uuid == BleTransport.CCCD && status == BluetoothGatt.GATT_SUCCESS)
            s.subscribed = true
            s.queue.add(probe); pump(s)
            // Probe reply must arrive even if the write callback succeeds.
            handler.postDelayed({ if (sessions[s.id] === s && !s.ready) fail(s, "BLE local connection check timed out") }, 15_000)
        }
        override fun onReadRemoteRssi(g: BluetoothGatt, rssi: Int, status: Int) = on(g) { s ->
            if (s.readingSignal) {
                s.readingSignal = false; s.operation++
                if (status == BluetoothGatt.GATT_SUCCESS && rssi in -127..-1)
                    listener.onPeer(TransportPeer(s.id, "Nearby LOKA device", s.ready, rssi))
                pump(s)
            }
        }
        override fun onCharacteristicWrite(g: BluetoothGatt, characteristic: BluetoothGattCharacteristic, status: Int) = on(g) { s ->
            check(characteristic === s.rx && s.writing && status == BluetoothGatt.GATT_SUCCESS)
            s.operation++; s.writing = false; s.queue.poll(); queueLoads[s.id] = s.queue.sumOf { it.size }; pump(s)
            if (s.ready && s.queue.isEmpty() && !s.writing) listener.onTransferOpportunity(s.id)
        }
        override fun onCharacteristicChanged(g: BluetoothGatt, characteristic: BluetoothGattCharacteristic) {
            // Copy legacy mutable values before crossing threads. API 33+ uses the overload below.
            if (android.os.Build.VERSION.SDK_INT < 33) receive(g, characteristic.uuid, characteristic.value?.clone() ?: byteArrayOf())
        }
        override fun onCharacteristicChanged(g: BluetoothGatt, characteristic: BluetoothGattCharacteristic, value: ByteArray) = receive(g, characteristic.uuid, value.clone())
    }
    private fun receive(g: BluetoothGatt, characteristic: java.util.UUID, bytes: ByteArray) {
        if (pendingPosts.incrementAndGet() > 128) { pendingPosts.decrementAndGet(); return }
        handler.post {
            try {
                val s = current(g) ?: return@post
                if (characteristic != BleTransport.TX || !allowed(s.id)) return@post
                if (bytes.contentEquals(reply) && s.subscribed && !s.ready) {
                    s.ready = true
                    listener.onPeer(TransportPeer(s.id, "Nearby LOKA device", true))
                    listener.onLink(s.id, true); log("BLE automatic outgoing route ready")
                } else if (s.ready) {
                    runCatching { s.assembler.accept(bytes) }.onSuccess { frame ->
                        if (frame != null && s.budget.take()) listener.onFrame(s.id, frame)
                    }.onFailure { fail(s, "Malformed BLE frame") }
                }
            } finally { pendingPosts.decrementAndGet() }
        }
    }
    private fun open(device: BluetoothDevice) {
        val key = id(device); val now = SystemClock.elapsedRealtime()
        if (!running || !allowed(key) || key in sessions || sessions.size >= 4) return
        if (attempted[key]?.let { now - it < 30_000 } == true) return
        attempted[key] = now
        val s = Session(key); sessions[key] = s
        runCatching {
            s.gatt = checkNotNull(device.connectGatt(app, false, callback, BluetoothDevice.TRANSPORT_LE))
            deadline(s, 20_000)
        }.onFailure { fail(s, "BLE connection could not start") }
    }
    override fun start() { handler.post {
        if (running) return@post
        val adapter = app.getSystemService(BluetoothManager::class.java).adapter
        if (adapter?.isEnabled != true) return@post
        scanner = adapter.bluetoothLeScanner ?: return@post
        running = true
        val poll = ++signalPoll
        handler.postDelayed(object : Runnable {
            override fun run() {
                if (!running || poll != signalPoll) return
                sessions.values.toList().filter { it.ready && !it.writing && !it.readingSignal && it.queue.isEmpty() }.forEach { s ->
                    if (runCatching { s.gatt?.readRemoteRssi() }.getOrDefault(false) == true) {
                        s.readingSignal = true; deadline(s, 12_000)
                    }
                }
                handler.postDelayed(this, 10_000)
            }
        }, 10_000)
        val scan = object : ScanCallback() {
            override fun onScanResult(type: Int, result: ScanResult) { handler.post {
                if (!running || scanning !== this) return@post
                // RSSI is a radio measurement, independent of Android's initiator token.
                // Apple advertises the service without that token; do not discard its signal.
                listener.onPeer(TransportPeer(id(result.device), "Nearby LOKA device",
                    sessions[id(result.device)]?.ready == true, result.rssi.takeIf { it in -127..-1 }))
                val remote = result.scanRecord?.getServiceData(ParcelUuid(BleTransport.SERVICE))
                listener.onPeer(TransportPeer(id(result.device), "Nearby LOKA device", true, result.rssi))
                if (!BleDiscovery.initiates(token, remote)) return@post
                scanFailures = 0
                val key = id(result.device)
                if (key !in candidates && candidates.size >= 32) {
                    val victim = candidates.keys.firstOrNull { it !in sessions } ?: return@post
                    candidates.remove(victim); attempted.remove(victim)
                }
                candidates[key] = result.device
                listener.onPeer(TransportPeer(key, "Nearby LOKA device", true, result.rssi))
                open(result.device)
            } }
            override fun onScanFailed(errorCode: Int) { handler.post {
                if (scanning === this) {
                    stopScanning()
                    sessions.values.toList().forEach { fail(it, "BLE discovery interrupted") }
                    val currentGeneration = generation
                    if (++scanFailures <= 3) {
                        log("BLE discovery interrupted; retrying shortly")
                        handler.postDelayed({ if (generation == currentGeneration) start() }, 30_000)
                    } else log("BLE discovery unavailable; turn local connection off and on to retry")
                }
            } }
        }
        scanning = scan
        runCatching { scanner?.startScan(listOf(ScanFilter.Builder().setServiceUuid(ParcelUuid(BleTransport.SERVICE)).build()),
            ScanSettings.Builder().setScanMode(ScanSettings.SCAN_MODE_LOW_POWER).build(), scan) }
            .onFailure { log("BLE discovery unavailable"); stopScanning() }
    } }
    private fun stopScanning() {
        scanning?.let { runCatching { scanner?.stopScan(it) } }; scanning = null; scanner = null; running = false
    }
    override fun stop() { handler.post {
        generation++; scanFailures = 0
        stopScanning(); sessions.values.toList().forEach { fail(it, "BLE client stopped") }; candidates.clear(); attempted.clear()
    } }
    override fun refreshPeers() { handler.post { candidates.forEach { (key, _) -> listener.onPeer(TransportPeer(key, "Nearby LOKA device", true)) } } }
    override fun connect(peer: String) { handler.post { candidates[peer]?.let { attempted.remove(peer); open(it) } } }
    override fun disconnect(peer: String) { handler.post { sessions[peer]?.let { fail(it, "BLE link disconnected") } } }
    override fun send(peer: String, frame: ByteArray) = enqueue(peer, frame, false)
    override fun sendUrgent(peer: String, frame: ByteArray) = enqueue(peer, frame, true)
    private fun enqueue(peer: String, frame: ByteArray, urgent: Boolean) {
        require(frame.size in 1..16384)
        check(pendingPosts.incrementAndGet() <= 128) { pendingPosts.decrementAndGet(); "BLE callback queue full" }
        val copy = frame.clone()
        // Reserve load before posting: mesh callbacks can enqueue synchronously
        // while this handler is still processing the link-ready event.
        postedBytes.compute(peer) { _, value -> (value ?: 0) + copy.size }
        handler.post {
            try {
                val s = sessions[peer] ?: return@post
                if (!s.ready || !allowed(peer)) return@post
                if (runCatching { BleFraming.enqueueFrame(s.queue, copy, urgent, s.writing) }.isFailure) { log("BLE queue busy; message remains pending for retry"); return@post }
                queueLoads[s.id] = s.queue.sumOf { it.size }
                pump(s)
            } finally {
                postedBytes.compute(peer) { _, value -> ((value ?: 0) - copy.size).takeIf { it > 0 } }
                pendingPosts.decrementAndGet()
            }
        }
    }
    private fun pump(s: Session) {
        if (s.writing || s.readingSignal || s.queue.isEmpty()) return
        val rx = s.rx ?: return
        rx.writeType = BluetoothGattCharacteristic.WRITE_TYPE_DEFAULT; rx.value = s.queue.peek()
        s.writing = true; deadline(s, 12_000)
        if (runCatching { s.gatt?.writeCharacteristic(rx) }.getOrDefault(false) != true) fail(s, "BLE write could not start")
    }
}
