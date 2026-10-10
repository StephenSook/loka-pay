import SwiftUI
import CryptoKit
import AudioToolbox

struct PartyCardsView:View {
    @ObservedObject var chat:ChatStore
    @ObservedObject var contacts:ContactStore
    var back:()->Void
    @State private var nearby=false
    var body:some View {
        if nearby || ["invited","joining","lobby","active"].contains(chat.partySession?.phase ?? "") {
            LegacyPartyCardsView(chat:chat,contacts:contacts,back:{nearby=false;back()})
        } else { FilteredCardsContent(cards:chat.partyGames.flatMap(\.cards),back:back,nearby:{nearby=true}) }
    }
}


struct LegacyPartyCardsView: View {
    @ObservedObject var chat: ChatStore
    @ObservedObject var contacts: ContactStore
    var back: () -> Void
    @AppStorage("loka.party.adultConfirmed") private var adult = false
    @AppStorage("loka.cards.eligible21") private var drinkingAge = false
    @State private var birthday = Date()
    @State private var page = "vibe"
    @State private var intensity = "clean"
    @State private var mode = "friends"
    @State private var count = 2
    @State private var consent = false
    @State private var drinking = false
    @State private var search = ""
    @State private var chosen: PartyGame?
    @State private var selected: [String] = []
    @State private var settingsOpen = false
    @State private var ask = true
    @State private var confirmation = false
    private var own: String { contacts.publicKey.map(ContactCode.fingerprint) ?? "" }
    private var session: PartySession? { chat.partySession.flatMap { $0.phase == "ended" ? nil : $0 } }
    private var nearby: [NearbyProfile] { var seen = Set<String>(); return chat.nearbyPeople.filter { $0.id != own && seen.insert($0.id).inserted } }
    private func name(_ id: String) -> String { if id == own { return "You" }; return chat.nearbyPeople.first(where:{$0.id==id})?.name ?? contacts.contacts.first(where:{$0.id==id})?.name ?? "Player" }
    private func eligible(_ game: PartyGame) -> [PartyCard] { game.cards.filter { $0.modes.contains(mode) && ($0.min...$0.max).contains(count) && (intensity=="all" || $0.intensity==intensity) && (consent || !$0.consent) && (!$0.alcohol || drinking) && (!$0.adult || intensity != "clean") } }
    private func invite() { if let chosen { chat.inviteCards(selected,PartySettings(game:chosen.id,mode:mode,intensity:intensity,consent:consent,drinking:drinking)) } }
    private func chooseCount(_ value: String) { count = value == "2 Players" ? 2 : 3; mode = count == 2 ? "friends" : "group"; selected = [] }
    var body: some View {
        VStack(spacing:0) {
            HStack {
                Button("‹ Back") { if settingsOpen { settingsOpen=false } else if session != nil { back() } else if page=="players" { page="library" } else if page=="library" { page="vibe" } else { back() } }
                Text(settingsOpen ? "Game settings" : session.flatMap { s in chat.partyGames.first(where:{$0.id==s.settings.game})?.name } ?? (page=="vibe" ? "Choose your vibe" : "Party cards")).font(.custom("LilitaOne",size:22,relativeTo:.title2))
                Spacer()
                if adult { Button { settingsOpen.toggle() } label: { Image(systemName:"gearshape") }.accessibilityLabel("Game settings") }
            }.padding(16)
            ScrollView {
                VStack(alignment:.leading,spacing:18) {
                    if let error=chat.partyError { Text(error).foregroundStyle(.red) }
                    if session==nil,chat.partySession?.phase=="ended",chat.partyStatus.contains("expired") { Text(chat.partyStatus).foregroundStyle(LokaStyle.muted) }
                    content
                }.padding(.horizontal,18).padding(.top,8).frame(maxWidth:720).frame(maxWidth:.infinity)
            }.id(page + String(settingsOpen) + (session?.id ?? ""))
        }.background(LokaStyle.background).foregroundStyle(LokaStyle.ink).tint(LokaStyle.green).toolbar(.hidden,for:.navigationBar)
        .alert("Ready to play?",isPresented:$confirmation) {
            Button("Invite players") { invite() }; Button("Cancel",role:.cancel) {}
        } message: { Text("\(chosen?.name ?? "Party cards") · \(count) players · \(intensity.capitalized). Everyone accepts before the first card.") }
    }
    @ViewBuilder private var content: some View {
        if !adult || (session?.settings.drinking==true && !drinkingAge) { ageCheck }
        else if settingsOpen { settings }
        else if let session { play(session) }
        else if page=="vibe" { vibe }
        else if page=="library" { library }
        else { players }
    }
    private var ageCheck: some View {
        VStack(alignment:.leading,spacing:20) {
            Text("Before we play").font(.custom("LilitaOne",size:34,relativeTo:.largeTitle))
            Text("You must be 18 or older to play these party games.").foregroundStyle(LokaStyle.muted)
            DatePicker("Date of birth",selection:$birthday,in:...Date(),displayedComponents:.date).datePickerStyle(.compact)
            Text("Your date stays on this screen. Only your age confirmation is saved on this device.").font(.caption).foregroundStyle(LokaStyle.muted)
            Button("Confirm age") { adult=true;drinkingAge=birthday <= (Calendar.current.date(byAdding:.year,value:-21,to:Date()) ?? Date.distantPast);birthday=Date() }.buttonStyle(LokaPrimaryButtonStyle()).disabled(birthday > (Calendar.current.date(byAdding:.year,value:session?.settings.drinking==true ? -21 : -18,to:Date()) ?? Date.distantPast))
            Text("Adult themes. Skipping is always okay.").foregroundStyle(LokaStyle.muted)
        }
    }
    private var vibe: some View {
        VStack(alignment:.leading,spacing:18) {
            Text("Good company. Great stories.").foregroundStyle(LokaStyle.muted)
            ForEach(["clean","flirty"],id:\.self) { value in
                Button { intensity=value } label: {
                    HStack {
                        VStack(alignment:.leading,spacing:8) {
                            Text(value.capitalized).font(.custom("LilitaOne",size:26,relativeTo:.title2))
                            Text(value=="clean" ? "Just for fun · No sexual content" : "Mild & cheeky · Light teasing").font(.subheadline).foregroundStyle(LokaStyle.muted)
                        };Spacer();if intensity==value { Image(systemName:"checkmark.circle.fill").foregroundStyle(.mint) }
                    }.padding(24).frame(maxWidth:.infinity,alignment:.leading).background(intensity==value ? LokaStyle.mint : LokaStyle.surface,in:RoundedRectangle(cornerRadius:24))
                        .overlay(RoundedRectangle(cornerRadius:24).stroke(intensity==value ? Color.mint : LokaStyle.muted.opacity(0.3)))
                }.buttonStyle(.plain)
            }
            Text("How many players?").bold()
            chips(["2 Players","Group"],count==2 ? "2 Players" : "Group",chooseCount)
            if count==2 { chips(["Two people","Couple"],mode=="couples" ? "Couple" : "Two people") { mode=$0=="Couple" ? "couples" : "friends" } }
            else { chips(["3","4"],String(count)) { count=Int($0)!;selected=[] } }
            Text("Up to 4 devices per nearby session. Friendship is not required.").font(.caption).foregroundStyle(LokaStyle.muted)
            Button("Browse games") { page="library" }.buttonStyle(LokaPrimaryButtonStyle()).disabled(chat.partyGames.isEmpty)
            if chat.partyGames.isEmpty { Text(chat.partyStatus).foregroundStyle(LokaStyle.muted) }
        }
    }
    private var library: some View {
        VStack(alignment:.leading,spacing:18) {
            TextField("Find a game",text:$search).padding(14).background(LokaStyle.surface,in:RoundedRectangle(cornerRadius:16))
            Text("Intensity").bold();chips(["clean","flirty","all"],intensity) { intensity=$0 }
            Text("Players").bold();chips(["2 Players","Group"],count==2 ? "2 Players" : "Group",chooseCount)
            let games=chat.partyGames.filter { $0.name.localizedCaseInsensitiveContains(search) || search.isEmpty }.filter { !eligible($0).isEmpty }
            if games.isEmpty { Text("No cards match. Change your filters to see more games.") }
            LazyVGrid(columns:[GridItem(.flexible()),GridItem(.flexible())],spacing:14) {
                ForEach(games) { game in
                    VStack(alignment:.leading,spacing:8) {
                        Text(game.name).font(.custom("LilitaOne",size:18,relativeTo:.headline)).lineLimit(2).frame(minHeight:44,alignment:.topLeading)
                        PartyDeckArt(id:game.id).frame(maxWidth:.infinity).frame(height:54).accessibilityHidden(true)
                        Text("\(count) players · \(intensity.capitalized)").font(.caption).foregroundStyle(LokaStyle.muted)
                        Text("\(eligible(game).count) cards").font(.caption)
                        Button("Play") { chosen=game;selected=[];page="players" }.buttonStyle(.bordered).frame(maxWidth:.infinity).accessibilityIdentifier("party-game-"+game.id)
                    }.padding(14).frame(maxWidth:.infinity,alignment:.leading).background(LokaStyle.mint,in:RoundedRectangle(cornerRadius:24))
                }
            }
        }
    }
    private var players: some View {
        VStack(alignment:.leading,spacing:18) {
            Text(chosen?.name ?? "Choose players").font(.custom("LilitaOne",size:28,relativeTo:.title))
            Text(chosen?.instructions[mode] ?? "").foregroundStyle(LokaStyle.muted)
            Text("Invite \(count-1) nearby \(count==2 ? "person" : "people")").bold()
            if nearby.isEmpty { Text("Waiting for someone nearby. Keep LOKA open on both devices.").foregroundStyle(LokaStyle.muted) }
            ForEach(nearby) { person in
                Button {
                    if selected.contains(person.id) { selected.removeAll{$0==person.id} } else if selected.count<count-1 { selected.append(person.id) }
                } label: { Text((selected.contains(person.id) ? "✓ " : "")+(person.name.isEmpty ? "Nearby player" : person.name)).frame(maxWidth:.infinity).padding(8) }.buttonStyle(.bordered).accessibilityIdentifier("party-peer-"+person.id)
            }
            Text("\(selected.count)/\(count-1) selected · Everyone accepts before play").foregroundStyle(LokaStyle.muted)
            Button("Invite to play") { if ask { confirmation=true } else { invite() } }.buttonStyle(LokaPrimaryButtonStyle()).disabled(selected.count != count-1)
            Text("Inviting someone to a game does not add them to your contacts.").font(.caption).foregroundStyle(LokaStyle.muted)
        }
    }
    private func play(_ session:PartySession) -> some View {
        PartySessionContent(s:session,card:chat.partyCard,own:own,name:name,avatar:{id in chat.nearbyPeople.first{$0.id==id}?.avatarID},status:chat.partyStatus,paused:chat.partyPaused,canAct:chat.partyCanAct,accept:chat.acceptCards,move:chat.cardAction,resume:chat.resumeCards,end:{chat.endCards();chosen=nil;page="library"})
    }
    private var settings: some View {
        VStack(alignment:.leading,spacing:18) {
            Text("Intensity").bold();chips(["clean","flirty","all"],intensity) { intensity=$0 }
            Text("Players").bold();chips(["2","3","4"],String(count)) { count=Int($0)!;mode=count==2 ? "friends" : "group";selected=[] }
            Toggle("Ask before each game",isOn:$ask)
            Toggle("Show only clean cards",isOn:Binding(get:{intensity=="clean"},set:{intensity=$0 ? "clean" : "all"}))
            Toggle("Allow consent dares",isOn:$consent)
            Text(session != nil ? "These settings apply to your next round. Everyone will accept the new invitation." : "Filter changes apply to your next card game.").foregroundStyle(LokaStyle.muted)
            Button("Apply settings") { settingsOpen=false;if session==nil { page="library" } }.buttonStyle(LokaPrimaryButtonStyle())
        }
    }
    private func chips(_ values:[String],_ selected:String,_ choose:@escaping(String)->Void) -> some View {
        ScrollView(.horizontal,showsIndicators:false) {
            HStack(spacing:8) {
                ForEach(Array(Set(values)).sorted { values.firstIndex(of:$0)!<values.firstIndex(of:$1)! },id:\.self) { value in
                    Button { choose(value) } label: { Text(value.capitalized).font(.subheadline.bold()).padding(.horizontal,14).padding(.vertical,10).background(value==selected ? LokaStyle.green : LokaStyle.surface,in:Capsule()).foregroundStyle(value==selected ? LokaStyle.onGreen : LokaStyle.ink) }.buttonStyle(.plain)
                }
            }
        }
    }
}

