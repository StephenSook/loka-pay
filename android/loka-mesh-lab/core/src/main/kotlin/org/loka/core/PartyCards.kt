package org.loka.core

import java.util.UUID
import java.util.Base64

data class PartyCard @JvmOverloads constructor(val id: String, val game: String, val text: String, val intensity: String, val modes: Set<String>, val min: Int, val max: Int, val consent: Boolean, val tags:Set<String> = setOf("clean"), val adult:Boolean = false, val alcohol:Boolean = false, val gameName:String="", val instructions:Map<String,String> = emptyMap(), val packs:Set<String> = setOf("classic"), val stage:Int=1, val namedText:String="")
data class PartySettings(val game: String, val mode: String, val intensity: String = "clean", val consent: Boolean = false, val drinking: Boolean = false)
data class PartyMove(val kind: String, val id: String)
data class PartySession(val id: String, val members: List<String>, val settings: PartySettings, val expires: Long,
    val phase: String, val accepted: Set<String>, val moves: List<PartyMove> = emptyList()) {
    val host get() = members.first()
    val revision get() = moves.size
    val turn get() = members[revision % members.size]
}
data class PartyEvent(val kind: String, val id: String, val session: String, val pack: String, val expires: Long,
    val revision: Int = 0, val value: String = "-", val ref: String = "-") {
    fun encode() = "L1|G|2|$kind|$id|$session|$pack|$expires|$revision|$value|$ref".also { decode(it) }
    companion object {
        fun permitted(sender:String,text:String,pack:String,session:PartySession?,now:Long):Boolean = runCatching {
            val e=decode(text)
            e.pack==pack && e.expires>now && e.expires<=now+150_000 && (e.kind in listOf("C","K","I","A") || session?.let{it.id==e.session && sender in it.members && it.expires>now}==true)
        }.getOrDefault(false)
        fun decode(text: String): PartyEvent {
            require(text.length <= 2048 && text.all { it.code in 32..126 })
            val p=text.split('|'); require(p.size==11 && p.take(3)==listOf("L1","G","2"))
            require(p[3] in listOf("C","K","I","J","S","M","U","A","R","E"))
            GameEvent.uuid(p[4]); GameEvent.uuid(p[5]); GameEvent.identity(p[6]); if(p[10]!="-") GameEvent.uuid(p[10])
            val expires=p[7].toLong(); val rev=p[8].toInt(); require(expires>=0 && expires.toString()==p[7] && rev in 0..24 && rev.toString()==p[8])
            return PartyEvent(p[3],p[4],p[5],p[6],expires,rev,p[9],p[10])
        }
    }
}
/** One bounded group session. All callbacks use the existing encrypted messaging owner. */
class PartyCards(val own:String,val pack:String,private val cards:List<PartyCard>,private val clock:()->Long,
    private val save:(String)->Unit,private val send:(String,String)->String,private val discard:(String)->Unit) {
    data class Pending(val peer:String,val event:PartyEvent,var packet:String="-")
    var session:PartySession?=null; private set
    var notice="Choose your vibe"; private set
    private var pending=linkedMapOf<String,Pending>()
    
    private var invitations=linkedMapOf<String,Long>()
    private var ackAt=mutableMapOf<String,Long>()
    private var draft:Pair<Int,PartyMove>?=null
    private var lastHost=0L; private var recovering=false
    val paused get()=recovering || clock()-lastHost>90_000
    val canAct get()=session?.let{it.phase=="active" && it.turn==own && !paused && draft==null && pending.values.none{p->p.event.kind in listOf("M","U","S","J")}}==true
    fun packetPermissions() = pending.values.filter { it.packet != "-" }.associate { it.packet to it.peer }
    val peers get()=session?.members.orEmpty().filter{it!=own}.toSet()
    init { GameEvent.identity(own);GameEvent.identity(pack);require(cards.size in 1..300 && cards.map{it.id}.toSet().size==cards.size) }
    fun eligible(settings:PartySettings,count:Int)=cards.filter { it.game==settings.game && settings.mode in it.modes && count in it.min..it.max && (settings.intensity=="all" || it.intensity==settings.intensity) && (settings.consent || !it.consent) && (!it.alcohol || settings.drinking) && (!it.adult || settings.intensity!="clean") }.sortedBy{it.id}
    fun remaining(s:PartySession=session!!):List<PartyCard> {
        var deck=eligible(s.settings,s.members.size)
        s.moves.forEach { m ->
            require(deck.isNotEmpty());deck=deck.drop(1)
            if(m.kind=="shuffle" && deck.isNotEmpty()) { val shift=m.id.take(8).toLong(16).rem(deck.size).toInt();deck=deck.drop(shift)+deck.take(shift) }
        }
        return if(s.revision>=24) emptyList() else deck
    }
    val current get()=session?.let{remaining(it).firstOrNull()}
    private fun event(kind:String,value:String="-",ref:String="-",revision:Int=session!!.revision)=PartyEvent(kind,UUID.randomUUID().toString(),session!!.id,pack,clock()+120_000,revision,value,ref)
    private fun key(peer:String,id:String)="$peer:$id"
    private fun enqueue(peer:String,e:PartyEvent) {require(pending.size<12);pending[key(peer,e.id)]=Pending(peer,e)}
    private fun remove(peer:String,id:String) {pending.remove(key(peer,id))?.packet?.takeIf{it!="-"}?.let{removed.add(it)}}
    private var removed=mutableListOf<String>()
    private fun broadcast(kind:String,value:String="-",ref:String="-") {val e=event(kind,value,ref);peers.forEach{enqueue(it,e)}}
    private fun body(s:PartySession):String=listOf(s.settings.game,s.settings.mode,s.settings.intensity,if(s.settings.consent)"1" else "0",if(s.settings.drinking)"1" else "0",s.members.joinToString(","),s.accepted.sorted().joinToString(","),s.phase,if(s.moves.isEmpty())"-" else s.moves.joinToString(","){"${it.kind}.${it.id}"}).joinToString(";")
    private fun parse(id:String,expires:Long,value:String):PartySession {
        val p=value.split(';');require(p.size==9 && p[0].matches(Regex("[a-z_]{1,40}")) && p[1] in listOf("couples","friends","group") && p[2] in listOf("clean","flirty","dirty","all") && p[3] in listOf("0","1") && p[4] in listOf("0","1"))
        val members=p[5].split(',');members.forEach(GameEvent::identity);require(members.size in 2..4 && members.toSet().size==members.size && own in members && (if(p[1]=="group")members.size>=3 else members.size==2))
        val accepted=p[6].split(',').toSet();require(accepted.size in 1..members.size && members.containsAll(accepted) && members.first() in accepted)
        val moves=if(p[8]=="-") emptyList() else p[8].split(',').map{ val m=it.split('.');require(m.size==2 && m[0] in listOf("done","skip","sip","shuffle"));GameEvent.uuid(m[1]);PartyMove(m[0],m[1]) }
        require(moves.size<=24 && moves.map{it.id}.toSet().size==moves.size && p[7] in listOf("lobby","invited","joining","active","complete","ended"))
        val s=PartySession(id,members,PartySettings(p[0],p[1],p[2],p[3]=="1",p[4]=="1"),expires,p[7],accepted,moves)
        require(eligible(s.settings,members.size).isNotEmpty() && moves.size<=minOf(24,eligible(s.settings,members.size).size) && (s.settings.drinking || moves.none{it.kind=="sip"}))
        if(s.phase in listOf("active","complete"))require(s.accepted.size==s.members.size)
        if(s.phase=="active")require(moves.size<minOf(24,eligible(s.settings,members.size).size))
        if(s.phase=="complete")require(moves.size==minOf(24,eligible(s.settings,members.size).size))
        return s
    }
    private fun transaction(block:()->Unit) {
        val before=export();val oldNotice=notice;val oldLast=lastHost;val oldRecovery=recovering;removed=mutableListOf()
        try {block();save(export())}catch(e:Exception){restore(before);notice=oldNotice;lastHost=oldLast;recovering=oldRecovery;removed.clear();throw e}
        removed.forEach(discard);removed.clear()
    }
    fun invite(players:List<String>,settings:PartySettings) {
        require(session==null || session!!.phase in listOf("ended","complete") || session!!.expires<=clock())
        val s=PartySession(UUID.randomUUID().toString(),listOf(own)+players,settings,clock()+120_000,"lobby",setOf(own))
        parse(s.id,s.expires,body(s))
        transaction {pending.values.map{it.packet}.filter{it!="-"}.forEach{removed.add(it)};pending.clear();draft=null;session=s;recovering=false;lastHost=clock();broadcast("C");notice="Inviting…"};flush()
    }
    fun accept() {val s=session!!;require(s.phase=="invited" && own!=s.host && s.expires>clock());transaction{session=s.copy(phase="joining");enqueue(s.host,event("J",revision=0));notice="Waiting for the other players"};flush()}
    fun act(kind:String) {
        require(canAct && kind in listOf("done","skip","shuffle","sip") && (kind!="sip" || session!!.settings.drinking))
        transaction {val move=PartyMove(kind,UUID.randomUUID().toString());if(session!!.host==own)commit(move) else {draft=session!!.revision to move;enqueue(session!!.host,event("M",kind,move.id));notice="Waiting for confirmation"}};flush()
    }
    private fun commit(move:PartyMove) {val s=session!!;require(remaining(s).isNotEmpty());session=s.copy(moves=s.moves+move);if(remaining().isEmpty())session=session!!.copy(phase="complete");broadcast("U",move.kind,move.id);notice=if(session!!.phase=="complete")"Round complete" else "Waiting for the other players"}
    fun resume(){val s=session!!;require(s.phase in listOf("active","joining","complete") && s.expires>clock());transaction{recovering=true;if(s.host==own)snapshot()else enqueue(s.host,event("R"));notice="Reconnecting…"};flush()}
    fun end(){require(session!=null);transaction{pending.values.filter{it.packet!="-"}.forEach{removed.add(it.packet)};pending.clear();draft=null;session=session!!.copy(phase="ended");if(session!!.host==own)broadcast("E")else enqueue(session!!.host,event("E"));notice="Game ended"};flush()}
    private fun snapshot(){val s=session!!;peers.forEach{p->if(pending.values.none{it.peer==p && it.event.kind=="S"})enqueue(p,event("S",body(s)))}}
    private fun reply(peer:String,e:PartyEvent,kind:String) {
        val stamp=clock();val k=key(peer,e.id)
        if(stamp-(ackAt[k]?:0)<15_000)return
        ackAt.entries.removeAll{stamp-it.value>=120_000};if(ackAt.size>=64)return
        ackAt[k]=stamp
        runCatching{send(peer,PartyEvent(kind,UUID.randomUUID().toString(),e.session,pack,stamp+120_000,session?.revision?:0,"-",e.id).encode())}
    }
    fun receive(sender:String,text:String) {
        GameEvent.identity(sender);require(sender!=own);val e=PartyEvent.decode(text);val now=clock()
        require(e.pack==pack && e.expires>now && e.expires<=now+150_000)
        if(e.kind=="C") {require(e.revision==0 && e.value=="-" && e.ref=="-");reply(sender,e,"K");return}
        if(e.kind=="I" && session?.id!=e.session) {
            require(e.revision==0 && e.ref=="-" && (session==null || session!!.phase in listOf("ended","complete") || session!!.expires<=now))
            val next=parse(e.session,e.expires,e.value);require(next.host==sender && next.phase=="lobby" && next.moves.isEmpty() && next.accepted==setOf(sender))
            transaction{invitations.entries.removeAll{it.value<=now};require(e.session !in invitations && invitations.size<16);invitations[e.session]=e.expires;pending.values.filter{it.packet!="-"}.forEach{removed.add(it.packet)};pending.clear();draft=null;session=next.copy(phase="invited");lastHost=now;recovering=false;notice="Party cards invitation"};reply(sender,e,"A");return
        }
        val s=session!!;require(e.session==s.id && sender in peers && s.expires>now)
        if(e.kind in listOf("A","J","K","R","E"))require(e.value=="-")
        if(e.kind in listOf("A","K"))require(e.ref!="-")
        if(e.kind in listOf("I","J","S","R","E"))require(e.ref=="-")
        var ack=e.kind !in listOf("A","K","M")
        transaction {
            if(sender==s.host || s.host==own)lastHost=now
            when(e.kind){
                "K"->{require(s.host==own && s.phase=="lobby" && e.revision==0 && pending[key(sender,e.ref)]?.event?.kind=="C");remove(sender,e.ref);enqueue(sender,event("I",body(s),revision=0))}
                "I"->{require(sender==s.host && s.phase in listOf("invited","joining","active","complete") && e.revision==0 && parse(e.session,e.expires,e.value).members==s.members)}
                "J"->{require(s.host==own && s.phase in listOf("lobby","active") && e.revision==0);session=s.copy(accepted=s.accepted+sender);pending.values.filter{it.peer==sender && it.event.kind=="I"}.map{it.event.id}.forEach{remove(sender,it)};if(session!!.accepted.size==s.members.size && s.phase=="lobby"){session=session!!.copy(phase="active",expires=now+86_400_000);snapshot()}}
                "A"->{val p=pending[key(sender,e.ref)];if(p!=null){require(p.event.kind !in listOf("C","M") && e.revision>=p.event.revision);remove(sender,e.ref);if(p.event.kind=="S"){pending.values.filter{it.peer==sender && it.event.kind=="U" && it.event.revision<=e.revision}.map{it.event.id}.forEach{remove(sender,it)};if(pending.values.none{it.event.kind=="S"})recovering=false}}}
                "M"->{require(s.host==own && s.phase in listOf("active","complete") && e.ref!="-" && e.value in listOf("done","skip","sip","shuffle") && (e.value!="sip" || s.settings.drinking));val at=s.moves.indexOfFirst{it.id==e.ref};if(at>=0){require(at==e.revision && s.members[at%s.members.size]==sender && s.moves[at].kind==e.value);snapshot()}else{require(s.phase=="active" && s.turn==sender && e.revision==s.revision && pending.values.none{it.event.kind in listOf("U","S")});commit(PartyMove(e.value,e.ref))}}
                "U"->{require(sender==s.host && s.phase in listOf("active","complete") && e.ref!="-" && e.value in listOf("done","skip","sip","shuffle") && (e.value!="sip" || s.settings.drinking) && e.revision>0);val move=PartyMove(e.value,e.ref);if(e.revision<=s.revision)require(s.moves[e.revision-1]==move) else if(e.revision!=s.revision+1){if(pending.values.none{it.event.kind=="R"})enqueue(s.host,event("R"));recovering=true;ack=false}else{require(s.moves.none{it.id==move.id} && remaining(s).isNotEmpty());if(s.turn==own)require(draft==(s.revision to move));session=s.copy(moves=s.moves+move);if(remaining().isEmpty())session=session!!.copy(phase="complete");draft?.let{require(it.first!=s.revision || it.second==move)};if(draft?.second==move){draft=null;pending.values.filter{it.event.kind=="M"}.map{it.event.id}.forEach{remove(sender,it)}}}}
                "S"->{require(sender==s.host && s.phase in listOf("joining","active","complete"));val next=parse(s.id,now+86_400_000,e.value);require(next.phase in listOf("active","complete") && next.members==s.members && next.settings==s.settings && next.revision==e.revision && next.moves.take(s.revision)==s.moves);for(i in s.revision until next.revision)if(s.members[i%s.members.size]==own)require(draft==(i to next.moves[i]));if(next.revision>=s.revision){session=next;recovering=false;pending.values.filter{it.event.kind in listOf("J","R")}.map{it.event.id}.forEach{remove(sender,it)};draft?.let{d->if(next.revision>d.first){require(next.moves[d.first]==d.second);draft=null;pending.values.filter{it.event.kind=="M"}.map{it.event.id}.forEach{remove(sender,it)}}}}
                }
                "R"->{require(s.host==own && s.phase in listOf("active","complete"));snapshot()}
                "E"->{require(e.revision<=s.revision && (sender==s.host || s.host==own));if(s.phase!="ended"){pending.values.filter{it.packet!="-"}.forEach{removed.add(it.packet)};pending.clear();draft=null;session=s.copy(phase="ended");if(s.host==own)broadcast("E")}}
                else->error("Unsupported game event")
            }
            notice=when(session!!.phase){"ended"->"Game ended";"complete"->"Round complete";"active"->if(session!!.turn==own)"Your turn" else "Waiting for the other players";else->notice}
        }
        if(ack)reply(sender,e,"A");flush()
    }
    fun tick() {
        val now=clock();val stale=pending.values.filter{it.event.expires<=now}
        if(stale.isNotEmpty() || session?.let{it.expires<=now && it.phase!="ended"}==true)transaction{
            stale.forEach{remove(it.peer,it.event.id);if(it.event.kind in listOf("M","U","S"))recovering=true}
            if(session!!.expires<=now){session=session!!.copy(phase="ended");draft=null;notice="Invitation or session expired"}
        }
        val s=session;val d=draft
        if(s!=null && d!=null && !recovering && pending.values.none{it.event.kind=="M"} && s.revision==d.first && s.turn==own)transaction{enqueue(s.host,event("M",d.second.kind,d.second.id, d.first))}
        flush()
    }
    private fun flush(){val p=pending.values.firstOrNull{it.packet=="-"}?:return;runCatching{val id=send(p.peer,p.event.encode());p.packet=id;try{save(export())}catch(e:Exception){p.packet="-";discard(id);throw e}}}
    fun export():String {
        fun enc(s:String)=Base64.getEncoder().encodeToString(s.toByteArray(Charsets.UTF_8))
        val s=session
        val lines=mutableListOf("PC2|$pack",if(s==null)"-" else "${s.id}|${s.expires}|${enc(body(s))}",draft?.let{"${it.first}|${it.second.kind}|${it.second.id}"}?:"-",if(invitations.isEmpty())"-" else invitations.entries.joinToString(","){"${it.key}.${it.value}"})
        pending.values.forEach{lines.add("${it.peer}|${enc(it.event.encode())}|${it.packet}")}
        return lines.joinToString("\n").also{require(it.length<=16384)}
    }
    fun restore(raw:String) {
        require(raw.length<=16384);val lines=raw.split('\n');require(lines.size in 4..16 && lines[0]=="PC2|$pack")
        fun dec(s:String)=String(Base64.getDecoder().decode(s),Charsets.UTF_8)
        val next=if(lines[1]=="-")null else lines[1].split('|').let{require(it.size==3);GameEvent.uuid(it[0]);parse(it[0],it[1].toLong(),dec(it[2]))}
        val newDraft=if(lines[2]=="-")null else lines[2].split('|').let{require(it.size==3 && it[1] in listOf("done","skip","sip","shuffle"));GameEvent.uuid(it[2]);it[0].toInt() to PartyMove(it[1],it[2])}
        val nextInvitations=linkedMapOf<String,Long>();if(lines[3]!="-")lines[3].split(",").forEach{val p=it.split(".");require(p.size==2);GameEvent.uuid(p[0]);require(nextInvitations.put(p[0],p[1].toLong())==null && nextInvitations.size<=16)}
        val nextPending=linkedMapOf<String,Pending>();lines.drop(4).forEach{line->val p=line.split('|');require(p.size==3);GameEvent.identity(p[0]);val e=PartyEvent.decode(dec(p[1]));require(next!=null && p[0] in next.members && p[0]!=own && e.session==next.id && e.pack==pack);if(p[2]!="-")GameEvent.uuid(p[2]);require(nextPending.put(key(p[0],e.id),Pending(p[0],e,p[2]))==null)}
        if(newDraft!=null)require(next!=null && own!=next.host && newDraft.first==next.revision && next.turn==own)
        session=next;invitations=nextInvitations;pending=nextPending;draft=newDraft;recovering=next?.phase in listOf("active","joining","complete");lastHost=0;notice=if(recovering)"Reconnecting…" else if(next!=null)"Waiting for the other players" else "Choose your vibe"
    }
}

