# /call in Wolof: the script Khadim writes (PLAN.md 3.89)

The phone call on `/call` speaks English or French today. Wolof is wired in and switched off until Khadim, a native speaker, writes the words and rates a real test call. This page lists every English piece to translate, what each slot means, and the steps to turn Wolof on.

**Rule: only Khadim writes Wolof.** Nobody else writes, guesses or machine-translates a Wolof sentence: not in the code, not in the tests, not on this page. The unit tests use bracketed placeholder tokens such as `[hello]`, never Wolof.

## Where the text goes

One block in one file: `web/lib/call-wolof.ts`, the constant `WOLOF_SCRIPT`, between the lines `KHADIM FILLS IN THIS BLOCK` and `End of the block Khadim fills in`. Nothing else has to change for the words to reach the call.

## How the call is put together

The call is six sentences joined by spaces. The third sentence has two slots, `{amount}` and `{ago}`, filled from the amount and time phrases further down. A slot is a name in braces. Write it exactly as shown, wherever Wolof word order needs it in the sentence.

Worked example in English, for a payment of 2.50 sandbox USDC settled 3 minutes ago:

- `{amount}` comes from `dollarsAndCents`, with `{dollars}` = `dollars` filled with n = 2 ("2 dollars") and `{cents}` = `cents` filled with n = 50 ("50 cents"): "2 dollars and 50 cents".
- `{ago}` comes from `minutes` filled with n = 3: "3 minutes ago".
- `paymentSettled` then reads: "A sandbox payment of 2 dollars and 50 cents was settled on Solana devnet 3 minutes ago."

## The six sentences (`sentences`)

Copied from the English branch of `speechFor` in `web/lib/call-speech.ts`.

| Field | English | Slots |
|---|---|---|
| `hello` | Hello. | none |
| `whoIsCalling` | This is an automated demo call from LOKA Pay at the Hacklanta hackathon, asked for on zerobars dot U S. | none |
| `paymentSettled` | A sandbox payment of {amount} was settled on Solana devnet {ago}. | needs `{amount}` and `{ago}` |
| `signatureChecked` | Before paying the shop, the chain checked the payer's signature. | none |
| `testMoney` | This is test money with no real value. | none |
| `goodbye` | Goodbye. | none |

