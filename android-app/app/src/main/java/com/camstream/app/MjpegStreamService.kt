package com.camstream.app

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.graphics.ImageFormat
import android.os.Build
import android.util.Size
import androidx.camera.core.CameraSelector
import androidx.camera.core.ImageAnalysis
import androidx.camera.core.ImageProxy
import androidx.camera.lifecycle.ProcessCameraProvider
import androidx.core.app.NotificationCompat
import androidx.lifecycle.LifecycleService
import java.net.Inet4Address
import java.net.NetworkInterface
import java.util.concurrent.Executors
import java.util.concurrent.atomic.AtomicReference

class MjpegStreamService : LifecycleService() {

    companion object {
        const val ACTION_START = "com.camstream.app.action.START"
        const val ACTION_STOP = "com.camstream.app.action.STOP"
        private const val NOTIFICATION_CHANNEL_ID = "camstream_service"
        private const val NOTIFICATION_ID = 1
    }

    private val cameraExecutor = Executors.newSingleThreadExecutor()
    private val latestFrame = AtomicReference<ByteArray?>(null)
    private var cameraProvider: ProcessCameraProvider? = null
    private var mjpegServer: MjpegServer? = null
    private var discoveryBroadcaster: DeviceDiscoveryBroadcaster? = null

    override fun onCreate() {
        super.onCreate()
        createNotificationChannel()
    }

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        super.onStartCommand(intent, flags, startId)
        when (intent?.action) {
            ACTION_STOP -> {
                stopStreaming()
                return START_NOT_STICKY
            }
            else -> startStreaming()
        }
        return START_NOT_STICKY
    }

    private fun startStreaming() {
        startForeground(NOTIFICATION_ID, buildNotification())

        mjpegServer = MjpegServer(StreamStatus.PORT) { latestFrame.get() }.also { it.start() }
        discoveryBroadcaster = DeviceDiscoveryBroadcaster(StreamStatus.PORT).also { it.start() }

        val providerFuture = ProcessCameraProvider.getInstance(this)
        providerFuture.addListener({
            val provider = providerFuture.get()
            cameraProvider = provider

            val analysis = ImageAnalysis.Builder()
                .setTargetResolution(Size(640, 480))
                .setBackpressureStrategy(ImageAnalysis.STRATEGY_KEEP_ONLY_LATEST)
                .setOutputImageFormat(ImageAnalysis.OUTPUT_IMAGE_FORMAT_YUV_420_888)
                .build()

            analysis.setAnalyzer(cameraExecutor) { imageProxy: ImageProxy ->
                try {
                    latestFrame.set(imageProxyToJpeg(imageProxy))
                } catch (_: Exception) {
                    // drop this frame; the last good frame keeps being served
                } finally {
                    imageProxy.close()
                }
            }

            provider.unbindAll()
            provider.bindToLifecycle(this, CameraSelector.DEFAULT_BACK_CAMERA, analysis)

            StreamStatus.notifyChanged(true, getLocalIpAddress())
        }, androidx.core.content.ContextCompat.getMainExecutor(this))
    }

    private fun stopStreaming() {
        mjpegServer?.stop()
        mjpegServer = null
        discoveryBroadcaster?.stop()
        discoveryBroadcaster = null
        cameraProvider?.unbindAll()
        cameraProvider = null
        StreamStatus.notifyChanged(false, null)
        stopForeground(STOP_FOREGROUND_REMOVE)
        stopSelf()
    }

    override fun onDestroy() {
        stopStreaming()
        cameraExecutor.shutdown()
        super.onDestroy()
    }

    private fun createNotificationChannel() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            val channel = NotificationChannel(
                NOTIFICATION_CHANNEL_ID,
                getString(R.string.notification_channel_name),
                NotificationManager.IMPORTANCE_LOW
            )
            val manager = getSystemService(NotificationManager::class.java)
            manager.createNotificationChannel(channel)
        }
    }

    private fun buildNotification(): Notification {
        val stopIntent = Intent(this, MjpegStreamService::class.java).apply { action = ACTION_STOP }
        val stopPendingIntent = PendingIntent.getService(
            this, 0, stopIntent,
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
        )
        return NotificationCompat.Builder(this, NOTIFICATION_CHANNEL_ID)
            .setContentTitle(getString(R.string.notification_title))
            .setContentText(getString(R.string.notification_text))
            .setSmallIcon(android.R.drawable.ic_menu_camera)
            .addAction(0, getString(R.string.stop_streaming), stopPendingIntent)
            .setOngoing(true)
            .build()
    }

    private fun getLocalIpAddress(): String? {
        return try {
            NetworkInterface.getNetworkInterfaces().asSequence()
                .flatMap { it.inetAddresses.asSequence() }
                .filterIsInstance<Inet4Address>()
                .firstOrNull { !it.isLoopbackAddress }
                ?.hostAddress
        } catch (_: Exception) {
            null
        }
    }
}
