package org.loka.meshlab

import android.content.SharedPreferences
import org.json.JSONObject
import org.json.JSONArray
import org.loka.core.*
import java.security.MessageDigest

internal class LocalCardStorage(private val prefs:SharedPreferences,cards:List<PartyCard>) {
    private val catalog=MessageDigest.getInstance("SHA-256").digest(cards.joinToString("|"){listOf(it.id,it.text,it.tags.sorted().joinToString(","),it.modes.sorted().joinToString(","),it.min.toString(),it.max.toString(),it.packs.sorted().joinToString(","),it.stage.toString(),it.namedText,it.gameName).joinToString("~")}.toByteArray()).joinToString(""){"%02x".format(it.toInt() and 255)}
    fun clear(){prefs.edit().remove("session").apply()}
    fun save(session:LocalCardSession){if(session.names.isEmpty())return
        val json=JSONObject().put("version",1).put("updated",System.currentTimeMillis()).put("catalog",catalog).put("frame",encode(session.frame())).put("previous",session.previous?.let(::encode) ?: JSONObject.NULL)
        prefs.edit().putString("session",json.toString()).apply()
    }
    fun load(cards:List<PartyCard>,adult:Boolean,drinking:Boolean):Pair<CardSessionFrame,CardSessionFrame?>? {
        val raw=prefs.getString("session",null) ?: return null
        return runCatching{
            require(raw.length<=65536);val json=JSONObject(raw)
            require(json.getInt("version")==1 && json.getString("catalog")==catalog && System.currentTimeMillis()-json.getLong("updated") in 0..86400000)
            val frame=decode(json.getJSONObject("frame"));val previous=json.optJSONObject("previous")?.let(::decode)
            LocalCardSession(cards).restore(frame,adult,drinking);previous?.let{LocalCardSession(cards).restore(it,adult,drinking)}
            frame to previous
        }.getOrElse{clear();null}
    }
    private fun encode(f:CardSessionFrame)=JSONObject().put("names",JSONArray(f.names)).put("turn",f.turn).put("completed",f.completed).put("roundTurns",f.roundTurns).put("handoff",f.handoff).put("revealed",f.revealed).put("paused",f.paused).put("sound",f.sound).put("roundIndex",f.roundIndex).put("deck",JSONObject().put("seed",f.deck.seed).put("filters",JSONArray(f.deck.filters.toList())).put("players",f.deck.audience.players).put("mode",f.deck.audience.mode).put("shown",JSONArray(f.deck.shown.toList())).put("current",f.deck.current ?: JSONObject.NULL).put("cycle",f.deck.cycle).put("pack",f.deck.pack).put("stage",f.deck.stage).put("last",f.deck.last ?: JSONObject.NULL))
    private fun strings(a:JSONArray)=(0 until a.length()).map{a.getString(it)}
    private fun decode(f:JSONObject):CardSessionFrame {
        val d=f.getJSONObject("deck")
        return CardSessionFrame(CardDeckState(d.getString("seed"),strings(d.getJSONArray("filters")).toSet(),CardAudience(d.getInt("players"),d.getString("mode")),strings(d.getJSONArray("shown")).toSet(),if(d.isNull("current"))null else d.getString("current"),d.getInt("cycle"),d.getString("pack"),d.getInt("stage"),if(d.isNull("last"))null else d.getString("last")),strings(f.getJSONArray("names")),f.getInt("turn"),f.getInt("completed"),f.getInt("roundTurns"),f.getBoolean("handoff"),f.getBoolean("revealed"),f.getBoolean("paused"),f.getBoolean("sound"),f.optInt("roundIndex",0))
    }
}
