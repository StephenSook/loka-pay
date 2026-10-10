package org.loka.meshlab

import androidx.compose.runtime.*
import androidx.compose.foundation.*
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.material3.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.Alignment
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.unit.dp
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.semantics.selected
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.asImageBitmap
import androidx.compose.ui.layout.ContentScale
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts

internal val profileArt = listOf(R.drawable.avatar_0, R.drawable.avatar_1, R.drawable.avatar_2, R.drawable.avatar_3, R.drawable.avatar_4, R.drawable.avatar_5, R.drawable.avatar_6, R.drawable.avatar_7, R.drawable.avatar_8, R.drawable.avatar_9, R.drawable.avatar_10, R.drawable.avatar_11, R.drawable.avatar_12, R.drawable.avatar_13, R.drawable.avatar_14, R.drawable.avatar_15, R.drawable.avatar_16, R.drawable.avatar_17, R.drawable.avatar_18, R.drawable.avatar_19, R.drawable.avatar_20, R.drawable.avatar_21, R.drawable.avatar_22, R.drawable.avatar_23, R.drawable.avatar_24, R.drawable.avatar_25, R.drawable.avatar_26, R.drawable.avatar_27, R.drawable.avatar_28, R.drawable.avatar_29, R.drawable.avatar_30, R.drawable.avatar_31, R.drawable.avatar_32, R.drawable.avatar_33, R.drawable.avatar_34, R.drawable.avatar_35, R.drawable.avatar_36, R.drawable.avatar_37, R.drawable.avatar_38, R.drawable.avatar_39, R.drawable.avatar_40, R.drawable.avatar_41)

@Composable internal fun appearanceValue(key: String, fallback: String): String {
    val context = LocalContext.current
    val prefs = remember { context.getSharedPreferences("loka-appearance", 0) }
    var value by remember(key) { mutableStateOf(prefs.getString(key, null) ?: if (key == "avatar") kotlin.random.Random.nextInt(6, profileArt.size).toString() else fallback) }
    LaunchedEffect(prefs, key) { if (key == "avatar" && !prefs.contains(key)) prefs.edit().putString(key, value).apply() }
    DisposableEffect(prefs, key) {
        val listener = android.content.SharedPreferences.OnSharedPreferenceChangeListener { _, changed -> if (changed == key) value = prefs.getString(key, fallback) ?: fallback }
        prefs.registerOnSharedPreferenceChangeListener(listener)
        onDispose { prefs.unregisterOnSharedPreferenceChangeListener(listener) }
    }
    return value
}

@Composable internal fun ProfilePortrait(name: String, modifier: Modifier, own: Boolean = false, avatarID: String? = null, peerID: String? = null) {
    val context = LocalContext.current
    val selected = appearanceValue("avatar", "0")
    val photoVersion = appearanceValue("photo", "")
    val bitmap = remember(photoVersion, own) { if (own && photoVersion.isNotEmpty()) android.graphics.BitmapFactory.decodeFile(java.io.File(context.filesDir, "profile-avatar.jpg").path) else null }
    val cached = appearanceValue("peer-avatar-${peerID.orEmpty()}", "")
    val remote = org.loka.core.NearbyPeople.avatarID(avatarID ?: cached)?.removePrefix("avatar_")?.toIntOrNull()
    val index = if (own) selected.toIntOrNull()?.coerceIn(0, profileArt.lastIndex) ?: 0 else remote ?: name.toByteArray(Charsets.UTF_8).fold(0) { value, byte -> (value * 31 + (byte.toInt() and 255)) % 6 }
    if (own && selected == "photo" && bitmap != null) Image(bitmap.asImageBitmap(), "Your profile picture", modifier.clip(CircleShape), contentScale = ContentScale.Crop)
    else Image(painterResource(profileArt[index]), if (own) "Your profile illustration" else null, modifier.clip(CircleShape).border(2.dp, LokaColors.green.copy(alpha=.4f), CircleShape), contentScale = ContentScale.Crop)
}

