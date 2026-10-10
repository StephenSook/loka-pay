# LOKA Pay settlement API, version 1

Status: draft for the event. Drafted by Claude so the iOS client (task 1.10) and the server (tasks 1.9, 1.9b) can be built at the same time. **Jordan and Pravin own the server and may change anything here**; changes after merge follow the contract rule in `AGENTS.md` (announce in `PLAN.md`, commit subject starts with `⚠️ CONTRACT`).

The signed byte structures are defined in `protocol/PAYMENT-V1.md`. This document only fixes the HTTP and JSON around them. Everything is sandbox: Solana devnet and devnet USDC, which has no monetary value.

## 1. Conventions

- Base URL: `https://api.zerobars.us`. JSON in and out (`Content-Type: application/json`), request bodies at most 4 KB.
- No login, no cookies, no API keys. The server never needs to know who a person is.
- **Bytes** (keys, wires, certificates) are base64url with no padding, the same encoding as the transport in PAYMENT-V1 section 5. The server rejects padding and non-canonical encodings.
- **Hashes** (note id, key hashes) are lowercase hex, 64 characters.
- **Amounts** in mint base units are **decimal strings** (`"1000000"` is $1.00), because a `u64` does not fit a JavaScript number. Fields holding them end in `Units`.
- **Allowance ids** are `u64`, also sent as decimal strings.
- **Times** are unix seconds as JSON numbers. Slots are JSON numbers.
- **Solana transaction signatures** are base58 strings. `explorer` fields are `https://explorer.solana.com/tx/<signature>?cluster=devnet`.
- CORS allows only our web origin and our preview domains. Logging follows `PLAN.md` 6.7: no client IPs, no bodies.

### Errors

Every error is `{ "error": "<name>", "message": "<plain English>" }`.

| HTTP | `error` | When |
|---|---|---|
| 400 | `bad_json` | Body is not JSON or misses a required field |
| 400 | `bad_base64url` | A bytes field is not canonical base64url |
| 400 | `bad_pubkey` | A public key is not a 33-byte compressed P-256 point |
| 400 | `name_length` | Merchant name is not 1 to 64 bytes of UTF-8 after NFC |
| 404 | `unknown_note` | `GET /v1/notes/{noteId}` for a note this server never saw |
| 409 | `registration_failed` | Confirmed failure, with signature, explorer link and bounded retryOf repost instructions; no certificate |
| 409 | `onboarding_already_claimed` | The public key already received its completed onboarding allowance and cannot renew |
| 422 | a PAYMENT-V1 section 6 name, `bad_ack`, `unknown_allowance`, `unknown_merchant` or `payer_mismatch` | The note or ack failed a stateless check or an identity check (section 4) |
| 429 | `rate_limited` | The in-memory burst guard tripped; retry after `Retry-After` seconds |
| 429 | `budget_exhausted` | That wallet's daily budget is spent (team and public pools are separate) |
| 503 | `chain_unavailable` | Devnet RPC failed after retries; nothing was signed; safe to retry |

**A refusal is never signed and never remembered.** The note id covers only the 141 note bytes, not the signature or the ack. If a refusal were signed or cached under that id, anyone who had seen a note (spend markers spread note bytes to nearby merchants) could upload it with a broken signature first and block the genuine upload. So a 422 carries no server signature, binds nothing, and a later upload of the same note is checked from scratch. API v1 never issues a CONF with status 3; that status stays defined in PAYMENT-V1 but unused.

## 2. `POST /v1/payers`: register a payer key and open its allowance

Request:

```json
{ "publicKey": "<base64url, 33-byte compressed P-256 key>" }
```

The server opens an on-chain allowance for that key (`open_allowance`) and signs its certificate. It picks the allowance id uniformly at random from the full `u64` range, never sequentially: the allowance account's address comes from the id alone, so anyone can reserve an id by funding their own allowance first (`programs/README.md`). If `open_allowance` fails because that account already exists, the server picks a new id and retries, and it signs the certificate only after the open transaction confirms. Team devices draw from the table-demo wallet and the demo fee payer; every other key draws from the public-onboarding wallet and the public fee payer, with a smaller cap. The server decides the pool from a list of team key hashes in its own configuration, never from anything in the request.

