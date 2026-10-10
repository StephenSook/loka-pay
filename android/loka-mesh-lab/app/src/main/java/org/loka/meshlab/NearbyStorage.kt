package org.loka.meshlab
import org.json.JSONObject
import org.json.JSONArray
import org.loka.core.*
internal object NearbyStorage {
    fun encode(state: NearbySaved): ByteArray = JSONObject().apply {
        put("blocked", JSONArray(state.book.blocked.toList())); put("keys", JSONObject(state.keys))
        put("entries", JSONArray(state.book.entries.map { e -> JSONObject().apply {
            put("peer",e.peer); put("request",e.request.encode()); put("outgoing",e.outgoing)
            put("phase",e.phase.name); put("name",e.peerName); put("response",e.responseName)
        } }))
    }.toString().toByteArray().also { require(it.size <= 262144) }
    fun decode(bytes: ByteArray): NearbySaved {
        require(bytes.size <= 262144); val j=JSONObject(bytes.toString(Charsets.UTF_8))
        val entries=j.getJSONArray("entries"); val blocked=j.getJSONArray("blocked"); val keys=j.getJSONObject("keys")
        require(entries.length()<=32 && blocked.length()<=128 && keys.length()<=32)
        return NearbySaved(ContactConsentBook.Saved((0 until entries.length()).map { i -> val e=entries.getJSONObject(i)
            ContactConsentBook.Entry(e.getString("peer"),ContactConsent.decode(e.getString("request")),e.getBoolean("outgoing"),ContactConsentBook.Phase.valueOf(e.getString("phase")),e.getString("name"),e.getString("response"))
        }, (0 until blocked.length()).map { blocked.getString(it) }.toSet()), keys.keys().asSequence().associateWith { keys.getString(it) })
    }
}