@Composable internal fun AvatarChoices(chosen: () -> Unit = {}) {
    val context = LocalContext.current
    val selected = appearanceValue("avatar", "0")
    var error by remember { mutableStateOf<String?>(null) }
    val photo = rememberLauncherForActivityResult(ActivityResultContracts.GetContent()) { uri ->
        if (uri != null) runCatching {
            val bounds = android.graphics.BitmapFactory.Options().apply { inJustDecodeBounds = true }
            context.contentResolver.openInputStream(uri)?.use { android.graphics.BitmapFactory.decodeStream(it, null, bounds) }
            val options = android.graphics.BitmapFactory.Options()
            while (maxOf(bounds.outWidth, bounds.outHeight) / options.inSampleSize > 1280) options.inSampleSize *= 2
            val bitmap = context.contentResolver.openInputStream(uri)?.use { android.graphics.BitmapFactory.decodeStream(it, null, options) } ?: error("Couldn’t open photo")
            val scale = minOf(1f, 640f / maxOf(bitmap.width, bitmap.height))
            val resized = android.graphics.Bitmap.createScaledBitmap(bitmap, (bitmap.width * scale).toInt().coerceAtLeast(1), (bitmap.height * scale).toInt().coerceAtLeast(1), true)
            java.io.File(context.filesDir, "profile-avatar.jpg").outputStream().use { resized.compress(android.graphics.Bitmap.CompressFormat.JPEG, 88, it) }
            context.getSharedPreferences("loka-appearance",0).edit().putString("avatar","photo").putString("photo", System.nanoTime().toString()).apply(); chosen()
        }.onFailure { error = "Couldn’t open this photo. Choose another image." }
    }
    Column(verticalArrangement = Arrangement.spacedBy(12.dp)) {
        Text("Choose your look", style = MaterialTheme.typography.titleMedium)
        listOf("Community" to (6..17), "3D portraits" to (18..29), "Fantasy" to (30..41), "Classic" to (0..5)).forEach { (title, indices) ->
            Text(title, style = MaterialTheme.typography.titleSmall, color = LokaColors.muted)
            indices.toList().chunked(4).forEach { row -> Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                row.forEach { index -> Image(painterResource(profileArt[index]), "Choose profile illustration ${index+1}", Modifier.weight(1f).aspectRatio(1f).clip(CircleShape).border(if(selected == index.toString()) 3.dp else 1.dp, LokaColors.green, CircleShape).semantics { this.selected = selected == index.toString() }.clickable { context.getSharedPreferences("loka-appearance",0).edit().putString("avatar",index.toString()).apply(); chosen() }, contentScale = ContentScale.Crop) }
                repeat(4-row.size) { Spacer(Modifier.weight(1f)) }
            } }
        }
        TextButton(onClick = { photo.launch("image/*") }) { Text("Choose a photo") }
        error?.let { Text(it, color = MaterialTheme.colorScheme.error) }
    }
}

@Composable internal fun ThemeChoices(close: () -> Unit) {
    val context = LocalContext.current
    val selected = appearanceValue("theme", "System")
    AlertDialog(onDismissRequest = close, title = { Text("Choose your theme") }, text = { Column {
        listOf("System", "Dark", "Light").forEach { label -> TextButton(onClick = { context.getSharedPreferences("loka-appearance",0).edit().putString("theme",label).apply(); close() }) { Text(label + if (label == selected) "  ✓" else "") } }
    } }, confirmButton = { TextButton(onClick=close) { Text("Done") } })
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable internal fun AvatarPickerSheet(close: () -> Unit) {
    ModalBottomSheet(onDismissRequest = close) {
        Column(Modifier.fillMaxWidth().verticalScroll(rememberScrollState()).padding(24.dp), verticalArrangement = Arrangement.spacedBy(16.dp)) {
            AvatarChoices(chosen = close)
            TextButton(onClick = close, modifier = Modifier.align(Alignment.End)) { Text("Done") }
        }
    }
}

@Composable internal fun NameOnboarding(name: String, change: (String) -> Unit, next: () -> Unit, modifier: Modifier = Modifier) {
    var choose by remember { mutableStateOf(false) }
    BoxWithConstraints(modifier.fillMaxSize()) {
        val dense = maxHeight < 330.dp
        val compact = maxHeight < 500.dp
        Column(Modifier.fillMaxSize().padding(horizontal = 28.dp), horizontalAlignment = Alignment.CenterHorizontally) {
            Column(Modifier.weight(1f).fillMaxWidth().verticalScroll(rememberScrollState()), horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.spacedBy(if (dense) 8.dp else 14.dp)) {
                if (!dense) {
                    Text("Make it yours.", fontFamily = LokaDisplay.font, style = MaterialTheme.typography.headlineSmall)
                    Text("Choose a look and add your name.", color = LokaColors.muted)
                }
                Box(Modifier.size(if (dense) 64.dp else if (compact) 96.dp else 112.dp).clickable { choose = true }, contentAlignment = Alignment.BottomEnd) {
                    ProfilePortrait(name, Modifier.fillMaxSize(), own = true)
                    Surface(color = LokaColors.mint, shape = CircleShape) { Box(Modifier.padding(8.dp)) { Glyph("edit", Modifier.size(20.dp), description = "Choose your avatar") } }
                }
                if (!dense) Text("Tap your avatar to change it", color = LokaColors.muted, style = MaterialTheme.typography.labelMedium)
                OutlinedTextField(name, { change(it.take(40)) }, label = { Text("Your name") }, singleLine = true, modifier = Modifier.fillMaxWidth())
            }
            Button(onClick = next, enabled = name.isNotBlank(), modifier = Modifier.fillMaxWidth().heightIn(min = 52.dp)) { Text("Continue") }
            if (!dense) Text("Good chats. Your community, closer.", Modifier.padding(vertical = 12.dp), color = LokaColors.muted, style = MaterialTheme.typography.labelSmall)
            else Spacer(Modifier.height(12.dp))
        }
    }
    if (choose) AvatarPickerSheet { choose = false }
}
