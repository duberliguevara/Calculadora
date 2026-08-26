package com.camstream.app

import android.content.Context
import android.hardware.camera2.CameraCharacteristics
import android.hardware.camera2.CameraManager
import kotlin.math.atan
import kotlin.math.sqrt

data class CameraOption(val id: String, val label: String)

/**
 * Enumerates every lens the device exposes via Camera2 (this needs no runtime
 * permission — camera *characteristics* are readable without CAMERA access)
 * and labels rear lenses as Ultra Wide / Main / Telephoto based on their
 * field of view, since Android has no direct "lens type" API.
 */
object CameraCatalog {

    private data class RawLens(val id: String, val fieldOfView: Double)

    fun list(context: Context): List<CameraOption> {
        val manager = context.getSystemService(Context.CAMERA_SERVICE) as? CameraManager
            ?: return emptyList()

        val backLenses = mutableListOf<RawLens>()
        var frontId: String? = null

        try {
            for (id in manager.cameraIdList) {
                val chars = manager.getCameraCharacteristics(id)
                when (chars.get(CameraCharacteristics.LENS_FACING)) {
                    CameraCharacteristics.LENS_FACING_FRONT -> {
                        if (frontId == null) frontId = id
                    }
                    CameraCharacteristics.LENS_FACING_BACK -> {
                        backLenses.add(RawLens(id, fieldOfViewOf(chars)))
                    }
                    else -> Unit // external/unknown: not useful for a phone-as-webcam app
                }
            }
        } catch (_: Exception) {
            return emptyList()
        }

        // Widest FOV (smallest focal length) first: ultra-wide -> main -> telephoto(s).
        val sortedBack = backLenses.sortedByDescending { it.fieldOfView }
        val mainFov = (sortedBack.getOrNull(1) ?: sortedBack.getOrNull(0))?.fieldOfView

        val options = mutableListOf<CameraOption>()
        sortedBack.forEachIndexed { index, lens ->
            val zoomSuffix = if (mainFov != null && mainFov > 0 && lens.fieldOfView > 0) {
                " (~%.1fx)".format(mainFov / lens.fieldOfView)
            } else {
                ""
            }
            val label = when {
                sortedBack.size == 1 -> "Trasera"
                index == 0 -> "Trasera – Ultra Angular$zoomSuffix"
                index == 1 -> "Trasera – Principal (1x)"
                else -> "Trasera – Teleobjetivo$zoomSuffix"
            }
            options.add(CameraOption(lens.id, label))
        }
        frontId?.let { options.add(CameraOption(it, "Frontal")) }
        return options
    }

    private fun fieldOfViewOf(chars: CameraCharacteristics): Double {
        val focalLength = chars.get(CameraCharacteristics.LENS_INFO_AVAILABLE_FOCAL_LENGTHS)?.firstOrNull()
        val sensorSize = chars.get(CameraCharacteristics.SENSOR_INFO_PHYSICAL_SIZE)
        if (focalLength == null || focalLength <= 0f || sensorSize == null) return 0.0
        val diagonal = sqrt((sensorSize.width * sensorSize.width + sensorSize.height * sensorSize.height).toDouble())
        return 2.0 * atan(diagonal / (2.0 * focalLength))
    }
}
