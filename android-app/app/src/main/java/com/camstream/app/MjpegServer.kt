package com.camstream.app

import java.io.BufferedOutputStream
import java.net.ServerSocket
import java.net.Socket
import java.util.concurrent.atomic.AtomicBoolean
import kotlin.concurrent.thread

private const val BOUNDARY = "camstreamboundary"
private const val TARGET_FRAME_INTERVAL_MS = 66L // ~15 fps

class MjpegServer(
    private val port: Int,
    private val frameProvider: () -> ByteArray?
) {
    private val running = AtomicBoolean(false)
    private var serverSocket: ServerSocket? = null
    private var acceptThread: Thread? = null

    fun start() {
        if (running.get()) return
        running.set(true)
        val socket = ServerSocket(port)
        serverSocket = socket
        acceptThread = thread(name = "mjpeg-accept") {
            while (running.get()) {
                try {
                    val client = socket.accept()
                    thread(name = "mjpeg-client") { handleClient(client) }
                } catch (e: Exception) {
                    if (running.get()) {
                        // socket closed while stopping, or transient accept error; loop will exit via running flag
                    }
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
            socket.soTimeout = 10_000
            // Minimal HTTP: consume the request line, ignore the rest, respond immediately.
            socket.getInputStream().bufferedReader().readLine()

            val out = BufferedOutputStream(socket.getOutputStream())
            val header = "HTTP/1.0 200 OK\r\n" +
                "Content-Type: multipart/x-mixed-replace; boundary=$BOUNDARY\r\n" +
                "Cache-Control: no-cache, private\r\n" +
                "Pragma: no-cache\r\n" +
                "Connection: close\r\n\r\n"
            out.write(header.toByteArray(Charsets.US_ASCII))
            out.flush()

            while (running.get() && !socket.isClosed) {
                val frame = frameProvider()
                if (frame == null) {
                    Thread.sleep(50)
                    continue
                }
                val partHeader = "--$BOUNDARY\r\n" +
                    "Content-Type: image/jpeg\r\n" +
                    "Content-Length: ${frame.size}\r\n\r\n"
                out.write(partHeader.toByteArray(Charsets.US_ASCII))
                out.write(frame)
                out.write("\r\n".toByteArray(Charsets.US_ASCII))
                out.flush()
                Thread.sleep(TARGET_FRAME_INTERVAL_MS)
            }
        } catch (_: Exception) {
            // client disconnected or timed out; nothing to do
        } finally {
            try {
                socket.close()
            } catch (_: Exception) {
            }
        }
    }
}
