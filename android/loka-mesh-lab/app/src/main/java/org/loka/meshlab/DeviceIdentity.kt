package org.loka.meshlab

import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyProperties
import org.loka.core.LabCrypto
import java.security.KeyPair
import java.security.KeyPairGenerator
import java.security.KeyStore

object DeviceIdentity {
    fun load(): LabCrypto {
        val alias = "loka-mesh-lab-identity-v0"
        val store = KeyStore.getInstance("AndroidKeyStore").apply { load(null) }
        if (!store.containsAlias(alias)) {
            KeyPairGenerator.getInstance(KeyProperties.KEY_ALGORITHM_RSA, "AndroidKeyStore").apply {
                initialize(KeyGenParameterSpec.Builder(alias,
                    KeyProperties.PURPOSE_DECRYPT or KeyProperties.PURPOSE_SIGN)
                    .setKeySize(3072)
                    .setDigests(KeyProperties.DIGEST_SHA256, KeyProperties.DIGEST_SHA1)
                    .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_RSA_OAEP)
                    .setSignaturePaddings(KeyProperties.SIGNATURE_PADDING_RSA_PKCS1)
                    .build())
            }.generateKeyPair()
        }
        return LabCrypto(KeyPair(store.getCertificate(alias).publicKey,
            store.getKey(alias, null) as java.security.PrivateKey))
    }
}
