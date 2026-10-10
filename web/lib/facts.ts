// Dated facts the judge pages state that no API can read for them. Each says where it
// came from; anything the chain or GitHub can answer is read live instead (lib/chain.ts,
// lib/github.ts).

/**
 * The initialize_vault transaction, from the devnet deploy log (PLAN.md 1.4). The pages do
 * not trust this string: lib/chain.ts reads the transaction from devnet and shows its slot,
 * block time, result and the instruction its logs name.
 */
export const INIT_TX_SIGNATURE =
  "2y4go46y25K6yMnSc4eVZCtbs3nKQzubb6Qr2Byp6piXGuCMWniaiL2aVBsrfMkAxUfJ9odVNcKKpqG3g4EraT4R";

/**
 * The first real settled redeem_note on devnet, Sat Oct 10 2:01 AM ET: the "settled payment"
 * link in the repository README ("First real payment and refused cheat on devnet", commit
 * b8a79b0, PLAN.md 1.4). Checked against devnet with getTransaction: loka_vault logged
 * "Instruction: RedeemNote" and the transaction succeeded. /proof links it as the evidence
 * that a note has been redeemed, because a single transaction cannot scroll away the way
 * /live's newest rows do.
 */
export const FIRST_REDEEM_TX_SIGNATURE =
  "5tEKu2mtrdzu9hVaXCmkGyq9Y6mTobNVBmVx5ji59hku2bf28E3okmJatw7WbPRqfHHpLf9wyC1SbjwU3PWD5rAa";

/** iOS status (PLAN.md 1.11): App Store Connect read betaReviewState WAITING_FOR_REVIEW, submitted 12:05:42 AM ET. */
export const TESTFLIGHT_STATUS =
  "TestFlight build 1 submitted to Apple beta review Sat Oct 10 12:05 AM ET; the public link appears here once Apple approves";
export const TESTFLIGHT_STATUS_AS_OF = "2026-10-10";

/** The hacking window opened Fri Oct 9 8:08 PM ET (organizers' announcement, PLAN.md). */
export const HACKING_STARTED = "since hacking started, Fri Oct 9 8:08 PM ET";

/** The pre-event kit tag: everything after it was written during the event. */
export const KIT_TAG = "pre-hacklanta-kit";

/** The 2-of-3 multisig upgrade authority is planned (PLAN.md 3.46), not done. */
export const MULTISIG_TASK = "3.46";
