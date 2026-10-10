// Proof of reserves (PLAN.md 3.24, the chain-direct part): the vault's tokens against
// everything the program says it owes, every balance from one getMultipleAccounts call at
// one slot (lib/chain.ts readReserves). Server component.

import type { Read, ReservesRead } from "@/lib/chain";
import { REPO_URL } from "@/lib/site";
import { explorerAddress } from "@/lib/solana";
import { formatUnits } from "@/lib/vault";
import { OutlineChip, StateChip } from "./chips";
import { CheckIcon } from "./icons";
import { CARD, Fact, Mono, OutLink, ReadFailure, ReadStamp, YesNo } from "./judge-ui";

const CODE = `${REPO_URL}/blob/main/programs/loka_vault/src`;

function Units({ units, testId }: { units: string; testId?: string }) {
  return (
    <span className="font-bold" data-testid={testId}>
      {formatUnits(units)} <span className="font-medium text-muted">sandbox USDC</span>
    </span>
  );
}

export function ReservesPanel({ read }: { read: Read<ReservesRead> }) {
  return (
    <section id="reserves" aria-labelledby="reserves-title" className="flex scroll-mt-6 flex-col gap-4">
      <h2 id="reserves-title" className="text-3xl">
        Proof of reserves
      </h2>
      <p className="leading-relaxed">
        The vault&apos;s tokens against everything the program owes, from the program&apos;s own accounts on devnet.
      </p>
      {read.ok ? <Reserves r={read.data} readAtMs={read.readAtMs} /> : <ReadFailure what="the reserves from devnet" reason={read.reason} ms={read.atMs} />}
      <div className={`${CARD} flex flex-col gap-3`}>
        <h3 className="text-xl">How it is counted</h3>
        <ul className="flex list-disc flex-col gap-2 pl-6 leading-relaxed">
          <li>
            Opening an allowance moves its cap plus its bond into the vault (
            <OutLink href={`${CODE}/instructions/open.rs`}>open.rs</OutLink>).
          </li>
          <li>
            Redeeming a note adds its amount to the allowance&apos;s redeemed total and to the merchant&apos;s balance;
            no tokens leave the vault (<OutLink href={`${CODE}/instructions/redeem.rs`}>redeem.rs</OutLink>).
          </li>
          <li>
            A withdrawal pays part of a merchant&apos;s balance out of the vault (
            <OutLink href={`${CODE}/instructions/withdraw.rs`}>withdraw.rs</OutLink>).
          </li>
          <li>So the vault owes each allowance its cap minus redeemed, plus its bond, and each merchant its balance.</li>
        </ul>
        <h3 className="text-xl">Not shown</h3>
        <ul className="flex list-disc flex-col gap-2 pl-6 leading-relaxed" data-testid="reserves-not-shown">
          <li>Bounty and operator credits: the program has no such accounts, so there is nothing on chain to count.</li>
          <li>Network fees: separate fee-payer wallets pay them; the vault never pays a fee.</li>
          <li>
            Expired allowances are still counted as owed: the program has no reclaim instruction yet, so their unspent
            tokens stay in the vault.
          </li>
        </ul>
      </div>
    </section>
  );
}

function Reserves({ r, readAtMs }: { r: ReservesRead; readAtMs: number }) {
  const difference = BigInt(r.totals.difference);
  const covered = difference >= BigInt(0);
  return (
    <div className={`${CARD} flex flex-col gap-4`} data-testid="reserves">
      <div className="flex flex-wrap items-center gap-3">
        {covered ? (
          <OutlineChip label="Covered" Icon={CheckIcon} size="lg" testId="reserves-verdict" />
        ) : (
          <StateChip state="warning" label="Short" size="lg" testId="reserves-verdict" />
        )}
        <span className="text-lg">
          {covered
            ? difference === BigInt(0)
              ? "The vault holds exactly what it owes."
              : "The vault holds more than it owes."
            : "The vault holds less than it owes."}
        </span>
      </div>
      <dl className="flex flex-col gap-3">
        <Fact label="Assets: vault balance" testId="reserves-assets">
          <Units units={r.totals.assets} />
        </Fact>
        <Fact label={`Allowances still spendable (${r.allowances.length})`} testId="reserves-allowances">
          <Units units={r.totals.allowanceRemaining} />
        </Fact>
        <Fact label="Bonds" testId="reserves-bonds">
          <Units units={r.totals.bonds} />
        </Fact>
        <Fact label={`Merchant balances (${r.merchants.length})`} testId="reserves-merchants">
          <Units units={r.totals.merchantBalances} />
        </Fact>
        <Fact label="Liabilities: total owed" testId="reserves-liabilities">
          <Units units={r.totals.liabilities} />
        </Fact>
        <Fact label="Assets minus liabilities" testId="reserves-difference">
          <Units units={r.totals.difference} />
        </Fact>
        <Fact label="Vault account checks">
          <span className="flex flex-wrap gap-2">
            <YesNo value={r.vault.mintMatchesPins} yes="Pinned devnet USDC mint" no="Mint differs from the pins" />
            <YesNo value={r.vault.ownerIsVault} yes="Owned by the vault account" no="Owner is not the vault account" />
          </span>
        </Fact>
      </dl>
      {r.anomalies.length > 0 ? (
        <p className="font-bold" data-testid="reserves-anomalies">
          Allowances with more redeemed than their cap (the program forbids this): {r.anomalies.join(", ")}
        </p>
      ) : null}
      {r.allowances.length + r.merchants.length > 0 ? (
        <details className="min-w-0">
          <summary className="cursor-pointer font-bold">Every account counted</summary>
          <ul className="mt-3 flex flex-col gap-3">
            {r.allowances.map((a) => (
              <li key={a.address} className="flex min-w-0 flex-col gap-1">
                <span>
                  Allowance {a.id}: cap {formatUnits(a.capUnits)}, redeemed {formatUnits(a.redeemedUnits)}, bond{" "}
                  {formatUnits(a.bondUnits)}
                </span>
                <OutLink href={explorerAddress(a.address)}>
                  <Mono>{a.address}</Mono>
                </OutLink>
              </li>
            ))}
            {r.merchants.map((m) => (
              <li key={m.address} className="flex min-w-0 flex-col gap-1">
                <span>Merchant balance {formatUnits(m.balanceUnits)}</span>
                <OutLink href={explorerAddress(m.address)}>
                  <Mono>{m.address}</Mono>
                </OutLink>
              </li>
            ))}
          </ul>
        </details>
      ) : null}
      <ReadStamp
        source="Solana devnet"
        slot={`slot ${r.slot}, every balance in one call (accounts listed at slot ${r.listedAt.first} and checked again at slot ${r.listedAt.check})`}
        ms={readAtMs}
        testId="reserves-read-stamp"
      />
    </div>
  );
}