/** Local player count describes people sharing the phone, not connected devices. */
data class CardAudience(val players:Int=4,val mode:String="group") {
    val valid get()=players in 2..20 && when(mode){"friends","couples"->players==2;"group"->players>=3;else->false}
    val label get()="$players players · "+when(mode){"couples"->"Couple";"friends"->"Friends";else->"Group"}
    fun accepts(card:PartyCard)=valid && mode in card.modes && players in card.min..card.max
}

fun PartyCard.playRule(mode:String):String = when {
    alcohol && game=="truth_or_drink" -> "Answer the question or take a drink. You can always skip."
    alcohol && game=="do_or_drink" -> "Do the dare or take a drink. Anyone involved must agree. You can always skip."
    else -> instructions[mode] ?: "Take turns. You can always skip."
}

/** One public prompt deck. Draft UI selections never mutate this state. */
class FilteredCardDeck(private val cards:List<PartyCard>, seed:String=UUID.randomUUID().toString()) {
    var seed=seed; private set
    var pack="all"
    var stage=1
    var filters:Set<String> = setOf("clean"); private set
    var audience:CardAudience=CardAudience(); private set
    var shown:Set<String> = emptySet(); private set
    var current:PartyCard? = null; private set
    private var cycle=0
    private var lastShown:String?=null
    init {require(cards.map{it.id}.toSet().size==cards.size)}
    fun eligible(selected:Set<String>,adult:Boolean,drinking:Boolean,audience:CardAudience=this.audience,pack:String=this.pack)=cards.filter{
        (pack=="all" || pack in it.packs) &&
        audience.accepts(it) &&
        it.tags.any(selected::contains) && (!it.adult || ("dirty" in selected && adult)) && (!it.alcohol || ("drinking" in selected && drinking))
    }
    fun apply(selected:Set<String>,adult:Boolean,drinking:Boolean,audience:CardAudience=this.audience) {
        require(audience.valid)
        require(selected.isNotEmpty() && setOf("clean","drinking","dirty").containsAll(selected))
        require(("dirty" !in selected || adult) && ("drinking" !in selected || drinking))
        filters=selected.toSet();this.audience=audience;draw(adult,drinking)
    }
    fun peek(adult:Boolean,drinking:Boolean):PartyCard? = eligible(filters,adult,drinking).filter{it.id !in shown}.minWithOrNull(compareBy<PartyCard>{kotlin.math.abs(it.stage-stage)}.thenBy{rank(it.id)})
    fun draw(adult:Boolean,drinking:Boolean) {
        current=peek(adult,drinking)
        current?.let{shown=shown+it.id;lastShown=it.id}
    }
    fun shuffleAgain(adult:Boolean,drinking:Boolean) {
        val previous=lastShown;cycle++;shown=emptySet()
        val available=eligible(filters,adult,drinking)
        current=available.filter{it.id!=previous || available.size==1}.minWithOrNull(compareBy<PartyCard>{kotlin.math.abs(it.stage-stage)}.thenBy{rank(it.id)})
        current?.let{shown=setOf(it.id);lastShown=it.id}
    }
    fun snapshot()=CardDeckState(seed,filters,audience,shown,current?.id,cycle,pack,stage,lastShown)
    fun restore(value:CardDeckState,adult:Boolean,drinking:Boolean) {
        require(value.seed.length in 1..256 && value.cycle in 0..100000 && value.stage in 0..2 && value.pack in CardPacks.ids)
        require(value.audience.valid && value.filters.isNotEmpty() && setOf("clean","drinking","dirty").containsAll(value.filters))
        require(("dirty" !in value.filters || adult) && ("drinking" !in value.filters || drinking))
        require(value.last==null || value.last in value.shown)
        require(value.shown.size<=cards.size && cards.map{it.id}.toSet().containsAll(value.shown))
        val card=value.current?.let{id->cards.firstOrNull{it.id==id} ?: error("Unknown card")}
        require(card==null || (card.id in value.shown && card in eligible(value.filters,adult,drinking,value.audience,value.pack)))
        seed=value.seed;filters=value.filters;audience=value.audience;shown=value.shown;current=card;cycle=value.cycle;pack=value.pack;stage=value.stage;lastShown=value.last ?: card?.id
    }
    private fun rank(id:String)=java.security.MessageDigest.getInstance("SHA-256").digest("$seed|$cycle|$id".toByteArray()).joinToString(""){"%02x".format(it.toInt() and 255)}
}

