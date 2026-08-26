package com.camstream.app

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Intent
import android.os.Build
import androidx.core.app.NotificationCompat
import androidx.lifecycle.LifecycleService
import com.pedro.common.ConnectChecker
import com.pedro.encoder.input.video.CameraHelper
import com.pedro.library.generic.GenericCamera2
import org.json.JSONArray
import org.json.JSONObject

class RtmpStreamService : LifecycleService(), ControlHandler {

    companion object {
        const val ACTION_START = "com.camstream.app.action.START"
        const val ACTION_STOP = "com.camstream.app.action.STOP"
        const val ACTION_SWITCH_CAMERA = "com.camstream.app.action.SWITCH_CAMERA"
        const val ACTION_SET_AUDIO = "com.camstream.app.action.SET_AUDIO"

        const val EXTRA_CAMERA_ID = "camera_id"
        const val EXTRA_QUALITY_KEY = "quality_key"
        const val EXTRA_SERVER_URL = "server_url"
        const val EXTRA_AUDIO_ENABLED = "audio_enabled"

        const val CONTROL_PORT = 8090

        private const val NOTIFICATION_CHANNEL_ID = "camstream_service"
        private const val NOTIFICATION_ID = 1
    }

    private lateinit var streamer: GenericCamera2
    private var controlServer: ControlServer? = null

    private var currentCameraId: String? = null
    private var currentQuality: QualityPreset = QualityPreset.DEFAULT
    private var currentServerUrl: String? = null
    private var currentAudioEnabled: Boolean = true

    private val connectChecker = object : ConnectChecker {
        override fun onConnectionStarted(url: String) {
            StreamStatus.notifyChanged(StreamStatus.State.CONNECTING, cameraId = currentCameraId, qualityKey = currentQuality.key)
        }

        override fun onConnectionSuccess() {
            StreamStatus.notifyChanged(StreamStatus.State.STREAMING, cameraId = currentCameraId, qualityKey = currentQuality.key)
        }

        override fun onConnectionFailed(reason: String) {
            StreamStatus.notifyChanged(StreamStatus.State.ERROR, reason)
            stopStreaming()
        }

        override fun onNewBitrate(bitrate: Long) = Unit

        override fun onDisconnect() {
            StreamStatus.notifyChanged(StreamStatus.State.IDLE)
        }

        override fun onAuthError() {
            StreamStatus.notifyChanged(StreamStatus.State.ERROR, "Error de autenticación con el servidor")
            stopStreaming()
        }

        override fun onAuthSuccess() = Unit
    }