private struct PartyDeckArt:View {
    let id:String
    private var symbol:String { switch id { case "never_have_i_ever":return "questionmark";case "truth_or_drink":return "heart.fill";case "whos_most_likely_to":return "crown.fill";case "hot_seat":return "chair.lounge.fill";case "would_you_rather":return "arrow.triangle.branch";case "two_player_specials":return "person.2.fill";default:return "sparkles" } }
    var body:some View {
        ZStack {
            RoundedRectangle(cornerRadius:10).fill(Color(red:1,green:0.80,blue:0.32)).frame(width:42,height:48).rotationEffect(.degrees(-15)).offset(x:-24)
            RoundedRectangle(cornerRadius:10).fill(Color(red:0.95,green:0.55,blue:0.69)).frame(width:42,height:48).rotationEffect(.degrees(15)).offset(x:24)
            RoundedRectangle(cornerRadius:10).fill(Color(red:0.84,green:0.70,blue:1)).frame(width:44,height:52)
            Image(systemName:symbol).font(.system(size:26,weight:.bold)).foregroundStyle(Color(red:0.19,green:0.06,blue:0.27))
        }
    }
}

struct PartySessionContent:View {
    let s:PartySession;let card:PartyCard?;let own:String;let name:(String)->String;var avatar:(String)->String? = {_ in nil}
    let status:String;let paused:Bool;let canAct:Bool
    let accept:()->Void;let move:(String)->Void;let resume:()->Void;let end:()->Void
    @ViewBuilder var body:some View {
        Text(paused && ["active","complete"].contains(s.phase) ? "Reconnecting…" : status).font(.headline).foregroundStyle(LokaStyle.green)
        HStack { Text(s.settings.intensity.capitalized); Text(s.members.count==2 ? "2 Players" : "Group") }.font(.subheadline.bold()).padding(10).background(LokaStyle.mint,in:Capsule())
        Text(s.members.map(name).joined(separator:" · ")).foregroundStyle(LokaStyle.muted)
        if s.phase=="invited" {
            Text("\(name(s.host)) invited you. \(s.members.count) players; \(s.settings.intensity) cards. You can skip any card.")
            Text("Consent dares: \(s.settings.consent ? "Included" : "Off")").foregroundStyle(LokaStyle.muted)
            Button("Accept invitation") { accept() }.buttonStyle(LokaPrimaryButtonStyle())
            Button("Decline") { end() }.buttonStyle(.bordered)
        } else if ["lobby","joining"].contains(s.phase) {
            Text("Waiting for players · \(s.accepted.count)/\(s.members.count)").font(.custom("LilitaOne",size:26,relativeTo:.title2))
            ForEach(s.members,id:\.self) { id in Text("\(name(id)) · \(s.accepted.contains(id) ? "Ready" : "Inviting…")") }
        } else if s.phase=="active" {
            Text("\(name(s.turn))’s turn").font(.custom("LilitaOne",size:28,relativeTo:.title))
            let next=s.members[(s.revision+1)%s.members.count]
            HStack {
                ForEach([s.turn,next],id:\.self) { id in
                    HStack {
                        LokaAvatar(name:name(id),size:42,own:id==own,avatarID:avatar(id),peerID:id)
                        VStack(alignment:.leading) {
                            Text(id==s.turn ? "Playing" : "Up next").font(.caption).foregroundStyle(LokaStyle.muted)
                            Text(name(id)).bold()
                        }
                    }
                    Spacer()
                }
            }
            if let card{Text(card.gameName).font(.custom("LilitaOne",size:26)).foregroundStyle(.yellow);CardGraphicView(card:card,height:440,mode:s.settings.mode);Text(card.playRule(s.settings.mode)).foregroundStyle(LokaStyle.muted);Text("Card \(s.revision+1)").font(.caption).foregroundStyle(LokaStyle.muted)}else{Text("Synchronizing card…")}
            Text("Play your way. Skipping is always okay.").foregroundStyle(LokaStyle.muted)
            Button("Done / Next") { move("done") }.buttonStyle(LokaPrimaryButtonStyle()).disabled(!canAct)
            HStack {
                Button("Skip") { move("skip") }.buttonStyle(.bordered).disabled(!canAct)
            }
            Button("Shuffle") { move("shuffle") }.frame(maxWidth:.infinity).disabled(!canAct)
        } else if s.phase=="complete" {
            Text("Round complete!").font(.custom("LilitaOne",size:30,relativeTo:.title))
            Text("\(s.revision) cards played. Pick another game or play again.")
        }
        if ["active","joining","complete"].contains(s.phase) { Button("Resume / sync") { resume() }.buttonStyle(.bordered) }
        Button(s.host==own ? "End game" : "Leave game") { end() }
    }
}

