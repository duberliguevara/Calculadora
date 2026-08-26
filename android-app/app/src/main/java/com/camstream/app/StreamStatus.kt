package com.camstream.app

/** Simple in-process pub/sub so MainActivity can reflect the service's live state. */
object StreamStatus {
    const val PORT = 8080

    interface Listener {
        fun onStatusChanged(running: Boolean, ipAddress: String?)
    }

    @Volatile var listener: Listener? = null

    fun notifyChanged(running: Boolean, ipAddress: String?) {
        listener?.onStatusChanged(running, ipAddress)
    }
}
