package org.loka.meshlab

import android.content.ClipData
import android.content.ClipboardManager
import android.content.Context
import android.content.ContextWrapper
import android.os.Build
import android.security.keystore.KeyPermanentlyInvalidatedException
import androidx.biometric.BiometricManager
import androidx.biometric.BiometricPrompt
import androidx.compose.foundation.Image
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.text.selection.SelectionContainer
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Button
import androidx.compose.material3.Card
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.asImageBitmap
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.unit.dp
import androidx.core.content.ContextCompat
import androidx.fragment.app.FragmentActivity
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import org.loka.core.pay.AllowanceCertificate
import org.loka.core.pay.Base58
import org.loka.core.pay.MerchantCertificate
import org.loka.core.pay.Money
import org.loka.core.pay.PayerChecks
import org.loka.core.pay.PaymentException
import org.loka.core.pay.PaymentTransport
import org.loka.core.pay.SerialReservations
import org.loka.core.pay.SignedPayment
import org.loka.core.pay.toHex
import java.io.File
import java.time.Instant

/**
 * Pay (sandbox): this phone signs a NOTE_V1 with its own Keystore P-256 key behind
 * BiometricPrompt (PLAN.md task 3.13). Everything shown comes from verified bytes or the
 * Keystore's KeyInfo. Nothing here sends or settles the note.
 */
