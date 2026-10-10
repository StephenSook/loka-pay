package org.loka.meshlab

import android.app.Activity
import android.content.ClipData
import android.content.ClipboardManager
import android.os.PersistableBundle
import android.view.WindowManager
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.selection.SelectionContainer
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.PasswordVisualTransformation
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp

@Composable
internal fun BackupScreen(state: LabState, model: LabViewModel) {
    val context = LocalContext.current
    DisposableEffect(context) {
        val window = (context as Activity).window
        val alreadySecure = window.attributes.flags and WindowManager.LayoutParams.FLAG_SECURE != 0
        window.addFlags(WindowManager.LayoutParams.FLAG_SECURE)
        onDispose { if (!alreadySecure) window.clearFlags(WindowManager.LayoutParams.FLAG_SECURE) }
    }
    var acknowledged by remember(state.backupCode) { mutableStateOf(false) }
    var restoreUri by remember { mutableStateOf<android.net.Uri?>(null) }
    var restoreKey by remember { mutableStateOf("") }
    val save = rememberLauncherForActivityResult(ActivityResultContracts.CreateDocument("application/octet-stream")) { uri ->
        if (uri != null) model.saveBackup(uri)
    }
    val open = rememberLauncherForActivityResult(ActivityResultContracts.OpenDocument()) { uri ->
        restoreUri = uri; restoreKey = ""
    }
    LazyColumn(contentPadding = PaddingValues(24.dp), verticalArrangement = Arrangement.spacedBy(18.dp)) {
        item { Surface(shape = RoundedCornerShape(20.dp), color = LokaColors.mint) {
            Column(Modifier.padding(20.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
                Text("Your chats stay with you", fontSize = 22.sp, fontWeight = FontWeight.Bold)
                Text("Messages are saved encrypted on this phone, even when you close LOKA. This preview keeps the latest 5,000 messages.", color = LokaColors.green, fontSize = 14.sp)
                Text("${state.chatMessages.size} messages in history", fontWeight = FontWeight.SemiBold)
                if (state.historySaveFailed) Text("Some messages could not be saved. Create a backup before closing LOKA and check your free storage.", color = MaterialTheme.colorScheme.error, fontSize = 13.sp)
            }
        } }
        item { Surface(shape = RoundedCornerShape(20.dp), color = androidx.compose.ui.graphics.Color.White) {
            Column(Modifier.padding(20.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
                Text("Encrypted backup", fontSize = 18.sp, fontWeight = FontWeight.Bold)
                Text("Save a backup on your phone or choose Google Drive in the file picker if it is available. Drive needs Internet to sync; local chats do not.", color = LokaColors.muted, fontSize = 14.sp)
                Text(state.backupStatus, color = LokaColors.green, fontSize = 12.sp)
                if (state.backupCode == null) {
                    Button(onClick = model::prepareBackup, enabled = state.ready && !state.backupBusy, modifier = Modifier.fillMaxWidth()) { Text("Create encrypted backup") }
                } else {
                    Text("Save your recovery key first", fontWeight = FontWeight.Bold)
                    Text("Keep this key separately from the backup, for example in a password manager. Losing it means losing access to this backup. Your phone number and Google account cannot unlock it.", color = LokaColors.muted, fontSize = 13.sp)
                    SelectionContainer { Text(state.backupCode, fontSize = 13.sp, fontWeight = FontWeight.SemiBold) }
                    OutlinedButton(onClick = {
                        val clip = ClipData.newPlainText("LOKA backup recovery key", state.backupCode).apply {
                            description.extras = PersistableBundle().apply { putBoolean("android.content.extra.IS_SENSITIVE", true) }
                        }
                        context.getSystemService(ClipboardManager::class.java).setPrimaryClip(clip)
                    }, enabled = !state.backupBusy, modifier = Modifier.fillMaxWidth()) { Text("Copy recovery key") }
                    Row { Checkbox(acknowledged, { acknowledged = it }, enabled = !state.backupBusy)
                        Text("I saved the recovery key somewhere safe", Modifier.padding(top = 12.dp), fontSize = 13.sp) }
                    Button(onClick = { save.launch("loka-backup-${System.currentTimeMillis()}.lokabackup") }, enabled = acknowledged && !state.backupBusy, modifier = Modifier.fillMaxWidth()) { Text("Choose where to save") }
                    TextButton(onClick = model::cancelBackup, enabled = !state.backupBusy) { Text("Cancel this backup") }
                }
                if (state.backupBusy) LinearProgressIndicator(Modifier.fillMaxWidth())
            }
        } }
        item { Surface(shape = RoundedCornerShape(20.dp), color = androidx.compose.ui.graphics.Color.White) {
            Column(Modifier.padding(20.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
                Text("Restore your chats", fontSize = 18.sp, fontWeight = FontWeight.Bold)
                Text("Choose a LOKA backup and enter its recovery key. Saved history is merged with current chats. Contacts must be verified separately on a new phone; old messages are not resent.", color = LokaColors.muted, fontSize = 14.sp)
                OutlinedButton(onClick = { open.launch(arrayOf("*/*")) }, enabled = state.ready && !state.backupBusy && state.backupCode == null, modifier = Modifier.fillMaxWidth()) { Text("Choose backup to restore") }
            }
        } }
        item { Text("Manual backup only for now. No automatic cloud sync or account recovery. Uninstalling the app removes local history and its device key. Encryption remains an experimental preview awaiting independent review.", color = LokaColors.muted, fontSize = 12.sp) }
    }
    if (restoreUri != null) AlertDialog(onDismissRequest = { if (!state.backupBusy) { restoreUri = null; restoreKey = "" } },
        title = { Text("Unlock your backup") }, text = {
            OutlinedTextField(restoreKey, { restoreKey = it.take(64) }, label = { Text("Backup recovery key") },
                visualTransformation = PasswordVisualTransformation(), singleLine = true, enabled = !state.backupBusy)
        }, confirmButton = { TextButton(onClick = {
            model.restoreBackup(checkNotNull(restoreUri), restoreKey) { restoreUri = null; restoreKey = "" }
        }, enabled = restoreKey.trim().length == 43 && !state.backupBusy) { Text("Restore chats") } },
        dismissButton = { TextButton(onClick = { restoreUri = null; restoreKey = "" }, enabled = !state.backupBusy) { Text("Cancel") } })
}
