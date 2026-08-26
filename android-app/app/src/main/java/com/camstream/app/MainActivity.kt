package com.camstream.app

import android.content.Intent
import android.os.Build
import android.os.Bundle
import android.widget.Toast
import androidx.activity.result.contract.ActivityResultContracts
import androidx.appcompat.app.AppCompatActivity
import androidx.core.content.ContextCompat
import com.camstream.app.databinding.ActivityMainBinding

class MainActivity : AppCompatActivity(), StreamStatus.Listener {

    private lateinit var binding: ActivityMainBinding
    private var isStreaming = false

    private val permissionLauncher = registerForActivityResult(
        ActivityResultContracts.RequestMultiplePermissions()
    ) { results ->
        if (results[android.Manifest.permission.CAMERA] == true) {
            startStreamingService()
        } else {
            Toast.makeText(this, R.string.camera_permission_needed, Toast.LENGTH_LONG).show()
        }
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        binding = ActivityMainBinding.inflate(layoutInflater)
        setContentView(binding.root)

        binding.toggleButton.setOnClickListener {
            if (isStreaming) stopStreamingService() else requestPermissionsAndStart()
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

    private fun requestPermissionsAndStart() {
        val needed = mutableListOf(android.Manifest.permission.CAMERA)
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            needed.add(android.Manifest.permission.POST_NOTIFICATIONS)
        }
        val missing = needed.filter {
            ContextCompat.checkSelfPermission(this, it) != android.content.pm.PackageManager.PERMISSION_GRANTED
        }
        if (missing.isEmpty()) {
            startStreamingService()
        } else {
            permissionLauncher.launch(missing.toTypedArray())
        }
    }

    private fun startStreamingService() {
        val intent = Intent(this, MjpegStreamService::class.java).apply {
            action = MjpegStreamService.ACTION_START
        }
        ContextCompat.startForegroundService(this, intent)
    }

    private fun stopStreamingService() {
        val intent = Intent(this, MjpegStreamService::class.java).apply {
            action = MjpegStreamService.ACTION_STOP
        }
        startService(intent)
    }

    override fun onStatusChanged(running: Boolean, ipAddress: String?) {
        runOnUiThread {
            isStreaming = running
            binding.toggleButton.text = getString(
                if (running) R.string.stop_streaming else R.string.start_streaming
            )
            binding.statusText.text = getString(
                if (running) R.string.status_streaming else R.string.status_idle
            )
            binding.urlText.text = if (running) {
                if (ipAddress != null) {
                    "WiFi: http://$ipAddress:${StreamStatus.PORT}/video\nUSB: usa el programa de PC (adb forward) y abre http://127.0.0.1:${StreamStatus.PORT}/video"
                } else {
                    "USB: usa el programa de PC (adb forward) y abre http://127.0.0.1:${StreamStatus.PORT}/video\n(Sin IP de WiFi detectada)"
                }
            } else {
                ""
            }
        }
    }
}
