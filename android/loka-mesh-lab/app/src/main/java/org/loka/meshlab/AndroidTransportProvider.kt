package org.loka.meshlab

import android.Manifest
import android.app.Application
import android.bluetooth.BluetoothAdapter
import android.content.Intent
import android.os.Build
import kotlinx.coroutines.CoroutineScope
import org.loka.core.transport.TransportFactory

/** Android-specific permission/dialog policy belongs to the selected provider. */
interface AndroidTransportProvider {
    val name: String
    val setupHint: String
    val setupAction: String
    val requiredPermissions: Array<String>
    fun activationRequest(): Intent? = null
    fun visibilityRequest(): Intent?
    fun factory(scope: CoroutineScope, allowed: (String) -> Boolean): TransportFactory
}

class BluetoothTransportProvider(private val application: Application) : AndroidTransportProvider {
    override val name = "Bluetooth Classic"
    override val setupHint = "Pair in Android settings if needed."
    override val setupAction = "Pair"
    override val requiredPermissions: Array<String>
        get() = if (Build.VERSION.SDK_INT >= 31) arrayOf(
            Manifest.permission.BLUETOOTH_SCAN,
            Manifest.permission.BLUETOOTH_CONNECT,
            Manifest.permission.BLUETOOTH_ADVERTISE,
        ) else arrayOf(Manifest.permission.ACCESS_FINE_LOCATION)
    override fun visibilityRequest() = Intent(BluetoothAdapter.ACTION_REQUEST_DISCOVERABLE)
        .putExtra(BluetoothAdapter.EXTRA_DISCOVERABLE_DURATION, 120)
    override fun activationRequest(): Intent? =
        if (application.getSystemService(android.bluetooth.BluetoothManager::class.java)?.adapter?.isEnabled == false)
            Intent(BluetoothAdapter.ACTION_REQUEST_ENABLE) else null
    override fun factory(scope: CoroutineScope, allowed: (String) -> Boolean) = TransportFactory { listener ->
        BluetoothTransport(application, scope, allowed, listener)
    }
}