    override fun onCreate() {
        super.onCreate()
        createNotificationChannel()
        streamer = GenericCamera2(applicationContext, connectChecker)
        controlServer = ControlServer(CONTROL_PORT, this).also { it.start() }
    }

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        super.onStartCommand(intent, flags, startId)
        when (intent?.action) {
            ACTION_STOP -> {
                stopStreaming()
                return START_NOT_STICKY
            }
            ACTION_SWITCH_CAMERA -> {
                intent.getStringExtra(EXTRA_CAMERA_ID)?.let { onSwitchCamera(it) }
                return START_NOT_STICKY
            }
            ACTION_SET_AUDIO -> {
                onSetAudioEnabled(intent.getBooleanExtra(EXTRA_AUDIO_ENABLED, true))
                return START_NOT_STICKY
            }
            else -> {
                val cameraId = intent?.getStringExtra(EXTRA_CAMERA_ID)
                val quality = QualityPreset.fromKey(intent?.getStringExtra(EXTRA_QUALITY_KEY))
                val serverUrl = intent?.getStringExtra(EXTRA_SERVER_URL)
                val audioEnabled = intent?.getBooleanExtra(EXTRA_AUDIO_ENABLED, true) ?: true
                if (serverUrl.isNullOrBlank()) {
                    StreamStatus.notifyChanged(StreamStatus.State.ERROR, "Falta la dirección del servidor")
                    stopSelf()
                    return START_NOT_STICKY
                }
                startStreaming(cameraId, quality, serverUrl, audioEnabled)
            }
        }
        return START_NOT_STICKY
    }

    private fun startStreaming(cameraId: String?, quality: QualityPreset, serverUrl: String, audioEnabled: Boolean) {
        StreamStatus.notifyChanged(StreamStatus.State.STARTING, cameraId = cameraId, qualityKey = quality.key)
        startForeground(NOTIFICATION_ID, buildNotification())

        currentCameraId = cameraId
        currentQuality = quality
        currentServerUrl = serverUrl
        currentAudioEnabled = audioEnabled
        val rotation = CameraHelper.getCameraOrientation(this)

        if (audioEnabled) {
            try {
                streamer.prepareAudio()
            } catch (_: Exception) {
                // no microphone permission/hardware; stream continues video-only
            }
        }

        val videoOk = streamer.prepareVideo(quality.width, quality.height, quality.fps, quality.videoBitrateBps, rotation)
        if (!videoOk) {
            StreamStatus.notifyChanged(StreamStatus.State.ERROR, "El dispositivo no soporta esta configuración de video")
            stopStreaming()
            return
        }

        try {
            if (cameraId != null) {
                streamer.startPreview(cameraId, quality.width, quality.height, rotation)
            } else {
                streamer.startPreview()
            }
        } catch (e: Exception) {
            StreamStatus.notifyChanged(StreamStatus.State.ERROR, "No se pudo abrir la cámara: ${e.message}")
            stopStreaming()
            return
        }

        streamer.startStream(serverUrl)
    }

    // --- ControlHandler: commands coming from the PC companion ---

    override fun onSwitchCamera(cameraId: String) {
        if (!this::streamer.isInitialized) return
        try {
            streamer.switchCamera(cameraId)
            currentCameraId = cameraId
            StreamStatus.notifyChanged(StreamStatus.State.STREAMING, cameraId = currentCameraId, qualityKey = currentQuality.key)
        } catch (e: Exception) {
            StreamStatus.notifyChanged(StreamStatus.State.ERROR, "No se pudo cambiar de cámara: ${e.message}")
        }
    }

    override fun onChangeQuality(qualityKey: String) {
        val quality = QualityPreset.fromKey(qualityKey)
        val serverUrl = currentServerUrl ?: return
        if (quality == currentQuality) return
        if (this::streamer.isInitialized) {
            if (streamer.isStreaming) streamer.stopStream()
            if (streamer.isOnPreview) streamer.stopPreview()
        }
        startStreaming(currentCameraId, quality, serverUrl, currentAudioEnabled)
    }

    override fun onSetAudioEnabled(enabled: Boolean) {
        val serverUrl = currentServerUrl ?: return
        if (enabled == currentAudioEnabled) return
        // Adding/removing the audio track needs a fresh encoder setup, same as a quality change.
        if (this::streamer.isInitialized) {
            if (streamer.isStreaming) streamer.stopStream()
            if (streamer.isOnPreview) streamer.stopPreview()
        }
        startStreaming(currentCameraId, currentQuality, serverUrl, enabled)
    }

    override fun onStop() {
        stopStreaming()
    }

    override fun statusJson(): JSONObject {
        val camerasJson = JSONArray()
        CameraCatalog.list(this).forEach { option ->
            camerasJson.put(JSONObject().put("id", option.id).put("label", option.label))
        }
        val qualitiesJson = JSONArray()
        QualityPreset.entries.forEach { preset ->
            qualitiesJson.put(JSONObject().put("key", preset.key).put("label", preset.label))
        }
        val streaming = this::streamer.isInitialized && streamer.isStreaming
        return JSONObject().apply {
            put("streaming", streaming)
            put("cameraId", currentCameraId ?: JSONObject.NULL)
            put("qualityKey", currentQuality.key)
            put("audioEnabled", currentAudioEnabled)
            put("cameras", camerasJson)
            put("qualities", qualitiesJson)
        }
    }

    // --- lifecycle ---

    private fun stopStreaming() {
        if (this::streamer.isInitialized) {
            if (streamer.isStreaming) streamer.stopStream()
            if (streamer.isOnPreview) streamer.stopPreview()
        }
        StreamStatus.notifyChanged(StreamStatus.State.IDLE)
        stopForeground(STOP_FOREGROUND_REMOVE)
        stopSelf()
    }

    override fun onDestroy() {
        stopStreaming()
        controlServer?.stop()
        controlServer = null
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
        val stopIntent = Intent(this, RtmpStreamService::class.java).apply { action = ACTION_STOP }
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
}
