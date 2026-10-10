package org.loka.meshlab

import android.content.ClipData
import android.content.ClipboardManager
import android.content.pm.PackageManager
import android.os.Bundle
import android.util.Base64
import androidx.activity.ComponentActivity
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.compose.setContent
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
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import org.loka.core.LabCrypto
import org.loka.core.fingerprint
import org.loka.core.transport.TransportCapability

@Composable
internal fun LabScreen(
    state: LabState, model: LabViewModel, start: () -> Unit,
    discoverable: () -> Unit, copyKey: () -> Unit, export: () -> Unit,
) {
    var importText by remember { mutableStateOf("") }
    var selected by remember { mutableStateOf("") }
    var message by remember { mutableStateOf("Hello C") }
    val candidate = remember(importText) {
        runCatching {
            val key = Base64.decode(importText.trim(), Base64.DEFAULT)
            LabCrypto.parsePublicKey(key); fingerprint(key)
        }.getOrNull()
    }
    Surface(Modifier.fillMaxSize()) {
        LazyColumn(Modifier.fillMaxSize().safeDrawingPadding(), contentPadding = PaddingValues(20.dp),
            verticalArrangement = Arrangement.spacedBy(12.dp)) {
            item {
                Text("LOKA", style = MaterialTheme.typography.displaySmall, color = MaterialTheme.colorScheme.primary)
                Text("Mesh Lab · Android prototype", style = MaterialTheme.typography.titleMedium)
                Text("No data. Still connected.", style = MaterialTheme.typography.bodyLarge)
            }
            item {
                Card {
                    Column(Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                        Text(if (state.running) "Lab listening · ${state.connected.size} links" else "Lab stopped",
                            style = MaterialTheme.typography.titleMedium)
                        Text("Foreground experiment · ${state.transportName}. Allow A–B and B–C only. ${state.setupHint} Local delivery needs no Internet connection.")
                        Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                            Button(onClick = if (state.running) model::stop else start, enabled = state.ready) {
                                Text(if (state.running) "Stop lab" else "Start lab")
                            }
                            OutlinedButton(onClick = discoverable, enabled = state.running && TransportCapability.VISIBILITY in state.capabilities) { Text("Be visible") }
                        }
                        Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                            OutlinedButton(onClick = model::discover, enabled = state.running && TransportCapability.DISCOVERY in state.capabilities) { Text("Discover") }
                            TextButton(onClick = model::refresh, enabled = state.running) { Text("Refresh peers") }
                        }
                        Row {
                            Switch(checked = state.relayEnabled, onCheckedChange = model::relay, enabled = state.ready)
                            Text("Forward ciphertext", Modifier.padding(12.dp))
                        }
                        Row {
                            Switch(checked = !state.automaticNearby, onCheckedChange = { model.automaticNearby(!it) }, enabled = state.ready)
                            Text("Manual BLE topology control", Modifier.padding(12.dp))
                        }
                    }
                }
            }
            item {
                Text("Device identity", style = MaterialTheme.typography.titleLarge)
                SelectionContainer { Text(state.deviceId, style = MaterialTheme.typography.bodySmall) }
                TextButton(onClick = copyKey, enabled = state.ready) { Text("Copy public key") }
                Text("Compare the full fingerprint through a trusted channel before importing a key. Keys persist; messages and queues are in memory.",
                    style = MaterialTheme.typography.bodySmall)
            }
            item { Text("Nearby devices", style = MaterialTheme.typography.titleLarge) }
            if (state.peers.isEmpty()) item { Text("Start the lab, make the other phones visible, then discover.") }
            items(state.peers, key = { it.id }) { peer ->
                Card {
                    Column(Modifier.padding(12.dp)) {
                        Text(peer.displayName, style = MaterialTheme.typography.titleMedium)
                        Text("${peer.id} · ${if (peer.readyToConnect) "ready" else "setup required"}${peer.signalDbm?.let { " · $it dBm" } ?: ""}",
                            style = MaterialTheme.typography.bodySmall)
                        Row {
                            Checkbox(peer.id in state.allowed, { model.allow(peer.id, it) })
                            Text("Allow experiment link", Modifier.padding(top = 14.dp))
                        }
                        val connected = peer.id in state.connected
                        OutlinedButton(onClick = {
                            when { connected -> model.disconnect(peer.id)
                                peer.readyToConnect -> model.connect(peer.id)
                                else -> model.preparePeer(peer.id) }
                        }, enabled = state.running && (connected || (peer.id in state.allowed &&
                            (peer.readyToConnect || TransportCapability.PEER_PREPARATION in state.capabilities)))) {
                            Text(when { connected -> "Disconnect"; peer.readyToConnect -> "Connect"; else -> state.setupAction })
                        }
                    }
                }
            }
            item {
                Text("Trust a device", style = MaterialTheme.typography.titleLarge)
                OutlinedTextField(importText, { importText = it }, label = { Text("Paste public key (Base64)") },
                    modifier = Modifier.fillMaxWidth(), maxLines = 3)
                if (candidate != null) SelectionContainer { Text("Fingerprint: $candidate", style = MaterialTheme.typography.bodySmall) }
                Button(onClick = { model.importKey(importText); importText = "" }, enabled = candidate != null && state.ready) {
                    Text("I verified this fingerprint · Trust")
                }
            }
            item { Text("Encrypted message", style = MaterialTheme.typography.titleLarge) }
            items(state.trusted, key = { it.id }) { device ->
                Row {
                    RadioButton(selected == device.id, { selected = device.id })
                    Text(device.id.take(16), Modifier.weight(1f).padding(top = 14.dp))
                    TextButton(onClick = { model.forget(device.id); if (selected == device.id) selected = "" }) { Text("Forget") }
                }
            }
            item {
                OutlinedTextField(message, { message = it }, label = { Text("Message · maximum 2048 UTF-8 bytes") },
                    modifier = Modifier.fillMaxWidth(), maxLines = 4)
                Button(onClick = { model.send(selected, message) }, enabled = selected.isNotEmpty() && message.isNotBlank() && state.ready) {
                    Text("Encrypt & queue")
                }
                Text("Queueing or writing to a link does not confirm delivery. Check the receiving phone.", style = MaterialTheme.typography.bodySmall)
            }
            item { Text("Received messages", style = MaterialTheme.typography.titleLarge) }
            items(state.messages) { SelectionContainer { Text(it) } }
            item {
                Row {
                    Text("Diagnostics", style = MaterialTheme.typography.titleLarge, modifier = Modifier.weight(1f))
                    TextButton(onClick = export) { Text("Export") }
                }
            }
            items(state.events.asReversed()) { Text(it, style = MaterialTheme.typography.bodySmall) }
        }
    }
}
