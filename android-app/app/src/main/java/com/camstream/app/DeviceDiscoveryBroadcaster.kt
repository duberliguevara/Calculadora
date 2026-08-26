package com.camstream.app

import android.os.Build
import org.json.JSONObject
import java.net.DatagramPacket
import java.net.DatagramSocket
import java.net.InetAddress
import java.net.NetworkInterface
import java.util.concurrent.atomic.AtomicBoolean
import kotlin.concurrent.thread

/**
 * While streaming, announces this device's stream URL to the local network via
 * UDP broadcast so the PC companion app can discover it without typing the IP.
 */
class DeviceDiscoveryBroadcaster(private val streamPort: Int) {

    companion object {
        const val DISCOVERY_PORT = 8081
        private const val INTERVAL_MS = 2000L
    }

    private val running = AtomicBoolean(false)
    private var workerThread: Thread? = null

    fun start() {
        if (running.get()) return
        running.set(true)
        workerThread = thread(name = "camstream-discovery") {
            try {
                DatagramSocket().use { socket ->
                    socket.broadcast = true
                    while (running.get()) {
                        announceOnce(socket)
                        Thread.sleep(INTERVAL_MS)
                    }
                }
            } catch (_: InterruptedException) {
                // stop() was called; exit quietly
            } catch (_: Exception) {
                // socket setup failed (e.g. no network); nothing to announce
            }
        }
    }

    fun stop() {
        running.set(false)
        workerThread?.interrupt()
        workerThread = null
    }

    private fun announceOnce(socket: DatagramSocket) {
        val payload = JSONObject().apply {
            put("app", "camstream")
            put("name", Build.MODEL ?: "Android")
            put("port", streamPort)
        }.toString().toByteArray()

        for (broadcastAddress in getBroadcastAddresses()) {
            try {
                socket.send(DatagramPacket(payload, payload.size, broadcastAddress, DISCOVERY_PORT))
            } catch (_: Exception) {
                // this interface's broadcast failed; try the next one
            }
        }
    }

    private fun getBroadcastAddresses(): List<InetAddress> {
        val addresses = mutableListOf<InetAddress>()
        try {
            NetworkInterface.getNetworkInterfaces().asSequence()
                .filter { it.isUp && !it.isLoopback }
                .forEach { iface ->
                    iface.interfaceAddresses.forEach { ia ->
                        ia.broadcast?.let { addresses.add(it) }
                    }
                }
        } catch (_: Exception) {
        }
        return addresses
    }
}
