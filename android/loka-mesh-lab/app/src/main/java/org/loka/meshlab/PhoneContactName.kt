package org.loka.meshlab

import android.Manifest
import android.content.Context
import android.content.pm.PackageManager
import android.net.Uri
import android.provider.ContactsContract
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.input.KeyboardType
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext

/** Exact international-number match only. Never grants trust or keeps an address-book copy. */
object PhoneContactName {
    fun normalize(value: String): String? {
        if (value.length > 40 || value.any { it !in "+0123456789 ()-." }) return null
        return value.filter { it == '+' || it in '0'..'9' }.takeIf { it.matches(Regex("\\+[1-9][0-9]{6,14}")) }
    }
    fun lookup(context: Context, number: String): String? {
        val phone = requireNotNull(normalize(number)) { "Include the country code, for example +1." }
        check(context.checkSelfPermission(Manifest.permission.READ_CONTACTS) == PackageManager.PERMISSION_GRANTED)
        val names = linkedSetOf<String>()
        val uri = Uri.withAppendedPath(ContactsContract.PhoneLookup.CONTENT_FILTER_URI, Uri.encode(phone))
        context.contentResolver.query(uri, arrayOf(ContactsContract.PhoneLookup.DISPLAY_NAME,
            ContactsContract.PhoneLookup.NUMBER, ContactsContract.PhoneLookup.NORMALIZED_NUMBER), null, null, null)?.use { rows ->
            while (rows.moveToNext()) {
                if (normalize(rows.getString(2).orEmpty()) == phone || normalize(rows.getString(1).orEmpty()) == phone) {
                    rows.getString(0)?.trim()?.take(40)?.takeIf { it.isNotEmpty() }?.let(names::add)
                }
            }
        }
        require(names.size <= 1) { "More than one contact matches. Enter the name yourself." }
        return names.singleOrNull()
    }
}

@Composable fun PhoneContactNameField(onName: (String) -> Unit) {
    val context = LocalContext.current
    var phone by remember { mutableStateOf("") }
    var requested by remember { mutableIntStateOf(0) }
    var busy by remember { mutableStateOf(false) }
    var status by remember { mutableStateOf<String?>(null) }
    val latestOnName by rememberUpdatedState(onName)
    val permission = rememberLauncherForActivityResult(ActivityResultContracts.RequestPermission()) { granted ->
        if (granted) requested++ else status = "Contacts access is off. You can still enter a name."
    }
    LaunchedEffect(requested) {
        if (requested == 0) return@LaunchedEffect
        busy = true
        try {
            val result = withContext(Dispatchers.IO) { PhoneContactName.lookup(context, phone) }
            if (result != null) { latestOnName(result); status = "Name filled from your contacts. You can edit it." }
            else status = "No exact match. Check the country code or enter a name."
        } catch (e: SecurityException) { status = "Contacts access is off. You can enter a name instead." }
        catch (e: IllegalArgumentException) { status = e.message }
        catch (_: Exception) { status = "Could not read contacts. Enter a name or try again." }
        finally { busy = false }
    }
    Column {
        OutlinedTextField(phone, { phone = it.take(40); status = null }, label = { Text("Phone number (optional)") },
            placeholder = { Text("Include country code, e.g. +1") }, singleLine = true, enabled = !busy,
            keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Phone))
        Text("Use your phone’s contacts to fill a name. Contacts stay on this device; only the name you save is kept in LOKA.", style = MaterialTheme.typography.bodySmall)
        TextButton(enabled = !busy && PhoneContactName.normalize(phone) != null, onClick = {
            if (context.checkSelfPermission(Manifest.permission.READ_CONTACTS) == PackageManager.PERMISSION_GRANTED) requested++
            else permission.launch(Manifest.permission.READ_CONTACTS)
        }) { Text(if (busy) "Looking up name…" else "Use phone contacts") }
        status?.let { Text(it, style = MaterialTheme.typography.bodySmall) }
    }
}