@Composable
internal fun PayScreen() {
    val context = LocalContext.current
    val scope = rememberCoroutineScope()
    val config = remember { PayConfig.status() }
    val serials = remember { SerialReservations(File(context.filesDir, "loka-pay/serials.txt"), AndroidDirectorySync) }

    var signer by remember { mutableStateOf<KeystoreP256Signer?>(null) }
    var keyError by remember { mutableStateOf<String?>(null) }
    var keyAttempt by remember { mutableIntStateOf(0) }
    var keyInvalidated by remember { mutableStateOf(false) }
    var confirmReplace by remember { mutableStateOf(false) }

    var allowanceText by rememberSaveable { mutableStateOf("") }
    var merchantText by rememberSaveable { mutableStateOf("") }
    var amountText by rememberSaveable { mutableStateOf("") }
    var busy by remember { mutableStateOf(false) }
    var message by remember { mutableStateOf<String?>(null) }
    // The signed note with the merchant certificate captured when it was signed (never the live fields).
    var signed by remember { mutableStateOf<SignedPayment?>(null) }
    var serialsLeft by remember { mutableStateOf<Int?>(null) }

    LaunchedEffect(keyAttempt) {
        keyError = null
        signer = null
        try {
            signer = withContext(Dispatchers.IO) {
                // A new key starts with a new, durably recorded, empty serial store. An existing key
                // with a missing store makes every reservation fail (`storage`): never a reset.
                KeystoreP256Signer.loadOrCreate(context.applicationContext, beforeCreate = { serials.initialize() })
            }
        } catch (e: Exception) {
            keyError = "Could not create or load this phone's key: ${e.message ?: e.javaClass.simpleName}. " +
                "A screen lock is required, and on Android 8 to 10 an enrolled fingerprint."
        }
    }

    // Inputs are locked while a signature is in progress; editing any input afterwards clears the
    // signed card, so it never sits next to fields it was not signed from.
    LaunchedEffect(allowanceText, merchantText, amountText) { signed = null }

    val ready = config as? PayConfig.Status.Ready
    val allowance = remember(allowanceText, ready) {
        ready?.let { verifyCertificate(allowanceText, PaymentTransport.Kind.ALLOWANCE) { bytes ->
            AllowanceCertificate.verify(bytes, it.pins.deployment, it.serverPublicKey, BouncyCastleEd25519Verifier)
        } }
    }
    val merchant = remember(merchantText, ready) {
        ready?.let { verifyCertificate(merchantText, PaymentTransport.Kind.MERCHANT) { bytes ->
            MerchantCertificate.verify(bytes, it.pins.deployment, it.serverPublicKey, BouncyCastleEd25519Verifier)
        } }
    }
    val amount = Money.parse(amountText.trim())
    val allowanceCert = allowance?.value
    val merchantCert = merchant?.value

    LaunchedEffect(allowanceCert?.allowanceId, signed) {
        serialsLeft = allowanceCert?.let { cert ->
            runCatching { withContext(Dispatchers.IO) { serials.remaining(cert.allowanceId) } }.getOrNull()
        }
    }

    val payerRefusal = run {
        val s = signer ?: return@run null
        if (allowanceCert == null || merchantCert == null || amount == null) return@run null
        try {
            PayerChecks.check(allowanceCert, merchantCert, s.keyHash, amount, Instant.now().epochSecond); null
        } catch (e: PaymentException) {
            e.error.code
        }
    }

    fun sign() {
        val s = signer ?: return
        val r = ready ?: return
        val cert = allowanceCert ?: return
        val shop = merchantCert ?: return
        val units = amount ?: return
        val activity = context.fragmentActivity() ?: run { message = "Signing needs the app's main window."; return }
        message = null
        signed = null
        val canAuthenticate = BiometricManager.from(context).canAuthenticate(KeystoreP256Signer.promptAuthenticators)
        if (canAuthenticate != BiometricManager.BIOMETRIC_SUCCESS) {
            message = "This phone cannot authenticate for the key right now (code $canAuthenticate). " +
                "Set a screen lock and enroll a strong biometric, then try again."
            return
        }
        val signature = try {
            s.signatureForPrompt()
        } catch (e: KeyPermanentlyInvalidatedException) {
            keyInvalidated = true
            message = "A biometric change invalidated this phone's key. It cannot sign again; replace it and ask for a new allowance."
            return
        } catch (e: Exception) {
            message = "The key could not start signing: ${e.message ?: e.javaClass.simpleName}"
            return
        }
        busy = true
        scope.launch {
            // Reserve the serial durably before the prompt: a cancelled or failed signature burns it, never reuses it.
            val reserved = try {
                withContext(Dispatchers.IO) { serials.reserve(cert.allowanceId) }
            } catch (e: PaymentException) {
                message = "Refused: ${e.error.code}. ${explain(e.error.code)}"
                busy = false
                return@launch
            }
            val noteBytes = try {
                PayerChecks.noteFor(r.pins.deployment, cert, shop, s.keyHash, units, reserved, Instant.now().epochSecond).encode()
            } catch (e: PaymentException) {
                message = "Refused: ${e.error.code}. ${explain(e.error.code)} Serial $reserved is used up and will not be reused."
                busy = false
                return@launch
            }
            val info = BiometricPrompt.PromptInfo.Builder()
                .setTitle("Sign a sandbox payment")
                .setSubtitle("${Money.display(units)} devnet USDC to ${shop.displayName}")
                .setDescription("Sandbox: devnet USDC has no monetary value.")
                .setAllowedAuthenticators(KeystoreP256Signer.promptAuthenticators)
                .apply { if (Build.VERSION.SDK_INT < Build.VERSION_CODES.R) setNegativeButtonText("Cancel") }
                .setConfirmationRequired(true)
                .build()
            val callback = object : BiometricPrompt.AuthenticationCallback() {
                override fun onAuthenticationSucceeded(result: BiometricPrompt.AuthenticationResult) {
                    val authorized = result.cryptoObject?.signature
                    if (authorized == null) {
                        message = "The prompt returned no signing key. Nothing was signed; serial $reserved will not be reused."
                        busy = false
                        return
                    }
                    scope.launch {
                        try {
                            signed = withContext(Dispatchers.Default) {
                                // SignedPayment refuses (payee_mismatch) unless `shop` is the note's payee.
                                SignedPayment(s.finishNote(authorized, noteBytes, r.pins.deployment), shop)
                            }
                        } catch (e: PaymentException) {
                            message = "The signature did not verify (${e.error.code}), so no note is shown. Serial $reserved will not be reused."
                        } catch (e: Exception) {
                            message = "Signing failed: ${e.message ?: e.javaClass.simpleName}. Serial $reserved will not be reused."
                        } finally {
                            busy = false
                        }
                    }
                }

                override fun onAuthenticationError(errorCode: Int, errString: CharSequence) {
                    message = "Not signed: $errString. Serial $reserved for allowance ${cert.allowanceId} is used up and will not be reused."
                    busy = false
                }
            }
            BiometricPrompt(activity, ContextCompat.getMainExecutor(context), callback)
                .authenticate(info, BiometricPrompt.CryptoObject(signature))
        }
    }

    Column(Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(20.dp), verticalArrangement = Arrangement.spacedBy(16.dp)) {
        Card(Modifier.fillMaxWidth()) {
            Column(Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(4.dp)) {
                Text("Sandbox", style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.Bold)
                Text("Solana devnet and devnet USDC, which has no monetary value. Nothing on this screen moves real money.")
            }
        }

        Section("This phone's key") {
            val s = signer
            when {
                keyError != null -> {
                    Text(keyError!!, color = MaterialTheme.colorScheme.error)
                    OutlinedButton(onClick = { keyAttempt++ }) { Text("Try again") }
                }
                s == null -> Text("Preparing the Keystore key...")
                else -> {
                    Label("Key hash (sha256 of the compressed public key)")
                    Mono(s.keyHash.toHex())
                    Label("Hardware level")
                    Text(s.security.level.label, fontWeight = FontWeight.SemiBold)
                    Text("From ${s.security.source}.", style = MaterialTheme.typography.bodySmall)
                    Label("Authentication")
                    Text(if (s.security.perUseAuthentication) "Required for every signature: ${s.security.authenticators}."
                        else "KeyInfo does not report per-use authentication (required ${s.security.userAuthenticationRequired}, validity ${s.security.authenticationValidity} s). Treat this key as unprotected.")
                }
            }
            if (keyInvalidated) OutlinedButton(onClick = { confirmReplace = true }) { Text("Replace this phone's key") }
        }

        Section("Pinned deployment") {
            when (config) {
                is PayConfig.Status.Ready -> {
                    Text("Cluster: ${if (config.pins.deployment.clusterId == 0) "devnet" else "mainnet"}")
                    Label("Program id"); Mono(Base58.encode(config.pins.deployment.programId))
                    Label("Server key (Ed25519)"); Mono(config.serverPublicKey.toHex())
                }
                is PayConfig.Status.ServerKeyNotPinned -> Text(
                    "The settlement server's Ed25519 key is not pinned in config/pins.json yet. Certificates cannot be checked, so this phone will not sign a payment.",
                    color = MaterialTheme.colorScheme.error)
                is PayConfig.Status.Unavailable -> Text("${config.reason} This phone will not sign a payment.", color = MaterialTheme.colorScheme.error)
            }
        }

        Section("Allowance certificate") {
            OutlinedTextField(allowanceText, { allowanceText = it.trim() }, Modifier.fillMaxWidth(),
                label = { Text("Paste L1|P|1|A|...") }, maxLines = 4, enabled = ready != null && !busy)
            when {
                allowance == null || allowanceText.isEmpty() -> {}
                allowance.value != null -> {
                    val c = allowance.value
                    Text("Verified with the pinned server key.", fontWeight = FontWeight.SemiBold)
                    Text("Allowance ${c.allowanceId} · cap ${Money.display(c.cap)} · offline limit ${Money.display(c.offlineLimit)} (sandbox USDC)")
                    Text("Expires ${Instant.ofEpochSecond(c.expiry)} · ${if (c.earmarks.isEmpty()) "any merchant" else "${c.earmarks.size} earmarked merchant(s)"}")
                    signer?.let { s ->
                        Text(if (c.payerKeyHash.contentEquals(s.keyHash)) "Issued for this phone's key." else "Issued for a different key: this phone cannot pay from it.",
                            color = if (c.payerKeyHash.contentEquals(s.keyHash)) MaterialTheme.colorScheme.onSurface else MaterialTheme.colorScheme.error)
                    }
                    serialsLeft?.let { Text("Serials left on this phone for this allowance: $it of 256") }
                }
                else -> Text(allowance.error ?: "", color = MaterialTheme.colorScheme.error)
            }
        }

        Section("Merchant certificate") {
            OutlinedTextField(merchantText, { merchantText = it.trim() }, Modifier.fillMaxWidth(),
                label = { Text("Paste L1|P|1|C|...") }, maxLines = 4, enabled = ready != null && !busy)
            when {
                merchant == null || merchantText.isEmpty() -> {}
                merchant.value != null -> {
                    Text("Verified with the pinned server key.", fontWeight = FontWeight.SemiBold)
                    Text(merchant.value.displayName, style = MaterialTheme.typography.titleMedium)
                    Label("Merchant key hash"); Mono(merchant.value.merchantKeyHash.toHex())
                }
                else -> Text(merchant.error ?: "", color = MaterialTheme.colorScheme.error)
            }
        }

        Section("Amount") {
            OutlinedTextField(amountText, { amountText = it }, Modifier.fillMaxWidth(), singleLine = true,
                label = { Text("Sandbox USDC, for example 1.00") }, enabled = ready != null && !busy,
                keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Decimal))
            when {
                amountText.isBlank() -> {}
                amount == null -> Text("Use digits with up to six decimals.", color = MaterialTheme.colorScheme.error)
                else -> Text("${Money.display(amount)} sandbox USDC = $amount base units")
            }
            payerRefusal?.let { Text("Refused: $it. ${explain(it)}", color = MaterialTheme.colorScheme.error) }
            Button(onClick = ::sign, enabled = !busy && ready != null && signer != null && !keyInvalidated &&
                allowanceCert != null && merchantCert != null && amount != null && payerRefusal == null) {
                Text(if (busy) "Waiting for authentication..." else "Sign with this phone's key")
            }
            message?.let { Text(it, color = MaterialTheme.colorScheme.error) }
        }

        signed?.let { payment -> SignedNoteCard(context, payment) }
    }

    if (confirmReplace) AlertDialog(
        onDismissRequest = { confirmReplace = false },
        title = { Text("Replace this phone's key?") },
        text = { Text("The old key is deleted. The new key has a different key hash, so existing allowances for this phone stop working and a new allowance is needed.") },
        confirmButton = { TextButton(onClick = {
            confirmReplace = false
            scope.launch {
                runCatching { withContext(Dispatchers.IO) { KeystoreP256Signer.delete(context.applicationContext) } }
                keyInvalidated = false
                message = null
                keyAttempt++
            }
        }) { Text("Delete and create a new key") } },
        dismissButton = { TextButton(onClick = { confirmReplace = false }) { Text("Cancel") } })
}

