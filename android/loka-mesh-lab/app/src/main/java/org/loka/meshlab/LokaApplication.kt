package org.loka.meshlab

import android.app.Application

/** Composition root: select an Android transport here, without coupling messaging or UI to it. */
class LokaApplication : Application() {
    override fun onCreate() {
        super.onCreate()
        cacheDir.listFiles()?.filter { it.name.startsWith("loka-voice-") || it.name.startsWith("loka-play-") }?.forEach { it.delete() }
    }
    val notificationScope = kotlinx.coroutines.CoroutineScope(kotlinx.coroutines.SupervisorJob() + kotlinx.coroutines.Dispatchers.Main)
    val messages: LabViewModel by lazy { LabViewModel(this, transportProvider) }
    val transportProvider: AndroidTransportProvider by lazy { LocalTransportProvider(this) }
}
