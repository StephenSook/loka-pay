package org.loka.meshlab

import android.annotation.SuppressLint
import android.content.Context
import android.content.pm.PackageManager
import android.os.Build
import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyInfo
import android.security.keystore.KeyProperties
import android.security.keystore.StrongBoxUnavailableException
import androidx.annotation.RequiresApi
import androidx.biometric.BiometricManager.Authenticators.BIOMETRIC_STRONG
import androidx.biometric.BiometricManager.Authenticators.DEVICE_CREDENTIAL
import org.loka.core.pay.Deployment
import org.loka.core.pay.P256Rules
import org.loka.core.pay.SignedNote
import java.security.KeyFactory
import java.security.KeyPairGenerator
import java.security.KeyStore
import java.security.PrivateKey
import java.security.Signature
import java.security.interfaces.ECPublicKey
import java.security.spec.ECGenParameterSpec

/**
 * The payer's P-256 key in the Android Keystore (PLAN.md task 3.13). The private key is created
 * inside the Keystore, never leaves it, signs only (PURPOSE_SIGN, SHA-256), and every signature
 * needs a fresh user authentication through BiometricPrompt with a CryptoObject:
 * API 30+: per-use (timeout 0) strong biometric or device credential; API 26 to 29: per-use
 * strong biometric (validity -1). StrongBox is tried first when the phone has it.
 *
 * Device-only: none of this runs in CI or on the JVM. The byte work after signing (DER to
 * low-S r || s, section 6 validation) is core code with JVM tests.
 */
