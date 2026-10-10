package org.loka.core

import java.util.Base64
import java.util.UUID

/** Versioned application content inside the unchanged encrypted v0 envelope. */
data class ChatContent(val kind: String, val id: String, val data: ByteArray = byteArrayOf(), val index: Int = 0, val count: Int = 1) {
    fun acknowledges(messageId: String, recipient: String, sender: String) = kind == "A" && id == messageId && recipient == sender
    fun encode(): String = when (kind) {
        "A" -> "L1|A|$id"
        "B" -> "L1|B|$id|${utf8(data)}"
        "H" -> "L1|H|$id|$index"
        "R" -> "L1|R|$id|${Base64.getEncoder().encodeToString(data)}"
        "T" -> "L1|T|$id|${Base64.getEncoder().encodeToString(data)}"
        "V", "I" -> "L1|$kind|$id|$index|$count|${Base64.getEncoder().encodeToString(data)}"
        else -> error("Unsupported content")
    }.also { require(decode(it) != null) }
    companion object {
        const val MAX_VOICE = 98304
        val REACTIONS = listOf("", "👍", "❤️", "😂", "😮", "😢", "🙏")
        fun reactionEmoji(state: String?): String = state?.substringAfterLast('|').orEmpty()
        fun reactionVersion(state: String?): Pair<Long, String> {
            if (state == null) return -1L to ""
            val p = state.split('|'); require(p.size == 3 && p[2] in REACTIONS)
            val time = p[0].toLong(); require(time >= 0 && time.toString() == p[0])
            require(UUID.fromString(p[1]).toString() == p[1]); return time to p[1]
        }
        fun newerReaction(old: String?, next: String): Boolean {
            val a = reactionVersion(old); val b = reactionVersion(next)
            return b.first > a.first || b.first == a.first && b.second > a.second
        }
        fun decode(text: String): ChatContent? {
            if (!text.startsWith("L1|")) return null
            require(text.toByteArray(Charsets.UTF_8).size <= MAX_TEXT_BYTES)
            val p = text.split('|'); require(p.size >= 3)
            require(UUID.fromString(p[2]).toString() == p[2])
            fun data(value: String): ByteArray = Base64.getDecoder().decode(value).also { require(Base64.getEncoder().encodeToString(it) == value) }
            return when (p[1]) {
                "A" -> { require(p.size == 3); ChatContent("A", p[2]) }
                "B" -> { require(p.size == 4); val at = p[3].toLong(); require(at >= 0 && at.toString() == p[3]); ChatContent("B", p[2], p[3].toByteArray(Charsets.UTF_8)) }
                "H" -> { require(p.size == 4); val hops = p[3].toInt(); require(hops in 1..7 && hops.toString() == p[3]); ChatContent("H", p[2], index = hops) }
                "R" -> { require(p.size == 4); val bytes = data(p[3]); val r = utf8(bytes).split('|'); require(r.size == 2 && UUID.fromString(r[0]).toString() == r[0] && r[1] in REACTIONS); ChatContent("R", p[2], bytes) }
                "T" -> { require(p.size == 4); val bytes = data(p[3]); require(bytes.size in 1..1400); utf8(bytes); ChatContent("T", p[2], bytes) }
                "V", "I" -> {
                    require(p.size == 6); val index = p[3].toInt(); val count = p[4].toInt(); val bytes = data(p[5])
                    require(index.toString() == p[3] && count.toString() == p[4] && count in 1..(if (p[1] == "I") 64 else 96) && index in 0 until count && bytes.size in 1..1024)
                    require(index == count - 1 || bytes.size == 1024)
                    ChatContent(p[1], p[2], bytes, index, count)
                }
                else -> error("Unsupported content version/type")
            }
        }
        fun utf8(bytes: ByteArray): String = Charsets.UTF_8.newDecoder().onMalformedInput(java.nio.charset.CodingErrorAction.REPORT)
            .decode(java.nio.ByteBuffer.wrap(bytes)).toString()
        fun image(id: String, bytes: ByteArray): List<ChatContent> {
            require(validImage(bytes))
            return voice(id, bytes).map { it.copy(kind = "I") }
        }
        fun validImage(bytes: ByteArray): Boolean = runCatching {
            require(bytes.size in 12..65536 && bytes[0] == 0xff.toByte() && bytes[1] == 0xd8.toByte() && bytes[bytes.size - 2] == 0xff.toByte() && bytes.last() == 0xd9.toByte())
            fun u(i: Int) = bytes[i].toInt() and 255
            var at = 2
            while (at + 4 < bytes.size) {
                require(u(at++) == 255)
                while (u(at) == 255) at++
                val marker = u(at++)
                require(marker != 0xda && marker != 0xd9)
                val length = u(at) * 256 + u(at + 1)
                require(length >= 2 && at + length <= bytes.size)
                if (marker == 0xc0 || marker == 0xc2) {
                    require(length >= 8 && u(at + 2) == 8)
                    val height = u(at + 3) * 256 + u(at + 4); val width = u(at + 5) * 256 + u(at + 6)
                    return@runCatching height in 1..1024 && width in 1..1024
                }
                at += length
            }
            false
        }.getOrDefault(false)
        fun voice(id: String, bytes: ByteArray): List<ChatContent> {
            require(bytes.size in 1..MAX_VOICE)
            val count = (bytes.size + 1023) / 1024
            return (0 until count).map { ChatContent("V", id, bytes.copyOfRange(it * 1024, minOf(bytes.size, (it + 1) * 1024)), it, count) }
        }
    }
}

class VoiceAssembly {
    private data class Parts(val count: Int, var expires: Long, val chunks: MutableMap<Int, ByteArray> = mutableMapOf())
    private val pending = mutableMapOf<String, Parts>()
    @Synchronized fun accept(sender: String, part: ChatContent, expires: Long, now: Long): ByteArray? {
        pending.entries.removeAll { it.value.expires <= now }
        require(part.kind in listOf("V", "I") && expires > now)
        val key = "$sender:${part.kind}:${part.id}"
        val item = pending[key] ?: run { require(pending.size < 8); Parts(part.count, expires).also { pending[key] = it } }
        require(item.count == part.count)
        item.expires = minOf(item.expires, expires)
        val previous = item.chunks[part.index]
        require(previous == null || previous.contentEquals(part.data))
        item.chunks[part.index] = part.data
        if (item.chunks.size != item.count) return null
        val result = (0 until item.count).flatMap { item.chunks.getValue(it).toList() }.toByteArray()
        require(result.size <= ChatContent.MAX_VOICE); pending.remove(key); if (part.kind == "I") require(ChatContent.validImage(result)); return result
    }
}
