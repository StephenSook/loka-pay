plugins { kotlin("jvm") }
java {
    sourceCompatibility = JavaVersion.VERSION_17
    targetCompatibility = JavaVersion.VERSION_17
}
kotlin { compilerOptions { jvmTarget.set(org.jetbrains.kotlin.gradle.dsl.JvmTarget.JVM_17) } }
dependencies {
    testImplementation("junit:junit:4.13.2")
    // Test-only JSON reader for protocol/vectors/payment-v1.json (the core main code has no JSON).
    testImplementation("org.json:json:20260814")
}

// The payment tests read the shared files from the repository (no copies to drift). The
// paths are passed explicitly, and the tests fail (never skip) when a file is missing.
val repoRoot = rootDir.resolve("../..").canonicalFile
val paymentVectors = repoRoot.resolve("protocol/vectors/payment-v1.json")
val pinsFile = repoRoot.resolve("config/pins.json")
tasks.test {
    systemProperty("loka.paymentVectors", paymentVectors.path)
    systemProperty("loka.pins", pinsFile.path)
    inputs.files(paymentVectors, pinsFile).withPropertyName("paymentSharedFiles")
}
