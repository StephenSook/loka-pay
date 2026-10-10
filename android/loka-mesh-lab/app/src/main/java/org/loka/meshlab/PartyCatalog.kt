package org.loka.meshlab

import android.content.Context
import org.json.JSONObject
import org.loka.core.PartyCard
import java.security.MessageDigest

data class PartyGame(val id:String,val name:String,val description:String,val instructions:Map<String,String>,val cards:List<PartyCard>)
internal data class PartyCatalog(val hash:String,val games:List<PartyGame>) {
    companion object {
        fun load(context:Context):PartyCatalog {
            val bytes=context.assets.open("games.json").use{it.readBytes()};require(bytes.size in 1..524288)
            val json=JSONObject(String(bytes,Charsets.UTF_8));val array=json.getJSONArray("games")
            require(json.getJSONObject("meta").getString("version")=="3.2" && array.length()==8)
            val games=(0 until array.length()).map { at ->
                val game=array.getJSONObject(at);val id=game.getString("id");val raw=game.getJSONArray("cards");val ruleJson=game.getJSONObject("instructionsByMode");val rules=ruleJson.keys().asSequence().associateWith{ruleJson.getString(it)}
                val cards=(0 until raw.length()).map { index ->
                    val c=raw.getJSONObject(index);val modes=c.getJSONArray("supportedModes")
                    PartyCard(c.getString("id"),id,c.getString("text"),c.getString("intensity"),(0 until modes.length()).map{modes.getString(it)}.toSet(),c.getInt("minPlayers"),c.getInt("maxPlayers"),c.getBoolean("requiresConsent"),c.getJSONArray("tags").let{a->(0 until a.length()).map{a.getString(it)}.toSet()},c.getBoolean("requiresAdult"),c.getBoolean("requiresDrinking"),game.getString("name"),rules,c.optJSONArray("packs")?.let{a->(0 until a.length()).map{a.getString(it)}.toSet()} ?: setOf("classic"),c.optInt("stage",1),c.optString("namedText","")).also{
                        require(it.stage in 0..2 && it.packs.isNotEmpty() && (org.loka.core.CardPacks.ids-setOf("all")).containsAll(it.packs) && ("family" !in it.packs || (it.tags==setOf("clean") && !it.adult && !it.alcohol)))
                        require(it.id.matches(Regex("[a-z0-9_]{1,64}")) && it.text.length in 1..1000 && it.intensity in listOf("clean","flirty","dirty") && it.modes.isNotEmpty() && it.modes.all{m->m in listOf("couples","friends","group")} && it.min in 2..20 && it.max in it.min..20)
                    }
                }
                require(cards.all{it.tags.isNotEmpty() && it.tags.all{tag->tag in setOf("clean","drinking","dirty")} && (!it.adult || "dirty" in it.tags) && (!it.alcohol || "drinking" in it.tags) && ("clean" !in it.tags || (!it.adult && !it.alcohol))})
                require(game.getInt("cardCount")==cards.size)
                val instructions=game.getJSONObject("instructionsByMode")
                val modes=game.getJSONArray("supportedModes").let{m->(0 until m.length()).map{m.getString(it)}.toSet()}
                require(modes.isNotEmpty() && modes.all{it in listOf("couples","friends","group")} && instructions.keys().asSequence().toSet()==modes && cards.all{modes.containsAll(it.modes)})
                PartyGame(id,game.getString("name"),game.getString("description"),modes.associateWith{instructions.getString(it)},cards)
            }
            val cards=games.flatMap{it.cards};require(cards.size==294 && cards.map{it.id}.toSet().size==294 && games.map{it.id}.toSet().size==8)
            val hash=MessageDigest.getInstance("SHA-256").digest(bytes).joinToString(""){"%02x".format(it.toInt() and 255)}
            return PartyCatalog(hash,games)
        }
    }
}
