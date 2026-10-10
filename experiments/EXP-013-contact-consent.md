# EXP-013 — Reciprocal contact consent

Hypothesis: an authenticated, bounded request/accept/acknowledgement exchange can replace reciprocal manual QR import while preserving explicit approval of new conversations.

## Implemented software experiment

Kotlin `ContactConsentBook` and Swift `ContactConsentBook` implement the [LC1 contract](../protocol/CONTACT-CONSENT-EXPERIMENT.md). The existing packet-v0 envelope is unchanged. The experiment does not change production transport admission or contact storage.

Reproduce on the development Mac:

```sh
cd android/loka-mesh-lab
./gradlew :core:test --no-daemon
cd ../..
sh tests/check-ios-messaging.sh
```

The interoperability runner generates disposable RSA identities in a temporary directory, sends an encrypted Swift request through the actual Java/Kotlin codec, returns an encrypted Android acceptance, and sends an encrypted Swift acknowledgement back. The Java confirmation phase reconstructs test state from the original request; **this is not a persistence/restart test**. Test files are removed after execution and contain no phone identities or conversations.

Both implementations also exercise approval gating, lost replies, duplicate acknowledgements, decline/block, source/deadline binding, malformed inputs and bounded retention. Kotlin additionally checks unsolicited request-ID substitution, self requests and repeated outgoing requests to a peer.

## Remaining physical gate

No physical experiment run. Installed 0.6.13 apps do not use LC1. Before enabling:

1. Implement crash-safe encrypted consent/block storage, admission budgets and native approval screens.
2. Bind profile/key discovery independently of untrusted radio observations; expose people visibility separately from relay participation.
3. Test Android → iPhone, iPhone → Android and Android → Android initiation and acceptance without reciprocal QR import.
4. Drop each response in turn, reconnect, restart either app and verify persistent consent and truthful pending status.
5. Reject stale, blocked and unsolicited requests; verify no personal messages appear before approval.

Measure request latency, time until each side confirms acceptance, retries, bytes, background behavior and restart outcomes. This experiment does not establish radio range, multi-hop delivery or reliable background operation.
