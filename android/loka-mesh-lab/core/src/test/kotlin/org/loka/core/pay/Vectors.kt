package org.loka.core.pay

import org.json.JSONArray
import org.json.JSONObject
import java.io.File

/**
 * protocol/vectors/payment-v1.json, read from the repository (no copy to drift). The path comes
 * from the `loka.paymentVectors` system property set in core/build.gradle.kts; when it is absent
 * (an IDE run), the repository is found by walking up from the working directory. A missing file
 * is a test failure, never a skip.
 */
object Vectors {
    val file: File by lazy { sharedFile("loka.paymentVectors", "protocol/vectors/payment-v1.json") }
    val root: JSONObject by lazy { JSONObject(file.readText(Charsets.UTF_8)) }

    fun list(key: String): List<JSONObject> = root.getJSONArray(key).objects()
    val constants: JSONObject get() = root.getJSONObject("constants")
    val keys: JSONObject get() = root.getJSONObject("keys")

    val deployment: Deployment
        get() = Deployment(hex(constants.getString("programIdHex")), 0, hex(constants.getString("mintHex")))

    val serverKey: ByteArray get() = hex(keys.getJSONObject("serverEd25519").getString("publicKeyHex"))
    fun keyHash(name: String): ByteArray = hex(keys.getJSONObject(name).getString("keyHashHex"))
    fun publicKey(name: String): ByteArray = hex(keys.getJSONObject(name).getString("publicKeyHex"))

    fun hex(text: String): ByteArray = hexToBytes(text)

    fun sharedFile(property: String, relative: String): File {
        System.getProperty(property)?.let { path ->
            val f = File(path)
            if (!f.isFile) throw AssertionError("$relative not found at $path (from -D$property)")
            return f
        }
        var dir: File? = File(System.getProperty("user.dir")).absoluteFile
        while (dir != null) {
            val candidate = File(dir, relative)
            if (candidate.isFile) return candidate
            dir = dir.parentFile
        }
        throw AssertionError("$relative not found above ${System.getProperty("user.dir")}")
    }
}

fun JSONArray.objects(): List<JSONObject> = List(length()) { getJSONObject(it) }
fun JSONObject.bytes(key: String): ByteArray = hexToBytes(getString(key))
fun JSONObject.u64(key: String): ULong = getString(key).toULong()
fun JSONObject.i64(key: String): Long = getString(key).toLong()
