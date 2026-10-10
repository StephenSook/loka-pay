package org.loka.core

import org.loka.core.transport.LokaTransport
import org.loka.core.transport.TransportFactory
import org.loka.core.transport.TransportListener
import org.loka.core.transport.TransportPeer

/** Connects a local transport to the existing encrypted mesh engine without any platform APIs. */
class MeshNode(
    crypto: LabCrypto,
    factory: TransportFactory,
    trusted: (String) -> Boolean,
    private val listener: TransportListener,
    message: (String, String) -> Unit,
    clock: () -> Long = System::currentTimeMillis,
    packetMessage: ((Packet, String) -> Unit)? = null,
    private val control: (String, ByteArray) -> Boolean = { _, _ -> false },
    saveCarry: ((List<ByteArray>) -> Unit)? = null,
) {
    private lateinit var transport: LokaTransport
    private val engine = MeshEngine(crypto, clock, trusted,
        sendFrame = { peer, frame -> transport.send(peer, frame) },
        event = listener::onDiagnostic,
        message = message, packetMessage = packetMessage,
        sendUrgentFrame = { peer, frame -> transport.sendUrgent(peer, frame) }, saveCarry = saveCarry)

    init {
        engine.routeLoad = { peer -> transport.queuedBytes(peer) }
        transport = factory.create(object : TransportListener {
            override fun onPeer(peer: TransportPeer) = listener.onPeer(peer)
            override fun onLink(peer: String, connected: Boolean) {
                if (connected) engine.linkUp(peer) else engine.linkDown(peer)
                listener.onLink(peer, connected)
            }
            override fun onFrame(peer: String, frame: ByteArray) { if (!control(peer, frame)) engine.receive(peer, frame) }
            override fun onRunning(running: Boolean) = listener.onRunning(running)
            override fun onDiagnostic(text: String) = listener.onDiagnostic(text)
            override fun onTransferOpportunity(peer: String) { engine.tick(); listener.onTransferOpportunity(peer) }
        })
    }

    var applicationPeer: (String) -> Boolean
        get() = engine.applicationPeer
        set(value) { engine.applicationPeer = value }
    var applicationContent: (String, String) -> Boolean
        get() = engine.applicationContent
        set(value) { engine.applicationContent = value }
    var applicationPacket: (Packet) -> Boolean
        get() = engine.applicationPacket
        set(value) { engine.applicationPacket = value }
    var routeLoad: (String) -> Int
        get() = engine.routeLoad
        set(value) { engine.routeLoad = value }
    var routePreference: (String) -> Int
        get() = engine.routePreference
        set(value) { engine.routePreference = value }
    var observeRoute: ((Packet, String?, Boolean) -> Unit)?
        get() = engine.observeRoute
        set(value) { engine.observeRoute = value }
    var carryVersion: (String) -> Int
        get() = engine.carryVersion
        set(value) { engine.carryVersion = value }
    var carryPeer: (String) -> String?
        get() = engine.carryPeer
        set(value) { engine.carryPeer = value }
    val capabilities get() = transport.capabilities
    var relayEnabled: Boolean
        get() = engine.relayEnabled
        set(value) { engine.relayEnabled = value }
    fun sendControl(peer: String, frame: ByteArray) { require(NearbyPeople.controls(frame) && frame.size <= 4096); transport.sendUrgent(peer, frame) }
    fun start() = transport.start()
    fun stop() = transport.stop()
    fun refreshPeers() = transport.refreshPeers()
    fun discover() = transport.discover()
    fun preparePeer(peer: String) = transport.preparePeer(peer)
    fun connect(peer: String) = transport.connect(peer)
    fun disconnect(peer: String) = transport.disconnect(peer)
    fun send(recipient: ByteArray, text: String, urgent: Boolean = false, carrier: String = "", automatic: Boolean = false, returnVia: List<String> = emptyList(), lifetimeMs: Long? = null): String = engine.send(recipient, text, urgent, carrier, automatic, returnVia, lifetimeMs)
    fun restoreCarry(frames: List<ByteArray>) = engine.restoreCarry(frames)
    fun tick() = engine.tick()
    fun diagnostic() = engine.diagnostic()
    fun queued() = engine.queued()
    fun restore(frame: ByteArray) = engine.restore(frame)
    fun discard(ids: Collection<String>) = engine.discard(ids)
}