Idempotent by key: calling again with the same key while its allowance is open returns the same allowance (HTTP 200) instead of opening a second one. A new allowance returns HTTP 201.

Registration pending responses use HTTP 202: `{ "status": "pending", "kind": "payer", "keyHash": "<hex>", "signature": null, "retryAfter": 2 }`. The signature is the saved transaction signature when available. Repost the same request to observe it. Unsigned preparation follows the claim lease. Saved attempts follow the bounded broadcast recovery below. Proven allocation collisions can retry inside the original request; confirmed failures also support the explicit repost below. Confirmed failures follow the explicit bounded repost rule below.

Saved-attempt recovery: after the separate 30 second broadcast lease, a request may resend identical saved bytes at most twice after the original send, only if a history search finds nothing and confirmed height is no greater than the saved last valid height. Ownership is checked immediately before sending. Resends do not sign or reserve again. If an attempt expired and a subsequent history search finds nothing, registration may prepare one replacement per job, with the same plan and allowance id and a new budget reservation. A fenced atomic save consumes that recovery slot; pre-save failures do not. All signatures remain stored. Any found prior result is resolved first; a found signature without a final result blocks replacement. Exhausted recovery remains HTTP 202. Saved settlement replacements use the same exact-byte resend rule but keeps its single replacement and second-expiry rule in section 4.

Confirmed registration failures are recoverable through one explicit repost per job. HTTP 409 registration_failed includes the saved signature, retryable and retryOf. After restoring funding or waiting for budget reset, repost the original publicKey (and name for a merchant) plus retryOf equal to that signature. The server atomically admits the retry, retains the first key, pool, policy, merchant name and all signature history, extending an expired failed payer plan by the same policy lifetime, and fences the old worker. No uncertain signature is eligible. A confirmed collision whose next budget reservation is denied returns this same actionable 409, never indefinite 202. Once the explicit retry is consumed, retryable is false. Unsigned work can still recover through its claim lease. Known unsigned admission failure restores the prior failed response and retry slot. Old reservations are not refunded.

Expiry controls team renewal: only a completed team allowance whose recorded expiry has passed may open a new allowance on a later call. Public onboarding is one completed allowance per key: active repeats return the original certificate without funding again; after expiry a new claim returns unsigned HTTP 409 onboarding_already_claimed. No separate /v1/allowances endpoint is defined. Pending registrations never renew. No cap, serial or redeemed-balance lookup triggers renewal. Daily budgets use UTC days and atomically reserve token deposits, funding-wallet rent and fee-payer lamports before signing. Every collision retry has a separate conservative reservation; reservations are never automatically refunded. Team membership, limits and certificate terms are server configuration.

Response:

```json
{
  "allowanceId": "17",
  "payerKeyHash": "<hex>",
  "pool": "team",
  "capUnits": "5000000",
  "offlineLimitUnits": "2000000",
  "bondUnits": "0",
  "expiry": 1760400000,
  "earmarks": [],
  "allowance": "<base64url allowance wire, PAYMENT-V1 4.5>",
  "openSignature": "<base58>",
  "explorer": "https://explorer.solana.com/tx/<base58>?cluster=devnet"
}
```

- `earmarks` is the list of merchant key hashes in hex, sorted, empty for "any merchant".
- The phone verifies `allowance` with the pinned server key before trusting any number above; the certificate is the source of truth, the JSON fields are for display.
- On the repeat call, `openSignature` and `explorer` name the original open transaction.

## 3. `POST /v1/merchants`: register a merchant key

Request:

```json
{ "publicKey": "<base64url, 33-byte compressed P-256 key>", "name": "Khadim's stall" }
```

