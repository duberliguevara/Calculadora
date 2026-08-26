package com.camstream.app

import org.json.JSONObject
import java.net.DatagramPacket
import java.net.DatagramSocket
import java.util.concurrent.atomic.AtomicBoolean
import kotlin.concurrent.thread

/**
 * Listens for the PC companion's UDP announcements so the "IP de la PC"
 * field can fill itself in, instead of making the user type it.
 */
class PcDiscoveryListener(private val onPcFound: (String) -> Unit) {

    companion object {
        const val DISCOVERY_PORT = 8091
    }

    private val running = AtomicBoolean(false)
    private var workerThread: Thread? = null

    fun start() {
        if (running.get()) return
        running.set(true)
        workerThread = thread(name = "pc-discovery") {
            try {
                DatagramSocket(DISCOVERY_PORT).use { socket ->
                    socket.broadcast = true
                    socket.soTimeout = 1000
                    val buffer = ByteArray(1024)
                    while (running.get()) {
                        try {
                            val packet = DatagramPacket(buffer, buffer.size)
                            socket.receive(packet)
                            val text = String(packet.data, 0, packet.length, Charsets.UTF_8)
                            val json = JSONObject(text)
                            if (json.optString("app") == "camstream_pc") {
                                onPcFound(packet.address.hostAddress ?: continue)
                            }
                        } catch (_: java.net.SocketTimeoutException) {
                            // just a poll tick so `running` gets rechecked; keep listening
                        } catch (_: Exception) {
                            // malformed packet from something else on the network; ignore it
                        }
                    }
                }
            } catch (_: Exception) {
                // port busy or no network; the manual IP field still works
            }
        }
    }

    fun stop() {
        running.set(false)
        workerThread = null
    }
}