Keep these names as they are spoken: LOKA Pay, Hacklanta, Solana devnet, and "zerobars dot U S" (the site's address read out). The call must still say that the payment is a sandbox payment in test money with no real value, as every money screen in LOKA Pay does.

## The amount (`amount`)

The amount is sandbox USDC, read as dollars and cents. A fraction of a cent is rounded to the nearest cent.

| Field | English | Used when | Slots |
|---|---|---|---|
| `lessThanOneCent` | less than 1 cent | the amount rounds to 0 cents | none |
| `oneDollar` | 1 dollar | exactly 1 dollar | `{n}` optional (it is 1) |
| `dollars` | {n} dollars | 2 dollars or more | needs `{n}` |
| `oneCent` | 1 cent | exactly 1 cent | `{n}` optional (it is 1) |
| `cents` | {n} cents | 2 to 99 cents | needs `{n}` |
| `dollarsAndCents` | {dollars} and {cents} | both dollars and cents | needs `{dollars}` and `{cents}`, each already filled from the four rows above |
| `about` | about {amount} | the amount was rounded | needs `{amount}`, the whole phrase built from the rows above |

More examples, in English:

- 10 cents: `cents` with n = 10.
- 1 dollar and 1 cent: `dollarsAndCents` holding `oneDollar` and `oneCent`.
- 1.234567 USDC: `about` around `dollarsAndCents` ("about 1 dollar and 23 cents").
- 0.000004 USDC: `lessThanOneCent`, with no "about".

If Wolof does not change the noun for one, write the same pattern in `oneDollar` and `dollars` (and in `oneCent` and `cents`).

## How long ago (`ago`)

Minutes under 2 hours, hours under 2 days, then days. Hours and days never come as 1, so they have no "one" form.

| Field | English | Used when | Slots |
|---|---|---|---|
| `lessThanAMinute` | less than a minute ago | under 1 minute | none |
| `oneMinute` | 1 minute ago | exactly 1 minute | `{n}` optional (it is 1) |
| `minutes` | {n} minutes ago | 2 to 119 minutes | needs `{n}` |
| `hours` | {n} hours ago | 2 to 47 hours | needs `{n}` |
| `days` | {n} days ago | 2 days or more | needs `{n}` |

## Numbers (`numberWords`)

By default each `{n}` gets the number as digits, for example `12`, and the voice reads the digits. Leave `numberWords` empty at first. If the test call reads the digits badly (in French or English instead of Wolof, for example), add your word for each number the call can say, keyed by its digits:

```ts
numberWords: { "1": "<your word for 1>", "2": "<your word for 2>" },
```

Numbers the call can say: dollars from 1 up, cents 1 to 99, minutes 1 to 119, hours 2 to 47, days 2 up. A number missing from the table still goes in as digits.

## The menu label (`optionLabel`)

What the `/call` language menu shows for Wolof, written the way Wolof speakers name their language.

## What the code checks

`wolofScriptProblems()` in `web/lib/call-wolof.ts` lists everything missing or wrong, and CI fails on a half-filled script with that list:

- every field is filled;
- every slot a field needs is there, and it has no slot it does not take;
- no em dash or en dash, and no brace outside a slot;
- `numberWords` keys are digits (`"12"`, not `"012"`), each with a word and no slot.

Until the script passes, the server refuses `lang: "wo"` with `400 bad_lang` and the call can never speak Wolof.

## What the code sends to ElevenLabs

A Wolof call uses the same voice and model as English and French (`eleven_v4`) and adds `language_code: "wo"`, the ISO 639-1 code for Wolof. The ElevenLabs text-to-speech reference describes `language_code` as an optional ISO 639-1 code used "to enforce a language for the model and text normalization" (https://elevenlabs.io/docs/api-reference/text-to-speech/convert), and the models page lists Wolof (wol) among the Eleven v4 languages (https://elevenlabs.io/docs/overview/models). Both were read on 2026-10-10. English and French requests are unchanged and send no language code.

Nobody has heard a Wolof call from this code yet. Whether the voice is understandable is what step 4 checks. The voice is the ElevenLabs premade voice set in `web/lib/call-server.ts` unless `LOKA_ELEVENLABS_VOICE_ID` names another; changing it changes the voice for every language.

## Steps for Khadim

1. Branch from `main` and open `web/lib/call-wolof.ts`. Fill every field of `WOLOF_SCRIPT` in one change. Leave `WOLOF_REVIEWED_BY_NATIVE_SPEAKER = false`.
2. Check the script:

   ```sh
   cd web && pnpm install --frozen-lockfile && pnpm test:unit -g Wolof
   ```

   The test "the shipped script is untouched or complete" prints anything still missing. Once it passes, the test "Wolof preview" prints the full text of the call for six sample payments. Read them the way a listener would hear them.
3. Open a pull request with that one file. Once it is merged and deployed, the server takes `lang: "wo"`, and the `/call` page still shows only English and French.
4. Place one real test call to your own phone. A payment must have settled that your number has not been called about yet (one call per number for each payment; the other limits are on the `/call` page). Replace the X's with your 10 digits and use the desk code from the LOKA Pay table:

   ```sh
   curl -sS -X POST https://zerobars.us/api/call \
     -H 'content-type: application/json' \
     --data '{"to":"+1XXXXXXXXXX","lang":"wo","code":"DESK_CODE"}'
   ```

   The answer starts with `{"status":"calling"` and your phone rings. Listen to the whole call. Is every sentence understandable to a Wolof speaker? Are the amount and the time right?
5. If you rate it understandable, open a second pull request that sets `WOLOF_REVIEWED_BY_NATIVE_SPEAKER = true`, with the date of the test call and your rating in its description. CI refuses the gate on an incomplete script. Once it deploys, `/call` shows Wolof in the language menu. If it is not understandable, change the sentences (or add `numberWords`, or try another voice) and repeat steps 2 to 4 before setting the gate.

## Until the gate is set

Judge-facing copy does not mention Wolof calls: claims follow the code (AGENTS.md). Once `/call` shows Wolof, the copy may say so.
