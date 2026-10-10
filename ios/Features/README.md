# iOS Features

`ContactStore.swift` persists bounded public contacts and local names with explicit verification. `ContactQr.swift` offers sharing, camera/image scanning and friend confirmation. `ChatStore.swift` binds trusted identity, the packet engine and the app-owned transport. `ConversationView.swift` shows actual text messages in familiar chat bubbles; drafts clear only after successful encryption/queueing. No delivery/read status is inferred from a radio write acknowledgement.

First-lab iPhone messages remain only in bounded memory and vanish on process restart; contacts and Keychain identity persist. Android has separately encrypted persistent history. See [scope](../README.md).