struct FilteredCardsContent:View {
    let cards:[PartyCard];var back:()->Void;var nearby:()->Void
    @AppStorage("loka.cards.eligible18") private var adult=false
    @AppStorage("loka.cards.eligible21") private var drinking=false
    @State private var session:LocalCardSession
    private var deck:FilteredCardDeck{session.deck}
    @AppStorage("loka.cards.localSession") private var savedData=Data()
    @State private var saved:LocalCardSave?
    @State private var selectedPack="all"
    @State private var draftPack="all"
    @State private var roundTurns=1
    @State private var handoff=true
    @State private var sound=false
    @State private var optionsOpen=false
    @State private var editingNames=false
    @State private var pendingEdit=false
    @State private var nameList=""
    @State private var nameListError=""
    @Environment(\.scenePhase) private var scenePhase
    @State private var playing=false
    @State private var shuffleRevision=0
    @State private var motionBusy=false
    @State private var dealPending=true
    @State private var skipRequest=0
    @State private var rulesOpen=false
    @State private var namesOpen=false
    @State private var pendingNames=false
    @State private var continueNames=false
    private var playerNames:[String]{session.names}
    @State private var draftNames:[String]=[]
    private var playerTurn:Int{session.turn}
    @State private var selected:Set<String>=["clean"]
    @State private var draft:Set<String>=["clean"]
    @State private var selectedAudience:CardAudience?
    @State private var draftAudience:CardAudience?
    @State private var filtersOpen=false
    @State private var ageOpen=false
    @State private var pendingAge=false
    @State private var birthdayChosen=false
    @State private var birthdayDate=Calendar.current.startOfDay(for:Date())
    private var birthday:String {let c=Calendar(identifier:.gregorian).dateComponents([.day,.month,.year],from:birthdayDate);return String(format:"%02d%02d%04d",c.day ?? 1,c.month ?? 1,c.year ?? 1900)}
    @State private var rejected=false
    @State private var unavailable:Set<String>=[]
    @FocusState private var focusedPlayer:Int?
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @Environment(\.colorScheme) private var colorScheme
    private var dark:Bool{colorScheme == .dark}
    private var plum:Color{dark ? Color(red:0.13,green:0.05,blue:0.16) : Color(red:0.97,green:0.95,blue:0.99)}
    private var screenText:Color{dark ? .white : ink}
    private var muted:Color{dark ? lavender : Color(red:0.44,green:0.33,blue:0.5)}
    private let lavender=Color(red:0.91,green:0.85,blue:1),ink=Color(red:0.14,green:0.04,blue:0.19)
    init(cards:[PartyCard],back:@escaping()->Void,nearby:@escaping()->Void){self.cards=cards;self.back=back;self.nearby=nearby;_session=State(initialValue:LocalCardSession(cards:cards))}
    private var catalogKey:String{SHA256.hash(data:Data(cards.map{[$0.id,$0.text,$0.tags.sorted().joined(separator:","),$0.modes.sorted().joined(separator:","),String($0.min),String($0.max),$0.packs.sorted().joined(separator:","),String($0.stage),$0.namedText,$0.gameName].joined(separator:"~")}.joined(separator:"|").utf8)).map{String(format:"%02x",$0)}.joined()}
    private func namesValid(_ names:[String],count:Int)->Bool{LocalCardSession.validNames(names,count:count)}
    private func persist(){saved=LocalCardSave(updated:Date(),frame:session.frame(),previous:session.previous,catalog:catalogKey);if let saved,let data=try? JSONEncoder().encode(saved),data.count<=65536{savedData=data}}
    private func loadSaved(){guard !savedData.isEmpty else{return};do{guard savedData.count<=65536 else{throw QuizError.invalid};let value=try JSONDecoder().decode(LocalCardSave.self,from:savedData);guard value.version==1,value.catalog==catalogKey,(0...86400).contains(Date().timeIntervalSince(value.updated)) else{throw QuizError.invalid};var check=LocalCardSession(cards:cards);try check.restore(value.frame,adult:adult,drinking:drinking);if let previous=value.previous{try check.restore(previous,adult:adult,drinking:drinking)};saved=value}catch{saved=nil;savedData=Data()}}
    private func restore(){guard let saved else{return};do{try session.restore(saved.frame,adult:adult,drinking:drinking,history:saved.previous);session.resume();dealPending=false;selected=deck.filters;selectedAudience=deck.audience;selectedPack=deck.pack;roundTurns=session.roundTurns;handoff=session.handoff;sound=session.sound;draftNames=playerNames;playing=true;persist()}catch{self.saved=nil;savedData=Data()}}
    private func finish(){savedData=Data();saved=nil;session.end();draftNames=[];selectedAudience=nil;playing=false}
    private func pause(){session.pause();dealPending=false;persist()}
    private func reveal(){session.reveal();CardHaptics.advance();if session.sound{AudioServicesPlaySystemSound(1104)};persist()}
    private func advance(){guard !session.paused,!session.finished,session.revealed else{return};CardHaptics.advance();session.advance(adult:adult,drinking:drinking);persist()}
    private func apply(_ value:Set<String>,approvedAdult:Bool?=nil,approvedDrinking:Bool?=nil){UIApplication.shared.sendAction(#selector(UIResponder.resignFirstResponder),to:nil,from:nil,for:nil);guard let context=draftAudience,context.valid else{return};do{try session.configure(value,adult:approvedAdult ?? adult,drinking:approvedDrinking ?? drinking,audience:context,names:draftNames,pack:draftPack,roundTurns:roundTurns,handoff:handoff,sound:sound);selected=value;selectedAudience=context;selectedPack=draftPack;dealPending=true;shuffleRevision+=1;playing=true;filtersOpen=false;ageOpen=false;persist()}catch{rejected=true}}
    private func request(_ value:Set<String>,context:CardAudience?){guard !value.isEmpty,let context,context.valid else{return};draft=value;draftAudience=context;if !namesValid(draftNames,count:context.players){draftNames=(0..<context.players).map{index in index<draftNames.count ? draftNames[index] : index<playerNames.count ? playerNames[index] : ""};if filtersOpen{pendingNames=true;filtersOpen=false}else{namesOpen=true};return};if(value.contains("dirty") && !adult)||(value.contains("drinking") && !drinking){birthdayDate=Calendar.current.startOfDay(for:Date());birthdayChosen=false;rejected=false;if filtersOpen{pendingAge=true;filtersOpen=false}else{ageOpen=true}}else{apply(value)}}
    private func chipColor(_ value:String)->Color{value=="clean" ? Color(red:0.67,green:0.94,blue:0.79) : value=="dirty" ? Color(red:1,green:0.57,blue:0.64) : lavender}
    var body:some View {
        VStack(spacing:12) {
                ZStack {
                    HStack{Text("✦").foregroundStyle(muted);Spacer();Text("✦").foregroundStyle(.yellow)}.padding(.horizontal,28)
                    VStack(spacing:-8){HStack(spacing:0){ForEach(Array("LOKA").indices,id:\.self){index in Text(String(Array("LOKA")[index])).font(.custom("LilitaOne",size:playing ? 52 : 64)).rotationEffect(.degrees([-7.0,3,-3,4][index]))}}.foregroundStyle(dark ? Color(red:1,green:0.93,blue:0.91) : Color(red:0.34,green:0.14,blue:0.48)).accessibilityLabel("LOKA");Text(playing && !(deck.current?.gameName.isEmpty ?? true) ? deck.current!.gameName : "Cards").font(.custom("LilitaOne",size:26)).multilineTextAlignment(.center).lineLimit(2).minimumScaleFactor(0.8).padding(.horizontal,46).accessibilityIdentifier("cards-game-title").foregroundStyle(dark ? .yellow : Color(red:0.65,green:0.36,blue:0.02))}
                    VStack{HStack{Button("‹ Back"){if playing{pause();playing=false}else{back()}}.font(.caption).foregroundStyle(muted);Spacer()};Spacer()}
                }.frame(height:playing ? 112 : 132)
                if playing { playerStatus }
                if playing {
                    GeometryReader { geometry in
                        play(cardHeight:min(640,max(1,geometry.size.height-12))).frame(maxWidth:.infinity,maxHeight:.infinity)
                    }
                    playFooter
                } else {
                    ScrollView {VStack(spacing:18){choose;Spacer(minLength:24)}}.frame(maxWidth:.infinity,maxHeight:.infinity)
                    startFooter
                }
        }.padding(.horizontal,18).padding(.top,8).frame(maxWidth:720).frame(maxWidth:.infinity,maxHeight:.infinity).background(RadialGradient(colors:dark ? [Color(red:0.2,green:0.09,blue:0.23),plum,Color(red:0.07,green:0.03,blue:0.08)] : [.white,plum,Color(red:0.94,green:0.90,blue:0.98)],center:.center,startRadius:0,endRadius:600).ignoresSafeArea()).tint(Color(red:0.63,green:0.36,blue:0.93)).toolbar(.hidden,for:.navigationBar)
        .onAppear{loadSaved()}
        .onChange(of:cards.map(\.id)){_,_ in if !playing{session=LocalCardSession(cards:cards);loadSaved()}}
        .onChange(of:motionBusy){_,busy in if !busy && session.revealed && !session.paused{dealPending=false}}
        .onChange(of:scenePhase){_,value in if value != .active && playing{pause()}}
        .sheet(isPresented:$filtersOpen,onDismiss:{if pendingNames{pendingNames=false;namesOpen=true}else if pendingAge{pendingAge=false;ageOpen=true}}){filterSheet.presentationDetents([.large]).presentationDragIndicator(.visible).interactiveDismissDisabled(false)}
        .sheet(isPresented:$namesOpen,onDismiss:{focusedPlayer=nil;if continueNames{continueNames=false;if editingNames{session.rename(draftNames);editingNames=false;persist()}else{request(draft,context:draftAudience)}}else{editingNames=false;draftNames=playerNames}}){namesSheet.presentationDetents([.large]).presentationDragIndicator(.visible).interactiveDismissDisabled(false)}
        .sheet(isPresented:$rulesOpen){VStack(spacing:0){ScrollView{VStack(alignment:.leading,spacing:18){
            if let card=deck.current {Text(card.gameName.isEmpty ? "How to play" : card.gameName).font(.custom("LilitaOne",size:26));Text(card.playRule(deck.audience.mode));Text(deck.audience.label).font(.caption).foregroundStyle(muted)}
        }.padding(24)}
            primary("Got it"){rulesOpen=false}.padding(.horizontal,24).padding(.bottom,16)
        }.foregroundStyle(screenText).frame(maxWidth:.infinity,maxHeight:.infinity).background(plum).presentationDetents([.large]).presentationDragIndicator(.visible).interactiveDismissDisabled(false)}
        .sheet(isPresented:$optionsOpen,onDismiss:{if pendingEdit{pendingEdit=false;namesOpen=true}}){optionsSheet.presentationDetents([.large]).presentationDragIndicator(.visible).interactiveDismissDisabled(false)}
        .sheet(isPresented:$ageOpen,onDismiss:{birthdayDate=Calendar.current.startOfDay(for:Date())}){NavigationStack{ageSheet.toolbar(.hidden,for:.navigationBar)}.presentationDetents([.large]).presentationDragIndicator(.visible).interactiveDismissDisabled(false)}
    }
    private var choose:some View {
        VStack(spacing:18){Text("Choose your cards").font(.custom("LilitaOne",size:30)).foregroundStyle(screenText);Text("One deck. Your vibe.").foregroundStyle(muted);if saved != nil{primary("Resume game"){restore()};Text("Your unfinished round is saved on this phone.").font(.caption).foregroundStyle(muted)};audienceRows($selectedAudience);packChoices($selectedPack);rows($selected);matchingCards(selected,context:selectedAudience,pack:selectedPack);roundChoices;Text("Mix categories or keep it clean.").foregroundStyle(muted)}
    }
    private var startFooter:some View {
        HStack(spacing:12){
            Button {draftPack=selectedPack;request(selected,context:selectedAudience)} label:{
                Text("Start playing →").frame(maxWidth:.infinity,minHeight:56)
                    .background(Color(red:0.63,green:0.36,blue:0.93),in:RoundedRectangle(cornerRadius:20)).foregroundStyle(.white)
            }.disabled(!canStart(selected,context:selectedAudience,pack:selectedPack))
            Button(action:nearby){
                Text("Nearby multiplayer").frame(maxWidth:.infinity,minHeight:56)
                    .background(plum,in:RoundedRectangle(cornerRadius:20))
                    .overlay(RoundedRectangle(cornerRadius:20).stroke(Color(red:0.63,green:0.36,blue:0.93),lineWidth:1)).foregroundStyle(screenText)
            }
        }.font(.custom("LilitaOne",size:17)).multilineTextAlignment(.center).lineLimit(2).buttonStyle(.plain)
            .frame(maxWidth:420).padding(.bottom,12).accessibilityElement(children:.contain).accessibilityIdentifier("cards-start-footer")
    }
    private func canStart(_ categories:Set<String>,context:CardAudience?,pack:String)->Bool {
        guard let context,context.valid else{return false}
        return !deck.eligible(categories,adult:true,drinking:true,audience:context,pack:pack).isEmpty
    }
    private func matchingCards(_ categories:Set<String>,context:CardAudience?,pack:String)->some View {
        Group {if let context,context.valid {
            let matches=deck.eligible(categories,adult:true,drinking:true,audience:context,pack:pack)
            let count=matches.count,remaining=matches.filter{!deck.shown.contains($0.id)}.count
            VStack(spacing:8){Text(count==0 ? "No cards match. Change the pack, categories or player setup." : "\(count) matching cards · \(remaining) unseen")
                if count>0,roundTurns>0,remaining<context.players*roundTurns{Text("This selection has \(remaining) unused cards. A full round needs \(context.players*roundTurns). Try All packs or add a category; this deck will end early.")}
            }.font(.caption).foregroundStyle(muted)
        }}
    }
    private func audienceRows(_ value:Binding<CardAudience?>)->some View {
        VStack(alignment:.leading,spacing:12){
            Text("Who’s playing?").font(.custom("LilitaOne",size:24)).foregroundStyle(screenText)
            HStack(spacing:8){ForEach(["friends","couples","group"],id:\.self){mode in
                let title=mode=="friends" ? "Two friends" : mode=="couples" ? "A couple" : "A group"
                let checked=value.wrappedValue?.mode==mode
                Button {value.wrappedValue=CardAudience(players:mode=="group" ? max(3,value.wrappedValue?.players ?? 4) : 2,mode:mode)} label:{
                    Text(title).font(.subheadline.bold()).multilineTextAlignment(.center).frame(maxWidth:.infinity,minHeight:44)
                        .foregroundStyle(checked ? ink : screenText)
                        .background(checked ? lavender : dark ? Color(red:0.23,green:0.14,blue:0.26) : Color(red:0.94,green:0.90,blue:0.98),in:RoundedRectangle(cornerRadius:14)).overlay(RoundedRectangle(cornerRadius:14).stroke(checked ? ink : muted,lineWidth:1.5))
                }.buttonStyle(.plain).accessibilityLabel(title).accessibilityValue(checked ? "Selected" : "Not selected")
                    .accessibilityAddTraits(checked ? .isSelected : []).accessibilityIdentifier("card-audience-"+mode)
            }}
            if let context=value.wrappedValue,context.mode=="group" {
                Stepper("Players: \(context.players)",value:Binding(get:{value.wrappedValue?.players ?? 4},set:{value.wrappedValue=CardAudience(players:$0,mode:"group")}),in:3...20)
                    .foregroundStyle(screenText).accessibilityIdentifier("card-player-count")
            }
        }.frame(maxWidth:.infinity)
    }
    private func rows(_ values:Binding<Set<String>>)->some View {
        VStack(spacing:14){ForEach(["clean"],id:\.self){category in
            let checked=values.wrappedValue.contains(category)
            Button {if checked{values.wrappedValue.remove(category)}else{values.wrappedValue.insert(category)}} label:{
                HStack(spacing:14){Image("loka_mascot_"+category).resizable().scaledToFit().frame(width:52,height:52);VStack(alignment:.leading,spacing:6){Text(category.capitalized).font(.custom("LilitaOne",size:25));Text(category=="clean" ? "Lighthearted fun." : category=="drinking" ? "For a livelier night. · 21+" : "Bolder questions. · 18+").font(.caption)};Spacer();Image(systemName:checked ? "checkmark.circle.fill" : "circle").font(.title2)}.padding(20).frame(maxWidth:.infinity).foregroundStyle(checked ? ink : screenText).background(checked ? chipColor(category) : dark ? Color(red:0.23,green:0.14,blue:0.26) : Color(red:0.94,green:0.90,blue:0.98),in:RoundedRectangle(cornerRadius:24)).overlay(RoundedRectangle(cornerRadius:24).stroke(checked ? ink.opacity(0.5) : muted,lineWidth:1.5))
            }.buttonStyle(.plain).disabled(unavailable.contains(category)).accessibilityLabel(category.capitalized).accessibilityValue(checked ? "Selected" : "Not selected").accessibilityAddTraits(checked ? .isSelected : []).accessibilityIdentifier("card-filter-"+category)
        }}
    }
    private func primary(_ title:String,_ action:@escaping()->Void)->some View {Button(action:action){Text(title).font(.custom("LilitaOne",size:22)).frame(maxWidth:.infinity,minHeight:56).background(Color(red:0.63,green:0.36,blue:0.93),in:RoundedRectangle(cornerRadius:24)).foregroundStyle(.white)}.buttonStyle(.plain).frame(maxWidth:420)}
    private var playerStatus:some View {
        VStack(spacing:4) {
            Text(playerNames.indices.contains(playerTurn) ? "\(playerNames[playerTurn])’s turn" : "").font(.custom("LilitaOne",size:20)).foregroundStyle(screenText).lineLimit(2).minimumScaleFactor(0.8).accessibilityIdentifier("cards-current-player")
            HStack(spacing:10){Text(deck.audience.label).font(.caption).foregroundStyle(muted);Button("•••"){optionsOpen=true}.accessibilityLabel("Game options").accessibilityIdentifier("cards-session-options").disabled(motionBusy)}
            Text((session.goal>0 ? "\(min(session.completed,session.goal))/\(session.goal) turns" : "\(session.completed) turns")+" · "+session.phaseLabel).font(.caption2).foregroundStyle(muted)
        }
    }
    private func play(cardHeight:CGFloat)->some View {
        Group {
            if session.paused{Text("Game paused").font(.custom("LilitaOne",size:30)).foregroundStyle(screenText)}
            else if session.finished{VStack(spacing:18){Image(systemName:"sparkles").font(.system(size:48)).foregroundStyle(.purple);Text(deck.current==nil ? "You’ve finished this deck" : "Round complete!").font(.custom("LilitaOne",size:30));Text("\(session.completed) turns together. Ready for another?").foregroundStyle(muted)}.multilineTextAlignment(.center).foregroundStyle(screenText).transition(.opacity)}
            else if let card=deck.current {
                if !session.revealed{handoffMessage(height:cardHeight)}
                else {
                    CardMotionView(shuffleKey:shuffleRevision,cardHeight:cardHeight,dismissKey:skipRequest,shuffleCards:deck.eligible(selected,adult:adult,drinking:drinking).map{maskedCard($0)},currentCard:maskedCard(card),mode:deck.audience.mode,previewCard:session.handoff ? nil : deck.peek(adult:adult,drinking:drinking),animateShuffle:dealPending,busy:$motionBusy,advance:{advance()}){CardGraphicView(card:session.display(card),height:cardHeight,mode:deck.audience.mode)}.frame(maxWidth:min(420,cardHeight*0.792))
                }
            }
        }.animation(reduceMotion ? nil : .easeInOut(duration:0.2),value:session.finished)
    }
    private func handoffMessage(height:CGFloat)->some View {
        ScrollView {
            VStack(spacing:16) {
                Image(systemName:"arrow.right").font(.system(size:40,weight:.medium)).foregroundStyle(lavender).accessibilityHidden(true)
                Text("Pass the phone to").font(.headline).foregroundStyle(muted)
                Text(playerNames.indices.contains(playerTurn) ? playerNames[playerTurn] : "the next player")
                    .font(.custom("LilitaOne",size:36)).foregroundStyle(screenText).multilineTextAlignment(.center)
                Text("Tap Reveal card when you’re ready.").font(.subheadline).foregroundStyle(muted).multilineTextAlignment(.center)
            }.padding(.horizontal,24).padding(.vertical,20).frame(maxWidth:.infinity,minHeight:height)
                .accessibilityElement(children:.combine).accessibilityIdentifier("cards-handoff-message")
        }.frame(maxWidth:420).frame(height:height)
    }
    private func maskedCard(_ card:PartyCard)->PartyCard{var value=card;value.text="Your next moment together";return value}
    private var playFooter:some View {
        VStack(spacing:4){
            if session.paused{primary("Resume game"){session.resume();persist()}}
            else if session.finished{
                primary("Another round"){session.newRound(adult:adult,drinking:drinking);dealPending=true;shuffleRevision+=1;persist()}
                Button("Change the vibe"){playing=false}.padding(10).foregroundStyle(muted)
                Button("Finish game"){finish()}.padding(10).foregroundStyle(muted)
            }else if deck.current != nil {
                primary(session.revealed ? "Next card" : "Reveal card"){if session.revealed{advance()}else{reveal()}}.disabled(motionBusy)
                HStack(spacing:0){
                    Button {draft=selected;draftPack=selectedPack;draftAudience=selectedAudience;draftNames=playerNames;filtersOpen=true} label:{Text("Filters").frame(maxWidth:.infinity,minHeight:44)}
                    Button {skipRequest+=1} label:{Text("Skip").frame(maxWidth:.infinity,minHeight:44)}.disabled(!session.revealed)
                    Button {rulesOpen=true} label:{Text("How to play").frame(maxWidth:.infinity,minHeight:44)}
                }.buttonStyle(.plain).font(.subheadline).foregroundStyle(muted).disabled(motionBusy)
            }
        }.frame(maxWidth:420).padding(.bottom,12)
    }
    private var optionsSheet:some View {
        ScrollView{VStack(spacing:16){
            Text("Game options").font(.custom("LilitaOne",size:28))
            Text("\(CardPacks.labels[deck.pack] ?? "All packs") · \(playerNames.count) players").foregroundStyle(muted)
            primary("Undo last card"){try? session.undo(adult:adult,drinking:drinking);optionsOpen=false;persist()}.disabled(session.previous==nil)
            primary("Edit players"){draftAudience=selectedAudience;draftNames=playerNames;nameList="";nameListError="";editingNames=true;pendingEdit=true;optionsOpen=false}
            primary("Pause game"){pause();optionsOpen=false}
            primary("Finish game"){optionsOpen=false;finish()}
        }.padding(24)}.foregroundStyle(screenText).frame(maxWidth:.infinity,maxHeight:.infinity).background(plum)
    }
    private func packChoices(_ value:Binding<String>)->some View {
        VStack(alignment:.leading,spacing:10){Text("Question packs").font(.custom("LilitaOne",size:24));ScrollView(.horizontal,showsIndicators:false){HStack(spacing:8){ForEach(CardPacks.options,id:\.0){item in choice(item.1,selected:value.wrappedValue==item.0){value.wrappedValue=item.0}.accessibilityIdentifier("card-pack-"+item.0)}}}.accessibilityIdentifier("card-packs-scroll")}
    }
    private func choice(_ title:String,selected:Bool,action:@escaping()->Void)->some View {
        Button(action:action){Text(title+(selected ? " ✓" : "")).font(.subheadline.bold()).padding(.horizontal,14).frame(minHeight:44).foregroundStyle(selected ? ink : screenText).background(selected ? lavender : dark ? Color(red:0.23,green:0.14,blue:0.26) : Color(red:0.94,green:0.90,blue:0.98),in:RoundedRectangle(cornerRadius:14)).overlay(RoundedRectangle(cornerRadius:14).stroke(muted,lineWidth:1.5))}.buttonStyle(.plain).accessibilityValue(selected ? "Selected" : "Not selected")
    }
    private var roundChoices:some View {
        VStack(alignment:.leading,spacing:12){
            Text("Make it your round").font(.custom("LilitaOne",size:24))
            ScrollView(.horizontal,showsIndicators:false){HStack(spacing:8){ForEach([(1,"Quick round"),(2,"Longer round"),(0,"Open-ended")],id:\.0){item in choice(item.1,selected:roundTurns==item.0){roundTurns=item.0}.accessibilityIdentifier("card-round-\(item.0)")}}}
            Text(roundTurns==1 ? "One turn for everyone." : roundTurns==2 ? "Two turns for everyone." : "Keep playing until you’re ready to stop.").font(.caption).foregroundStyle(muted)
            Toggle("Pass phone, then reveal",isOn:$handoff).accessibilityIdentifier("card-handoff-toggle")
            Toggle("Card sounds",isOn:$sound)
        }.foregroundStyle(screenText)
    }
    private var filterSheet:some View {
        VStack(spacing:0){ScrollView{VStack(spacing:18){Text("Choose your cards").font(.custom("LilitaOne",size:30)).foregroundStyle(screenText);audienceRows($draftAudience);packChoices($draftPack);rows($draft);matchingCards(draft,context:draftAudience,pack:draftPack)}.padding(24)}
            primary("Apply filters"){request(draft,context:draftAudience)}.disabled(!canStart(draft,context:draftAudience,pack:draftPack)).padding(.horizontal,24).padding(.bottom,16)
        }.frame(maxWidth:.infinity,maxHeight:.infinity).background(plum)
    }
    private var namesSheet:some View {
        VStack(spacing:0) {
            VStack(spacing:12){
                Text("Player names").font(.custom("LilitaOne",size:28))
                Text("\(draftNames.filter{!$0.trimmingCharacters(in:.whitespacesAndNewlines).isEmpty}.count) of \(draftNames.count) names added").foregroundStyle(muted)
            }.padding(24)
            ScrollView {
                VStack(spacing:14) {
                    TextField("Paste names, separated by commas or lines",text:$nameList,axis:.vertical).textInputAutocapitalization(.words).autocorrectionDisabled().onChange(of:nameList){_,value in nameList=String(value.prefix(2000));nameListError=""}.lineLimit(2...4).padding(14).background(lavender.opacity(0.4),in:RoundedRectangle(cornerRadius:14)).accessibilityIdentifier("card-name-list")
                    primary("Use names"){let names=LocalCardSession.parseNames(nameList);if !names.isEmpty,names.count<=draftNames.count,Set(names.map{$0.lowercased()}).count==names.count,names.allSatisfy{$0.count<=40}{draftNames=names+Array(repeating:"",count:draftNames.count-names.count);nameListError="";focusedPlayer=nil;UIApplication.shared.sendAction(#selector(UIResponder.resignFirstResponder),to:nil,from:nil,for:nil)}else{nameListError="Use up to \(draftNames.count) different names, 40 characters each."}}
                    if !nameListError.isEmpty{Text(nameListError).font(.caption).foregroundStyle(muted)}
                    ForEach(draftNames.indices,id:\.self){index in
                        TextField("Player \(index+1) name",text:Binding(get:{draftNames.indices.contains(index) ? draftNames[index] : ""},set:{value in if draftNames.indices.contains(index){draftNames[index]=String(value.prefix(40))}}))
                            .textContentType(.name).textInputAutocapitalization(.words).autocorrectionDisabled()
                            .focused($focusedPlayer,equals:index).submitLabel(index==draftNames.count-1 ? .done : .next)
                            .onSubmit {focusedPlayer=index+1<draftNames.count ? index+1 : nil}
                            .padding(14).background(lavender.opacity(0.3),in:RoundedRectangle(cornerRadius:14))
                            .accessibilityIdentifier("card-player-name-\(index)")
                    }
                    Text("Use a different name for each player.").font(.caption).foregroundStyle(muted)
                }.padding(.horizontal,24).padding(.bottom,16)
            }.scrollDismissesKeyboard(.interactively).clipped().accessibilityIdentifier("card-names-scroll")
            VStack(spacing:12) {
                primary("Continue"){focusedPlayer=nil;continueNames=true;namesOpen=false}.disabled(!namesValid(draftNames,count:draftAudience?.players ?? 0))
            }.padding(.horizontal,24).padding(.top,14).padding(.bottom,16).background(plum)
        }.foregroundStyle(screenText).frame(maxWidth:.infinity,maxHeight:.infinity).background(plum.ignoresSafeArea())
    }
    private var ageSheet:some View {
        let minimum=draft.contains("drinking") ? 21 : 18
        let result=CardBirthday.eligible(birthday,minimum:minimum)
        return VStack(spacing:18){
            Text("Confirm your age").font(.custom("LilitaOne",size:30))
            Text("Dirty cards: 18+. Drinking cards: 21+. Your date of birth stays on this screen.").font(.subheadline)
            ScrollView {VStack(spacing:18) {
            DatePicker("Date of birth",selection:$birthdayDate,in:(Calendar.current.date(byAdding:.year,value:-120,to:Date()) ?? .distantPast)...Date(),displayedComponents:.date)
                .datePickerStyle(.wheel).labelsHidden().environment(\.colorScheme,.light)
                .accessibilityIdentifier("card-birthday-wheel").onChange(of:birthdayDate){old,new in if !Calendar.current.isDate(old,inSameDayAs:new){birthdayChosen=true;rejected=false}}
            Text(result==true ? "Ready to confirm." : "These cards require age \(minimum)+.").font(.caption)
            if rejected{Text("Those categories are unavailable for your age. You can play Clean cards.")}
            }}.clipped()
            primary("Confirm & play") {
                if result==true {
                    let eligible18=CardBirthday.eligible(birthday,minimum:18)==true
                    let eligible21=CardBirthday.eligible(birthday,minimum:21)==true
                    adult=eligible18;drinking=eligible21;apply(draft,approvedAdult:eligible18,approvedDrinking:eligible21)
                }else{
                    rejected=true;unavailable.formUnion(draft.filter{$0 != "clean" && CardBirthday.eligible(birthday,minimum:$0=="drinking" ? 21 : 18) != true})
                    if !playing{selected=["clean"]}
                }
            }.disabled(!birthdayChosen || result==nil || rejected)
            if rejected{primary("Play Clean cards"){apply(["clean"])}}
        }.padding(24).foregroundStyle(ink)
            .frame(maxWidth:.infinity,maxHeight:.infinity).background(lavender.ignoresSafeArea())
    }

}

/// Finite presentation only; one completed throw commits one deck action.
private struct CardMotionView<Content:View>:View {
    let shuffleKey:Int
    let cardHeight:CGFloat
    var dismissKey=0
    let shuffleCards:[PartyCard]
    let currentCard:PartyCard
    let mode:String
    let previewCard:PartyCard?
    var animateShuffle=true
    @Binding var busy:Bool
    let advance:()->Void
    @ViewBuilder let content:()->Content
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @State private var shuffling=true
    @State private var shuffleStart=Date()
    @State private var poses=(0..<5).map{_ in CardShufflePose()}
    @State private var x:CGFloat=0
    @State private var throwing=false
    @State private var throwDirection:CGFloat=1
    @State private var throwID=0
    var body:some View {
        ZStack {
            if shuffling {
                TimelineView(.animation) { timeline in
                    GeometryReader { geometry in
                        let progress=reduceMotion ? 1.0 : min(1,max(0,timeline.date.timeIntervalSince(shuffleStart)/2.3))
                        ZStack {
                            ForEach(0..<5,id:\.self) { index in
                                let frame=CardShuffleFrame(progress:progress,index:index,pose:poses[index],width:geometry.size.width,reduced:reduceMotion)
                                if frame.opacity>0 {
                                    CardGraphicView(card:index == 4 || shuffleCards.isEmpty ? currentCard : shuffleCards[index % shuffleCards.count],height:cardHeight,mode:mode,preview:true)
                                        .padding(.horizontal,6).shadow(color:.black.opacity(0.15),radius:6,y:4)
                                        .rotationEffect(.degrees(frame.angle)).offset(x:frame.x,y:frame.y)
                                        .opacity(frame.opacity).zIndex(frame.layer)
                                }
                            }
                        }.frame(width:geometry.size.width,height:cardHeight)
                    }
                }.frame(height:cardHeight).accessibilityHidden(true)
            } else {
                if let card=previewCard {
                    CardGraphicView(card:card,height:cardHeight,mode:mode,preview:true).padding(.horizontal,6)
                        .scaleEffect(0.96+min(abs(x)/300,1)*0.04).rotationEffect(.degrees(-2*(1-min(abs(x)/300,1)))).offset(y:(1-min(abs(x)/300,1))*8).accessibilityHidden(true)
                }
                content().padding(.horizontal,6).shadow(color:.black.opacity(0.15),radius:6,y:4)
                    .rotationEffect(.degrees(reduceMotion ? 0 : min(22,max(-22,Double(x/22)))))
                    .offset(x:x,y:reduceMotion ? 0 : abs(x)*0.045)
                    .contentShape(Rectangle())
                    .simultaneousGesture(DragGesture(minimumDistance:12).onChanged{value in
                        guard !busy,abs(value.translation.width)>abs(value.translation.height) else{return}
                        x=value.translation.width
                    }.onEnded{value in
                        guard !busy else{return}
                        let horizontal=abs(value.translation.width)>abs(value.translation.height)
                        let committed=horizontal && (abs(value.translation.width)>100 || (abs(value.translation.width)>24 && abs(value.predictedEndTranslation.width)>220))
                        if committed {busy=true;throwing=true;throwDirection=value.predictedEndTranslation.width<0 ? -1 : 1;throwID+=1}
                        else {withAnimation(reduceMotion ? nil : .spring(response:0.38,dampingFraction:0.72)){x=0}}
                    })
            }
        }
        .task(id:shuffleKey){
            if !animateShuffle{shuffling=false;busy=false;return}
            busy=true;shuffling=true;x=0;shuffleStart=Date();poses=(0..<5).map{_ in CardShufflePose()}
            // Empty table, staggered deal, several randomized crossings, then settle.
            do{
                if reduceMotion {try await Task.sleep(for:.milliseconds(80))}
                else {for interval in [380,160,160,160,350,400,690] {
                    try await Task.sleep(for:.milliseconds(interval))
                    guard !Task.isCancelled else{return}
                    if interval != 690 {CardHaptics.shuffleTick()}
                }}
            }catch{return}
            guard !Task.isCancelled else{return}
            shuffling=false;busy=false
        }
        .onChange(of:dismissKey){_,_ in
            guard !busy else{return}
            busy=true;throwing=true;throwDirection = -1;throwID+=1
        }
        .task(id:throwID){
            guard throwing else{return}
            withAnimation(reduceMotion ? nil : .easeIn(duration:0.28)){x=throwDirection*1200}
            do{try await Task.sleep(for:.milliseconds(reduceMotion ? 12 : 290))}catch{return}
            guard !Task.isCancelled else{return}
            advance()
            var transaction=Transaction();transaction.disablesAnimations=true
            withTransaction(transaction){x=0;throwing=false;busy=false}
        }
        .onDisappear{busy=false}
    }
}

private struct CardShuffleFrame {
    let x:CGFloat;let y:CGFloat;let angle:Double;let opacity:Double;let layer:Double
    init(progress:Double,index:Int,pose:CardShufflePose,width:CGFloat,reduced:Bool) {
        let dealt:Double=min(1,max(0,progress/0.42*6-Double(index)-1))
        let mix:Double=min(1,max(0,(progress-0.42)/0.44))
        let envelope:Double=sin(mix * Double.pi)
        let phase:Double=mix*6*Double.pi+pose.phase
        let wave:Double=sin(phase)*envelope
        let entryX:Double=(1-dealt)*Double(width)*0.9*pose.direction
        let mixX:Double=wave*Double(width)*0.48
        let entryY:Double=(1-dealt) * -100
        let settle:Double=min(1,max(0,(progress-0.86)/0.14))
        let stackY:Double=Double(index-2)*5*(1-settle)
        let mixY:Double=sin(phase*1.4)*envelope*44
        x=reduced ? 0 : CGFloat(entryX+mixX)
        y=reduced ? 0 : CGFloat(entryY+stackY+mixY)
        let entryAngle:Double=(1-dealt)*pose.angle
        let mixAngle:Double=Double(index-2)*2+wave*18
        angle=reduced ? 0 : (entryAngle+mixAngle)*(1-settle)
        opacity=min(1,dealt*5)*(index == 4 ? 1 : 1-settle);layer=Double(index)+wave*6
    }
}

/// Shared artwork and bounds for dealing, swiping, and the revealed card.
private struct CardArtworkView:View {
    let category:String
    let height:CGFloat
    var body:some View {
        Image("loka_card_"+category).resizable().frame(height:height)
    }
}

private struct CardShufflePose {
    let direction=Bool.random() ? 1.0 : -1.0
    let phase=Double.random(in:0...(2 * .pi))
    let angle=Double.random(in:-25...25)
}

// The public catalog is clean-only and ships only the clean card art.
private func cardCategory(_ card:PartyCard)->String {"clean"}
private struct CardGraphicView:View {
    let card:PartyCard;let height:CGFloat;var mode="group";var preview=false
    private func promptSize(width:CGFloat,height:CGFloat)->CGFloat {
        for size in stride(from:25.0,through:16.0,by:-1.0){
            let font=UIFont(name:"LilitaOne",size:size) ?? .boldSystemFont(ofSize:size)
            let bounds=(card.text as NSString).boundingRect(with:CGSize(width:max(1,width),height:.greatestFiniteMagnitude),options:[.usesLineFragmentOrigin,.usesFontLeading],attributes:[.font:font],context:nil)
            if bounds.height<=height{return size}
        }
        return 16
    }
    var body:some View {
        ZStack {
            CardArtworkView(category:cardCategory(card),height:height)
            GeometryReader{geometry in
                ScrollView {VStack(spacing:14){
                    Text(card.text).font(.custom("LilitaOne",size:promptSize(width:geometry.size.width*0.73,height:height*0.59-20))).accessibilityIdentifier(preview ? "" : "filtered-current-card")
                }.multilineTextAlignment(.center).foregroundStyle(Color(red:0.14,green:0.04,blue:0.19)).padding(.vertical,10).frame(maxWidth:.infinity,minHeight:height*0.59)}
                    .scrollDisabled(preview).frame(width:geometry.size.width*0.73,height:height*0.59).position(x:geometry.size.width/2,y:height/2)
            }
        }.frame(height:height)
    }
}

/// Formatting happens inside the text edit so UIKit retains the intended caret position.
private struct CardBirthdayInput:UIViewRepresentable {
    @Binding var text:String
    let ink:UIColor
    func makeCoordinator()->Coordinator {Coordinator(self)}
    func makeUIView(context:Context)->UITextField {
        let field=UITextField();field.delegate=context.coordinator;field.keyboardType = .numberPad
        field.placeholder="DD/MM/YYYY";field.font = .preferredFont(forTextStyle:.body);field.textColor=ink
        field.accessibilityLabel="Date of birth";field.accessibilityIdentifier="card-birthday"
        let toolbar=UIToolbar();toolbar.sizeToFit();toolbar.items=[UIBarButtonItem(systemItem:.flexibleSpace),UIBarButtonItem(title:"Done",style:.done,target:context.coordinator,action:#selector(Coordinator.done))]
        field.inputAccessoryView=toolbar;context.coordinator.field=field
        return field
    }
    func updateUIView(_ field:UITextField,context:Context){context.coordinator.parent=self;field.textColor=ink;if field.text != text{field.text=text}}
    final class Coordinator:NSObject,UITextFieldDelegate {
        var parent:CardBirthdayInput
        weak var field:UITextField?
        init(_ parent:CardBirthdayInput){self.parent=parent}
        @objc func done(){field?.resignFirstResponder()}
        func textField(_ field:UITextField,shouldChangeCharactersIn range:NSRange,replacementString replacement:String)->Bool {
            let old=field.text ?? "",ns=old as NSString
            guard range.location+range.length<=ns.length else{return false}
            var start=CardBirthday.digits(ns.substring(to:range.location)).count
            var removed=CardBirthday.digits(ns.substring(with:range)).count
            let raw=CardBirthday.digits(old),insert=CardBirthday.digits(replacement)
            if replacement.isEmpty && range.length>0 && removed==0 && start>0{start-=1;removed=1}
            let edited=String(raw.prefix(start))+insert+String(raw.dropFirst(start+removed))
            let formatted=CardBirthday.format(edited),count=min(start+insert.count,CardBirthday.digits(formatted).count)
            let offset=min(formatted.count,count+(count>2 ? 1 : 0)+(count>4 ? 1 : 0))
            field.text=formatted
            if let position=field.position(from:field.beginningOfDocument,offset:offset){field.selectedTextRange=field.textRange(from:position,to:position)}
            parent.text=formatted
            return false
        }
    }
}

private enum CardHaptics {
    static func shuffleTick(){UISelectionFeedbackGenerator().selectionChanged()}
    static func advance(){UIImpactFeedbackGenerator(style:.light).impactOccurred()}
}
