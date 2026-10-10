# Friend request actions — October 3, 2026

Incoming authenticated pending requests generate local notifications with Accept and Decline. Notification IDs are scoped to the request, pending IDs are bounded/persisted to suppress repeated alerts, and handled/expired requests remove their alerts during request-state updates. They use existing notification permission; no server or Internet delivery dependency was introduced.

Acceptance uses the same live incoming-request and expiration checks as the in-app action. Only after the existing consent code saves approval and authorizes the saved key does navigation open the peer's chat. Android sets Chats and the selected conversation; iOS selects Chats and opens its existing conversation sheet. Failure does not navigate or mark acceptance as successful. Acceptance reply transmission still depends on a working route and existing retry/expiry rules.

Android actions use immutable PendingIntents into a non-exported activity, avoiding an externally callable accept action on the exported deep-link activity. Actions open LOKA; the model waits up to seven seconds for stores to load and then rechecks the request. iOS Accept requires authentication and foreground presentation; Decline requires authentication. No private key or friend authorization is taken from notification extras.

Build checks: iOS signed device build and Android assembleDebug/lintDebug. Existing consent/messaging regression suite covers expiry, approval, duplicate requests, persistence and cross-platform consent exchange. Actual notification tap/cold-start/locked-device/navigation behavior still requires physical testing.

Manual checks: receive a fresh request while foreground/background; accept in-app and from notification; verify the correct chat and Chats tab. Decline must not add/open a contact. Repeat a stale action, expire a request, deny notification permission, restart with a pending request, and receive duplicate packets. Keep radios enabled; background receipt depends on OS runtime and transport availability. iOS force-quit cannot be overcome by local notification code.
