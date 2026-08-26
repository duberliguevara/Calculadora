package com.camstream.app

enum class StreamProtocol(
    val key: String,
    val label: String,
    val description: String,
    val port: Int
) {
    RTMP(
        "rtmp",
        "RTMP (más compatible)",
        "Lo entiende prácticamente cualquier programa de streaming/edición, pero tiene más retraso (unos 2-5 segundos, a veces más).",
        1935
    ),
    SRT(
        "srt",
        "SRT (menos retraso)",
        "Mucho menos retraso (menos de 1 segundo). Necesita que el programa receptor lo soporte explícitamente — OBS Studio sí lo soporta.",
        8890
    );

    fun buildUrl(host: String, streamPath: String): String = when (this) {
        RTMP -> "rtmp://$host:$port/$streamPath"
        SRT -> "srt://$host:$port?streamid=publish:$streamPath"
    }

    companion object {
        val DEFAULT = RTMP

        fun fromKey(key: String?): StreamProtocol =
            entries.firstOrNull { it.key == key } ?: DEFAULT
    }
}
