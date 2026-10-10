package org.loka.meshlab

import android.content.Context
import android.media.MediaPlayer
import android.media.MediaRecorder
import androidx.compose.runtime.*
import androidx.compose.material3.*
import java.io.File

/** App-private temporary microphone file; always removed after preview/cancel/send. */
class VoiceNote(private val context: Context) {
    var recording by mutableStateOf(false); private set
    var playing by mutableStateOf(false); private set
    var bytes by mutableStateOf<ByteArray?>(null); private set
    var error by mutableStateOf<String?>(null); private set
    var seconds by mutableStateOf(0); private set
    val levels = mutableStateListOf<Float>()
    private val handler = android.os.Handler(android.os.Looper.getMainLooper())
    private var startedAt = 0L
    private val meter = object : Runnable {
        override fun run() {
            if (!recording) return
            seconds = ((android.os.SystemClock.elapsedRealtime() - startedAt) / 1000).toInt().coerceAtMost(60)
            val amplitude = runCatching { recorder?.maxAmplitude ?: 0 }.getOrDefault(0)
            levels.add((amplitude / 32767f).coerceIn(.04f, 1f)); if (levels.size > 24) levels.removeAt(0)
            handler.postDelayed(this, 100)
        }
    }
    private var recorder: MediaRecorder? = null
    private var player: MediaPlayer? = null
    private var file: File? = null
    @Suppress("DEPRECATION") fun start() {
        discard(); error = null
        runCatching {
            file = File.createTempFile("loka-voice-", ".m4a", context.cacheDir)
            recorder = MediaRecorder().apply {
                setAudioSource(MediaRecorder.AudioSource.MIC); setOutputFormat(MediaRecorder.OutputFormat.MPEG_4)
                setAudioEncoder(MediaRecorder.AudioEncoder.AAC); setAudioChannels(1); setAudioSamplingRate(16000); setAudioEncodingBitRate(12000)
                setMaxDuration(60000); setMaxFileSize(98304); setOutputFile(file!!.absolutePath)
                setOnInfoListener { _, what, _ -> if (what == MediaRecorder.MEDIA_RECORDER_INFO_MAX_DURATION_REACHED || what == MediaRecorder.MEDIA_RECORDER_INFO_MAX_FILESIZE_REACHED) stop() }
                prepare(); start()
            }; recording = true; startedAt = android.os.SystemClock.elapsedRealtime(); handler.post(meter)
        }.onFailure { discard(); error = "Could not start recording. Check microphone permission." }
    }
    fun stop() {
        if (!recording) return
        recording = false; handler.removeCallbacks(meter)
        runCatching {
            recorder?.stop()
            val data = file!!.readBytes(); require(data.size in 1..98304); bytes = data
        }.onFailure { error = "Could not save recording. Try again." }
        recorder?.release(); recorder = null
        file?.delete(); file = null
    }
    fun play(data: ByteArray) {
        if (playing) { player?.release(); player = null; playing = false; file?.delete(); file = null; return }
        runCatching {
            file = File.createTempFile("loka-play-", ".m4a", context.cacheDir).apply { writeBytes(data) }
            player = MediaPlayer().apply {
                setDataSource(file!!.absolutePath); prepare(); require(duration <= 63000)
                setOnCompletionListener { discardPlayback() }; setOnErrorListener { _, _, _ -> discardPlayback(); error = "Could not play this voice note."; true }; start()
            }; playing = true
        }.onFailure { discardPlayback(); error = "Could not play this voice note." }
    }
    private fun discardPlayback() { player?.release(); player = null; playing = false; file?.delete(); file = null }
    fun discard() {
        recorder?.setOnInfoListener(null); runCatching { recorder?.stop() }; recorder?.release(); recorder = null
        handler.removeCallbacks(meter); seconds = 0; levels.clear(); recording = false; bytes = null; discardPlayback()
    }
}
@Composable fun VoiceBubble(bytes: ByteArray) {
    val context = androidx.compose.ui.platform.LocalContext.current
    val voice = remember { VoiceNote(context) }
    DisposableEffect(Unit) { onDispose { voice.discard() } }
    androidx.compose.foundation.layout.Column {
        TextButton(onClick = { voice.play(bytes) }) { Text(if (voice.playing) "■  Stop voice note" else "▶  Play voice note") }
        voice.error?.let { Text(it, color = MaterialTheme.colorScheme.error) }
    }
}