@Composable
private fun SignedNoteCard(context: Context, payment: SignedPayment) {
    // Everything on this card comes from the snapshot: the note's bytes and the merchant
    // certificate that was verified and bound to the note's payee key hash when it was signed.
    val note = payment.note
    val transport = payment.transport
    val qr = remember(transport) { ContactQr.bitmap(transport).asImageBitmap() }
    Section("Signed note (sandbox)") {
        Text("Signed on this phone and checked against PAYMENT-V1 section 6. Not sent and not settled: show the QR or send the text to the merchant.")
        Text("${Money.display(note.note.amount)} sandbox USDC to ${payment.merchantName} · serial ${note.note.serial} · allowance ${note.note.allowanceId}")
        Text("Expires ${Instant.ofEpochSecond(note.note.expiry)}")
        Label("Merchant key hash (the note's payee)"); Mono(payment.merchantKeyHash.toHex())
        Label("Note id"); Mono(note.noteId.toHex())
        Image(qr, contentDescription = "QR code of the signed note", modifier = Modifier.size(280.dp))
        Label("Transport text")
        Mono(transport)
        Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            OutlinedButton(onClick = {
                context.getSystemService(ClipboardManager::class.java)?.setPrimaryClip(ClipData.newPlainText("LOKA sandbox note", transport))
            }) { Text("Copy text") }
        }
    }
}

