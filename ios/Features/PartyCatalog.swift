import Foundation
import CryptoKit

struct PartyGame: Identifiable { var id:String;var name:String;var description:String;var instructions:[String:String];var cards:[PartyCard] }
struct PartyCatalog {
    var hash:String;var games:[PartyGame]
    private struct Card:Decodable { var id:String;var text:String;var intensity:String;var supportedModes:[String];var minPlayers:Int;var maxPlayers:Int;var requiresConsent:Bool;var tags:[String];var requiresAdult:Bool;var requiresDrinking:Bool;var packs:[String]?;var stage:Int?;var namedText:String? }
    private struct Game:Decodable { var id:String;var name:String;var description:String;var instructionsByMode:[String:String];var supportedModes:[String];var cardCount:Int;var cards:[Card] }
    private struct Meta:Decodable {var version:String}
    private struct Catalog:Decodable {var games:[Game];var meta:Meta}
    static func load(url provided:URL? = nil) throws -> PartyCatalog {
        guard let url=provided ?? Bundle.main.url(forResource:"games",withExtension:"json",subdirectory:"gameJson") else {throw QuizError.invalid}
        let bytes=try Data(contentsOf:url);guard (1...524288).contains(bytes.count) else {throw QuizError.invalid}
        let raw=try JSONDecoder().decode(Catalog.self,from:bytes)
        guard raw.meta.version=="3.2",raw.games.count==8 else {throw QuizError.invalid}
        let games=try raw.games.map { g -> PartyGame in
            guard g.cardCount==g.cards.count,!g.supportedModes.isEmpty,Set(g.supportedModes).isSubset(of:["couples","friends","group"]),Set(g.instructionsByMode.keys)==Set(g.supportedModes) else {throw QuizError.invalid}
            let cards=try g.cards.map { c -> PartyCard in
                guard c.id.range(of:"^[a-z0-9_]{1,64}$",options:.regularExpression) != nil,(1...1000).contains(c.text.count),["clean","flirty","dirty"].contains(c.intensity),!c.supportedModes.isEmpty,Set(c.supportedModes).isSubset(of:Set(g.supportedModes)),(2...20).contains(c.minPlayers),(c.minPlayers...20).contains(c.maxPlayers) else {throw QuizError.invalid}
                guard (0...2).contains(c.stage ?? 1),!(c.packs ?? ["classic"]).isEmpty,Set(c.packs ?? ["classic"]).isSubset(of:Set(CardPacks.labels.keys).subtracting(["all"])),(!(c.packs ?? []).contains("family") || (c.tags==["clean"] && !c.requiresAdult && !c.requiresDrinking)) else{throw QuizError.invalid}
                return PartyCard(id:c.id,game:g.id,text:c.text,intensity:c.intensity,modes:Set(c.supportedModes),min:c.minPlayers,max:c.maxPlayers,consent:c.requiresConsent,tags:Set(c.tags),adult:c.requiresAdult,alcohol:c.requiresDrinking,gameName:g.name,instructions:g.instructionsByMode,packs:Set(c.packs ?? ["classic"]),stage:c.stage ?? 1,namedText:c.namedText ?? "")
            }
            return PartyGame(id:g.id,name:g.name,description:g.description,instructions:g.instructionsByMode,cards:cards)
        }
        guard games.flatMap(\.cards).allSatisfy({ !$0.tags.isEmpty && $0.tags.isSubset(of:["clean","drinking","dirty"]) && (!$0.adult || $0.tags.contains("dirty")) && (!$0.alcohol || $0.tags.contains("drinking")) && (!$0.tags.contains("clean") || (!$0.adult && !$0.alcohol)) }) else {throw QuizError.invalid}
        let cards=games.flatMap(\.cards);guard cards.count==294,Set(cards.map(\.id)).count==294,Set(games.map(\.id)).count==8 else {throw QuizError.invalid}
        return PartyCatalog(hash:SHA256.hash(data:bytes).map{String(format:"%02x",$0)}.joined(),games:games)
    }
}
