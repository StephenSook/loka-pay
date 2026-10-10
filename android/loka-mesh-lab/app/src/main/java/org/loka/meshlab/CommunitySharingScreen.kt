package org.loka.meshlab

import androidx.compose.animation.AnimatedVisibility
import androidx.compose.foundation.Image
import androidx.compose.foundation.selection.toggleable
import androidx.compose.ui.semantics.Role
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalSoftwareKeyboardController
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import org.json.JSONObject
import org.loka.core.CommunitySharingPreferences
import org.loka.core.SharingLimit

internal class CommunitySharingStore(context: android.content.Context) {
    private val preferences = context.getSharedPreferences("loka-community-sharing", 0)
    fun load(): CommunitySharingPreferences = runCatching {
        val json = JSONObject(preferences.getString("settings", null) ?: return CommunitySharingPreferences())
        fun limit(name: String, default: SharingLimit): SharingLimit {
            val item = json.optJSONObject(name) ?: return default
            return SharingLimit(item.getString("selection"), item.optString("custom"), item.optString("unit", "MB"))
        }
        CommunitySharingPreferences(json.getBoolean("enabled"), json.getBoolean("wifi"), json.getBoolean("mobile"), limit("wifiLimit", SharingLimit()), limit("mobileLimit", SharingLimit("100 MB")))
    }.getOrDefault(CommunitySharingPreferences())
    fun save(value: CommunitySharingPreferences): Boolean {
        require(value.error() == null)
        fun limit(value: SharingLimit) = JSONObject().put("selection", value.selection).put("custom", value.custom).put("unit", value.unit)
        val json = JSONObject().put("enabled", value.enabled).put("wifi", value.wifi).put("mobile", value.mobile)
            .put("wifiLimit", limit(value.wifiLimit)).put("mobileLimit", limit(value.mobileLimit))
        return preferences.edit().putString("settings", json.toString()).putBoolean("consent-saved", true).commit()
    }
}

@Composable
internal fun CommunitySharingScreen(modifier: Modifier = Modifier, onboarding: Boolean = false, saved: () -> Unit) {
    val context = LocalContext.current
    val keyboard = LocalSoftwareKeyboardController.current
    val store = remember { CommunitySharingStore(context) }
    val initial = remember { store.load() }
    var enabled by rememberSaveable { mutableStateOf(initial.enabled) }
    var wifi by rememberSaveable { mutableStateOf(initial.wifi) }
    var mobile by rememberSaveable { mutableStateOf(initial.mobile) }
    var wifiSelection by rememberSaveable { mutableStateOf(initial.wifiLimit.selection) }
    var mobileSelection by rememberSaveable { mutableStateOf(initial.mobileLimit.selection) }
    var wifiCustom by rememberSaveable { mutableStateOf(initial.wifiLimit.custom) }
    var mobileCustom by rememberSaveable { mutableStateOf(initial.mobileLimit.custom) }
    var wifiUnit by rememberSaveable { mutableStateOf(initial.wifiLimit.unit) }
    var mobileUnit by rememberSaveable { mutableStateOf(initial.mobileLimit.unit) }
    var saveError by remember { mutableStateOf<String?>(null) }
    val value = CommunitySharingPreferences(enabled, wifi, mobile, SharingLimit(wifiSelection, wifiCustom, wifiUnit), SharingLimit(mobileSelection, mobileCustom, mobileUnit))
    Column(modifier.fillMaxSize().imePadding()) {
        Column(Modifier.weight(1f).fillMaxWidth().verticalScroll(rememberScrollState()).padding(24.dp), verticalArrangement = Arrangement.spacedBy(20.dp)) {
            if (onboarding) {
                Image(painterResource(R.drawable.community_sharing), null, Modifier.fillMaxWidth().heightIn(max = 190.dp))
                Text("A little connection.\nA stronger community.", fontFamily = LokaDisplay.font, fontSize = 27.sp, lineHeight = 32.sp)
            }
            Text("Help relay encrypted messages when you’re online. Sharing is optional.", color = LokaColors.muted, fontSize = 15.sp)
            Surface(shape = RoundedCornerShape(24.dp), color = LokaColors.surface) {
                Column(Modifier.padding(18.dp), verticalArrangement = Arrangement.spacedBy(14.dp)) {
                    SharingSwitch("Join community sharing", enabled) { enabled = it }
                    AnimatedVisibility(enabled) {
                        Column(verticalArrangement = Arrangement.spacedBy(16.dp)) {
                            HorizontalDivider(color = LokaColors.line)
                            SharingSwitch("Share on Wi-Fi", wifi) { wifi = it }
                            AnimatedVisibility(wifi) {
                                SharingLimitField("Wi-Fi sharing limit", value.wifiLimit, listOf("Unlimited", "500 MB", "1 GB", "5 GB", "Custom"), { wifiSelection = it }, { wifiCustom = it }, { wifiUnit = it })
                            }
                            HorizontalDivider(color = LokaColors.line)
                            SharingSwitch("Share mobile data", mobile) { mobile = it }
                            AnimatedVisibility(mobile) {
                                Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                                    SharingLimitField("Monthly sharing limit", value.mobileLimit, listOf("50 MB", "100 MB", "500 MB", "1 GB", "Custom"), { mobileSelection = it }, { mobileCustom = it }, { mobileUnit = it })
                                    Text("Sharing stops at your limit. Carrier charges may apply.", color = LokaColors.muted, fontSize = 12.sp)
                                }
                            }
                            if (!mobile) Text("Mobile data won’t be used for community sharing.", color = LokaColors.muted, fontSize = 13.sp)
                        }
                    }
                    if (!enabled) Text("Community sharing is off.", color = MaterialTheme.colorScheme.secondary)
                    if (enabled && !wifi && !mobile) Text(value.error().orEmpty(), color = MaterialTheme.colorScheme.error)
                }
            }
            Text("Internet community sharing isn’t available yet. Save your preferences for when it launches.", color = MaterialTheme.colorScheme.secondary, fontSize = 13.sp)
            if (!onboarding) {
                Text("Usage: no community relay traffic recorded.", color = LokaColors.muted)
                Text("Monthly limits use your device’s local calendar month and cover community relay traffic plus network overhead. Your own messages and local mesh relaying are separate.", color = LokaColors.muted, fontSize = 12.sp)
            }
            saveError?.let { Text(it, color = MaterialTheme.colorScheme.error) }
        }
        Box(Modifier.fillMaxWidth().padding(horizontal = 24.dp, vertical = 16.dp)) {
            Button(onClick = { if (store.save(value)) { keyboard?.hide(); saved() } else saveError = "Couldn’t save sharing preferences. Please try again." }, enabled = value.error() == null, modifier = Modifier.fillMaxWidth().heightIn(min = 54.dp)) {
                Text(if (onboarding) "Save & continue" else "Save changes", fontWeight = FontWeight.Bold)
            }
        }
    }
}

