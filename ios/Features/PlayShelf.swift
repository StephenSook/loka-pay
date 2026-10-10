import SwiftUI
struct LokaPlayShelf: View {
    @ObservedObject var chat: ChatStore
    @ObservedObject var contacts: ContactStore
    @State private var selected: String?
    @Environment(\.lokaTabActive) private var tabActive

    private let games = [("Ludo", "game_ludo", "2–4 players"), ("Cards", "game_cards", "2–20 players"), ("Chess", "game_chess", "2 players"), ("Quick quiz", "game_quiz", "2 players")]
    var body: some View {
        Group {
        if selected == "Cards" { PartyCardsView(chat: chat, contacts: contacts, back: { selected = nil }) }
        else if selected == "Quick quiz" {
            VStack(spacing: 0) { Button("‹ Pick a game") { selected = nil }; QuickQuizView(chat: chat, contacts: contacts) }
        } else { shelf }
        }.preference(key:LokaTabsHiddenKey.self,value:selected == "Cards" && tabActive)
        .onChange(of: chat.partySession?.phase) { _, phase in if phase == "invited" { selected = "Cards" } }
        .onAppear { if chat.partySession?.phase == "invited" { selected = "Cards" } }
    }
    private var shelf: some View {
        VStack(spacing:0) {
            header
            ScrollView {
                VStack(alignment: .leading, spacing: 14) {
                    VStack(alignment: .leading, spacing: 10) {
                        Text("Play together,\nright here.").font(.custom("LilitaOne", size: 26, relativeTo: .title))
                        Text("Fun party games with people nearby.").font(.subheadline)
                        Button("Invite someone nearby") { selected = "Cards" }.buttonStyle(.plain).font(.caption.bold()).foregroundStyle(Color(red: 0.2, green: 0.06, blue: 0.27))
                            .padding(10).background(LokaStyle.yellow, in: Capsule())
                    }.foregroundStyle(.white).padding(18).frame(maxWidth: .infinity, alignment: .leading)
                        .background(LinearGradient(colors: [Color(red: 0.38, green: 0.14, blue: 0.84), Color(red: 0.54, green: 0.21, blue: 0.96)], startPoint: .topLeading, endPoint: .bottomTrailing), in: RoundedRectangle(cornerRadius: 28))
                    Text("Pick a game").font(.custom("LilitaOne", size: 22, relativeTo: .title2))
                    Text("Play together nearby. No Internet needed on a usable local connection.").font(.subheadline).foregroundStyle(LokaStyle.muted)
                    LazyVGrid(columns: [GridItem(.flexible()), GridItem(.flexible())], spacing: 10) {
                        ForEach(games, id: \.0) { game in
                            VStack(alignment: .leading, spacing: 0) {
                                Image(game.1).resizable().scaledToFit().frame(maxWidth:.infinity).frame(height:72).padding(8)
                                VStack(alignment: .leading, spacing: 5) {
                                    Text(game.0).font(.headline)
                                    Text(game.2).font(.caption).foregroundStyle(LokaStyle.muted)
                                    Text(["Cards", "Quick quiz"].contains(game.0) ? "Play ›" : "Coming soon").font(.caption.bold()).foregroundStyle(LokaStyle.green)
                                }.padding(10)
                            }.frame(maxWidth: .infinity, alignment: .leading).background(LokaStyle.surface).clipShape(RoundedRectangle(cornerRadius: 22))
                            .overlay(RoundedRectangle(cornerRadius:22).stroke(game.0 == "Ludo" ? LokaStyle.yellow : game.0 == "Cards" ? Color(red:0.95,green:0.39,blue:0.53) : game.0 == "Chess" ? Color.mint : Color(red:0.58,green:0.50,blue:1),lineWidth:3))
                            .contentShape(Rectangle()).onTapGesture { if ["Cards", "Quick quiz"].contains(game.0) { selected = game.0 } }
                            .accessibilityElement(children: .combine).accessibilityAddTraits(.isButton).accessibilityLabel(game.0)
                        }
                    }
                }.padding(16).frame(maxWidth: 720).frame(maxWidth: .infinity)
            }.clipped().accessibilityIdentifier("play-shelf-scroll")
        }.background(LokaStyle.background).toolbar(.hidden,for:.navigationBar)
    }
    private var header:some View {
        VStack(spacing:0) {
            HStack {
                VStack(alignment:.leading,spacing:4) {
                    Text("Let’s play").font(.custom("LilitaOne",size:26,relativeTo:.title)).accessibilityAddTraits(.isHeader)
                    Text("Games are better together.").foregroundStyle(LokaStyle.muted)
                }
                Spacer()
                Image(systemName:"gamecontroller").foregroundStyle(LokaStyle.green).accessibilityHidden(true)
            }.padding(16).frame(maxWidth:720).frame(maxWidth:.infinity)
            Rectangle().fill(LokaStyle.muted.opacity(0.15)).frame(height:1)
        }.background(LokaStyle.background).accessibilityElement(children:.contain).accessibilityIdentifier("play-shelf-header")
    }
}

