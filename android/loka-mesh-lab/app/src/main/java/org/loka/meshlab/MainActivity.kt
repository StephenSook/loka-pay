package org.loka.meshlab

import android.content.ClipData
import android.content.ClipboardManager
import android.content.pm.PackageManager
import android.os.Bundle
import android.util.Base64
import androidx.activity.ComponentActivity
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.compose.setContent
import androidx.compose.runtime.SideEffect
import androidx.compose.ui.graphics.luminance
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.text.selection.SelectionContainer
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.unit.dp
import androidx.lifecycle.ViewModelProvider
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.lifecycleScope
import androidx.core.view.WindowCompat
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import org.loka.core.LabCrypto
import org.loka.core.fingerprint
import org.loka.core.transport.TransportCapability

class MainActivity : ComponentActivity() {
    private var labModel: LabViewModel? = null
    private var incomingFriend by mutableStateOf<String?>(null)
    private var incomingContact by mutableStateOf<String?>(null)
    private fun lightSystemBars():Boolean = when(getSharedPreferences("loka-appearance",0).getString("theme","System")) {
        "Light" -> true
        "Dark" -> false
        else -> resources.configuration.uiMode and android.content.res.Configuration.UI_MODE_NIGHT_MASK != android.content.res.Configuration.UI_MODE_NIGHT_YES
    }
    override fun onResume() {
        super.onResume()
        labModel?.resumeLocalConnection()
        window.decorView.post {
            WindowCompat.getInsetsController(window, window.decorView).apply {
                isAppearanceLightStatusBars = lightSystemBars()
                isAppearanceLightNavigationBars = lightSystemBars()
            }
        }
    }
    override fun onPause() { LocalNotifications.visibleFriend = null; super.onPause() }
    override fun onNewIntent(intent: android.content.Intent) {
        super.onNewIntent(intent)
        setIntent(intent)
        labModel?.debugExcludePeer(intent.getStringExtra("loka-test-exclude"))
        incomingFriend = intent.getStringExtra("friend")?.takeIf { intent.action == LocalNotifications.OPEN }
        incomingContact = intent.dataString?.take(2049)?.takeIf { intent.action == android.content.Intent.ACTION_VIEW }
    }
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        incomingFriend = intent?.getStringExtra("friend")?.takeIf { intent.action == LocalNotifications.OPEN }
        incomingContact = intent?.dataString?.take(2049)?.takeIf { intent.action == android.content.Intent.ACTION_VIEW }
        WindowCompat.getInsetsController(window, window.decorView).apply {
            isAppearanceLightStatusBars = lightSystemBars()
            isAppearanceLightNavigationBars = lightSystemBars()
        }
        val provider = (application as LokaApplication).transportProvider
        val model = (application as LokaApplication).messages
        labModel = model
        model.debugExcludePeer(intent.getStringExtra("loka-test-exclude"))
        setContent {
            MaterialTheme(colorScheme = LokaColors.scheme, shapes = Shapes(
                small = androidx.compose.foundation.shape.RoundedCornerShape(14.dp),
                medium = androidx.compose.foundation.shape.RoundedCornerShape(22.dp),
                large = androidx.compose.foundation.shape.RoundedCornerShape(28.dp))) {
                val lightAppearance = androidx.compose.material3.MaterialTheme.colorScheme.background.luminance() > 0.5f
                SideEffect {
                    WindowCompat.getInsetsController(window, window.decorView).apply {
                        isAppearanceLightStatusBars = lightAppearance
                        isAppearanceLightNavigationBars = lightAppearance
                    }
                }
                val state by model.state.collectAsStateWithLifecycle()
                val permissions = provider.requiredPermissions
                val nearbyPreferences = remember { getSharedPreferences("nearby-onboarding", MODE_PRIVATE) }
                val notificationPreferences = remember { getSharedPreferences("notification-onboarding", MODE_PRIVATE) }
                val nearbySupported = packageManager.hasSystemFeature(PackageManager.FEATURE_BLUETOOTH_LE)
                var nearbyGranted by remember { mutableStateOf(permissions.all { checkSelfPermission(it) == PackageManager.PERMISSION_GRANTED }) }
                var nearbyDenied by remember { mutableStateOf(!nearbyGranted && nearbyPreferences.getBoolean("asked", false)) }
                var notificationsGranted by remember { mutableStateOf(androidx.core.app.NotificationManagerCompat.from(this@MainActivity).areNotificationsEnabled()) }
                var notificationsDenied by remember { mutableStateOf(!notificationsGranted && notificationPreferences.getBoolean("asked", false)) }
                fun bluetoothOn(): Boolean = nearbySupported && nearbyGranted && runCatching {
                    getSystemService(android.bluetooth.BluetoothManager::class.java)?.adapter?.isEnabled == true
                }.getOrDefault(false)
                var nearbyRadioOn by remember { mutableStateOf(bluetoothOn()) }
                val refreshPermissions = {
                    nearbyGranted = permissions.all { checkSelfPermission(it) == PackageManager.PERMISSION_GRANTED }
                    nearbyDenied = !nearbyGranted && nearbyPreferences.getBoolean("asked", false)
                    notificationsGranted = androidx.core.app.NotificationManagerCompat.from(this@MainActivity).areNotificationsEnabled()
                    notificationsDenied = !notificationsGranted && notificationPreferences.getBoolean("asked", false)
                    nearbyRadioOn = bluetoothOn()
                }
                DisposableEffect(Unit) {
                    val observer = androidx.lifecycle.LifecycleEventObserver { _, event ->
                        if (event == androidx.lifecycle.Lifecycle.Event.ON_RESUME) refreshPermissions()
                    }
                    lifecycle.addObserver(observer)
                    val receiver = object : android.content.BroadcastReceiver() {
                        override fun onReceive(context: android.content.Context?, intent: android.content.Intent?) { refreshPermissions() }
                    }
                    androidx.core.content.ContextCompat.registerReceiver(this@MainActivity, receiver,
                        android.content.IntentFilter(android.bluetooth.BluetoothAdapter.ACTION_STATE_CHANGED),
                        androidx.core.content.ContextCompat.RECEIVER_EXPORTED)
                    onDispose { lifecycle.removeObserver(observer); unregisterReceiver(receiver) }
                }
                val notificationRequest = rememberLauncherForActivityResult(ActivityResultContracts.RequestPermission()) {
                    notificationPreferences.edit().putBoolean("asked", true).apply(); refreshPermissions()
                }
                LaunchedEffect(Unit) {
                    LocalNotifications.channels(this@MainActivity)

                }
                val activation = rememberLauncherForActivityResult(ActivityResultContracts.StartActivityForResult()) {
                    refreshPermissions()
                    if (nearbyRadioOn) model.start()
                }
                val beginConnection = {
                    val intent = provider.activationRequest()
                    if (intent != null) activation.launch(intent) else model.start()
                }
                val request = rememberLauncherForActivityResult(ActivityResultContracts.RequestMultiplePermissions()) { granted ->
                    nearbyPreferences.edit().putBoolean("asked", true).apply()
                    refreshPermissions()
                    if (permissions.all { granted[it] == true || checkSelfPermission(it) == PackageManager.PERMISSION_GRANTED }) beginConnection()
                }
                var explainNearby by remember { mutableStateOf(false) }
                if (explainNearby) AlertDialog(
                    onDismissRequest = { explainNearby = false },
                    title = { Text("Stay connected locally") },
                    text = { Text("Allow Nearby Devices so LOKA can find and communicate with other LOKA users around you without requiring Internet.") },
                    confirmButton = { TextButton(onClick = {
                        nearbyPreferences.edit().putBoolean("explained", true).apply()
                        explainNearby = false
                        request.launch(permissions)
                    }) { Text("Allow Nearby Devices") } },
                    dismissButton = { TextButton(onClick = { explainNearby = false }) { Text("Not now") } })
                val discoverable = rememberLauncherForActivityResult(ActivityResultContracts.StartActivityForResult()) {
                    model.log("Discoverability dialog result: ${it.resultCode}")
                }
                val export = rememberLauncherForActivityResult(ActivityResultContracts.CreateDocument("text/plain")) { uri ->
                    if (uri != null) lifecycleScope.launch(Dispatchers.IO) {
                        runCatching {
                            checkNotNull(contentResolver.openOutputStream(uri)).bufferedWriter().use {
                                it.write("LOKA Mesh Lab diagnostics\nDevice: ${state.deviceId}\n")
                                it.write(state.events.joinToString("\n"))
                            }
                        }.onSuccess { model.log("Diagnostics exported") }
                            .onFailure { model.log("Export failed: ${it.message}") }
                    }
                }
                LokaApp(state, model,
                    start = {
                        if (!nearbySupported) model.reportError("This phone doesn’t support nearby Bluetooth messaging.")
                        else if (permissions.all { checkSelfPermission(it) == PackageManager.PERMISSION_GRANTED }) beginConnection()
                        else if (nearbyPreferences.getBoolean("asked", false)) {
                            startActivity(android.content.Intent(android.provider.Settings.ACTION_APPLICATION_DETAILS_SETTINGS, android.net.Uri.parse("package:$packageName")))
                        }
                        else if (!state.onboardingComplete) { nearbyPreferences.edit().putBoolean("explained", true).apply(); request.launch(permissions) }
                        else if (!nearbyPreferences.getBoolean("explained", false)) explainNearby = true
                        else request.launch(permissions)
                    },
                    discoverable = {
                        runCatching {
                            discoverable.launch(checkNotNull(provider.visibilityRequest()) {
                                "Visibility request unavailable for selected transport"
                            })
                        }.onFailure { model.log("Discoverability failed: ${it.message}") }
                    },
                    copyKey = {
                        getSystemService(ClipboardManager::class.java).setPrimaryClip(
                            ClipData.newPlainText("LOKA public key", state.publicKey))
                        model.log("Public key copied; verify fingerprint with recipient")
                    }, export = { export.launch("loka-lab-${System.currentTimeMillis()}.txt") },
                    incomingFriend = incomingFriend, consumeFriend = { incomingFriend = null },
                    incomingContact = incomingContact,
                    consumeContact = { incomingContact = null; intent.data = null },
                    nearbyGranted = nearbyGranted, notificationsGranted = notificationsGranted,
                    nearbyDenied = nearbyDenied, notificationsDenied = notificationsDenied,
                    nearbySupported = nearbySupported, nearbyRadioOn = nearbyRadioOn,
                    notifications = {
                        refreshPermissions()
                        if (!notificationsGranted) {
                            val prefs = notificationPreferences
                            if (android.os.Build.VERSION.SDK_INT >= 33 &&
                                checkSelfPermission(android.Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED &&
                                !prefs.getBoolean("asked", false)) {
                                notificationRequest.launch(android.Manifest.permission.POST_NOTIFICATIONS)
                            } else startActivity(android.content.Intent(android.provider.Settings.ACTION_APP_NOTIFICATION_SETTINGS)
                                .putExtra(android.provider.Settings.EXTRA_APP_PACKAGE, packageName))
                        }
                    })
            }
        }
    }
}
