# Product scope

LOKA Local is the primary product: offline local communication, eventually familiar one-to-one/group messages and voice notes. LOKA Go, account services, dashboards, calling, iOS, and financial services follow network feasibility.

The current deliverable includes a native messaging preview built on the experimental Mesh Lab. Chats, Network, and Settings provide a consumer-facing interface; engineering controls remain under Settings → Connections → Engineering tools. Conversations show verified contacts or restored history and actual received/queued messages; restored histories do not grant trust. Lab listener/link state is distinct from verified destination reachability. Hardware validation gates remain outstanding.

Immediate acceptance target: A sends “Hello C” through B with no A–C link; C replies through B; B never receives message plaintext. Record actual failures, hardware conditions, and battery behavior before claiming feasibility.


The long-term principle is **Local when possible. External connectivity when necessary.** Local, Cloud, Go, and Gateway are separate layers; their [responsibilities and current state](ARCHITECTURE.md) must stay explicit. Optional encrypted backups are independent of local communication. Restoring an account must not automatically unlock historical conversations.

The first technical gates are three-phone offline encrypted relaying, recovery through an alternate route, and then acceptable screen-off/background reliability and battery use. Large-scale product development follows measured results from those gates.


“No data required” means that locally deliverable communication needs no cellular/mobile data or Internet connection. Local network traffic still transmits bytes and consumes battery. A Wi-Fi radio being enabled is neither proof of Internet access nor proof that a particular LOKA recipient is reachable. Consumer reachability should describe an actual usable route; laboratory listener/link counts are only diagnostics.

Contact onboarding and network privacy follow [Contacts and discovery](CONTACTS-AND-DISCOVERY.md): QR/link contact exchange is implemented; verified phone-number onboarding/lookup and anonymous authenticated LOKA discovery are planned. Radio neighbors are not automatically contacts.

The v0.3 preview adds encrypted local history (latest 5,000 text messages) and optional manual encrypted backup/restore through local storage or an available cloud document provider. Backup recovery keys are separate from phone/account authentication; restoring history does not restore trust, device-private identity or live queues. Automatic cloud backup and account recovery remain deferred. See [backup boundaries](RECOVERY-AND-BACKUP.md).

The Settings page follows familiar messaging-app patterns: compact editable profile header, QR shortcut, grouped rows for Chats, Privacy, contact code, Connections and Help. QR sharing opens a dedicated page; radio/relay preferences and diagnostics sit deeper in settings. Only working features are listed—no placeholder calls, account settings, online status or notification toggles.
