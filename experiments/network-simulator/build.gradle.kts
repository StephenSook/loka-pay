plugins { kotlin("jvm") version "2.0.21"; application }
repositories { mavenCentral() }
java { sourceCompatibility = JavaVersion.VERSION_17; targetCompatibility = JavaVersion.VERSION_17 }
kotlin { compilerOptions { jvmTarget.set(org.jetbrains.kotlin.gradle.dsl.JvmTarget.JVM_17) } }
val coreSource = file("../../android/loka-mesh-lab/core/src/main/kotlin")
val real = sourceSets.create("real")
kotlin.sourceSets.named("main") {
    kotlin.srcDirs("src/main/kotlin", "src/shared/kotlin", coreSource)
    kotlin.include("org/loka/core/MeshEngine.kt", "org/loka/core/Packet.kt", "org/loka/core/ChatContent.kt", "org/loka/core/LocalLinkPolicy.kt", "org/loka/core/SimCrypto.kt", "org/loka/experiment/*.kt")
}
kotlin.sourceSets.named("real") {
    kotlin.srcDirs("src/real/kotlin", "src/shared/kotlin", coreSource)
    kotlin.include("org/loka/core/MeshEngine.kt", "org/loka/core/Packet.kt", "org/loka/core/ChatContent.kt", "org/loka/core/LabCrypto.kt", "org/loka/experiment/*.kt")
}
dependencies { add(real.implementationConfigurationName, kotlin("stdlib")) }
application { mainClass.set("org.loka.experiment.SimulatorKt") }
tasks.register<JavaExec>("realCheck") {
    dependsOn(real.classesTaskName); classpath = real.runtimeClasspath
    mainClass.set("org.loka.experiment.RealChecksKt")
}
