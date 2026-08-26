package com.camstream.app

/** Simple in-process pub/sub so MainActivity can reflect the service's live state. */
object StreamStatus {

    enum class State { IDLE, STARTING, CONNECTING, STREAMING, ERROR }

    interface Listener {
        fun onStatusChanged(state: State, message: String?, cameraId: String?, qualityKey: String?)
    }

    @Volatile var listener: Listener? = null

    fun notifyChanged(
        state: State,
        message: String? = null,
        cameraId: String? = null,
        qualityKey: String? = null
    ) {
        listener?.onStatusChanged(state, message, cameraId, qualityKey)
    }
}
