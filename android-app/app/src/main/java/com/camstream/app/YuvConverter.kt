package com.camstream.app

import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.graphics.ImageFormat
import android.graphics.Matrix
import android.graphics.Rect
import android.graphics.YuvImage
import androidx.camera.core.ImageProxy
import java.io.ByteArrayOutputStream

private const val JPEG_QUALITY = 70

/**
 * Converts a YUV_420_888 ImageProxy from CameraX into an upright JPEG byte array,
 * handling row/pixel strides (required on many devices where planes aren't tightly packed).
 */
fun imageProxyToJpeg(image: ImageProxy): ByteArray {
    val nv21 = yuv420ToNv21(image)
    val yuvImage = YuvImage(nv21, ImageFormat.NV21, image.width, image.height, null)
    val out = ByteArrayOutputStream()
    yuvImage.compressToJpeg(Rect(0, 0, image.width, image.height), JPEG_QUALITY, out)
    val jpegBytes = out.toByteArray()

    val rotation = image.imageInfo.rotationDegrees
    if (rotation == 0) return jpegBytes

    val bitmap = BitmapFactory.decodeByteArray(jpegBytes, 0, jpegBytes.size)
    val matrix = Matrix().apply { postRotate(rotation.toFloat()) }
    val rotated = Bitmap.createBitmap(bitmap, 0, 0, bitmap.width, bitmap.height, matrix, true)
    val rotatedOut = ByteArrayOutputStream()
    rotated.compress(Bitmap.CompressFormat.JPEG, JPEG_QUALITY, rotatedOut)
    bitmap.recycle()
    rotated.recycle()
    return rotatedOut.toByteArray()
}

private fun yuv420ToNv21(image: ImageProxy): ByteArray {
    val width = image.width
    val height = image.height
    val nv21 = ByteArray(width * height + 2 * (width / 2) * (height / 2))

    val yPlane = image.planes[0]
    val uPlane = image.planes[1]
    val vPlane = image.planes[2]

    var pos = 0
    val yBuffer = yPlane.buffer
    val yRowStride = yPlane.rowStride
    val yPixelStride = yPlane.pixelStride
    for (row in 0 until height) {
        var bufferPos = row * yRowStride
        for (col in 0 until width) {
            nv21[pos++] = yBuffer.get(bufferPos)
            bufferPos += yPixelStride
        }
    }

    val chromaHeight = height / 2
    val chromaWidth = width / 2
    val uBuffer = uPlane.buffer
    val vBuffer = vPlane.buffer
    val uRowStride = uPlane.rowStride
    val uPixelStride = uPlane.pixelStride
    val vRowStride = vPlane.rowStride
    val vPixelStride = vPlane.pixelStride

    for (row in 0 until chromaHeight) {
        val uRowStart = row * uRowStride
        val vRowStart = row * vRowStride
        for (col in 0 until chromaWidth) {
            nv21[pos++] = vBuffer.get(vRowStart + col * vPixelStride)
            nv21[pos++] = uBuffer.get(uRowStart + col * uPixelStride)
        }
    }

    return nv21
}
