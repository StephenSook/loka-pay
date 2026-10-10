# Adaptive layouts — October 3, 2026

## Implemented

- iOS targets both device families (iPhone and iPad), with all four iPad orientations. Native NavigationSplitView provides a selectable chat list and conversation detail, collapsing to a single column on narrow windows. Conversation identity resets detail-local state when changing people. Removed contacts clear the selected detail.
- iOS setup is bounded to 560 points, settings to 720, and conversation detail to 860. Chat sidebar has a 300–420 point native width range. Existing theme and system keyboard handling remain in use.
- Android uses the current window width, not device model: at 840 dp and above, navigation rail, 340 dp chat list, and conversation detail appear together. Narrow windows retain the single-screen flow. Selection is retained by the root saveable state; selected tablet rows are highlighted. Settings/details are bounded to 760 dp, setup to 560, conversation detail to 860.
- No networking, permissions, message protocol, encryption, or account reset behavior changed.

## Verification

- Signed iOS device build: passed. Built UIDeviceFamily is [1, 2]. Updated app installed on the connected iPad Air (5th generation), preserving its container. Launch attempt was blocked because the iPad locked.
- Android assembleDebug and lintDebug: passed. Existing duplicate-branch Kotlin warning remains outside this layout change.
- No physical Android tablet layout or visual screenshot verification completed. Native Apple pairing and delivery remain separate unproven gates.

## Manual review remaining

1. Open LOKA on iPad; complete setup if necessary. Verify list/detail in landscape and portrait, selected-row appearance, chat switching and native sidebar control.
2. Resize the app window to compact width and back. Verify native back navigation, contact removal, new-chat/notification entry and selected conversation behavior.
3. On Android test 400, 800, 840 and 1200 dp windows. Verify rail only on expanded windows; open settings and return to the selected chat; rotate and repeat.
4. Test keyboard open/close, large system text, dark/light theme, QR camera, photo picker and message actions. Check composer reachability and scroll behavior on both platforms.
