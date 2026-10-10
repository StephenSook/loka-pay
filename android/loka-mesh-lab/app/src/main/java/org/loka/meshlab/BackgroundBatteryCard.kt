package org.loka.meshlab

import android.app.ActivityManager
import android.content.Intent
import android.net.Uri
import android.os.Build
import android.os.PowerManager
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

/** A user-approved Doze exemption is distinct from OEM sleep controls or Force stop. */
@Composable
internal fun BackgroundBatteryCard(showTitle: Boolean = true, onReady: (() -> Unit)? = null) {
    val context = LocalContext.current
    val lifecycle = LocalLifecycleOwner.current.lifecycle
    val power = remember(context) { context.getSystemService(PowerManager::class.java) }
    val preferences = remember { context.getSharedPreferences("loka-background-setup", 0) }
    var exempt by remember { mutableStateOf(false) }
    var restricted by remember { mutableStateOf(false) }
    var reviewed by remember { mutableStateOf(preferences.getBoolean("reviewed", false)) }
    var pending by rememberSaveable { mutableStateOf(false) }
    var error by remember { mutableStateOf<String?>(null) }
    fun refresh() {
        exempt = power.isIgnoringBatteryOptimizations(context.packageName)
        restricted = Build.VERSION.SDK_INT >= 28 && context.getSystemService(ActivityManager::class.java).isBackgroundRestricted
    }
    val currentOnReady by rememberUpdatedState(onReady)
    LaunchedEffect(exempt, restricted) { if (exempt && !restricted) currentOnReady?.invoke() }
    val request = rememberLauncherForActivityResult(ActivityResultContracts.StartActivityForResult()) {
        pending = false; reviewed = true
        preferences.edit().putBoolean("reviewed", true).apply()
        refresh() // The exemption setting, not resultCode, proves approval.
    }
    fun openSettings() {
        val intent = if (!exempt) Intent(Settings.ACTION_IGNORE_BATTERY_OPTIMIZATION_SETTINGS)
            else Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS, Uri.parse("package:${context.packageName}"))
        error = null
        if (runCatching { context.startActivity(intent) }.isFailure) {
            error = "Open Settings → Apps → LOKA → Battery."
        }
    }
    DisposableEffect(lifecycle) {
        refresh()
        val observer = LifecycleEventObserver { _, event -> if (event == Lifecycle.Event.ON_RESUME) refresh() }
        lifecycle.addObserver(observer)
        onDispose { lifecycle.removeObserver(observer) }
    }
    Column(Modifier.fillMaxWidth(), verticalArrangement = Arrangement.spacedBy(16.dp)) {
        if (showTitle) Text("Keep messages coming", style = MaterialTheme.typography.titleMedium)
        when {
            exempt && !restricted -> Text("Background access allowed.", color = MaterialTheme.colorScheme.primary)
            else -> {
                Text(if (reviewed || restricted) {
                    if (!exempt) "In battery settings, select LOKA and choose Don’t optimize." else "In Settings, choose Battery → Unrestricted for LOKA."
                } else "Let LOKA stay active when you leave the app. This may use more battery.")
                Button(enabled = !pending, modifier = Modifier.fillMaxWidth().heightIn(min = 52.dp), onClick = {
                    if (reviewed || exempt || restricted) openSettings()
                    else {
                        pending = true; error = null
                        val intent = Intent(Settings.ACTION_REQUEST_IGNORE_BATTERY_OPTIMIZATIONS, Uri.parse("package:${context.packageName}"))
                        if (runCatching { request.launch(intent) }.isFailure) {
                            pending = false; reviewed = true
                            preferences.edit().putBoolean("reviewed", true).apply()
                            openSettings()
                        }
                    }
                }) { Text(if (reviewed || exempt || restricted) "Open battery settings" else "Allow background messaging") }
            }
        }
        error?.let { Text(it, color = MaterialTheme.colorScheme.error) }
    }
}
