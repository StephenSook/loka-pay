plugins {
    id("com.android.application")
    kotlin("android")
    id("org.jetbrains.kotlin.plugin.compose")
}

// Payment pins: config/pins.json at the repository root, the one file every build reads, compiled
// into BuildConfig. A missing file or a null field becomes "", which the pay screen reports as not
// published (and refuses to sign). A field that is present but malformed fails the build.
val repoRoot = rootDir.resolve("../..").canonicalFile
val paymentPins: Map<String, String> = run {
    val fields = listOf("cluster", "programId", "mint", "serverEd25519PublicKey")
    val file = repoRoot.resolve("config/pins.json")
    if (!file.isFile) return@run fields.associateWith { "" }
    val json = groovy.json.JsonSlurper().parse(file) as? Map<*, *>
        ?: throw GradleException("config/pins.json is not a JSON object")
    val base58 = Regex("^[1-9A-HJ-NP-Za-km-z]{32,44}$")
    val hex64 = Regex("^[0-9a-fA-F]{64}$")
    fields.associateWith { name ->
        when (val value = json[name]) {
            null -> ""
            is String -> {
                val ok = when (name) {
                    "cluster" -> value == "devnet" || value == "mainnet"
                    "serverEd25519PublicKey" -> hex64.matches(value) || base58.matches(value)
                    else -> base58.matches(value)
                }
                if (!ok) throw GradleException("config/pins.json: \"$name\" is malformed")
                value
            }
            else -> throw GradleException("config/pins.json: \"$name\" must be a string or null")
        }
    }
}

android {
    namespace = "org.loka.meshlab"
    compileSdk = 36
    defaultConfig {
        applicationId = "org.loka.meshlab"
        minSdk = 26
        targetSdk = 36
        versionCode = 74
        versionName = "0.6.66"
        testInstrumentationRunner = "androidx.test.runner.AndroidJUnitRunner"
        buildConfigField("String", "PINS_CLUSTER", "\"${paymentPins.getValue("cluster")}\"")
        buildConfigField("String", "PINS_PROGRAM_ID", "\"${paymentPins.getValue("programId")}\"")
        buildConfigField("String", "PINS_MINT", "\"${paymentPins.getValue("mint")}\"")
        buildConfigField("String", "PINS_SERVER_ED25519", "\"${paymentPins.getValue("serverEd25519PublicKey")}\"")
    }
    sourceSets.getByName("main").assets.srcDir("../../../gameJson")
    buildFeatures { compose = true; buildConfig = true }
    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }
    kotlinOptions { jvmTarget = "17" }
    testOptions {
        unitTests.all {
            it.systemProperty("loka.paymentVectors", repoRoot.resolve("protocol/vectors/payment-v1.json").path)
            it.systemProperty("loka.pins", repoRoot.resolve("config/pins.json").path)
        }
    }
}
dependencies {
    testImplementation("junit:junit:4.13.2")
    // Test-only JSON reader for the shared payment vectors (android.jar's org.json is a stub in unit tests).
    testImplementation("org.json:json:20260814")
    implementation("com.google.zxing:core:3.5.4")
    implementation("com.journeyapps:zxing-android-embedded:4.3.0")
    androidTestImplementation(platform("androidx.compose:compose-bom:2024.12.01"))
    androidTestImplementation("androidx.compose.ui:ui-test-junit4")
    debugImplementation("androidx.compose.ui:ui-test-manifest")
    androidTestImplementation("androidx.test:runner:1.6.2")
    androidTestImplementation("androidx.test.ext:junit:1.2.1")
    implementation(project(":core"))
    implementation(platform("androidx.compose:compose-bom:2024.12.01"))
    implementation("androidx.compose.material3:material3")
    implementation("androidx.compose.ui:ui-tooling-preview")
    debugImplementation("androidx.compose.ui:ui-tooling")
    implementation("androidx.activity:activity-compose:1.9.3")
    implementation("androidx.lifecycle:lifecycle-viewmodel-ktx:2.8.7")
    implementation("androidx.lifecycle:lifecycle-runtime-compose:2.8.7")
    implementation("org.jetbrains.kotlinx:kotlinx-coroutines-android:1.9.0")
    // Pay screen: BiometricPrompt with a CryptoObject for per-use Keystore signing. BiometricPrompt
    // needs a FragmentActivity, so fragment is declared and pinned to a current stable release.
    implementation("androidx.biometric:biometric:1.1.0")
    implementation("androidx.fragment:fragment:1.8.9")
    // Ed25519 verification of server certificates on every supported Android version (minSdk 26
    // has no Ed25519 in java.security). Used through its lightweight API, no provider registration.
    implementation("org.bouncycastle:bcprov-jdk18on:1.86")
}
