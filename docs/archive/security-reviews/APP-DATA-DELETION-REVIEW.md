# App data deletion review

Internal implementation review, October 2026. This is not an independent audit.

Android uses the OS clearApplicationUserData operation only after an explicit destructive confirmation. It stops the application, clears app-private data and runtime permissions, notifications and URI grants. Reopening returns to onboarding. The action does not delete documents exported to an external provider or data on other phones. The dialog offers the existing encrypted backup screen before deletion. No deletion action is invoked on connected physical phones during development.

On iOS, a persistent pending marker is set before stopping callbacks, subscriptions, transport and message stores. Identity generation is awaited before removing the precisely scoped LOKA identity Keychain item and history key. The root retries pending cleanup before constructing new stores, preventing crash recovery from opening stale archives. Only LOKA-prefixed owned files and preferences are removed. Cleanup failures prevent reinitialization and show a retry action. OS permissions remain granted. Exported backup documents and other phones are unaffected. The new identity requires contacts to exchange codes again. No forward secrecy or remote erasure is claimed.

Current limitations: iPhone backup export and automatic cloud backup are not implemented. An onboarding backup preference must never be described as an existing backup. Group membership and encryption need a separate reviewed protocol and destination-specific receipt storage; the new chat button must not fabricate group delivery from private-chat receipts.
