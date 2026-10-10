# LOKA visual design import

The supplied PNG boards are implemented as native Jetpack Compose and SwiftUI views. Both apps follow system light/dark appearance, using cream or midnight backgrounds, purple accents, yellow highlights, mint details, rounded cards, a LOKA wordmark, and four tabs: Chats, Nearby, Play, You.

The import covers onboarding artwork and segmented progress, chat greetings and saved-contact shortcuts, conversation cards, purple delivered text bubbles, decorative conversation backgrounds, Nearby radar and existing consent controls, profile counters, and a game shelf. Shared theme colors carry through the existing QR, settings, backup, permission, and engineering screens. QR modules retain their high-contrast rendering.

## Assets

Illustrations are cropped from the supplied onboarding and light app-board PNGs into Android drawable resources and `ios/Design.xcassets`. The original references are preserved. The latest standalone graphics in `UX/graphic` replace the onboarding and game crops with transparent artwork. Bundled copies are resized and palette-compressed; the original references remain intact. Native text, controls, cards, avatars, and decorative marks are rendered separately; complete screen screenshots are not used as UI.

## Capability boundaries

Games are explicitly marked as coming soon. No playable games, game invitations, invented game statistics, or calling implementation are added. Saved contacts use stable, decorative avatar illustrations derived from their local labels. These pictures are placeholders, not photos received from those people. Users can choose an illustration or a personal photo for their own local profile; avatar artwork and photos are not sent through discovery or the profile protocol. Nearby counts come from the existing people observations and do not establish friend reachability. Permission, identity, trust, encryption, radio, and delivery behavior remain with their existing implementations.

## Validation

Android `:app:assembleDebug` and `:app:lintDebug` and the iOS simulator build are the software checks. Android onboarding and all four tabs were reviewed on the isolated emulator in light/dark appearance; its disposable profile was used to reach the tabs without claiming permission-flow success. The fresh iOS review simulator renders onboarding but reports the existing device-identity access error, limiting interactive review. Simulator UI rendering does not demonstrate physical local delivery or background reliability.

## Display lettering

