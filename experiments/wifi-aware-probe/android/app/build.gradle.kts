plugins { id("com.android.application") }
android {
    namespace = "org.loka.awareprobe"
    compileSdk = 36
    defaultConfig { applicationId = "org.loka.awareprobe"; minSdk = 34; targetSdk = 36; versionCode = 5; versionName = "0.5-guided" }
    compileOptions { sourceCompatibility = JavaVersion.VERSION_17; targetCompatibility = JavaVersion.VERSION_17 }
}