@Composable private fun SharingSwitch(label: String, value: Boolean, change: (Boolean) -> Unit) {
    Row(Modifier.fillMaxWidth().toggleable(value = value, role = Role.Switch, onValueChange = change), verticalAlignment = Alignment.CenterVertically) {
        Text(label, Modifier.weight(1f), fontWeight = FontWeight.SemiBold, fontSize = 16.sp)
        Switch(value, onCheckedChange = null)
    }
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable private fun SharingLimitField(label: String, value: SharingLimit, choices: List<String>, select: (String) -> Unit, custom: (String) -> Unit, unit: (String) -> Unit) {
    var sheet by rememberSaveable { mutableStateOf(false) }
    Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
        Text(label, color = LokaColors.muted, fontSize = 13.sp)
        OutlinedButton(onClick = { sheet = true }, modifier = Modifier.fillMaxWidth(), shape = RoundedCornerShape(14.dp)) { Text(value.label(), Modifier.weight(1f)); Text("⌄") }
        AnimatedVisibility(value.selection == "Custom") {
            Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                OutlinedTextField(value.custom, { custom(it.take(24)) }, label = { Text("Custom monthly limit") }, keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Decimal), singleLine = true, isError = value.error() != null, modifier = Modifier.fillMaxWidth())
                Row(horizontalArrangement = Arrangement.spacedBy(12.dp)) { listOf("MB", "GB").forEach { name -> FilterChip(value.unit == name, { unit(name) }, label = { Text(name) }) } }
                value.error()?.let { Text(it, color = MaterialTheme.colorScheme.error, fontSize = 12.sp) }
            }
        }
        if (value.selection == "Unlimited") Text("No sharing cap on Wi-Fi.", color = LokaColors.muted, fontSize = 12.sp)
        else if (value.selection != "Custom") Text("${value.selection} per calendar month.", color = LokaColors.muted, fontSize = 12.sp)
    }
    if (sheet) ModalBottomSheet(onDismissRequest = { sheet = false }) {
        Column(Modifier.fillMaxWidth().verticalScroll(rememberScrollState()).padding(24.dp)) {
            Text(label, style = MaterialTheme.typography.titleLarge)
            choices.forEach { choice -> TextButton(onClick = { select(choice); sheet = false }, modifier = Modifier.fillMaxWidth().heightIn(min = 48.dp)) {
                Text(if (choice == "Unlimited" || choice == "Custom") choice else "$choice / month", Modifier.weight(1f))
                if (choice == value.selection) Text("✓")
            } }
        }
    }
}
