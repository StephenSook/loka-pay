package org.loka.meshlab

import android.annotation.SuppressLint
import android.app.Application
import android.bluetooth.*
import android.bluetooth.le.*
import android.os.ParcelUuid
import org.loka.core.transport.*
import java.util.UUID
import java.util.ArrayDeque

/** Foreground GATT peripheral: iPhone is central. Identity trust remains above this layer. */
@SuppressLint("MissingPermission")
class BleTransport(private val app: Application, private val allowed: (String) -> Boolean,
    private val listener: TransportListener, private val discoveryToken: ByteArray? = null) : LokaTransport {
    companion object {
        val SERVICE: UUID = UUID.fromString("9ebc1000-6ec2-4f17-97ef-48594c4f4b41")
        val RX: UUID = UUID.fromString("9ebc1001-6ec2-4f17-97ef-48594c4f4b41")
        val TX: UUID = UUID.fromString("9ebc1002-6ec2-4f17-97ef-48594c4f4b41")
        val CCCD: UUID = UUID.fromString("00002902-0000-1000-8000-00805f9b34fb")
    }
    private fun diagnostic(text: String) {
        if (BuildConfig.DEBUG) android.util.Log.i("LokaBle", text)
        listener.onDiagnostic(text)
    }
    override val capabilities = emptySet<TransportCapability>()
    private var server: BluetoothGattServer? = null
    private var advertiser: BluetoothLeAdvertiser? = null
    private var tx: BluetoothGattCharacteristic? = null
    private data class Peer(val device: BluetoothDevice, var subscribed: Boolean = false, var checked: Boolean = false, var routePublished: Boolean = false,
        val budget: org.loka.core.LinkIngressBudget = org.loka.core.LinkIngressBudget(android.os.SystemClock::elapsedRealtime),
        val incoming: BleFraming.Assembler = BleFraming.Assembler(android.os.SystemClock::elapsedRealtime),
        val outgoing: ArrayDeque<ByteArray> = ArrayDeque(), var sending: Boolean = false)
    private val peers = mutableMapOf<String, Peer>()
    private val delivery = android.os.Handler(android.os.Looper.getMainLooper())
    private val pendingDeliveries = java.util.concurrent.atomic.AtomicInteger()
    // Never call the mesh while holding the GATT monitor: mesh writes may re-enter this transport.
    private fun publishLink(key: String, up: Boolean) {
        delivery.post {
            val ready = synchronized(this) { peers[key]?.let { it.subscribed && it.checked && it.routePublished } == true && allowed(key) }
            if (!up || ready) listener.onLink(key, up)
        }
    }
    private fun publishFrame(key: String, peer: Peer, frame: ByteArray): Boolean {
        if (pendingDeliveries.incrementAndGet() > 128) { pendingDeliveries.decrementAndGet(); return false }
        delivery.post {
            try {
                val current = synchronized(this) { peers[key] === peer && peer.subscribed && peer.checked && allowed(key) }
                if (current) listener.onFrame(key, frame)
            } finally { pendingDeliveries.decrementAndGet() }
        }
        return true
    }
    private fun id(device: BluetoothDevice) = "ble:" + device.address
    private val advertising = object : AdvertiseCallback() {
        override fun onStartSuccess(settings: AdvertiseSettings?) = diagnostic("BLE local service advertising")
        override fun onStartFailure(errorCode: Int) { diagnostic("BLE advertising failed: $errorCode"); stop() }
    }
    private val callback = object : BluetoothGattServerCallback() {
        override fun onServiceAdded(status: Int, service: BluetoothGattService) {
            synchronized(this@BleTransport) {
                if (status != BluetoothGatt.GATT_SUCCESS || server == null) { diagnostic("BLE service unavailable"); return }
                advertiser?.startAdvertising(AdvertiseSettings.Builder().setConnectable(true)
                    .setAdvertiseMode(AdvertiseSettings.ADVERTISE_MODE_LOW_LATENCY).setTimeout(0).build(),
                    AdvertiseData.Builder().addServiceUuid(ParcelUuid(SERVICE)).build(),
                    AdvertiseData.Builder().apply { discoveryToken?.let { addServiceData(ParcelUuid(SERVICE), it) } }.build(), advertising)
            }
        }
        override fun onConnectionStateChange(device: BluetoothDevice, status: Int, newState: Int) {
            synchronized(this@BleTransport) {
                if (server == null) return
                val key = id(device)
                if (status == BluetoothGatt.GATT_SUCCESS && newState == BluetoothProfile.STATE_CONNECTED) {
                    // Android can report already-connected system GATT devices when a
                    // server opens. Reserve a LOKA slot only on an actual CCCD request.
                    // Repeated connection callbacks must not reset a working session.
                    listener.onPeer(TransportPeer(key, "Nearby LOKA device", false))
                    diagnostic("BLE peer connected; preparing local packet route")
                } else { peers.remove(key); listener.onPeer(TransportPeer(key, "Nearby LOKA device", false)); publishLink(key, false) }
            }
        }
        override fun onDescriptorWriteRequest(device: BluetoothDevice, requestId: Int,
            descriptor: BluetoothGattDescriptor, preparedWrite: Boolean, responseNeeded: Boolean,
            offset: Int, value: ByteArray) {
            synchronized(this@BleTransport) {
                val enable = value.contentEquals(BluetoothGattDescriptor.ENABLE_INDICATION_VALUE)
                val disable = value.contentEquals(BluetoothGattDescriptor.DISABLE_NOTIFICATION_VALUE)
                val validRequest = server != null && !preparedWrite && offset == 0 && descriptor.uuid == CCCD && (enable || disable)
                // A native write to this service is live-link evidence even when the
                // platform omitted a connection callback for an existing physical link.
                // Discovery alone neither reserves a slot nor authorizes any message.
                if (validRequest && enable && peers[id(device)] == null && peers.size < 4) {
                    peers[id(device)] = Peer(device)
                    diagnostic("BLE service subscription admitted; preparing public probe")
                }
                val peer = peers[id(device)]
                val valid = validRequest && peer != null
                if (valid) {
                    peer!!.subscribed = value.contentEquals(BluetoothGattDescriptor.ENABLE_INDICATION_VALUE)
                    if (!peer.subscribed) { peer.checked = false; peer.routePublished = false }
                }
                if (responseNeeded) server?.sendResponse(device, requestId, if (valid) BluetoothGatt.GATT_SUCCESS else BluetoothGatt.GATT_REQUEST_NOT_SUPPORTED, 0, null)
                if (BuildConfig.DEBUG) android.util.Log.i("LokaBle", "Subscription: valid=$valid allowed=${allowed(id(device))} peerPresent=${peer != null} prepared=$preparedWrite offset=$offset cccd=${descriptor.uuid == CCCD} bytes=${value.size} indication=${value.contentEquals(BluetoothGattDescriptor.ENABLE_INDICATION_VALUE)} disable=${value.contentEquals(BluetoothGattDescriptor.DISABLE_NOTIFICATION_VALUE)}")
                if (valid) {
                    listener.onPeer(TransportPeer(id(device), "Nearby LOKA device", peer!!.subscribed))
                    publishLink(id(device), peer.subscribed && allowed(id(device)))
                }
            }
        }
        override fun onCharacteristicWriteRequest(device: BluetoothDevice, requestId: Int,
            characteristic: BluetoothGattCharacteristic, preparedWrite: Boolean, responseNeeded: Boolean,
            offset: Int, value: ByteArray) {
            synchronized(this@BleTransport) {
                val peer = peers[id(device)]
                var ok = peer != null && allowed(id(device)) && characteristic.uuid == RX && !preparedWrite && offset == 0 && value.size in 2..20
                if (ok && value.contentEquals(byteArrayOf(0x7f,0x4c,0x4f,0x4b,0x41,1))) {
                    if (peer!!.subscribed && peer.outgoing.size < 2048 && peer.budget.take()) {
                        peer.checked = true
                        // Keep an in-flight indication at the head; check replies precede queued payload.
                        BleFraming.prioritizeControl(peer.outgoing, byteArrayOf(0x7f,0x4c,0x4f,0x4b,0x41,2), peer.sending)
                        pump(peer)
                        diagnostic("BLE public link probe received; reply queued")
                    } else ok = false
                } else if (ok && peer!!.checked) {
                    runCatching { peer!!.incoming.accept(value) }
                        .onSuccess { frame -> if (frame != null) ok = peer!!.budget.take() && publishFrame(id(device), peer, frame) }
                        .onFailure { ok = false }

                } else ok = false
                if (responseNeeded) server?.sendResponse(device, requestId, if (ok) BluetoothGatt.GATT_SUCCESS else BluetoothGatt.GATT_FAILURE, 0, null)
                if (BuildConfig.DEBUG && (!ok || value.contentEquals(byteArrayOf(0x7f,0x4c,0x4f,0x4b,0x41,1))))
                    android.util.Log.i("LokaBle", "Write: accepted=$ok peerPresent=${peer != null} allowed=${allowed(id(device))} subscribed=${peer?.subscribed == true} bytes=${value.size} prepared=$preparedWrite offset=$offset")
            }
        }
        override fun onNotificationSent(device: BluetoothDevice, status: Int) {
            synchronized(this@BleTransport) {
                val peer = peers[id(device)] ?: return
                peer.sending = false
                if (status == BluetoothGatt.GATT_SUCCESS) {
                    val sent = peer.outgoing.poll()
                    if (sent?.contentEquals(byteArrayOf(0x7f,0x4c,0x4f,0x4b,0x41,2)) == true && !peer.routePublished) {
                        peer.routePublished = true; publishLink(id(device), true)
                        diagnostic("BLE public link reply acknowledged; packet route ready")
                    }
                    pump(peer)
                    if (peer.outgoing.isEmpty() && !peer.sending) delivery.post { listener.onTransferOpportunity(id(device)) }
                }
                else { diagnostic("BLE indication failed"); disconnect(id(device)) }
            }
        }
    }
    @Synchronized override fun start() {
        if (server != null) return
        val manager = app.getSystemService(BluetoothManager::class.java)
        check(manager.adapter?.isEnabled == true) { "Enable Bluetooth" }
        advertiser = checkNotNull(manager.adapter.bluetoothLeAdvertiser) { "BLE advertising unsupported" }
        server = checkNotNull(manager.openGattServer(app, callback)) { "BLE server unavailable" }
        val service = BluetoothGattService(SERVICE, BluetoothGattService.SERVICE_TYPE_PRIMARY)
        service.addCharacteristic(BluetoothGattCharacteristic(RX, BluetoothGattCharacteristic.PROPERTY_WRITE, BluetoothGattCharacteristic.PERMISSION_WRITE))
        tx = BluetoothGattCharacteristic(TX, BluetoothGattCharacteristic.PROPERTY_INDICATE, 0).also {
            it.addDescriptor(BluetoothGattDescriptor(CCCD, BluetoothGattDescriptor.PERMISSION_WRITE))
            service.addCharacteristic(it)
        }
        if (server?.addService(service) != true) { stop(); error("BLE service registration failed") }
    }
    @Synchronized override fun refreshPeers() { peers.forEach { (id, p) -> listener.onPeer(TransportPeer(id, "Nearby LOKA device", p.subscribed)) } }
    @Synchronized override fun connect(peer: String) {
        check(allowed(peer)) { "Allow this BLE link first" }
        val p = checkNotNull(peers[peer]) { "Wait for the nearby phone to connect" }
        check(p.subscribed) { "The nearby phone is still preparing its link" }
        publishLink(peer, true)
    }
    @Synchronized override fun queuedBytes(peer: String) = peers[peer]?.outgoing?.sumOf { it.size } ?: 0
    override fun send(peer: String, frame: ByteArray) = enqueue(peer, frame, false)
    override fun sendUrgent(peer: String, frame: ByteArray) = enqueue(peer, frame, true)
    @Synchronized private fun enqueue(peer: String, frame: ByteArray, urgent: Boolean) {
        val p = checkNotNull(peers[peer]) { "BLE peer disconnected" }
        check(allowed(peer) && p.subscribed && p.checked && frame.size in 1..16384)
        BleFraming.enqueueFrame(p.outgoing, frame, urgent, p.sending)
        pump(p)
    }
    @Suppress("DEPRECATION") private fun pump(p: Peer) {
        if (p.sending || p.outgoing.isEmpty()) return
        tx?.value = p.outgoing.peek()
        p.sending = true
        if (server?.notifyCharacteristicChanged(p.device, tx, true) != true) {
            p.sending = false; p.outgoing.clear(); diagnostic("BLE could not send indication")
        }
    }
    @Synchronized override fun disconnect(peer: String) {
        peers.remove(peer)?.let { server?.cancelConnection(it.device) }
        listener.onPeer(TransportPeer(peer, "Nearby LOKA device", false))
        publishLink(peer, false)
    }
    @Synchronized override fun stop() {
        advertiser?.stopAdvertising(advertising); advertiser = null
        val old = server; server = null
        peers.forEach { (id, p) -> old?.cancelConnection(p.device); listener.onPeer(TransportPeer(id, "Nearby LOKA device", false)); publishLink(id, false) }
        peers.clear(); old?.close(); tx = null
    }
}