The server creates the merchant record on chain (`register_merchant`) if it does not exist and signs the merchant certificate. Idempotent by key; the name in the certificate is the one sent on the first call.

Pending responses have the same shape as payer registration with `kind: "merchant"`; repost to observe the saved signature. Existing on-chain records require verified creation-transaction evidence before a certificate can be issued. Merchant rent and transaction fees consume the selected pool's fee-payer budget, with no funding-wallet transfer.

Response (201 new, 200 existing):

```json
{
  "merchantKeyHash": "<hex>",
  "merchant": "<base64url merchant wire, PAYMENT-V1 4.6>",
  "registerSignature": "<base58>",
  "explorer": "https://explorer.solana.com/tx/<base58>?cluster=devnet"
}
```

## 4. `POST /v1/notes`: settle one note

Request:

```json
{ "note": "<base64url, 238-byte note wire>", "ack": "<base64url, 153-byte ack wire>" }
```

- `ack` is what the merchant normally sends. It is optional so a payer phone (the Sat 3 AM checkpoint) or a stranger (task 3.29) can settle a note without one; the chain does not need it. Without it, no "held offline" time exists for that note.
- The server runs the note through PAYMENT-V1 section 6 in order. A failure is HTTP 422 named by that check (`length`, `prefix`, `cluster`, `currency`, `amount_zero`, `wrong_program`, `wrong_mint`, `bad_pubkey`, `high_s`, `bad_signature`). A note shorter than 141 bytes has no note id, which is fine: a 422 does not need one.
- When `ack` is present, the server then checks it: its signature verifies, its note id equals the note's id, and its key hash equals the note's payee key hash. A bad ack is HTTP 422 `bad_ack`. A valid note with a bad ack is refused rather than settled without the ack, so the caller learns its ack is broken.
- Then the identity checks, before the note id is claimed or anything is sent: the allowance account for the note's allowance id must exist (else 422 `unknown_allowance`), the merchant record for its payee key hash must exist (else 422 `unknown_merchant`), and the note's payer key must equal the allowance's stored payer key (else 422 `payer_mismatch`). Neither the allowance's payer key nor the existence of a record changes once created, so the server may cache them. Without the payer check, anyone who had seen a note could re-sign its 141 bytes with their own key: the chain would reject that wire, and its failed decision would be cached under the genuine note's id and block the real payment. Found by the Codex review of #19.
- **The server does not pre-check spend state** (used serial, cap, expiry, earmark). The identity checks above are not spend state: the genuine payer's reused serial still reaches the chain. Those are the chain's job, so a reused serial is sent with preflight skipped and lands as a failed transaction with the program's named error and its own explorer link (task 2.13).
- The server reads the allowance and merchant accounts and checks their owners, discriminators and stored identities. An RPC failure returns an unsigned HTTP 503 and nothing is claimed.

A decided-note replay still passes note, ACK and payer-binding validation, then reads the journal before the per-allowance limiter. It returns the existing decision without consuming upload quota. Pending and new submissions still count.

Only an outcome on chain is final. Except for the late original-signature rule below, once a note id has a decision (`settled` or `failed`), every later upload of that note id returns that decision with `replayed: true` and sends nothing new to the chain. A later upload may attach a valid ack the first one lacked; the server stores it for the timing figures, and attaching an ack never changes the decision or the CONF.

GET recovery retains an accepted unsigned note when fee admission is denied or uncertain, returning HTTP 202 pending instead of deleting its journal entry. Later GETs can recover after lease expiry and budget reset; the original upload time and ACK remain recorded. An initial unsigned POST budget refusal remains HTTP 429.

**One attempt per note id.** The server holds at most one in-flight attempt for a note id (for example a lock or a unique row keyed by note id):