The wordmark uses intentionally unequal letter sizes and small rotations, with the same three yellow rays on Android and iOS. Hero titles use 36/34-point first/second lines, screen titles approximately 30–32, and section titles 22; body text keeps its readable native font. Display text bundles [Lilita One from Google Fonts](https://github.com/google/fonts/tree/main/ofl/lilitaone), with its SIL Open Font License included in each app. This is a native interpretation of the raster reference, which did not include a source font or vector wordmark. Font resources are bundled for offline use.

Phone-to-phone onboarding keeps its permission action in a fixed footer beneath scrolling instructions. Android uses the existing permission launcher and denial-to-Settings recovery; iOS retains its own enable action. The footer does not bypass system permission prompts.

Community sharing now has its own onboarding step and Settings editor, using the supplied community illustration, retained drafts, per-network presets, custom MB/GB validation, bottom sheets, and a fixed Save action. Internet gateway traffic and monthly metering are still unavailable; see [implementation boundaries](../docs/COMMUNITY-SHARING-UI.md).


## Your Corner and animated Nearby — 0.6.49

The three supplied grids in `UX/avators` provide 36 selectable portraits, grouped as Community, 3D portraits, and Fantasy. The original six board portraits remain available under Classic. New profiles receive one random grid portrait once; existing selections are preserved. Name onboarding and Edit profile open the same avatar collection in a bottom sheet, with an optional system image picker. The profile camera badge opens that chooser; it does not silently request camera permission. Selection is saved locally as an appearance preference; changing a look does not create a second account, alter device identity, or transmit a profile photo. Contact/nearby illustrations are stable local placeholders.

Your Corner now has the large portrait, camera badge, pencil/name edit, explicit Edit profile and QR buttons, yellow Games played card (Coming soon until games exist), mint Friends card from saved contacts, visibility control, privacy/backups/theme controls, and privacy reassurance. System/Dark/Light selections apply across the app and persist. Games and avatars do not invent game history or nearby friends.

Nearby uses observed named profiles around concentric rings, with decorative lines to the center and a pulse while local discovery is enabled. The layout shows up to six portraits, keeps the full actual count and list, and does not interpret positions/lines as distance or proven routes. iOS honors Reduce Motion; Android animations use system animation scale. No discovery, packet, consent or routing behavior changes.

Validation for this follow-up: Android build/lint and iOS simulator build passed. Emulator review covered the avatar gallery in onboarding, selection persistence after restart, and theme switching/persistence. Physical Android review checked dark Your Corner, icon contrast, and a real observed named profile on the Nearby diagram. Build 0.6.49 (57) was installed on the connected Android phone. These UI checks do not establish route or background reliability.


## Wide beacon and mode badge — 0.6.50

Nearby fills the available content width (up to 420 points/dp) with five broad, staggered rings expanding together, rather than one narrow ripple. Each observed portrait retains its center line and has a decorative curved stroke, mint dot, and yellow accent. These positions and arcs remain decorative, not measured distance or route quality. The two native wordmarks now carry three yellow marks on each side. Chats puts the device badge beneath the user's portrait.

Android Online mode requires the default network's INTERNET and VALIDATED capabilities, and no reported app network block. Offline mode does not turn local radios off or gate messaging, discovery, permissions, relaying, or routing. Network callbacks update only this composable and are unregistered when it leaves composition; no connectivity probes or transport changes are added. A captive portal or local-only Wi-Fi must not become Online simply because Wi-Fi is connected. See [Android network state](https://developer.android.com/develop/connectivity/network-ops/reading-network-state).

iOS uses NWPathMonitor for a truthful Wi-Fi connected / Network connected / Offline mode badge. A usable path does not verify Internet or an external LOKA route, so iOS does not label a connected path Online. Tapping either platform's badge explains its scope. See [Apple path status](https://developer.apple.com/documentation/networkextension/nwpath/status). The iOS monitor is stopped when the badge disappears. Neither badge indicates a friend's availability, account authentication, or implemented Go/Gateway messaging.

Validation: Android build/lint and iOS simulator build pass. On the disposable Android emulator, disabling Wi-Fi and mobile data changed the badge to Offline mode; restoring the original network settings restored Online mode. The transition and explanation were checked through the UI. The connected Android phone received 0.6.50 (58); its radios and sharing preferences were not changed for this UI update.

Physical UI review confirmed the mode badge beneath the profile portrait, the six wordmark marks, and broad concentric bands/portrait decorations for an actual observed nearby name. Successive captured RGB frames differed within the ring area, confirming live rendering on this phone. This is animation/status evidence, not a networking reliability result.

The matching signed iOS 0.6.50 (58) build was installed in place on the connected iPhone SE (3rd generation). `devicectl` confirmed installation and successful launch; existing app data was preserved. This confirms deployment and launch, not interactive iPhone UI or radio reliability.

## iOS and Android UI consistency — 0.6.51 (59)

iOS now uses the same four bottom destinations (Chats, Nearby, Play, You), purple selected tabs, compact illustrated headings, fixed primary actions, and Your Corner portrait/cards/settings structure as Android. Detail pages use a top-left native back button and hide the bottom destinations until returning. Chat details use navigation pushes instead of a separate conversation sheet. Existing contact and conversation behavior is retained.

Name onboarding shows one tappable portrait and the name field above a fixed Continue action. The avatar gallery appears only in its bottom sheet. On small screens with the keyboard visible, the portrait shrinks and supporting copy is reduced so the input and Continue remain visible. Larger accessibility text can still scroll. Avatar choices are appearance preferences, not additional accounts.

Validation: Android debug build and lint, signed iOS simulator/device builds, and native simulator/emulator review of avatar selection and keyboard-visible name entry. iPhone SE review also covers the custom bottom destinations, Your Corner, and detail/back navigation. These checks validate UI behavior; they do not establish physical networking reliability.

Build 0.6.51 (59) was installed and launched on the connected Samsung Android phone and iPhone SE. Existing device data was preserved. The iPhone SE simulator confirmed that Edit profile hides the bottom tabs and the top-left back button restores Your Corner and its tabs.

## Integrated animated navigation and supplied graphics — 0.6.52 (60)

Both apps use the screen background behind bottom navigation, including the system bottom inset. Tabs animate their selected purple indicator and icon; screens crossfade over 220 ms. iOS uses a shared spring indicator and honors Reduce Motion. Compose animations follow the system animator duration scale. Android’s tablet rail also uses the screen background; iPad tabs are centered with a 600-point maximum width while conversations retain native split navigation.

iOS Nearby uses a stable scrolling stack, omits the conversation search and floating chat action, and reserves space for bottom navigation. Its visibility control and count remain visible on the small iPhone SE; further details can scroll above the tabs. No radio, identity or route behavior changes.

The nine illustrations in `UX/graphic` map to welcome, nearby, notification, backup, community sharing and four game assets on both platforms. Transparent art blends into either theme. Game cards fit complete illustrations. Display copies preserve transparency, trim empty margins, resize to appropriate bounds, and use optimized 256-color PNGs. All 51 bundled raster assets total **1,516,315 bytes per platform**, previously 6,614,220 bytes (77% smaller). This is artwork size, not a claim about total store download size. Source images are preserved.

Validation: Android build/lint and signed iOS simulator/device builds passed. Native review covered small-iPhone Nearby and background continuity, Android tabs and game art in light/dark themes, and iPad mini onboarding, light portrait layouts, split chats and dark landscape game layouts. iPad review used an isolated simulator, not physical iPad hardware. The signed update was installed and launched on the connected iPhone. The physical Android phone disconnected before installation; the final APK is built and installed on the isolated emulator.

## iOS scroll completion and continuous beacon — 0.6.53 (61)

The home workspace now reserves the tab bar as a sibling below a bounded content area rather than inserting it around the navigation stacks. Each screen receives the remaining height directly, allowing its scroll content to finish above the tabs. Native iPhone SE review reached the Chats invitation actions, Nearby empty-state explanation, final game-card labels, and Your Corner footer.

The five staggered beacon bands use a smooth opacity envelope that reaches zero at the center and outer edge before each individual band wraps. Other bands continue expanding, avoiding a visible collective stop or restart. The pulse remains decorative; Reduce Motion, inactive-tab pauses and local discovery controls retain their existing behavior. No transport or reachability changes.

Signed simulator and device builds passed. Version 0.6.53 (61) was installed on the connected iPhone with existing data preserved.

## iOS native tab hosting follow-up — 0.6.54 (62)

Home destinations now use native `TabView` hosting instead of overlapping transparent navigation stacks. The system tab bar is hidden on every destination; the custom animated bar remains a separate sibling beneath bounded content. This isolates each destination’s navigation and scrolling while preserving native tab state.

Beacon bands travel continuously on an absolute timeline over six seconds. They retain steady opacity through most of their travel, with smooth fades only at the inner and outer boundaries; individual wraps remain invisible. Existing Reduce Motion and inactive-tab behavior remain in place.

Signed simulator/device builds passed. On the isolated iPhone SE simulator, gesture review reached the final Chats invitation card, Your Corner footer, Chess/Quick quiz labels, and Nearby empty-state explanation above the tabs after switching destinations. Version 0.6.54 (62) was installed on the connected iPhone in place. These remain UI checks, not networking reliability evidence.

## Hidden scroll indicators and connected-device update — 0.6.55 (63)

iOS hides scroll indicators at the application root so home tabs, onboarding, conversations, lists and presented editors inherit the same setting. Scrolling and content layout are retained. Android’s Compose screens already omit scroll indicators. Both platforms now report version 0.6.55 (63).

Android build/lint and signed iOS device/simulator builds passed. The new builds were installed in place and launched on the connected Samsung SM-S948U1, iPhone SE (3rd generation), and iPad Air (5th generation). Existing profiles and app data were preserved. The Android emulator and isolated iPhone simulator were updated as well. Device installation and launch do not establish networking reliability.

## iPad conversation navigation — iOS 0.6.56 (64)

The iPad conversation header now has an explicit top-left **Chats** button that clears the conversation and restores the chat list. Wide layouts keep the sidebar available, with purple outlines around the selected chat and contact portrait. Selecting a different person replaces the conversation. Direct selections clear stale New chat requests, allowing a previously chosen person to open again. Compact navigation and size-class transitions carry the selected conversation consistently.

Signed simulator and device builds passed. An isolated iPad mini simulator with disposable contacts confirmed switching between people, updated header/composer identity and selection highlights, returning through Chats, and portrait/landscape split layouts. Test contacts were removed by restoring the simulator’s original preferences. Version 0.6.56 (64) was installed in place and launched on the connected iPad Air (5th generation) and iPhone SE (3rd generation), preserving existing data. Android remains at 0.6.55 (63); this update changes iOS navigation only.

## Selected Nearby avatars and request stack — 0.6.57 (65)

Android and iOS share the selected bundled portrait by permanent `avatar_0`…`avatar_41` identifier through an optional encrypted LP1 control. The 42 images match byte-for-byte across platforms; their catalog hashes are recorded under `protocol/test-vectors`. Nearby radar portraits, people rows and request cards use the received ID. Saved friends retain their last received bundled illustration by device key for chat lists and conversation headers. Name-based fallback portraits remain for older peers or unavailable metadata. Camera/library photos remain local and clear the bundled selection rather than sending image payloads.

Incoming chat requests now appear above Visible nearby and the beacon, one card at a time with a count, stack treatment and previous/next controls. Accept stays explicit. Swipe left invokes Decline; swipe right or Later sets the card aside locally. Show later restores those cards. Vertical page scrolling remains available, expired requests disappear, and screen-reader users have ordinary labeled buttons. The existing consent persistence and authorization checks remain in place.

Validation: Android core tests, debug build/lint, signed iOS simulator/device builds, full native regression suite and actual Kotlin–Swift name/avatar/consent/typing interoperability passed. Additional Kotlin/Swift checks cover initial/change/clear avatar selection, malformed IDs, wrong nonce, noncanonical/stale/future timestamps, unbound links, replay, disconnect and visibility withdrawal. Native visual review used disposable, memory-only profiles in an isolated Android emulator and iPad mini simulator; it confirmed selected portraits, the top request stack, swipe-right Later and swipe-left Decline. All temporary fixture source edits were restored before deployment; review builds were replaced with regular builds. Small-iPhone simulator review could not complete because the host ran out of disk space during startup. This is UI/software evidence, not physical avatar propagation or radio reliability proof.

Version 0.6.57 (65) was installed in place and launched on the connected Samsung SM-S948U1, iPhone SE (3rd generation) and iPad Air (5th generation), preserving device profiles and history.

Final compatibility checks also ran the previous Kotlin LP1 implementation against updated Swift, and previous Swift LP1 against updated Kotlin. Both request directions retained names, consent and typing while older receivers ignored the optional avatar control. Multi-link display checks retain the newest accepted avatar for one device identity; request ordering is stable by deadline and request ID. Final builds and 91 Kotlin core tests passed. After the Android phone reconnected, the final 0.6.57 (65) builds, including multi-link avatar selection and stable request ordering, were installed in place on the Samsung SM-S948U1, iPhone SE (3rd generation) and iPad Air (5th generation). The Android emulator also received the final APK; isolated review devices were restored to regular builds. Existing device data was preserved.

## Controller bubble launcher icon — 0.6.58 (66)

Both platforms now use the approved artwork from `UX/appIcon/Loka controller bubble app icon.png`. iOS includes an opaque 1024px AppIcon asset for iPhone and iPad. Android includes five launcher densities, padded adaptive artwork for circular and rounded masks, and a monochrome layer for themed icons. The separate notification small icon is retained. Source artwork is unchanged; `UX/appIcon/generate_icons.py` regenerates the optimized assets and store/review exports.

Android build/lint and signed iOS device/simulator builds passed; packaged icon resources were checked. Native visual review confirmed the icon on the Android emulator launcher and isolated iPad mini Home Screen. Version 0.6.58 (66) was installed in place and launched on the connected Samsung SM-S948U1, iPhone SE (3rd generation), and iPad Air (5th generation), preserving existing app data. The Android emulator and isolated iPad simulator were also updated.

Cards now bundles the six supplied `cardGameGraphic` PNGs on Android and iOS, with category mascot rows, illustrated card centers, animated rear-card art and light/dark app chrome. Physical Samsung UI checks and iPad simulator screenshots are recorded in `experiments/results/2026-10-06-cards-artwork/`. The separate 24-player network proposal is `docs/CARDS-LARGE-GROUP-PLAN.md`; the current shared session cap remains four devices.

The iOS Play shelf places Let’s play in a fixed opaque header outside the clipped scroll viewport. The title and subtitle stay above the tiles during scrolling/bounce in either theme; the header belongs to the shelf and is absent inside Cards. Verification is recorded in `experiments/results/2026-10-06-play-header/`.

## Pass-phone instruction — 0.6.66 (74)

The local Cards handoff on Android and iOS uses a centered text message with a small arrow, the next player's name in the display typeface, and a supporting Reveal instruction. It has no category artwork, card border or card surface. The illustrated Clean/Drinking/Dirty faces appear only after Reveal. The footer action stays in place; the message can scroll on constrained screens or with longer names. Existing turn, reveal and shuffle behavior is retained.

Android build/lint and signed iOS device/simulator builds passed. Small-iPhone simulator review confirmed light/dark handoff layouts, Reveal opening the illustrated question, and Next card changing the handoff to the next named player. Version 0.6.66 (74) was installed in place on the connected Samsung SM-S948U1, iPhone SE (3rd generation) and iPad Air (5th generation), preserving app data.
