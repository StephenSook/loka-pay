# Current filtered-deck UX

The default Cards entry has been updated to the newer three-screen single-deck reference. See [filtered Cards](FILTERED-CARDS.md) for implementation, eligibility and the explicit gap between local filtering and the retained nearby G2 round flow. The following describes the older nearby flow, not the new filtered-deck network behavior.

# Party Cards implementation and validation

The Play page retains the four-game shelf from the premium app board. Cards follows the party showcase: local age check, clean/flirty/dirty vibe, two people/couple or bounded group, filtered searchable library, nearby selection, invitation confirmation, explicit acceptance, shared card and turn controls, settings. Birthday stays on screen; only confirmation is saved locally. Optional drinking and consent dares are off initially. Settings apply to a new accepted round, not silently to the existing shared deck.

`gameJson/games.json` is bundled on Android and iOS. Both validate its schema and exchange its SHA-256 hash. The eight categories and 218 party cards are not quiz content. Quick quiz remains a separate shelf choice. Ludo and Chess are still marked Coming soon.

Cards uses LOKA's transport-independent encrypted send/receive, automatic route selection, bounded retries and carry storage. Non-contact permission is limited to recognized game events and saved exact game packets. It never imports a contact or permits non-contact chat. Explicit invitation acceptance authorizes play. See [protocol](../protocol/PARTY-CARDS-V2.md) and [authorization review](../security/PARTY-CARDS-REVIEW.md).

Group size is capped at four devices and each device permits one accepted session. Sessions use small actions, not repeatedly transmitted catalogs. Action IDs, expected revisions, applied acknowledgements, persisted guest proposals and bounded snapshots prevent retries from advancing twice. Hosts pause/resume; they do not migrate. Leaving ends this first-version group. No timed competition or measured-capacity claim.

Automated validation includes Kotlin engine tests, genuine live Kotlin/Swift interoperability in both host directions, non-contact encrypted game scope versus chat, and existing encrypted chat/Quick quiz regressions. Native UI checks and physical results are recorded separately under `experiments/results/2026-10-05-nearby-games/`. Previous Quick quiz UI proof is not Cards proof. The physical Quick quiz attempt was stopped when the requested game scope was corrected.

Physical Cards proof must record actual packet transport, convergence and failures. Being connected by USB or showing a simulator screen does not prove radio delivery. An offline result additionally requires confirmation/evidence that mobile data and Internet uplinks were removed while usable local radios remained enabled.
