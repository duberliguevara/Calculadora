package com.camstream.app

/** Bitrates follow common streaming-guide ballparks (YouTube/Twitch) for each resolution/fps. */
enum class QualityPreset(
    val key: String,
    val label: String,
    val width: Int,
    val height: Int,
    val fps: Int,
    val videoBitrateBps: Int
) {
    SD_480("sd", "Baja (480p, ahorra datos)", 854, 480, 30, 2_000_000),
    HD_720("hd", "Media (720p)", 1280, 720, 30, 4_500_000),
    FHD_1080("fhd", "Alta (1080p)", 1920, 1080, 30, 8_000_000),
    FHD_1080_60("fhd60", "Máxima (1080p60)", 1920, 1080, 60, 12_000_000);

    companion object {
        val DEFAULT = FHD_1080

        fun fromKey(key: String?): QualityPreset =
            entries.firstOrNull { it.key == key } ?: DEFAULT
    }
}
