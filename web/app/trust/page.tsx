import type { Metadata } from "next";
import { connection } from "next/server";
import { SandboxChip } from "@/components/chips";
import { CARD, Fact, Mono, OutLink, PAGE, ReadFailure, ReadStamp, YesNo } from "@/components/judge-ui";
import { readProgramFacts } from "@/lib/chain";
import { MULTISIG_TASK } from "@/lib/facts";
import { PINS } from "@/lib/pins";
import { REPO_URL } from "@/lib/site";
import { explorerAddress } from "@/lib/solana";
import { formatUnits } from "@/lib/vault";

// /trust (PLAN.md 3.2): the threat model in plain words. The program checks summarise
// protocol/PAYMENT-V1.md section 8 and programs/loka_vault/src/instructions/redeem.rs; the
// limits summarise section 10. Custody facts that the chain can answer (the upgrade
// authority, the vault's owner and balance) are read live, cached 30 seconds.

export const metadata: Metadata = {
  title: "Trust | LOKA Pay",
  description: "What the LOKA Pay program checks, what the protocol does not promise, and who holds which key. Devnet pilot, unaudited.",
};

const SPEC = `${REPO_URL}/blob/main/protocol/PAYMENT-V1.md`;
const CODE = `${REPO_URL}/blob/main/programs/loka_vault/src`;

const CHECKS: Array<{ title: string; body: string }> = [
  {
    title: "The payer signed this exact note.",
    body: "The instruction right before redeem_note must be Solana's secp256r1 signature check, over exactly the 141 note bytes, with the payer key stored in the allowance account. The program reads it only through the canonical instructions sysvar, so a forged or substituted check fails.",
  },
  {
    title: "The note is well formed and meant for this deployment.",
    body: "Its prefix, the USD currency and an amount above zero are checked on chain, and so are this program id, the devnet cluster and the configured mint. A note signed for another deployment never settles here.",
  },
  {
    title: "The accounts are the program's own.",
    body: "The allowance account must be the program's account for the note's allowance id, and the merchant record the one for the note's payee.",
  },
  {
    title: "Each serial settles once.",
    body: "Every allowance keeps a 256-bit map of used serials. A second note on a used serial fails on chain with the error SerialUsed.",
  },
  {
    title: "Never more than the cap.",
    body: "The allowance's redeemed total plus this note must stay at or under the cap that was locked in the vault when the allowance opened.",
  },
  {
    title: "Nothing settles late.",
    body: "The chain clock must be at or before the note's expiry and the allowance's expiry.",
  },
  {
    title: "Only the named merchants, if any are named.",
    body: "When an allowance lists merchants (earmarks), the note's payee must be one of them.",
  },
  {
    title: "All or nothing.",
    body: "Only then is the merchant's balance credited and an event logged. A failed check changes nothing.",
  },
];

