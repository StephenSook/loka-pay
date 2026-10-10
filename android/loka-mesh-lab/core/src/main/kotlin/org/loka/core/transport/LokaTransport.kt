package org.loka.core.transport

/** A local link handle is opaque to the application; it is not an account or device identity. */
data class TransportPeer(
    val id: String,
    val displayName: String,
    val readyToConnect: Boolean,
    val signalDbm: Int? = null,
)

enum class TransportCapability { DISCOVERY, PEER_PREPARATION, VISIBILITY }

interface TransportListener {
    fun onPeer(peer: TransportPeer)
    fun onLink(peer: String, connected: Boolean)
    fun onFrame(peer: String, frame: ByteArray)
    fun onRunning(running: Boolean)
    fun onDiagnostic(text: String)
    fun onTransferOpportunity(peer: String) {}
}

/**
 * Local transport only. Providers must not introduce cloud delivery dependencies or require
 * Internet validation. Wi-Fi radio availability alone says nothing about recipient reachability.
 * This boundary may be implemented by a manager coordinating multiple local radio providers;
 * discovery/control and payload links need not use the same radio. External Go/Gateway routing
 * remains a separate policy. The current lab selects one Bluetooth provider.
 * Factories do not emit events until start. Callbacks may run on background threads.
 * start/stop are idempotent; stop closes pending and active links and emits link-down events.
 * send enqueues a bounded frame; enqueue/write success is not end-to-end delivery.
 */
interface LokaTransport {
    val capabilities: Set<TransportCapability>
    fun start()
    fun refreshPeers()
    fun discover() { throw UnsupportedOperationException("Discovery unavailable") }
    fun preparePeer(peer: String) { throw UnsupportedOperationException("Peer preparation unavailable") }
    fun connect(peer: String)
    fun send(peer: String, frame: ByteArray)
    fun sendUrgent(peer: String, frame: ByteArray) = send(peer, frame)
    fun queuedBytes(peer: String): Int = 0
    fun disconnect(peer: String)
    fun stop()
}

fun interface TransportFactory {
    fun create(listener: TransportListener): LokaTransport
}