/** A certificate check result: the verified value, or the refusal shown to the user. */
private class Checked<T>(val value: T?, val error: String?)

private fun <T> verifyCertificate(text: String, kind: PaymentTransport.Kind, verify: (ByteArray) -> T): Checked<T> {
    if (text.isEmpty()) return Checked(null, null)
    return try {
        val decoded = PaymentTransport.decode(text) ?: return Checked(null, "Not LOKA payment content (expected L1|P|1|${kind.letter}|...).")
        if (decoded.kind != kind) return Checked(null, "This is a ${decoded.kind.name.lowercase()} payload, not ${kind.name.lowercase()}.")
        Checked(verify(decoded.payload), null)
    } catch (e: PaymentException) {
        Checked(null, "Refused: ${e.error.code}. ${explain(e.error.code)}")
    }
}

private fun explain(code: String): String = when (code) {
    "bad_signature" -> "The server signature does not verify with the pinned key."
    "wrong_program", "cluster", "wrong_mint" -> "It was issued for a different deployment."
    "earmark_mismatch", "earmark_list" -> "The earmark list does not match the signed certificate."
    "name_length" -> "The merchant name is not valid."
    "length", "prefix", "base64url" -> "The bytes are not a complete certificate."
    "payer_mismatch" -> "The allowance was issued for a different phone key."
    "not_earmarked" -> "This allowance cannot pay this merchant."
    "expired" -> "The allowance has expired."
    "over_cap" -> "The amount is more than the allowance can ever settle."
    "offline_limit" -> "The amount is more than one merchant accepts offline from this allowance."
    "amount_zero" -> "The amount must be more than zero."
    "serials_exhausted" -> "All 256 serials of this allowance are used. Ask for a new allowance."
    "storage" -> "The serial file is missing, damaged or could not be written durably. This phone refuses to sign rather than risk reusing a serial."
    else -> ""
}

@Composable
private fun Section(title: String, content: @Composable () -> Unit) {
    Column(verticalArrangement = Arrangement.spacedBy(6.dp)) {
        Text(title, style = MaterialTheme.typography.titleLarge)
        content()
    }
}

@Composable
private fun Label(text: String) = Text(text, style = MaterialTheme.typography.labelMedium)

@Composable
private fun Mono(text: String) = SelectionContainer {
    Text(text, fontFamily = FontFamily.Monospace, style = MaterialTheme.typography.bodySmall)
}

private tailrec fun Context.fragmentActivity(): FragmentActivity? = when (this) {
    is FragmentActivity -> this
    is ContextWrapper -> baseContext.fragmentActivity()
    else -> null
}
