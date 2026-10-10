# Allowance id code (Script B)

Everything here is sandbox: Solana devnet and devnet USDC, which has no monetary value.

The iPhone Pay screen shows "Your allowance id (a sender needs this)" as text and as a QR code. A sender on `zerobars.us/send` enters that id (typed, or read from the code), the server opens a new allowance for the same payer key, and the page shows that allowance's certificate as a QR code for the phone to scan.

## The id code

```
LOKA-ALLOWANCE:<id>
```

- `<id>` is the allowance id as a canonical decimal `u64`, the same form as API-V1's allowance ids: ASCII digits `0` to `9` only, 1 to 20 of them, no sign, no spaces, no thousands separators, and no leading zero except for `0` itself. The value is at most 18446744073709551615.
- The prefix is exact and case-sensitive. A reader may ignore whitespace around the whole text and must refuse everything else.
- The id is the payer's allowance from setup (`POST /v1/payers`), not an allowance imported later, so it stays the same however many senders pay the phone.
- The code is a lookup key only. Nothing in it is signed and it carries no money: the server decides what a send opens, and the phone trusts only the signed certificate it scans back.

Code: `AllowanceIdCode` in `ios/LokaPay/Sources/LokaPay/ImportedAllowances.swift`; round-trip tests in `ios/LokaPay/Tests/LokaPayTests/AllowanceImportTests.swift`.

## The certificate code the phone scans back

The page shows the new allowance as the PAYMENT-V1 section 5 transport text for an allowance wire (section 4.5):

```
L1|P|1|A|<allowance wire in base64url, no padding>
```

The phone adds it only when the server's Ed25519 signature verifies with the pinned key, the program id, cluster id and mint equal the deployment's, the payer key hash equals this phone's payment key hash, and the expiry has not passed on the phone's clock. Otherwise it refuses by name (`import_bad_signature`, `import_other_key`, `import_wrong_program`, `import_wrong_cluster`, `import_wrong_mint`, `import_expired`, `import_malformed`, `import_conflict`) and stores nothing. An added certificate is kept beside the setup allowance, never in its place, and Pay switches to it; after a relaunch Pay starts on the newest unexpired import that has a serial left, and the owner can pick any held allowance. Serials are reserved per allowance id, so a new allowance starts at serial 0 and never shares a counter with another.
