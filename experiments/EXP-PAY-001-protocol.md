# EXP-PAY-001 session protocol (PLAN.md task 3.6)

How the team runs tonight's real-run measurement session, so the headline in `docs/FACTS.json` (`zero_bar_payments_settled` of `zero_bar_payments_tried`, PLAN.md 0B.3) comes from real phone payments in one frozen window, each with an explorer link, and anyone can recompute it.

- Owner: Khadim, with everyone (PLAN.md 3.6). The fill PR at the end is reviewed by Khadim and Stephen (0B.3).
- Everything is sandbox: Solana devnet and devnet USDC, which has no monetary value.
- Recompute tool: `tools/measure/exp_pay_001.py` (Python 3 standard library, no key needed).

## 1. The window

| | ET | unix seconds |
|---|---|---|
| Opens | Sat Oct 10 4:15 PM | 1791663300 |
| Closes | Sat Oct 10 11:59 PM (PLAN.md 3.6: "window frozen 11:59 PM") | 1791691140 |

- The window is on the server's upload clock: the moment the merchant phone's upload reached `api.zerobars.us` (the `uploadedAt` in the server-signed confirmation). That is the clock `RUNS` in `server/src/events/runs.ts` and `GET /api/stats?run=EXP-PAY-001` use. A note signed at 11:58 PM whose merchant uploads at 12:01 AM is outside the window.
- Opening at 4:15 PM includes the two iPhone payments already on devnet (4:23 PM, serial 0, and 5:05 PM, serial 1) and their two refused cheats. They count only if the attempt log (section 5) can list every try since 4:15 PM, failures included, from the team's notes and recordings, and only as rows with airplane_mode `y` where the payer phone really was in airplane mode. If it cannot, open the window at Sat Oct 10 9:00 PM ET (unix 1791680400) instead. Decide before 9 PM and write the decision at the top of the log. Whichever is chosen, the same two numbers go into the script and into `RUNS`.

## 2. Phones and who pays whom

From PLAN.md 1.10 and 4.10: Stephen's iPhone is registered as merchant "OWLS Table" and Jordan's as "OWLS Table B", both on TestFlight build 4, and each phone opened its own payer allowance at onboarding. Fill the table before the first payment. Add a phone only after it runs build 4, installed in place (4.10), and has finished Set up payments (sandbox).

| Label | Holder | Build | Merchant name | Payer allowance id (Pay screen) | Payer key hash (for `--phone`) |
|---|---|---|---|---|---|
| A | Stephen | 4 | OWLS Table | | |
| B | Jordan | 4 | OWLS Table B | 10652706154269594633 (from the 4:23 PM payment) | |
| C | | | | | |
| D | | | | | |

The payer key hash is what lets the script match a log row that has no note id (section 5). The Pay screen shows the allowance number, not the key hash, so read it from the draft: run the script once (section 7), find the phone's payment under "Not in the attempt log, excluded", check that its allowance equals "Allowance #" on that phone's Pay screen, and copy its payer key hash. Phone B's is on the 4:23 PM payment.

Rotation:

- Every payment crosses two different phones. No phone pays itself.
- With two phones, alternate: B pays A, then A pays B. With more, rotate so each payer pays at least two different merchants.
- Target: at least 10 real payments plus 2 refused cheats inside the window.
- Before starting, read each payer's cap on its Pay screen ("Up to $X sandbox"). Allowance 10652706154269594633 already settled $0.50 (two $0.25 payments). Ten more payments at $0.05 add $0.50; stop paying from an allowance that would pass its cap.

## 3. One payment, step by step

1. Payer phone: airplane mode on. Cellular and Wi-Fi off; the status bar shows the airplane, no bars. For the Bluetooth path, turn Bluetooth back on inside airplane mode.
2. Merchant phone: airplane mode on as well.
3. Payer: Pay, then "Scan merchant code", amount **$0.05** (50000 base units, PLAN.md 3.6), sign.
4. Transport, one of:
   - **Bluetooth**: "Send both over Bluetooth", only if the build shows it. If the screen says "Bluetooth sending is not connected in this build. Use the codes.", use the camera.
   - **Camera**: show code 1 (Allowance), then code 2 (Payment note), to the merchant's camera.
