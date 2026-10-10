// The deployed program, read live from devnet (lib/chain.ts readProgramFacts). Server
// component. Each fact is either a value read from the chain or a plain "not read".

import type { Part, ProgramFacts, Read } from "@/lib/chain";
import { INIT_TX_SIGNATURE } from "@/lib/facts";
import { PINS } from "@/lib/pins";
import { explorerAddress, explorerTx } from "@/lib/solana";
import { formatUnits, type AccountName } from "@/lib/vault";
import { Fact, Mono, OutLink, ReadFailure, ReadStamp, TxStatusChip, When, YesNo } from "./judge-ui";

const COUNT_LABELS: Record<AccountName, string> = {
  VaultConfig: "Config",
  VaultAuthority: "Vault authority",
  Allowance: "Allowances",
  Merchant: "Merchants",
};

function NotRead({ reason }: { reason: string }) {
  return <span className="text-muted">Not read: {reason}</span>;
}

function slotText(slots: { min: number; max: number }): string {
  return slots.min === slots.max ? `slot ${slots.min}` : `slots ${slots.min} to ${slots.max}`;
}

export function partOrNotRead<T>(part: Part<T>, render: (value: T) => React.ReactNode): React.ReactNode {
  return part.ok ? render(part.value) : <NotRead reason={part.reason} />;
}

export function ProgramFactsPanel({ read }: { read: Read<ProgramFacts> }) {
  return (
    <div className="flex min-w-0 flex-col gap-4">
      <dl className="flex flex-col gap-3">
        <Fact label="Program id (devnet)">
          <span className="flex flex-col gap-1">
            <Mono testId="program-id">{PINS.programId}</Mono>
            <OutLink href={explorerAddress(PINS.programId)} testId="program-explorer-link">
              Program on Solana Explorer
            </OutLink>
          </span>
        </Fact>
      </dl>
      {read.ok ? <Facts facts={read.data} readAtMs={read.readAtMs} /> : <ReadFailure what="the program from devnet" reason={read.reason} ms={read.atMs} />}
    </div>
  );
}

function Facts({ facts, readAtMs }: { facts: ProgramFacts; readAtMs: number }) {
  const { program, programData, vault, counts, init, config } = facts;
  return (
    <div className="flex min-w-0 flex-col gap-4" data-testid="program-facts">
      <dl className="flex flex-col gap-3">
        <Fact label="Executable" testId="fact-executable">
          {program.exists ? (
            <YesNo value={program.executable} yes="Yes, executable" no="Not executable" />
          ) : (
            <YesNo value={false} no="No account at this address" />
          )}
        </Fact>
        <Fact label="Upgrade authority" testId="fact-authority">
          {partOrNotRead(programData, (d) =>
            d.upgradeAuthority === null ? (
              "None: the program is frozen"
            ) : (
              <span className="flex flex-col gap-1">
                <Mono>{d.upgradeAuthority}</Mono>
                {d.upgradeAuthority === PINS.upgradeAuthority ? (
                  <span className="text-sm text-muted">Matches config/pins.json. One key; a 2-of-3 multisig is planned, not done.</span>
                ) : (
                  <YesNo value={false} no="Differs from config/pins.json" />
                )}
              </span>
            ),
          )}
        </Fact>
        <Fact label="Last deployed" testId="fact-deployed">
          {partOrNotRead(programData, (d) => (
            <>
              Slot {d.deploySlot}
              {d.deployTimeMs !== null ? (
                <>
                  , <When ms={d.deployTimeMs} />
                </>
              ) : (
                <span className="text-muted"> (block time not read)</span>
              )}
            </>
          ))}
        </Fact>
        <Fact label="Program size" testId="fact-size">
          {partOrNotRead(programData, (d) =>
            d.programBytes === null ? <span className="text-muted">Not reported by the node</span> : `${d.programBytes.toLocaleString("en-US")} bytes`,
          )}
        </Fact>
        <Fact label="Vault (sandbox USDC)" testId="fact-vault">
          {partOrNotRead(vault, (v) => (
            <span className="flex flex-col gap-1">
              <span className="font-bold">{formatUnits(v.amountUnits, v.decimals)} sandbox USDC</span>
              <span className="flex flex-wrap gap-2">
                <YesNo value={v.mintMatchesPins} yes="Pinned devnet USDC mint" no="Mint differs from the pins" />
                <YesNo value={v.ownerIsVault} yes="Owned by the vault account" no="Owner is not the vault account" />
              </span>
              <OutLink href={explorerAddress(PINS.accounts.vaultUsdcAccount)}>Vault token account on Solana Explorer</OutLink>
            </span>
          ))}
        </Fact>
        <Fact label="Program accounts, by Anchor discriminator" testId="fact-counts">
          {partOrNotRead(counts, (c) => (
            <ul className="flex flex-wrap gap-x-4 gap-y-1">
              {(Object.keys(COUNT_LABELS) as AccountName[]).map((name) => (
                <li key={name} data-testid={`count-${name}`}>
                  {COUNT_LABELS[name]}: <span className="font-bold">{c.byType[name]}</span>
                </li>
              ))}
              {c.other > 0 ? (
                <li data-testid="count-other">
                  Unrecognized: <span className="font-bold">{c.other}</span>
                </li>
              ) : null}
            </ul>
          ))}
        </Fact>
        <Fact label="Vault config" testId="fact-config">
          {partOrNotRead(config, (c) =>
            c.exists ? (
              <span className="flex flex-wrap gap-2">
                <YesNo value={c.mintMatchesPins} yes="Initialized for the pinned mint" no="Config mint differs from the pins" />
                <YesNo value={c.cluster === 0} yes="Cluster 0 (devnet)" no={`Cluster ${c.cluster}`} />
              </span>
            ) : (
              <YesNo value={false} no="Not initialized" />
            ),
          )}
        </Fact>
        <Fact label="Initialize transaction" testId="fact-init">
          <span className="flex flex-col gap-1">
            {partOrNotRead(init, (i) =>
              i.found ? (
                <span className="flex flex-wrap items-center gap-2">
                  <TxStatusChip failed={i.failed} />
                  <span>
                    {i.actions.length > 0 ? <code className="font-mono text-sm">{i.actions.join(", ")}</code> : "no loka_vault instruction in its logs"}
                    {i.slot !== null ? <>, slot {i.slot}</> : null}
                    {i.blockTimeMs !== null ? (
                      <>
                        , <When ms={i.blockTimeMs} />
                      </>
                    ) : null}
                  </span>
                </span>
              ) : (
                <YesNo value={false} no="Not found on devnet" />
              ),
            )}
            <OutLink href={explorerTx(INIT_TX_SIGNATURE)} testId="init-explorer-link">
              Initialize transaction on Solana Explorer
            </OutLink>
          </span>
        </Fact>
      </dl>
      <ReadStamp source="Solana devnet" slot={slotText(facts.slots)} ms={readAtMs} testId="program-read-stamp" />
    </div>
  );
}

