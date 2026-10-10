import Foundation
@main struct Checks {
    static func main() throws {
        let sessionCards=(0..<60).map{PartyCard(id:"local\($0)",game:"x",text:"Prompt \($0)",intensity:"clean",modes:["group","friends"],min:2,max:20,consent:false,packs:["family"],stage:$0%3,namedText:"{player}, ask {partner}: Prompt \($0)")}
        var local=LocalCardSession(cards:sessionCards)
        try local.configure(["clean"],adult:false,drinking:false,audience:CardAudience(players:20,mode:"group"),names:(0..<20).map{"Person \($0)"},pack:"family",roundTurns:1,handoff:true,sound:false)
        var localIDs:Set<String>=[]
        for i in 0..<20{precondition(!local.revealed && local.turn==i);let before=local.deck.current!.id;local.advance(adult:false,drinking:false);precondition(local.deck.current!.id==before);local.reveal();precondition(localIDs.insert(before).inserted);local.advance(adult:false,drinking:false)}
        precondition(local.finished && local.completed==20);try local.undo(adult:false,drinking:false);precondition(!local.finished && local.turn==19 && local.revealed)
        let record=LocalCardSave(updated:Date(),frame:local.frame(),previous:local.previous,catalog:"fixture")
        let decoded=try JSONDecoder().decode(LocalCardSave.self,from:JSONEncoder().encode(record));var recovered=LocalCardSession(cards:sessionCards);try recovered.restore(decoded.frame,adult:false,drinking:false,history:decoded.previous);precondition(recovered.deck.current?.id==local.deck.current?.id && recovered.turn==19)
        local.advance(adult:false,drinking:false);local.newRound(adult:false,drinking:false);precondition(!local.revealed && local.completed==0 && !localIDs.contains(local.deck.current!.id))
        precondition(LocalCardSession.parseNames("Alex, Blair Smith\nCasey")==["Alex","Blair Smith","Casey"] && !LocalCardSession.validNames(["Alex","alex"],count:2))
        precondition(stalePartyCatalog("PC2|"+String(repeating:"b",count:64)+"\n-\n-\n-",pack:String(repeating:"a",count:64)))
        precondition(!stalePartyCatalog("PC2|invalid\n-\n-\n-",pack:String(repeating:"a",count:64)))
        let samples=[
            PartyCard(id:"a",game:"x",text:"Clean",intensity:"clean",modes:["group"],min:2,max:20,consent:false),
            PartyCard(id:"b",game:"x",text:"Clean 2",intensity:"clean",modes:["group"],min:2,max:20,consent:false),
            PartyCard(id:"c",game:"x",text:"Dirty",intensity:"dirty",modes:["group"],min:2,max:20,consent:false,tags:["dirty"],adult:true),
            PartyCard(id:"d",game:"x",text:"Drink",intensity:"clean",modes:["group"],min:2,max:20,consent:false,tags:["drinking"],alcohol:true),
            PartyCard(id:"e",game:"x",text:"Both",intensity:"dirty",modes:["group"],min:2,max:20,consent:false,tags:["dirty","drinking"],adult:true,alcohol:true)]
        var golden=FilteredCardDeck(cards:samples,seed:"seed");try golden.apply(["clean","drinking","dirty"],adult:true,drinking:true);var order:[String]=[];while let card=golden.current{order.append(card.id);golden.draw(adult:true,drinking:true)};precondition(order==["b","e","c","d","a"])
        var deck=FilteredCardDeck(cards:samples,seed:"seed")
        precondition(Set(deck.eligible(["clean"],adult:true,drinking:true).map(\.id))==["a","b"])
        precondition(Set(deck.eligible(["dirty"],adult:true,drinking:true).map(\.id))==["c"])
        precondition(Set(deck.eligible(["drinking"],adult:true,drinking:true).map(\.id))==["d"])
        precondition(deck.eligible(["clean","dirty","drinking"],adult:true,drinking:true).count==5)
        try deck.apply(["clean"],adult:false,drinking:false);let first=deck.current!.id
        let next=deck.peek(adult:false,drinking:false);let shown=deck.shown;precondition(next?.id != first && deck.peek(adult:false,drinking:false)?.id==next?.id && deck.shown==shown)
        do {try deck.apply(["dirty"],adult:false,drinking:false);fatalError("Unconfirmed category accepted")}catch{}
        precondition(deck.current!.id==first && deck.filters==["clean"])
        try deck.apply(["clean","dirty"],adult:true,drinking:false);precondition(deck.current!.id != first)
        var seen:Set<String>=[first,deck.current!.id]
        while true{deck.draw(adult:true,drinking:false);guard let card=deck.current else{break};precondition(seen.insert(card.id).inserted)}
        precondition(seen.count==3 && deck.current==nil);deck.shuffleAgain(adult:true,drinking:false);precondition(deck.current != nil)
        let shared=PartyCard(id:"shared",game:"x",text:"Shared",intensity:"clean",modes:["friends","couples","group"],min:2,max:20,consent:false)
        var couple=shared;couple.id="couple";couple.modes=["couples"];couple.max=2
        var friends=shared;friends.id="friends";friends.modes=["friends"];friends.max=2
        var group=shared;group.id="group";group.modes=["group"];group.min=3;group.max=6
        var audienceDeck=FilteredCardDeck(cards:[shared,couple,friends,group],seed:"audience")
        func audienceIDs(_ context:CardAudience)->Set<String> {Set(audienceDeck.eligible(["clean"],adult:false,drinking:false,audience:context).map(\.id))}
        precondition(audienceIDs(CardAudience(players:2,mode:"friends"))==["shared","friends"])
        precondition(audienceIDs(CardAudience(players:2,mode:"couples"))==["shared","couple"])
        precondition(audienceIDs(CardAudience(players:6,mode:"group"))==["shared","group"])
        precondition(audienceIDs(CardAudience(players:7,mode:"group"))==["shared"])
        precondition(audienceIDs(CardAudience(players:2,mode:"group")).isEmpty)
        try audienceDeck.apply(["clean"],adult:false,drinking:false,audience:CardAudience(players:2,mode:"couples"))
        let previousID=audienceDeck.current?.id,previousShown=audienceDeck.shown
        do {try audienceDeck.apply(["clean"],adult:false,drinking:false,audience:CardAudience(players:4,mode:"couples"));fatalError("Invalid audience accepted")}catch{}
        precondition(audienceDeck.current?.id==previousID && audienceDeck.shown==previousShown && audienceDeck.audience.mode=="couples")
        try audienceDeck.apply(["clean"],adult:false,drinking:false,audience:CardAudience(players:2,mode:"friends"))
        while let card=audienceDeck.current {precondition(audienceDeck.audience.accepts(card));audienceDeck.draw(adult:false,drinking:false)}
        audienceDeck.shuffleAgain(adult:false,drinking:false);precondition(audienceDeck.audience.accepts(audienceDeck.current!))
        var drinkCard=samples[3];drinkCard.game="truth_or_drink"
        precondition(drinkCard.playRule("friends")=="Answer the question or take a drink. You can always skip.")
        drinkCard.game="do_or_drink";precondition(drinkCard.playRule("group").hasPrefix("Do the dare or take a drink."))
        let today=Calendar(identifier:.gregorian).date(from:DateComponents(year:2026,month:10,day:6))!
        precondition(CardAge.eligible(2005,minimum:21,today:today)==nil)
        precondition(CardAge.eligible(2005,minimum:21,today:today,month:10,day:6)==true)
        precondition(CardAge.eligible(2005,minimum:21,today:today,month:10,day:7)==false)
        precondition(CardAge.eligible(2005,minimum:21,today:today,month:2,day:30)==nil)
        precondition(CardBirthday.format("01012000")=="01/01/2000")
        precondition(CardBirthday.format("01/01/2000")=="01/01/2000")
        precondition(CardBirthday.format("010")=="01/0" && CardBirthday.format("0101200")=="01/01/200")
        for invalid in ["29021900","31042000","01012027","0101"] {precondition(CardBirthday.eligible(invalid,minimum:21,today:today)==nil)}
        precondition(CardBirthday.eligible("29022000",minimum:21,today:today)==true)
        precondition(CardBirthday.eligible("06102005",minimum:21,today:today)==true)
        precondition(CardBirthday.eligible("07102005",minimum:21,today:today)==false)
        print("PASS: Swift filtered deck, restrictions, no repeats, cancelled draft, exhaustion and exact age boundary")

        let ids=["a","b","c"].map{String(repeating:$0,count:64)}, pack=String(repeating:"f",count:64)
        let cards=(0..<8).map{PartyCard(id:"card_\($0)",game:"never_have_i_ever",text:"Prompt \($0)",intensity:"clean",modes:["group","friends","couples"],min:2,max:20,consent:false)}
        let args=CommandLine.arguments
        for kotlinHost in [true,false] {
            let javaOwn=kotlinHost ? ids[0] : ids[2]
            let proc=Process();proc.executableURL=URL(fileURLWithPath:args[1]);proc.arguments=["-cp",args[2],"PartyInterop",javaOwn,pack]
            let input=Pipe(),output=Pipe();proc.standardInput=input;proc.standardOutput=output;try proc.run();defer{proc.terminate()}
            var queue:[(from:String,to:String,text:String)]=[],now:Int64=1000000,saved:[String:String]=[:],swift:[String:PartyCards]=[:],javaRevision = -1,javaCard="-"
            for id in ids where id != javaOwn {
                swift[id]=try PartyCards(own:id,pack:pack,cards:cards,clock:{now},save:{saved[id]=$0},send:{to,text in queue.append((id,to,text));return UUID().uuidString.lowercased()},discard:{_ in})
            }
            @discardableResult func command(_ parts:[String],reject:Bool=false)throws->[String] {
                try input.fileHandleForWriting.write(contentsOf:Data((parts.joined(separator:"\t")+"\n").utf8));var bytes=Data()
                while true {guard let d=try output.fileHandleForReading.read(upToCount:1),!d.isEmpty else{fatalError("JVM stopped")};if d[0]==10{break};bytes.append(d)}
                let fields=String(decoding:bytes,as:UTF8.self).components(separatedBy:"\t")
                if reject {precondition(fields[0]=="ERR");return fields}
                precondition(fields[0]=="OK",parts[0]+" "+String(decoding:bytes,as:UTF8.self));javaRevision=Int(fields[1])!;javaCard=fields[2]
                if fields.count>4,!fields[4].isEmpty {for entry in fields[4].components(separatedBy:","){let p=entry.components(separatedBy:"#");queue.append((javaOwn,p[0],String(decoding:Data(base64Encoded:p[1])!,as:UTF8.self)))}}
                return fields
            }
            func deliver(_ d:(from:String,to:String,text:String))throws {
                if d.to==javaOwn {try command(["recv",d.from,Data(d.text.utf8).base64EncodedString()])}else{try swift[d.to]!.receive(d.from,d.text)}
            }
            func drain()throws {
                var budget=250
                while !queue.isEmpty {precondition(budget>0);budget-=1;let d=queue.removeFirst();let e=try PartyEvent.decode(d.text);let canonical=try e.encode();precondition(canonical==d.text);try deliver(d)
                    if e.kind=="U" {let before=d.to==javaOwn ? javaRevision : swift[d.to]!.session!.revision;try deliver(d);precondition((d.to==javaOwn ? javaRevision : swift[d.to]!.session!.revision)==before)}
                    try command(["tick"]);for engine in swift.values{try engine.tick()}
                }
            }
            if kotlinHost {try command(["invite",ids.dropFirst().joined(separator:",")])}else{try swift[ids[0]]!.invite(Array(ids.dropFirst()),PartySettings(game:"never_have_i_ever",mode:"group"))}
            try drain()
            for id in ids.dropFirst(){if id==javaOwn{try command(["accept"])}else{precondition(swift[id]!.session!.phase=="invited");try swift[id]!.accept()};try drain()}
            var seen=Set<String>()
            for revision in 0..<8 {
                let actor=ids[revision%3],card=javaCard;precondition(seen.insert(card).inserted)
                precondition(swift.values.allSatisfy{$0.current?.id==card})
                if actor==javaOwn {try command(["act",revision==2 ? "shuffle" : "done"])}else{try swift[actor]!.act(revision==2 ? "shuffle" : "done")}
                if revision==1,let at=queue.firstIndex(where:{(try? PartyEvent.decode($0.text).kind)=="M"}) {
                    let move=queue.remove(at:at);try deliver(move);queue.removeAll();now+=16000;try command(["time",String(now)])
                    if actor==javaOwn{try command(["restore"]);try command(["resume"])}else{try swift[actor]!.restore(saved[actor]!);try swift[actor]!.resume()}
                }
                try drain();precondition(javaRevision==revision+1 && swift.values.allSatisfy{$0.session!.revision==revision+1})
            }
            precondition(javaCard=="-" && swift.values.allSatisfy{$0.session!.phase=="complete"})
            let any=swift.values.first!.session!,bad=PartyEvent(kind:"M",id:UUID().uuidString.lowercased(),session:any.id,pack:pack,expires:now+120000,value:"done",ref:UUID().uuidString.lowercased())
            try command(["recv",String(repeating:"d",count:64),Data(try bad.encode().utf8).base64EncodedString()],reject:true)
            print("PASS Party Cards Kotlin/Swift \(kotlinHost ? "Kotlin" : "Swift") host: three members accept, eight shared cards, shuffle without repeats, duplicate commits, lost commit/restart/snapshot and unauthorized rejection")
        }
    }
}
