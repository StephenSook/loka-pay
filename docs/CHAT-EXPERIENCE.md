# Native chat experience — 0.6.15

Android and iPhone share these interactions:

| Action | Result |
| --- | --- |
| Hold a message | Compact emoji picker; replace/remove your reaction; copy text |
| Double-tap a message | Short message info with sent/delivered/read times and reported hops when available |
| + | Choose a photo from the phone |
| Camera | Take a photo, then preview before sending |
| Remove in photo preview | Discard the attachment and return to the composer |
| Send photo | Queue the compressed, encrypted photo; clear the preview after success |
| Security lock | Brief plain-language explanation of message protection |

The composer is hidden while a prepared photo is awaiting Send/Remove, providing one clear send action for the attachment. Native photo picking does not request broad library access. Camera permission is requested when used; already granted access proceeds directly. Capture cancellation preserves the text draft.

Status symbols sit beside the 12-hour timestamp. Grey double checks mean recipient-save confirmation. Blue double checks mean the message appeared in the recipient's active conversation and its read confirmation arrived. Notifications and background delivery do not mark content read. Read on a voice bubble does not mean the audio was played. Pending and expired confirmation remain honest rather than claiming nondelivery.

Message info stays short: full protocol/security limitations belong in [the content contract](../protocol/CHAT-CONTENT-V1.md) and [review](../security/MESSAGE-INFO-REACTIONS-REVIEW.md). Reported hops are labelled estimates and omitted when absent. They do not establish distance or a verified relay chain.

Android uses a compact dialog for reactions/details; iPhone uses native popover/sheet presentation. Both follow system light/dark appearance and native keyboard/safe-area handling. Accessibility exposes message info without requiring a double-tap gesture. Physical cross-platform gestures, camera behavior and read-confirmation delivery still need device testing.

## 0.6.16 new-chat entry

A floating new-chat action remains available on Chats and Nearby on both platforms. It opens verified saved friends and the contact-code flow. It does not authenticate a discovered radio device automatically. Group creation and encrypted group delivery are not yet implemented; do not present a group creation action as functional until membership consent and per-recipient delivery are integrated.

## 0.6.17 ordering and group entry

Conversations sort by the existing sender-created timestamp ascending, then canonical message ID ascending for equal timestamps. Chat previews select the maximum under that same order instead of the most recent arrival. Receipt times never change ordering. A delayed earlier message is inserted into its chronological position and does not trigger scrolling to the newest message merely because the count increased. No packet format or saved timestamps change. Phones with incorrect clocks can still disagree about actual real-world order; this is not a causal ordering protocol.

The new-chat chooser includes a people icon labeled “Group chats · Coming soon” on Android and iPhone. Group creation, consent and per-member encrypted delivery are still unimplemented; this row is informational.
