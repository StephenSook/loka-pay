package org.loka.meshlab

import android.content.Context
import org.json.JSONObject
import java.security.MessageDigest

data class QuizQuestion(val id: String, val text: String, val options: List<String>, val answer: Int)
internal data class QuizPack(val hash: String, val questions: List<QuizQuestion>) {
    companion object {
        fun load(context: Context): QuizPack {
            val raw = context.assets.open("quiz/quick-quiz-v1.json").use { it.readBytes() }; require(raw.size <= 16384)
            val json = JSONObject(String(raw, Charsets.UTF_8))
            require(json.getString("id") == "quick_quiz" && json.getInt("version") == 1 && json.getInt("rulesVersion") == 1)
            val cards = json.getJSONArray("questions"); require(cards.length() == 10)
            val questions = (0 until cards.length()).map { i ->
                val q = cards.getJSONObject(i); val options = q.getJSONArray("options"); require(options.length() == 4)
                QuizQuestion(q.getString("id"), q.getString("text"), (0..3).map { options.getString(it) }, q.getInt("answer")).also {
                    require(it.id == "qq_%03d".format(java.util.Locale.US, i + 1) && it.text.length in 1..250 && it.answer in 0..3 && it.options.all { s -> s.length in 1..100 } && it.options.toSet().size == 4)
                }
            }
            val hash = MessageDigest.getInstance("SHA-256").digest(raw).joinToString("") { "%02x".format(it.toInt() and 255) }
            return QuizPack(hash, questions)
        }
    }
}