internal class KeystoreP256Signer private constructor(
    private val alias: String,
    val compressedPublicKey: ByteArray,
    val security: KeySecurity,
) {
    val keyHash: ByteArray get() = P256Rules.keyHash(compressedPublicKey)

    /**
     * A Signature initialized for this key, to wrap in a BiometricPrompt.CryptoObject. Signing
     * with it fails until the prompt succeeds. Throws KeyPermanentlyInvalidatedException when a
     * biometric change invalidated the key.
     */
    fun signatureForPrompt(): Signature {
        val key = keyStore().getKey(alias, null) as? PrivateKey ?: error("Keystore key $alias is missing")
        return Signature.getInstance("SHA256withECDSA").apply { initSign(key) }
    }

    /**
     * Signs the raw 141 note bytes with a Signature the prompt has authorized, converts the
     * Keystore's DER to 64-byte low-S r || s, and returns the note only after it passes the
     * section 6 checks with this phone's public key.
     */
    fun finishNote(authorized: Signature, noteBytes: ByteArray, deployment: Deployment): SignedNote {
        authorized.update(noteBytes)
        return SignedNote.fromDerSignature(noteBytes, authorized.sign(), compressedPublicKey, deployment)
    }

    /** What the Keystore reports about where the key lives and how it is unlocked. */
    data class KeySecurity(
        val level: Level,
        /** How [level] was determined, shown next to it. */
        val source: String,
        val userAuthenticationRequired: Boolean,
        /** Seconds a successful authentication lasts; 0 (API 30+) or -1 (older) means every use. */
        val authenticationValidity: Int,
        val authenticators: String,
    ) {
        val perUseAuthentication: Boolean get() = userAuthenticationRequired && authenticationValidity <= 0
    }

    enum class Level(val label: String) {
        STRONGBOX("StrongBox (secure element)"),
        TEE("TEE (trusted execution environment)"),
        SOFTWARE("Software (not in secure hardware)"),
        UNKNOWN_SECURE("Secure hardware (level not named by Android)"),
        UNKNOWN("Unknown"),
    }

    companion object {
        const val ALIAS = "loka-pay-p256-v1"
        private const val PREFS = "loka-pay-key"
        private val lock = Any()

        /** BiometricPrompt authenticators that match the key's unlock rule on this Android version. */
        val promptAuthenticators: Int
            get() = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) BIOMETRIC_STRONG or DEVICE_CREDENTIAL else BIOMETRIC_STRONG

        /** Loads the key under [alias], or creates it (StrongBox first). Blocking: call off the main thread. */
        fun loadOrCreate(context: Context, alias: String = ALIAS): KeystoreP256Signer = synchronized(lock) {
            val store = keyStore()
            if (!store.containsAlias(alias)) create(context, alias)
            val publicKey = store.getCertificate(alias)?.publicKey as? ECPublicKey ?: error("Keystore key $alias has no EC public key")
            val privateKey = store.getKey(alias, null) as? PrivateKey ?: error("Keystore key $alias is missing")
            KeystoreP256Signer(alias, P256Rules.compress(publicKey), security(context, alias, privateKey))
        }

        /** Deletes the key (after the user confirms). The next [loadOrCreate] makes a new key with a new key hash. */
        @SuppressLint("ApplySharedPref") // synchronous on purpose: the record must match the Keystore entry
        fun delete(context: Context, alias: String = ALIAS) = synchronized(lock) {
            keyStore().deleteEntry(alias)
            context.getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit().remove("strongbox:$alias").commit()
        }

        private fun keyStore(): KeyStore = KeyStore.getInstance("AndroidKeyStore").apply { load(null) }

        @SuppressLint("ApplySharedPref") // synchronous on purpose: a crash must not lose the StrongBox record
        private fun create(context: Context, alias: String) {
            var strongBox = false
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P &&
                context.packageManager.hasSystemFeature(PackageManager.FEATURE_STRONGBOX_KEYSTORE)) {
                strongBox = tryStrongBox(alias)
            }
            if (!strongBox) generate(spec(alias).build())
            // Recorded for Android 9 to 11, where KeyInfo cannot name the level (API 31+ reads it from KeyInfo).
            context.getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit().putBoolean("strongbox:$alias", strongBox).commit()
        }

        @RequiresApi(Build.VERSION_CODES.P)
        private fun tryStrongBox(alias: String): Boolean = try {
            generate(spec(alias).setIsStrongBoxBacked(true).build())
            true
        } catch (e: StrongBoxUnavailableException) {
            false
        }

        private fun spec(alias: String): KeyGenParameterSpec.Builder {
            val builder = KeyGenParameterSpec.Builder(alias, KeyProperties.PURPOSE_SIGN)
                .setAlgorithmParameterSpec(ECGenParameterSpec("secp256r1"))
                .setDigests(KeyProperties.DIGEST_SHA256)
                .setUserAuthenticationRequired(true)
                .setInvalidatedByBiometricEnrollment(true)
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
                builder.setUserAuthenticationParameters(0, KeyProperties.AUTH_BIOMETRIC_STRONG or KeyProperties.AUTH_DEVICE_CREDENTIAL)
            } else {
                @Suppress("DEPRECATION")
                builder.setUserAuthenticationValidityDurationSeconds(-1)
            }
            return builder
        }

        private fun generate(spec: KeyGenParameterSpec) {
            KeyPairGenerator.getInstance(KeyProperties.KEY_ALGORITHM_EC, "AndroidKeyStore").apply { initialize(spec) }.generateKeyPair()
        }

        private fun security(context: Context, alias: String, key: PrivateKey): KeySecurity {
            val info = KeyFactory.getInstance(key.algorithm, "AndroidKeyStore").getKeySpec(key, KeyInfo::class.java)
            val (level, source) = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
                when (info.securityLevel) {
                    KeyProperties.SECURITY_LEVEL_STRONGBOX -> Level.STRONGBOX
                    KeyProperties.SECURITY_LEVEL_TRUSTED_ENVIRONMENT -> Level.TEE
                    KeyProperties.SECURITY_LEVEL_SOFTWARE -> Level.SOFTWARE
                    KeyProperties.SECURITY_LEVEL_UNKNOWN_SECURE -> Level.UNKNOWN_SECURE
                    else -> Level.UNKNOWN
                } to "KeyInfo.getSecurityLevel()"
            } else {
                @Suppress("DEPRECATION")
                val inside = info.isInsideSecureHardware
                val strongBox = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE).getBoolean("strongbox:$alias", false)
                when {
                    !inside -> Level.SOFTWARE
                    strongBox -> Level.STRONGBOX
                    else -> Level.TEE
                } to "KeyInfo.isInsideSecureHardware() and whether StrongBox accepted the key at creation"
            }
            val authenticators = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
                val type = info.userAuthenticationType
                listOfNotNull(
                    "strong biometric".takeIf { type and KeyProperties.AUTH_BIOMETRIC_STRONG != 0 },
                    "device PIN, pattern or password".takeIf { type and KeyProperties.AUTH_DEVICE_CREDENTIAL != 0 },
                ).joinToString(" or ").ifEmpty { "none reported" }
            } else "strong biometric (Android 8 to 10 unlock a per-use key only with a biometric)"
            return KeySecurity(level, source, info.isUserAuthenticationRequired, info.userAuthenticationValidityDurationSeconds, authenticators)
        }
    }
}
