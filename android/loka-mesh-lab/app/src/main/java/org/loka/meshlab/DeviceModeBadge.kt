package org.loka.meshlab

import android.net.ConnectivityManager
import android.net.Network
import android.net.NetworkCapabilities
import android.os.Handler
import android.os.Looper
import androidx.compose.runtime.*
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.Alignment
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp

/** Presentation only: never used by discovery, routing, relaying or message admission. */
internal data class DeviceMode(val online: Boolean? = null, val wifi: Boolean = false)

@Composable private fun rememberDeviceMode(): DeviceMode {
    val context = LocalContext.current
    var mode by remember { mutableStateOf(DeviceMode()) }
    DisposableEffect(context) {
        val connectivity = context.getSystemService(ConnectivityManager::class.java)
        var current: Network? = null
        var capabilities: NetworkCapabilities? = null
        var blocked = false
        fun update() {
            val caps = capabilities
            mode = DeviceMode(caps != null && !blocked && caps.hasCapability(NetworkCapabilities.NET_CAPABILITY_INTERNET) && caps.hasCapability(NetworkCapabilities.NET_CAPABILITY_VALIDATED), caps?.hasTransport(NetworkCapabilities.TRANSPORT_WIFI) == true)
        }
        val callback = object : ConnectivityManager.NetworkCallback() {
            override fun onAvailable(network: Network) { current = network; capabilities = null; blocked = false; mode = DeviceMode() }
            override fun onCapabilitiesChanged(network: Network, caps: NetworkCapabilities) { if (network == current) { capabilities = caps; update() } }
            override fun onBlockedStatusChanged(network: Network, isBlocked: Boolean) { if (network == current) { blocked = isBlocked; update() } }
            override fun onLost(network: Network) { if (network == current) { current = null; capabilities = null; update() } }
        }
        val registered = runCatching {
            connectivity.registerDefaultNetworkCallback(callback, Handler(Looper.getMainLooper()))
            if (connectivity.activeNetwork == null) mode = DeviceMode(false)
        }.isSuccess
        onDispose { if (registered) connectivity.unregisterNetworkCallback(callback) }
    }
    return mode
}

@Composable internal fun DeviceModeBadge() {
    val mode = rememberDeviceMode()
    var explain by remember { mutableStateOf(false) }
    val label = when(mode.online) { true -> "Online mode"; false -> "Offline mode"; null -> "Checking mode" }
    Row(Modifier.background(if (mode.online == true) LokaColors.mintAccent else LokaColors.yellow, RoundedCornerShape(12.dp)).clickable { explain = true }.padding(horizontal = 9.dp, vertical = 6.dp), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(4.dp)) {
        Glyph(if (mode.online == true) "wifi" else "wifi_off", Modifier.size(16.dp), androidx.compose.ui.graphics.Color(0xFF2C0C40))
        Text(label, color = androidx.compose.ui.graphics.Color(0xFF2C0C40), fontSize = 10.sp, fontWeight = FontWeight.Bold)
    }
    if (explain) AlertDialog(onDismissRequest = { explain = false }, title = { Text(label) }, text = { Text(when(mode.online) {
        true -> "Your phone has Internet access. Nearby chats still use local connections whenever possible."
        false -> (if (mode.wifi) "Wi-Fi is connected, but Internet access isn’t verified. " else "Your phone has no verified Internet connection. ") + "Nearby chats can still work through a local LOKA connection."
        null -> "Checking your phone’s Internet connection. Local LOKA connections work independently."
    }) }, confirmButton = { TextButton(onClick = { explain = false }) { Text("Got it") } })
}