- A second upload while the first is in flight does not build a second transaction. It answers HTTP 202 with the pending body in section 5, and the client polls `GET /v1/notes/{noteId}`.
- Confirmed transaction failures outside the redeem_note Custom u16 range return status failed, error TransactionFailed and errorCode null. CONF uses failed status with code 0 meaning no representable redeem_note code. A signature without confirmed metadata, slot or block time remains pending. No numeric program error is invented.
- Settlement fees use a required configured dailyLamports cap per fee payer and shared-clock UTC day, atomically reserved before signing the exact quoted unsigned transaction. Original budget exhaustion returns unsigned HTTP 429 budget_exhausted and releases its unsigned claim. Replacement exhaustion stays pending with the saved signature. Fresh transactions reserve again; exact-byte resends do not. Reservations are never automatically refunded. Unknown admission outcomes do not sign.
- An unsigned note claim can recover through POST or GET after its 30 second fenced lease. GET revalidates the stored note, ACK and payer identity and preserves the original upload time. Before lease expiry it returns pending with a null signature. Only the token owner may save and broadcast. GET does not consume upload quota.
- The server records each signature before sending. One rebuild is allowed only after the confirmed block height is strictly past the original last valid block height and a subsequent `getSignatureStatuses` lookup with `searchTransactionHistory: true` finds nothing. Workers prepare before one compare-and-set claims and saves the replacement. Preparation or a failed save before that durable write does not consume the rebuild. Only the worker whose save succeeds may send. Both signatures remain stored, and a second expiry stays pending. A found signature without final metadata does not permit rebuilding. If the original signature is found later, its result takes precedence, including over a recorded replacement result. This is the only exception to the otherwise immutable decision rule.
- Two gateways uploading the same note together therefore share one attempt and both end with the same CONF.

Response, HTTP 200 once the chain has decided:

```json
{
  "noteId": "<hex>",
  "status": "settled",
  "error": null,
  "errorCode": 0,
  "conf": "<base64url, 203-byte conf wire, PAYMENT-V1 4.3>",
  "signature": "<base58>",
  "slot": 412345678,
  "blockTime": 1760312345,
  "uploadedAt": 1760312344,
  "explorer": "https://explorer.solana.com/tx/<base58>?cluster=devnet",
  "replayed": false
}
```

| `status` | CONF status byte | `signature` / `explorer` | `error` |
|---|---|---|---|
| `settled` | 1 | the redeem transaction | `null` |
| `failed` | 2 | the failed transaction (opens on the explorer) | the redeem_note error name and code, or `TransactionFailed` with `errorCode: null` when unavailable |

The phone shows a status only from the verified `conf` bytes, never from these JSON fields (PAYMENT-V1 4.9).

## 5. `GET /v1/notes/{noteId}`

- HTTP 200 with the section 4 body once the chain has decided.
- HTTP 202 while an attempt is in flight:

  ```json
  { "noteId": "<hex>", "status": "pending", "signature": "<base58 or null>", "retryAfter": 2 }
  ```

  `signature` is the in-flight transaction once it has been sent, so a judge can watch it on the explorer. Clients poll after `retryAfter` seconds, backing off to at most 10 seconds between polls.
- HTTP 404 `unknown_note` for a note id this server has never attempted. A note that was only ever refused is unknown, by design (section 1).

Phones use this to recover a confirmation after a dropped connection; the merchant can also read the redemption record straight from the chain (task 3.29).

## 6. `GET /api/health`

```json
{ "ok": true, "commit": "<git sha>", "cluster": "devnet", "programId": "<base58>", "slot": 412345678 }
```

`slot` is read live from the RPC on each call, so a judge can see the server is talking to devnet. `ok` is false (HTTP 503) when the RPC cannot be reached.

## 7. Tests that hold both sides to this

- Server (task 1.9): an integration test posts a vector note and checks the response shape above; a second post returns `replayed: true` with the same `conf`; a tampered note returns HTTP 422 named by the failed check with no `conf`; posting the same note first with a broken signature and then intact still settles it; two concurrent posts of one note produce exactly one transaction and the same `conf`.
- iOS (task 1.10): the client decodes a recorded response from the deployed server and verifies `conf` and `allowance` with the pinned key.