object CardAge {
    /** Null means an exact birthday is needed or input is invalid; false is conclusively under age. */
    fun eligible(year:Int?,minimum:Int,today:java.time.LocalDate=java.time.LocalDate.now(),month:Int?=null,day:Int?=null):Boolean? {
        if(year==null || year<1900 || year>today.year)return null
        val years=today.year-year
        if(years<minimum)return false
        if(years>minimum)return true
        if(month==null || day==null)return null
        val born=runCatching{java.time.LocalDate.of(year,month,day)}.getOrNull() ?: return null
        return !born.isAfter(today.minusYears(minimum.toLong()))
    }
}

/** Transient birthday input. Formatting never makes an impossible date valid. */
object CardBirthday {
    fun digits(input:String)=input.filter{it in '0'..'9'}.take(8)
    fun format(input:String):String {
        val raw=digits(input)
        return listOf(raw.take(2),raw.drop(2).take(2),raw.drop(4)).filter{it.isNotEmpty()}.joinToString("/")
    }
    fun eligible(input:String,minimum:Int,today:java.time.LocalDate=java.time.LocalDate.now()):Boolean? {
        val raw=digits(input);if(raw.length!=8)return null
        val day=raw.take(2).toInt();val month=raw.substring(2,4).toInt();val year=raw.drop(4).toInt()
        val born=runCatching{java.time.LocalDate.of(year,month,day)}.getOrNull() ?: return null
        if(year<1900 || born.isAfter(today))return null
        return !born.isAfter(today.minusYears(minimum.toLong()))
    }
}


