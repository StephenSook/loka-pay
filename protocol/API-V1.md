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
| 429 | `rate_limited` | The in-memory burst guard tripped; retry after `Retry-After` seconds |
| 429 | `budget_exhausted` | That wallet's daily budget is spent (team and public pools are separate) |
| 503 | `chain_unavailable` | Devnet RPC failed after retries; nothing was signed; safe to retry |

A note the server refuses for a protocol reason is **not** an HTTP error: it returns 200 with a signed confirmation whose status is 3 (section 4).

## 2. `POST /v1/payers`: register a payer key and open its allowance

Request:

```json
{ "publicKey": "<base64url, 33-byte compressed P-256 key>" }
```

The server opens an on-chain allowance for that key (`open_allowance`) and signs its certificate. It picks the allowance id. Team devices draw from the table-demo wallet and the demo fee payer; every other key draws from the public-onboarding wallet and the public fee payer, with a smaller cap. The server decides the pool from a list of team key hashes in its own configuration, never from anything in the request.

Idempotent by key: calling again with the same key while its allowance is open returns the same allowance (HTTP 200) instead of opening a second one. A new allowance returns HTTP 201.

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
- When `ack` is present, the server checks it before anything else: its signature verifies, its note id equals the note's id, and its key hash equals the note's payee key hash. A bad ack is a status 3 refusal with `error: "bad_ack"`.

The server runs the note through PAYMENT-V1 section 6 in order. A failure there is a status 3 refusal named by that check (`length`, `prefix`, `cluster`, `currency`, `amount_zero`, `wrong_program`, `wrong_mint`, `bad_pubkey`, `high_s`, `bad_signature`). **The server does not pre-check state** (used serial, cap, expiry, earmark). Those are the chain's job, so a reused serial is sent with preflight skipped and lands as a failed transaction with the program's named error and its own explorer link (task 2.13).

Idempotent by note id: a note the server has already decided returns the first decision with `replayed: true` and sends nothing new to the chain.

Response, always HTTP 200 once the server has decided:

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
| `failed` | 2 | the failed transaction (opens on the explorer) | the program's error name, `errorCode` its number |
| `refused` | 3 | `null` | the check that failed |

The phone shows a status only from the verified `conf` bytes, never from these JSON fields (PAYMENT-V1 4.9).

## 5. `GET /v1/notes/{noteId}`

Returns the same body as section 4 for a note this server has decided, or 404 `unknown_note`. Phones use it to recover a confirmation after a dropped connection; the merchant can also read the redemption record straight from the chain (task 3.29).

## 6. `GET /api/health`

```json
{ "ok": true, "commit": "<git sha>", "cluster": "devnet", "programId": "<base58>", "slot": 412345678 }
```

`slot` is read live from the RPC on each call, so a judge can see the server is talking to devnet. `ok` is false (HTTP 503) when the RPC cannot be reached.

## 7. Tests that hold both sides to this

- Server (task 1.9): an integration test posts a vector note and checks the response shape above, a second post returns `replayed: true` with the same `conf`, and a tampered note returns status `refused` with the section 6 name.
- iOS (task 1.10): the client decodes a recorded response from the deployed server and verifies `conf` and `allowance` with the pinned key.
