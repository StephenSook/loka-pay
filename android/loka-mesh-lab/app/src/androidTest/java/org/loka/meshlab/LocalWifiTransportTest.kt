package org.loka.meshlab

import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import kotlinx.coroutines.*
import org.junit.Assert.*
import org.junit.Test
import org.junit.runner.RunWith
import org.loka.core.transport.*
import java.io.DataInputStream
import java.io.DataOutputStream
import java.net.ServerSocket
import java.net.Socket
import java.util.concurrent.LinkedBlockingQueue
import java.util.concurrent.TimeUnit

@RunWith(AndroidJUnit4::class)
class LocalWifiTransportTest {
    @Test fun actualSocketFramingBidirectionalAndOversizeRejection() = runBlocking {
        val context = InstrumentationRegistry.getInstrumentation().targetContext
        val scope = CoroutineScope(SupervisorJob() + Dispatchers.IO)
        val received = LinkedBlockingQueue<ByteArray>(); val links = LinkedBlockingQueue<String>()
        val transport = LocalWifiTransport(context, scope, { true }, object : TransportListener {
            override fun onPeer(peer: TransportPeer) = Unit
            override fun onLink(peer: String, connected: Boolean) { if (connected) links.offer(peer) }
            override fun onFrame(peer: String, frame: ByteArray) { received.offer(frame) }
            override fun onRunning(running: Boolean) = Unit
            override fun onDiagnostic(text: String) = Unit
        })
        try {
            transport.start()
            val field = LocalWifiTransport::class.java.getDeclaredField("server").apply { isAccessible = true }
            val server = withTimeout(10_000) {
                var socket: ServerSocket? = null
                while (socket == null) { socket = field.get(transport) as? ServerSocket; delay(50) }
                socket
            }
            Socket(server.inetAddress, server.localPort).use { socket ->
                socket.soTimeout = 5_000
                val input = DataInputStream(socket.getInputStream()); val output = DataOutputStream(socket.getOutputStream())
                output.writeInt(0x4c574630); output.flush()
                assertEquals(0x4c574630, input.readInt())
                val peer = checkNotNull(links.poll(5, TimeUnit.SECONDS))
                val frame = ByteArray(16384) { (it % 251).toByte() }
                output.writeInt(frame.size)
                // Deliberately fragment the TCP stream. Transport must reconstruct one frame.
                frame.asList().chunked(137).forEach { output.write(it.toByteArray()); output.flush() }
                assertArrayEquals(frame, received.poll(5, TimeUnit.SECONDS))
                transport.send(peer, byteArrayOf(1, 2, 3))
                assertEquals(3, input.readInt()); val reply = ByteArray(3); input.readFully(reply)
                assertArrayEquals(byteArrayOf(1,2,3), reply)
                output.writeInt(16385); output.flush()
                assertEquals(-1, input.read())
            }
        } finally { transport.stop(); scope.cancel() }
    }
}
