// Site-wide copy and links. Claims follow the code: nothing here describes a
// feature that is not built and tested.

import { DEMO_ALLOWANCE_ID } from "./facts";

// Every payment so far was handed between phones by camera QR, so the sentence says QR code.
export const SENTENCE =
  "When the network or the bank goes down, LOKA Pay lets a phone in airplane mode pay a shop's phone directly, in one hop by QR code, and the shop's phone settles the payment on Solana devnet when it finds signal.";

/** Bluetooth delivery is built, but no payment has gone over it yet: said beside the sentence, never in it. */
export const BLUETOOTH_STATUS = "Bluetooth delivery is built but has not carried a payment yet.";

export const REPO_URL = "https://github.com/StephenSook/loka-pay";

export const CONTACT_EMAIL = "team@zerobars.us";

/** The address /judge's "Watch on your phone" QR code opens on a judge's phone: always the production site. */
export const WATCH_DEMO_URL = `https://zerobars.us/watch?a=${DEMO_ALLOWANCE_ID}`;
