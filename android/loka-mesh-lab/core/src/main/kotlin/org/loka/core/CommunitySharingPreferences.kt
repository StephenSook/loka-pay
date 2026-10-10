package org.loka.core

import java.math.BigDecimal

/** Internet gateway preferences only. These never configure the local mesh relay. */
data class SharingLimit(val selection: String = "Unlimited", val custom: String = "", val unit: String = "MB") {
    fun bytes(): Long? {
        if (selection == "Unlimited") return null
        val amount = when (selection) {
            "50 MB" -> "50"; "100 MB" -> "100"; "500 MB" -> "500"; "1 GB" -> "1"; "5 GB" -> "5"
            "Custom" -> custom
            else -> throw IllegalArgumentException("Choose a sharing limit.")
        }
        val resolvedUnit = if (selection == "Custom") unit else if (selection.endsWith("GB")) "GB" else "MB"
        require(resolvedUnit in listOf("MB", "GB")) { "Choose MB or GB." }
        require(amount.matches(Regex("(?:[0-9]+(?:\\.[0-9]*)?|\\.[0-9]+)"))) { "Enter a positive number." }
        return try {
            BigDecimal(amount).multiply(BigDecimal(if (resolvedUnit == "GB") 1_000_000_000L else 1_000_000L)).longValueExact().also {
                require(it > 0) { "Enter a positive number." }
            }
        } catch (_: ArithmeticException) { throw IllegalArgumentException("Enter a positive limit within the supported range.") }
    }
    fun error(): String? = runCatching { bytes() }.exceptionOrNull()?.message
    fun label(): String = if (selection == "Unlimited") "Unlimited" else if (selection == "Custom") "Custom" else "$selection / month"
}

data class CommunitySharingPreferences(
    val enabled: Boolean = true,
    val wifi: Boolean = true,
    val mobile: Boolean = false,
    val wifiLimit: SharingLimit = SharingLimit(),
    val mobileLimit: SharingLimit = SharingLimit("100 MB")
) {
    fun error(): String? = when {
        !enabled -> null
        !wifi && !mobile -> "Choose Wi-Fi or mobile data, or turn community sharing off."
        wifi && wifiLimit.error() != null -> wifiLimit.error()
        mobile && mobileLimit.selection == "Unlimited" -> "Choose a mobile data limit."
        mobile && mobileLimit.error() != null -> mobileLimit.error()
        else -> null
    }
}
