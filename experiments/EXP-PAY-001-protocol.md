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
- Opening at 4:15 PM includes the two iPhone payments already on devnet (4:23 PM, serial 0, and 5:05 PM, serial 1) and their two refused cheats. They count only if the attempt log (section 5) can list every try since 4:15 PM, failures included, from the team's notes and recordings. If it cannot, open the window at Sat Oct 10 9:00 PM ET (unix 1791680400) instead. Decide before 9 PM and write the decision at the top of the log. Whichever is chosen, the same two numbers go into the script and into `RUNS`.

## 2. Phones and who pays whom

From PLAN.md 1.10 and 4.10: Stephen's iPhone is registered as merchant "OWLS Table" and Jordan's as "OWLS Table B", both on TestFlight build 4, and each phone opened its own payer allowance at onboarding. Fill the table before the first payment. Add a phone only after it runs build 4, installed in place (4.10), and has finished Set up payments (sandbox).

| Label | Holder | Build | Merchant name | Payer allowance id (Pay screen) |
|---|---|---|---|---|
| A | Stephen | 4 | OWLS Table | |
| B | Jordan | 4 | OWLS Table B | 10652706154269594633 (from the 4:23 PM payment) |
| C | | | | |
| D | | | | |

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
7. Write the log row (section 5) before starting the next payment.

## 4. The two refused cheats

After a payment settles, on the payer phone: "Try to cheat (sandbox demo)", "Scan merchant B's code" (a different merchant from the payment's), then show code 1 and code 2 (Cheat note) to merchant B. Merchant B goes online and settles. Expected: refused by Solana, SerialUsed (6011), a failed transaction with its own explorer link. Log each cheat with "cheat: yes". Cheats never count in the headline denominator (`docs/FACTS.json`: deliberate cheats excluded); the script lists them separately.

## 5. Attempt log: every try, failures included

The chain only sees payments that reached it. A try that failed earlier (a scan that did not read, a crash, a wrong amount, a merchant that never went online) is still a row, and it counts in `zero_bar_payments_tried`.

Keep the log live on paper or in a private shared note while it can hold names. It reaches the repo only in the fill PR, as `experiments/EXP-PAY-001.md`, with phone labels instead of names.

| # | Time ET | Payer | Merchant | Airplane mode on payer (y/n) | Transport | Amount | Received shown | Paid shown (time) | Explorer link or note id if shown | Failure and reason | Cheat | Volunteer (consent #) |
|---|---|---|---|---|---|---|---|---|---|---|---|---|

Zero bars is not on chain. The airplane-mode column, plus a screen recording or photo of the payer's status bar where possible, is the evidence for "made with zero bars".

## 6. Volunteers

- Any non-team person who holds a phone, pays, or appears on camera signs a written consent first: a sandbox payment demo with no real money, their hands or voice may appear in a recording, and their name is never published. Forms stay off the repo. The log records only "volunteer, consent #N".
- Volunteers use team phones: build 4 is distributed only to the team's internal TestFlight group, so nothing is installed on a volunteer's phone.
- Check the venue's recording rules before filming anyone.

## 7. Running the script

During the session, any time, to watch the counts (a cache directory outside the repo keeps repeat runs fast, since finalized transactions never change):

```sh
python3 tools/measure/exp_pay_001.py --from 1791663300 --to now --cache /tmp/exp-pay-001-cache
```

After the window closes and the last upload has settled:

```sh
python3 tools/measure/exp_pay_001.py --from 1791663300 --to 1791691140 --cache /tmp/exp-pay-001-cache
```

- Exit 0: every check passed. Exit 2: open the draft and read "Checks FAILED" at the top before using any number. Exit 1: a fetch failed and nothing was written; run it again.
- Output: `experiments/EXP-PAY-001.draft.md` and `experiments/EXP-PAY-001.draft.json` (every signature the scan read). Both are gitignored: they are inputs to the fill PR, never committed as they are.
- The public devnet RPC answers HTTP 429 with a 10 second Retry-After; the script waits and retries. `--rpc <url>` takes a private devnet RPC. Never paste a private RPC URL into the repo or a PR; the script prints it as a placeholder.
- The 2:01 AM test key (`docs/FACTS.json` `proof_pair_settled_tx`) is excluded automatically. Any other software-key or canary payer that redeems inside the window goes on the command line as `--exclude-payer-of-tx <one of its redeem signatures>` or `--exclude-payer <payer key hash>`.

## 8. The fill PR (after the window closes)

One reviewed PR (Khadim and Stephen), for example "feat(facts): EXP-PAY-001 window, report and headline (3.6)":

1. `server/src/events/runs.ts`: `RUNS['EXP-PAY-001'] = { from: <unix>, to: <unix> }`, the same two numbers passed to the script.
2. `experiments/EXP-PAY-001.md`: the draft's tables, the attempt log (labels, no names), the window decision from section 1, and the recompute command.
3. `docs/FACTS.json`:
   - `zero_bar_payments_settled`: the draft's "Settled on Solana" count, status `measured`, `as_of` the window close.
   - `zero_bar_payments_tried`: the draft's "reached Solana" count plus every attempt-log try that never reached the chain, cheats excluded.
4. After merge and the server deploy: `curl -s 'https://api.zerobars.us/api/stats?run=EXP-PAY-001'`. Its first field, `paymentsSettled`, must equal `zero_bar_payments_settled`. If they differ, the value does not ship until the difference is explained (for example a payer the server tags `canary` that the script was not told to exclude).
5. Only then do the README, `/judge`, the video and Devpost show the number, read from `docs/FACTS.json`.
