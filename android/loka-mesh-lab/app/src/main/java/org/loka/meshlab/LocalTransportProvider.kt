package org.loka.meshlab

import android.app.Application
import kotlinx.coroutines.CoroutineScope
import org.loka.core.transport.*

/** Coordinates independent Classic and BLE links; Internet/Go never enters this manager. */
class LocalTransportProvider(private val app: Application) : AndroidTransportProvider {
    private val classic = BluetoothTransportProvider(app)
    override val name = "Automatic nearby Bluetooth"
    override val setupHint = "Enable local connections on both phones. Nearby BLE routes connect automatically; Android Classic links may require system pairing."
    override val setupAction = "Pair Android"
    override val requiredPermissions get() = classic.requiredPermissions
    override fun activationRequest() = classic.activationRequest()
    override fun visibilityRequest() = classic.visibilityRequest()
    override fun factory(scope: CoroutineScope, allowed: (String) -> Boolean) = TransportFactory { listener ->
        object : LokaTransport {
            private val native = classic.factory(scope, allowed).create(listener)
            // Random per transport instance; never persisted or used as contact identity.
            private val token = ByteArray(8).also(java.security.SecureRandom()::nextBytes)
            private val ble = BleTransport(app, allowed, listener, token)
            private val client = BleClientTransport(app, token, allowed, listener)
            private val wifi = LocalWifiTransport(app, scope, allowed, listener)
            private val aware: LokaTransport? = if (android.os.Build.VERSION.SDK_INT >= 29 && app.packageManager.hasSystemFeature(android.content.pm.PackageManager.FEATURE_WIFI_AWARE)) AwareTransport(app, scope, allowed, listener) else null
            private fun route(peer: String): LokaTransport = when {
                peer.startsWith("aware:") -> checkNotNull(aware)
                peer.startsWith("wifi:") -> wifi
                peer.startsWith("ble:out:") -> client
                peer.startsWith("ble:") -> ble
                else -> native
            }
            override val capabilities get() = native.capabilities
            override fun start() {
                native.start()
                runCatching { ble.start() }.onFailure { listener.onDiagnostic("BLE unavailable: ${it.message}") }
                client.start()
                aware?.start()
                runCatching { wifi.start() }.onFailure { listener.onDiagnostic("Local Wi-Fi unavailable") }
            }
            override fun refreshPeers() { native.refreshPeers(); ble.refreshPeers(); client.refreshPeers(); aware?.start() }
            override fun discover() = native.discover()
            override fun preparePeer(peer: String) { if (!peer.startsWith("ble:") && !peer.startsWith("wifi:") && !peer.startsWith("aware:")) native.preparePeer(peer) }
            override fun connect(peer: String) = route(peer).connect(peer)
            override fun send(peer: String, frame: ByteArray) = route(peer).send(peer, frame)
            override fun queuedBytes(peer: String) = route(peer).queuedBytes(peer)
            override fun sendUrgent(peer: String, frame: ByteArray) = route(peer).sendUrgent(peer, frame)
            override fun disconnect(peer: String) = route(peer).disconnect(peer)
            override fun stop() { aware?.stop(); wifi.stop(); client.stop(); ble.stop(); native.stop() }
        }
    }
}