export default async function TrustPage() {
  await connection();
  const facts = await readProgramFacts();
  const programData = facts.ok ? facts.data.programData : null;
  const vault = facts.ok ? facts.data.vault : null;
  const readStatus = facts.ok ? (
    <ReadStamp
      source="Solana devnet"
      slot={facts.data.slots.min === facts.data.slots.max ? `slot ${facts.data.slots.min}` : `slots ${facts.data.slots.min} to ${facts.data.slots.max}`}
      ms={facts.readAtMs}
      stale={facts.staleBecause}
      testId="trust-read-stamp"
    />
  ) : (
    <ReadFailure what="the program from devnet" reason={facts.reason} ms={facts.atMs} />
  );

  return (
    <main className={PAGE}>
      <header className="flex flex-col gap-4">
        <div className="flex flex-wrap items-center gap-x-4 gap-y-3">
          <h1 className="text-5xl sm:text-6xl">Trust</h1>
          <SandboxChip />
        </div>
        <p className="text-xl leading-relaxed">
          What the program checks before it moves money, what the protocol does not promise, and who holds which key.
        </p>
      </header>

      <section aria-labelledby="pilot" className="flex min-w-0 gap-3 rounded-card border-3 border-warning-line bg-warning p-5 text-on-state">
        <div className="flex min-w-0 flex-col gap-2">
          <h2 id="pilot" className="text-2xl" data-testid="pilot-status">
            Devnet pilot, unaudited, not frozen on purpose.
          </h2>
          <p className="leading-relaxed">
            Nobody outside the team has audited this program. It stays upgradeable so a fix can ship during the event:
            freezing a Solana program cannot be undone. That also means whoever holds the upgrade authority can change
            the program, so that key is shown below, read from the chain.
          </p>
        </div>
      </section>

      <section aria-labelledby="custody" className="flex flex-col gap-4">
        <h2 id="custody" className="text-3xl">
          Who holds what
        </h2>
        {/* Values from an older read are introduced as such, before any of them. */}
        {facts.ok && facts.staleBecause ? readStatus : null}
        <dl className={`${CARD} flex flex-col gap-3`}>
          <Fact label="The payer's phone">
            A P-256 key created inside the iPhone&apos;s Secure Enclave, which cannot be exported. Only that phone can
            sign its payment notes.
          </Fact>
          <Fact label="The program's vault" testId="custody-vault">
            <span className="flex flex-col gap-2">
              <span>
                The sandbox tokens sit in a token account owned by the program&apos;s vault account. Only the program can
                move them out, and only to pay a merchant&apos;s signed withdrawal from the balance its redeemed notes
                credited.
              </span>
              <Mono>{PINS.accounts.vaultUsdcAccount}</Mono>
              {vault === null ? null : vault.ok ? (
                <span className="flex flex-wrap items-center gap-2">
                  <YesNo value={vault.value.ownerIsVault} yes="Owned by the vault account" no="Owner is not the vault account" />
                  <span className="font-bold">{formatUnits(vault.value.amountUnits, vault.value.decimals)} sandbox USDC</span>
                </span>
              ) : (
                <span className="text-muted">Not read: {vault.reason}</span>
              )}
              <OutLink href={explorerAddress(PINS.accounts.vaultUsdcAccount)}>Vault token account on Solana Explorer</OutLink>
            </span>
          </Fact>
          <Fact label="The settlement server">
            <span className="flex flex-col gap-2">
              <span>
                It relays notes to the program and pays the network fees. It cannot forge a payer&apos;s note: the program
                checks the payer&apos;s own signature on chain, so a note the payer never signed fails there. It also signs
                confirmations and certificates with an Ed25519 key.
              </span>
              <span data-testid="server-key-risk">
                Phones show Paid on its signed confirmation, and merchants accept its signed certificates offline, so
                whoever holds the server&apos;s Ed25519 key can sign a false confirmation or certificate that phones
                trust. The chain still decides who actually got paid.
              </span>
              {PINS.serverEd25519PublicKey === null ? (
                <span data-testid="server-status" className="font-bold">
                  The settlement server is not live yet: its key is not published in config/pins.json.
                </span>
              ) : (
                <span data-testid="server-status" className="flex flex-col gap-1">
                  <span className="font-bold">Its published Ed25519 key:</span>
                  <Mono>{PINS.serverEd25519PublicKey}</Mono>
                </span>
              )}
            </span>
          </Fact>
          <Fact label="The upgrade authority" testId="custody-authority">
            <span className="flex flex-col gap-2">
              {programData === null ? null : programData.ok ? (
                programData.value.upgradeAuthority === null ? (
                  <span className="font-bold">None: the program is frozen and can no longer be changed.</span>
                ) : (
                  <>
                    <Mono testId="upgrade-authority">{programData.value.upgradeAuthority}</Mono>
                    {programData.value.upgradeAuthority === PINS.upgradeAuthority ? (
                      <span>
                        One key, held by one teammate, can upgrade the program today. A 2-of-3 multisig is planned (task{" "}
                        {MULTISIG_TASK}), not done.
                      </span>
                    ) : (
                      <YesNo value={false} no="Differs from config/pins.json" />
                    )}
                    <OutLink href={explorerAddress(programData.value.upgradeAuthority)}>Authority on Solana Explorer</OutLink>
                  </>
                )
              ) : (
                <span className="text-muted">Not read: {programData.reason}</span>
              )}
            </span>
          </Fact>
        </dl>
        {facts.ok && facts.staleBecause ? null : readStatus}
      </section>

      <section aria-labelledby="checks" className="flex flex-col gap-4">
        <h2 id="checks" className="text-3xl">
          What the program checks before it moves money
        </h2>
        <ol className={`${CARD} flex list-decimal flex-col gap-3 pl-10`}>
          {CHECKS.map((c) => (
            <li key={c.title} className="leading-relaxed">
              <strong>{c.title}</strong> {c.body}
            </li>
          ))}
        </ol>
        <p className="flex flex-wrap gap-x-5 gap-y-2 text-sm">
          <OutLink href={`${SPEC}#8-what-the-program-checks-redeem_note`}>PAYMENT-V1 section 8</OutLink>
          <OutLink href={`${CODE}/instructions/redeem.rs`}>redeem.rs</OutLink>
          <OutLink href={`${CODE}/wire.rs`}>wire.rs</OutLink>
        </p>
      </section>

      <section aria-labelledby="limits" className="flex flex-col gap-4">
        <h2 id="limits" className="text-3xl">
          What the protocol does not promise
        </h2>
        <ul className={`${CARD} flex list-disc flex-col gap-3 pl-10`}>
          <li className="leading-relaxed">
            <strong>Double spending is bounded, not prevented.</strong> The chain refuses a reused serial, so a payer can
            never settle more than the cap. A merchant who accepts a note offline carries the risk that the payer spent
            that serial somewhere else first. An offline limit caps that risk; the merchant&apos;s phone enforces it,
            not the program.
          </li>
          <li className="leading-relaxed">
            <strong>The received-at time is the merchant phone&apos;s clock.</strong> The merchant signs it; nothing
            proves it.
          </li>
          <li className="leading-relaxed">
            <strong>Payments are not hidden from the public chain.</strong> Relaying phones cannot read or change a
            payment, but devnet stores key hashes, amounts and times for anyone to read.
          </li>
          <li className="leading-relaxed">
            <strong>Warnings and repayment are not built yet.</strong> Each allowance records a bond, held in the vault,
            but no instruction pays it out. Warnings that spread to nearby merchants after a conflicting spend are
            planned, not built.
          </li>
          <li className="leading-relaxed">
            <strong>Sandbox tokens only.</strong> The vault holds devnet USDC, a test token with no value. Nothing here
            moves real money.
          </li>
        </ul>
        <p className="text-sm">
          <OutLink href={`${SPEC}#10-what-this-protocol-does-not-promise`}>PAYMENT-V1 section 10</OutLink>
        </p>
      </section>
    </main>
  );
}
