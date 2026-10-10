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

/**
 * The refused cheat on devnet, Sat Oct 10 2:01 AM ET: the "refused cheat" link in the same
 * README row as FIRST_REDEEM_TX_SIGNATURE. Checked against devnet with getTransaction on
 * Oct 10: meta.err is InstructionError [2, Custom 6011] and loka_vault logged "Error Code:
 * SerialUsed". It is a reused serial, not an edited note, and /verify's "Play the attacker"
 * panel says so where it links it.
 */
export const REFUSED_CHEAT_TX_SIGNATURE =
  "2SQ8aiTmRizKpy17cQxzH1Bnae828qdico7Y8BMzrkYKBa1yTiBevM94ijzhEaiGZEmviaeu3BEXsRywS4Excohv";

/**
 * The first payment signed on an iPhone, Sat Oct 10 4:23 PM ET (docs/FACTS.json
 * proof_pair_iphone_settled_tx): signed with a teammate's Secure Enclave key, passed by camera QR
 * to the merchant iPhone while both were offline, settled when the merchant phone came online.
 * Checked against devnet with getTransaction: meta.err null, loka_vault logged
 * "Instruction: RedeemNote", and the precompile's 141-byte note hashes to IPHONE_SETTLED_NOTE_ID.
 * The proof pair (lib/proof-pair.ts) leads with it (PLAN.md 3.74).
 */
export const IPHONE_SETTLED_TX_SIGNATURE =
  "2SpG1YURVivMHY3VNWwRsDfo7SZBjWZHXZHeqAovEh6RTNE4XVVNrH5BzU84yJk6nXyqprdHAxt22QSuktskez17";
export const IPHONE_SETTLED_NOTE_ID = "f4cba02c37e62469a56252bdc7feb7ba82b974e32a71878cc354e32d29570cb9";

/**
 * The refused cheat signed on that iPhone, Sat Oct 10 4:31 PM ET (docs/FACTS.json
 * proof_pair_iphone_refused_tx): the same payer key, allowance and serial signed again for a
 * different merchant phone. Checked against devnet with getTransaction: meta.err is
 * InstructionError [1, Custom 6011] and loka_vault logged "Error Code: SerialUsed".
 */
export const IPHONE_REFUSED_TX_SIGNATURE =
  "3XtQtnHRKC3QvhBGye8gTMWimPg3iPXuBskf3LMsQEhJPdzeGiqEEjrmjFLqXFTJMQ9JFAitWoCbuEGFSLKjZc9n";
export const IPHONE_REFUSED_NOTE_ID = "5ecdc8dc27d8ed9ecaf952efce6f6aedb206fd8c480d3f7b46fcb280d34ac0da";

/**
 * The demo payer's allowance: the one both iPhone proof pairs spent from. docs/FACTS.json
 * proof_pair_iphone_settled_tx and proof_pair_iphone_refused_tx name it in their source
 * ("allowance 10652706154269594633"); unit/watch.test.ts checks that both still do. /judge's
 * "Watch on your phone" QR opens /watch for it. If the demo payer moves to another allowance
 * (PLAN.md 3.82), change it here and in those FACTS sources together.
 */
export const DEMO_ALLOWANCE_ID = "10652706154269594633";

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