5. Merchant: shows "Received" while still offline. Note the time.
6. Merchant: airplane mode off, Settle, wait for Paid (sandbox). Note the time. If it stops on Check again, write that down and tap Check again.
7. Write the log row (section 5) before starting the next payment, with the serial from the receipt ("Serial N of allowance #X").

## 4. The two refused cheats

After a payment settles, on the payer phone: "Try to cheat (sandbox demo)", "Scan merchant B's code" (a different merchant from the payment's), then show code 1 and code 2 (Cheat note) to merchant B. Merchant B goes online and settles. Expected: refused by Solana, SerialUsed (6011), a failed transaction with its own explorer link. Log each cheat as its own row with `cheat` set to `y`. Cheats never count in the headline denominator (`docs/FACTS.json`: deliberate cheats excluded); the script lists them separately.

## 5. Attempt log: every try, failures included

The chain only sees payments that reached it, and the script counts only what this log lists. A payment on chain that is not in the log is excluded from the headline and listed under "Not in the attempt log, excluded" with its signature: a teammate testing on Wi-Fi, a rehearsal, a phone's first payment. A try that failed earlier (a scan that did not read, a crash, a wrong amount, a merchant that never went online) is still a row: the draft lists it under "Tried, never reached the chain", and it counts in `zero_bar_payments_tried`.

The log is one CSV file, `experiments/EXP-PAY-001-attempts.csv` (or a `.json` list of objects with the same fields), one row per try, phone labels only. Names stay on paper or in a private shared note and never go in this file; a volunteer appears only as "volunteer, consent #N". The header row:

```csv
time,payer_phone,merchant_phone,airplane_mode,transport,note_id,serial,cheat
```

| Column | Required | Value |
|---|---|---|
| `time` | yes | When the merchant phone showed Paid (sandbox), or when the try ended. ISO 8601; no offset means ET, for example `2026-10-10 21:04`. |
| `payer_phone` | yes | Label from section 2. |
| `merchant_phone` | yes | Label from section 2. |
| `airplane_mode` | yes | `y` if the payer phone was in airplane mode with no bars when it signed, else `n`. |
| `transport` | yes | `bt` or `camera`. |
| `note_id` | no | The 64-hex note id, when it is known. |
| `serial` | no, but a row with no note id needs it | From the receipt: "Serial N of allowance #X". |
| `cheat` | no | `y` for a section 4 cheat, else `n` or empty. |

Other columns (amount, received time, failure and reason, volunteer consent #) are for people; the script ignores them.

How the script uses the log:

- A row matches the on-chain payment with its note id. With no note id, it matches by the payer phone's key hash (`--phone`, section 2) plus serial plus a block time within 120 seconds of the row's time. When a payment and its cheat both fit, the `cheat` column picks one.
- Only a matched row with airplane_mode `y` counts. The headline denominator is the number of matched rows with airplane_mode `y` (cheats excluded). A matched row with `n` is excluded and listed under "In the attempt log with airplane_mode n".
- Two rows that describe one payment, a row that fits two payments, and a row with a serial but no note id whose payer phone has no `--phone` fail the checks (exit 2), so a person decides. A row with neither a note id nor a serial cannot match and is listed under "Tried, never reached the chain".
- No `--attempt-log`, or a row the script cannot read (airplane_mode not `y` or `n`, transport not `bt` or `camera`, a time it cannot parse), stops the run with exit 64 and nothing is written.

Zero bars is not on chain. The airplane-mode column, plus a screen recording or photo of the payer's status bar where possible, is the evidence for "made with zero bars".

## 6. Volunteers

- Any non-team person who holds a phone, pays, or appears on camera signs a written consent first: a sandbox payment demo with no real money, their hands or voice may appear in a recording, and their name is never published. Forms stay off the repo. The log records only "volunteer, consent #N".
- Volunteers use team phones: build 4 is distributed only to the team's internal TestFlight group, so nothing is installed on a volunteer's phone.
- Check the venue's recording rules before filming anyone.

## 7. Running the script

During the session, any time, to watch the counts (a cache directory outside the repo keeps repeat runs fast, since finalized transactions never change):

```sh
python3 tools/measure/exp_pay_001.py --from 1791663300 --to now \
  --attempt-log experiments/EXP-PAY-001-attempts.csv --phone A=<payer key hash> --phone B=<payer key hash> \
  --cache /tmp/exp-pay-001-cache
```

After the window closes and the last upload has settled:

```sh
python3 tools/measure/exp_pay_001.py --from 1791663300 --to 1791691140 \
  --attempt-log experiments/EXP-PAY-001-attempts.csv --phone A=<payer key hash> --phone B=<payer key hash> \
  --cache /tmp/exp-pay-001-cache
```

- Exit 0: every check passed. Exit 2: open the draft and read "Checks FAILED" at the top before using any number. Exit 1: a fetch failed and nothing was written; run it again. Exit 64: no attempt log, or a log row it cannot read; nothing was written.
- Output: `experiments/EXP-PAY-001.draft.md` and `experiments/EXP-PAY-001.draft.json` (every signature the scan read). Both are gitignored: they are inputs to the fill PR, never committed as they are.
- The draft's headline reads "S of N settled", where N is the matched attempt-log rows with airplane_mode `y`. Beside it the draft lists every in-window payment that is not in the log, every logged payment with airplane_mode `n`, and every log row that never reached the chain.
- A payment under "Not in the attempt log, excluded" that should count means a missing or wrong log row: fix the row (add its note id or serial) and run again. Never move a payment into the headline by hand.
- The public devnet RPC answers HTTP 429 with a 10 second Retry-After; the script waits and retries. `--rpc <url>` takes a private devnet RPC. Never paste a private RPC URL into the repo or a PR; the script prints it as a placeholder.
- The 2:01 AM test key (`docs/FACTS.json` `proof_pair_settled_tx`) is excluded automatically. Any other software-key or canary payer that redeems inside the window goes on the command line as `--exclude-payer-of-tx <one of its redeem signatures>` or `--exclude-payer <payer key hash>`.

## 8. The fill PR (after the window closes)

One reviewed PR (Khadim and Stephen), for example "feat(facts): EXP-PAY-001 window, report and headline (3.6)":

1. `server/src/events/runs.ts`: `RUNS['EXP-PAY-001'] = { from: <unix>, to: <unix> }`, the same two numbers passed to the script.
2. `experiments/EXP-PAY-001-attempts.csv`: the attempt log the script read (labels, no names), so the recompute command runs for anyone.
3. `experiments/EXP-PAY-001.md`: the draft's tables, the window decision from section 1, the recompute command, and one line for every payment under "Not in the attempt log, excluded" or "airplane_mode n" saying what it was (for example "Wi-Fi test before the session"). None of them is moved into the headline.
4. `docs/FACTS.json`:
   - `zero_bar_payments_settled`: the draft's "Settled on Solana (headline numerator)" count, status `measured`, `as_of` the window close.
   - `zero_bar_payments_tried`: the draft's headline denominator (matched attempt-log rows with airplane_mode `y`) plus its "Tried in the window with airplane_mode y, never reached the chain" count. Cheats are already excluded from both.
5. After merge and the server deploy: `curl -s 'https://api.zerobars.us/api/stats?run=EXP-PAY-001'`. The server counts every payment in the window, logged or not, so its first field, `paymentsSettled`, must equal the draft's "Settled in the window, logged or not" count; the gap between that and `zero_bar_payments_settled` is the settled payments the draft lists as not in the log or logged with airplane_mode `n`. If they differ, the value does not ship until the difference is explained (for example a payer the server tags `canary` that the script was not told to exclude).
6. Only then do the README, `/judge`, the video and Devpost show the number, read from `docs/FACTS.json`.
