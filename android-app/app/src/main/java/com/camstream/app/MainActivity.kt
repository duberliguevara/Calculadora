package com.camstream.app

import android.content.Intent
import android.graphics.Color
import android.os.Build
import android.os.Bundle
import android.widget.ArrayAdapter
import android.widget.Toast
import androidx.activity.result.contract.ActivityResultContracts
import androidx.appcompat.app.AppCompatActivity
import androidx.core.content.ContextCompat
import com.camstream.app.databinding.ActivityMainBinding

private const val PREFS_NAME = "camstream_prefs"
private const val PREF_SERVER_IP = "server_ip"
private const val PREF_CAMERA_ID = "camera_id"
private const val PREF_QUALITY_KEY = "quality_key"
private const val RTMP_PORT = 1935
private const val STREAM_PATH = "camstream"

class MainActivity : AppCompatActivity(), StreamStatus.Listener {

    private lateinit var binding: ActivityMainBinding
    private val prefs by lazy { getSharedPreferences(PREFS_NAME, MODE_PRIVATE) }

    private var cameraOptions: List<CameraOption> = emptyList()
    private var selectedCameraId: String? = null
    private var selectedQuality: QualityPreset = QualityPreset.DEFAULT
    private var currentState: StreamStatus.State = StreamStatus.State.IDLE

    private val permissionLauncher = registerForActivityResult(
        ActivityResultContracts.RequestMultiplePermissions()
    ) { results ->
        if (results[android.Manifest.permission.CAMERA] == true) {
            beginStreaming()
        } else {
            Toast.makeText(this, R.string.camera_permission_needed, Toast.LENGTH_LONG).show()
        }
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        binding = ActivityMainBinding.inflate(layoutInflater)
        setContentView(binding.root)

        setupCameraDropdown()
        setupQualityDropdown()
        binding.serverIpInput.setText(prefs.getString(PREF_SERVER_IP, ""))

        binding.toggleButton.setOnClickListener {
            if (isActiveState(currentState)) stopStreamingService() else validateAndStart()
        }
    }

    override fun onStart() {
        super.onStart()
        StreamStatus.listener = this
    }

    override fun onStop() {
        super.onStop()
        StreamStatus.listener = null
    }

    private fun setupCameraDropdown() {
        cameraOptions = CameraCatalog.list(this)
        val labels = cameraOptions.map { it.label }
        binding.cameraDropdown.setAdapter(ArrayAdapter(this, android.R.layout.simple_list_item_1, labels))

        val savedId = prefs.getString(PREF_CAMERA_ID, null)
        val defaultIndex = cameraOptions.indexOfFirst { it.id == savedId }
            .let { if (it >= 0) it else cameraOptions.indexOfFirst { opt -> opt.label.contains("Principal") } }
            .let { if (it >= 0) it else 0 }

        if (cameraOptions.isNotEmpty()) {
            binding.cameraDropdown.setText(cameraOptions[defaultIndex].label, false)
            selectedCameraId = cameraOptions[defaultIndex].id
        }

        binding.cameraDropdown.setOnItemClickListener { _, _, position, _ ->
            val option = cameraOptions[position]
            selectedCameraId = option.id
            prefs.edit().putString(PREF_CAMERA_ID, option.id).apply()
            if (isActiveState(currentState)) {
                val intent = Intent(this, RtmpStreamService::class.java).apply {
                    action = RtmpStreamService.ACTION_SWITCH_CAMERA
                    putExtra(RtmpStreamService.EXTRA_CAMERA_ID, option.id)
                }
                startService(intent)
            }
        }
    }

    private fun setupQualityDropdown() {
        val labels = QualityPreset.entries.map { it.label }
        binding.qualityDropdown.setAdapter(ArrayAdapter(this, android.R.layout.simple_list_item_1, labels))

        selectedQuality = QualityPreset.fromKey(prefs.getString(PREF_QUALITY_KEY, null))
        binding.qualityDropdown.setText(selectedQuality.label, false)

        binding.qualityDropdown.setOnItemClickListener { _, _, position, _ ->
            val quality = QualityPreset.entries[position]
            selectedQuality = quality
            prefs.edit().putString(PREF_QUALITY_KEY, quality.key).apply()
            if (isActiveState(currentState)) {
                // Resolution/bitrate can't change on the fly; restart with the new preset.
                stopStreamingService()
                binding.root.postDelayed({ validateAndStart() }, 400)
            }
        }
    }

    private fun validateAndStart() {
        val ip = binding.serverIpInput.text?.toString()?.trim().orEmpty()
        if (ip.isEmpty()) {
            Toast.makeText(this, R.string.missing_server_ip, Toast.LENGTH_LONG).show()
            return
        }
        prefs.edit().putString(PREF_SERVER_IP, ip).apply()
        requestPermissionsAndStart()
    }

    private fun requestPermissionsAndStart() {
        val needed = mutableListOf(android.Manifest.permission.CAMERA, android.Manifest.permission.RECORD_AUDIO)
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            needed.add(android.Manifest.permission.POST_NOTIFICATIONS)
        }
        val missing = needed.filter {
            ContextCompat.checkSelfPermission(this, it) != android.content.pm.PackageManager.PERMISSION_GRANTED
        }
        if (missing.isEmpty()) {
            beginStreaming()
        } else {
            permissionLauncher.launch(missing.toTypedArray())
        }
    }

    private fun beginStreaming() {
        val ip = binding.serverIpInput.text?.toString()?.trim().orEmpty()
        val serverUrl = "rtmp://$ip:$RTMP_PORT/$STREAM_PATH"
        val intent = Intent(this, RtmpStreamService::class.java).apply {
            action = RtmpStreamService.ACTION_START
            putExtra(RtmpStreamService.EXTRA_CAMERA_ID, selectedCameraId)
            putExtra(RtmpStreamService.EXTRA_QUALITY_KEY, selectedQuality.key)
            putExtra(RtmpStreamService.EXTRA_SERVER_URL, serverUrl)
        }
        ContextCompat.startForegroundService(this, intent)
    }

    private fun stopStreamingService() {
        val intent = Intent(this, RtmpStreamService::class.java).apply {
            action = RtmpStreamService.ACTION_STOP
        }
        startService(intent)
    }

    private fun isActiveState(state: StreamStatus.State) = state == StreamStatus.State.STARTING ||
        state == StreamStatus.State.CONNECTING || state == StreamStatus.State.STREAMING

    override fun onStatusChanged(state: StreamStatus.State, message: String?) {
        runOnUiThread {
            currentState = state
            binding.toggleButton.text = getString(
                if (isActiveState(state)) R.string.stop_streaming else R.string.start_streaming
            )
            val (text, color) = when (state) {
                StreamStatus.State.IDLE -> getString(R.string.status_idle) to Color.GRAY
                StreamStatus.State.STARTING -> getString(R.string.status_starting) to Color.parseColor("#FF9800")
                StreamStatus.State.CONNECTING -> getString(R.string.status_connecting) to Color.parseColor("#FF9800")
                StreamStatus.State.STREAMING -> getString(R.string.status_streaming) to Color.parseColor("#2E7D32")
                StreamStatus.State.ERROR -> getString(R.string.status_error, message ?: "") to Color.parseColor("#C62828")
            }
            binding.statusText.text = text
            binding.statusText.setTextColor(color)
        }
    }
}
