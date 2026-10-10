package org.loka.meshlab

import android.Manifest
import android.content.Intent
import android.content.pm.PackageManager
import android.net.Uri
import android.net.wifi.aware.WifiAwareManager
import android.os.Build
import android.provider.Settings
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.layout.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.unit.dp
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.LifecycleEventObserver
import androidx.lifecycle.compose.LocalLifecycleOwner

@Composable internal fun AwareSetupCard(running: Boolean, refresh: () -> Unit, onGranted: (() -> Unit)? = null,
    layout: (@Composable (details: @Composable () -> Unit, action: @Composable () -> Unit) -> Unit)? = null) {
    val context = LocalContext.current
    val lifecycle = LocalLifecycleOwner.current.lifecycle
    val supported = Build.VERSION.SDK_INT >= 29 && context.packageManager.hasSystemFeature(PackageManager.FEATURE_WIFI_AWARE)
    val permission = if (Build.VERSION.SDK_INT >= 33) Manifest.permission.NEARBY_WIFI_DEVICES else Manifest.permission.ACCESS_FINE_LOCATION
    var granted by remember { mutableStateOf(context.checkSelfPermission(permission) == PackageManager.PERMISSION_GRANTED) }
    var available by remember { mutableStateOf(false) }
    val preferences = remember { context.getSharedPreferences("loka-aware-permission", 0) }
    var requested by remember { mutableStateOf(preferences.getBoolean("asked", false)) }
    var pending by rememberSaveable { mutableStateOf(false) }
    fun check() {
        granted = context.checkSelfPermission(permission) == PackageManager.PERMISSION_GRANTED
        available = supported && context.getSystemService(WifiAwareManager::class.java)?.isAvailable == true
        if (granted && running) refresh()
    }
    val request = rememberLauncherForActivityResult(ActivityResultContracts.RequestMultiplePermissions()) {
        pending = false; requested = true; preferences.edit().putBoolean("asked", true).apply(); check()
    }
    val currentOnGranted by rememberUpdatedState(onGranted)
    LaunchedEffect(granted, supported) { if (supported && granted) currentOnGranted?.invoke() }
    DisposableEffect(lifecycle, running) {
        check()
        val observer = LifecycleEventObserver { _, event -> if (event == Lifecycle.Event.ON_RESUME) check() }
        lifecycle.addObserver(observer); onDispose { lifecycle.removeObserver(observer) }
    }
    val details: @Composable () -> Unit = {
        Column(verticalArrangement = Arrangement.spacedBy(12.dp)) {
            Text("Connect to nearby phones", style = MaterialTheme.typography.titleMedium)
            Text(if (requested && !granted) "Open Settings → Permissions → ${if (Build.VERSION.SDK_INT >= 33) "Nearby devices" else "Location"} and choose Allow. Return to LOKA afterward." else "Your phones connect directly using Wi-Fi, without Internet. Choose Allow when your phone asks.")
            Text(when { !supported -> "This phone doesn’t support this connection option."
                !granted -> "Allow nearby access to get started."
                !available -> "Turn on Wi-Fi to use this option. If it’s already on, check your phone’s nearby settings."
                !running -> "Ready to use when you turn on local connections."
                else -> "Ready to look for a nearby phone." })
            Text("Works between compatible Android phones.", style = MaterialTheme.typography.bodySmall)
        }
    }
    val action: @Composable () -> Unit = {
        if (supported && !granted) {
            Button(modifier = Modifier.fillMaxWidth().heightIn(min = 52.dp), enabled = !pending, onClick = {
                if (requested) {
                    runCatching { context.startActivity(Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS, Uri.parse("package:${context.packageName}"))) }
                } else {
                    pending = true
                    request.launch(if (Build.VERSION.SDK_INT >= 33) arrayOf(permission) else arrayOf(Manifest.permission.ACCESS_COARSE_LOCATION, permission))
                }
            }) { Text(if (requested) "Open app settings" else "Allow nearby Wi-Fi") }
        }
    }
    if (layout != null) layout(details, action) else {
        Card(Modifier.fillMaxWidth()) {
            Column(Modifier.padding(20.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
                details()
                action()
            }
        }
    }
}
