package com.camstream.app

import org.json.JSONObject
import java.io.BufferedOutputStream
import java.net.ServerSocket
import java.net.Socket
import java.net.URLDecoder
import java.util.concurrent.atomic.AtomicBoolean
import kotlin.concurrent.thread

interface ControlHandler {
    fun onSwitchCamera(cameraId: String)
    fun onChangeQuality(qualityKey: String)
    fun onStop()
    fun statusJson(): JSONObject
}

/**
 * Tiny unauthenticated HTTP control channel so the PC companion can change
 * camera/quality or stop the stream without touching the phone. Meant for a
 * trusted local network only (same threat model as the rest of this app).
 */
class ControlServer(private val port: Int, private val handler: ControlHandler) {

    private val running = AtomicBoolean(false)
    private var serverSocket: ServerSocket? = null

    fun start() {
        if (running.get()) return
        running.set(true)
        val socket = ServerSocket(port)
        serverSocket = socket
        thread(name = "control-accept") {
            while (running.get()) {
                try {
                    val client = socket.accept()
                    thread(name = "control-client") { handleClient(client) }
                } catch (_: Exception) {
                    // closed while stopping, or transient accept error
                }
            }
        }
    }

    fun stop() {
        running.set(false)
        try {
            serverSocket?.close()
        } catch (_: Exception) {
        }
        serverSocket = null
    }

    private fun handleClient(socket: Socket) {
        try {
            socket.soTimeout = 5000
            val requestLine = socket.getInputStream().bufferedReader().readLine() ?: return
            val path = requestLine.split(" ").getOrElse(1) { "/" }
            val splitPath = path.split("?", limit = 2)
            val route = splitPath[0]
            val query = splitPath.getOrElse(1) { "" }
            val params = query.split("&").filter { it.isNotBlank() }.associate { pair ->
                val kv = pair.split("=", limit = 2)
                kv[0] to (kv.getOrNull(1)?.let { URLDecoder.decode(it, "UTF-8") } ?: "")
            }

            val responseJson = when (route) {
                "/status" -> handler.statusJson()
                "/camera" -> {
                    params["id"]?.let { handler.onSwitchCamera(it) }
                    handler.statusJson()
                }
                "/quality" -> {
                    params["key"]?.let { handler.onChangeQuality(it) }
                    handler.statusJson()
                }
                "/stop" -> {
                    handler.onStop()
                    JSONObject().put("ok", true)
                }
                else -> JSONObject().put("error", "not found")
            }

            writeJsonResponse(socket, responseJson)
        } catch (_: Exception) {
            // client disconnected or sent garbage; nothing to do
        } finally {
            try {
                socket.close()
            } catch (_: Exception) {
            }
        }
    }

    private fun writeJsonResponse(socket: Socket, json: JSONObject) {
        val body = json.toString().toByteArray(Charsets.UTF_8)
        val header = "HTTP/1.0 200 OK\r\n" +
            "Content-Type: application/json; charset=utf-8\r\n" +
            "Access-Control-Allow-Origin: *\r\n" +
            "Content-Length: ${body.size}\r\n" +
            "Connection: close\r\n\r\n"
        val out = BufferedOutputStream(socket.getOutputStream())
        out.write(header.toByteArray(Charsets.US_ASCII))
        out.write(body)
        out.flush()
    }
}