object CardPacks {
    val labels=linkedMapOf("all" to "All packs","classic" to "Classic mix","new_friends" to "New friends","close_friends" to "Close friends","couples" to "Couples","family" to "Family","big_party" to "Big parties")
    val ids get()=labels.keys
}
data class CardDeckState(val seed:String,val filters:Set<String>,val audience:CardAudience,val shown:Set<String>,val current:String?,val cycle:Int,val pack:String,val stage:Int,val last:String?=null)
data class CardSessionFrame(val deck:CardDeckState,val names:List<String>,val turn:Int,val completed:Int,val roundTurns:Int,val handoff:Boolean,val revealed:Boolean,val paused:Boolean,val sound:Boolean,val roundIndex:Int=0)
/** Local, single-phone experience. No packet events, answers or birthday values. */
class LocalCardSession(private val cards:List<PartyCard>) {
    var deck=FilteredCardDeck(cards);private set
    var names:List<String> = emptyList();private set
    var turn=0;private set
    var completed=0;private set
    var roundTurns=1;private set
    var handoff=true;private set
    var revealed=false;private set
    var paused=false;private set
    var sound=false;private set
    var roundIndex=0;private set
    var previous:CardSessionFrame?=null;private set
    val goal get()=roundTurns*names.size
    val finished get()=names.isNotEmpty() && ((goal>0 && completed>=goal) || deck.current==null)
    val phase:Int get(){val first=if(goal>0)maxOf(1,goal/3) else 2;val second=if(goal>0)maxOf(2,goal*2/3) else 6;return if(completed < first)0 else if(completed < second)1 else 2}
    val phaseLabel get()=listOf("Warm up","Playful","Deeper")[phase]
    fun configure(categories:Set<String>,adult:Boolean,drinking:Boolean,audience:CardAudience,names:List<String>,pack:String,roundTurns:Int,handoff:Boolean,sound:Boolean) {
        require(audience.valid && validNames(names,audience.players) && roundTurns in 0..2 && pack in CardPacks.ids)
        require(categories.isNotEmpty() && setOf("clean","drinking","dirty").containsAll(categories) && ("dirty" !in categories || adult) && ("drinking" !in categories || drinking) && deck.eligible(categories,adult,drinking,audience,pack).isNotEmpty())
        val keepTurn=this.names.isNotEmpty() && !finished
        this.names=names.map{it.trim()};turn=if(keepTurn)turn.coerceAtMost(names.lastIndex) else 0
        completed=0;roundIndex=0;this.roundTurns=roundTurns;this.handoff=handoff;this.sound=sound;paused=false;revealed=!handoff;previous=null
        deck.pack=pack;deck.stage=phase;deck.apply(categories,adult,drinking,audience)
    }
    fun reveal(){if(!paused && !finished)revealed=true}
    fun advance(adult:Boolean,drinking:Boolean) {
        if(paused || finished || !revealed || deck.current==null)return
        previous=frame();completed++;turn=(turn+1)%names.size;revealed=!handoff;deck.stage=phase;if(goal==0 || completed<goal)deck.draw(adult,drinking)
    }
    fun undo(adult:Boolean,drinking:Boolean){val value=previous ?: return;restore(value,adult,drinking);previous=null}
    fun newRound(adult:Boolean,drinking:Boolean){roundIndex++;completed=0;previous=null;paused=false;revealed=!handoff;deck.stage=phase;if(deck.current==null)deck.shuffleAgain(adult,drinking) else {deck.draw(adult,drinking);if(deck.current==null)deck.shuffleAgain(adult,drinking)}}
    fun end(){deck=FilteredCardDeck(cards);names=emptyList();turn=0;completed=0;roundIndex=0;previous=null;paused=false;revealed=false}
    fun rename(value:List<String>){require(validNames(value,names.size));names=value.map{it.trim()};previous=null}
    fun pause(){paused=true}
    fun resume(){paused=false}
    fun frame()=CardSessionFrame(deck.snapshot(),names,turn,completed,roundTurns,handoff,revealed,paused,sound,roundIndex)
    fun restore(value:CardSessionFrame,adult:Boolean,drinking:Boolean,history:CardSessionFrame?=null) {
        require(validNames(value.names,value.deck.audience.players) && value.turn in value.names.indices && value.completed in 0..100000 && value.roundTurns in 0..2 && value.roundIndex in 0..100000)
        deck.restore(value.deck,adult,drinking);names=value.names;turn=value.turn;completed=value.completed;roundTurns=value.roundTurns;handoff=value.handoff;revealed=value.revealed;paused=value.paused;sound=value.sound;roundIndex=value.roundIndex;previous=history
    }
    fun display(card:PartyCard):PartyCard {
        if(card.namedText.isBlank() || names.size<2)return card
        val offset=(roundIndex*maxOf(1,roundTurns)+completed/names.size)%(names.size-1)+1
        val partner=names[(turn+offset)%names.size]
        return card.copy(text=card.namedText.replace("{player}",names[turn]).replace("{partner}",partner))
    }
    companion object {fun validNames(names:List<String>,count:Int)=names.size==count && names.all{it.trim().length in 1..40} && names.map{it.trim().lowercase()}.distinct().size==count
        fun parseNames(text:String)=text.split(Regex("[,\n\r]+")).map{it.trim()}.filter{it.isNotEmpty()}
    }
}

/** A bounded, recognized older pack may be left archived while a fresh engine starts. */
fun stalePartyCatalog(raw:String,pack:String):Boolean {
    if(raw.length>16384)return false
    val header=raw.substringBefore('\n')
    return header.matches(Regex("PC2\\|[0-9a-f]{64}")) && header!="PC2|$pack"
}
