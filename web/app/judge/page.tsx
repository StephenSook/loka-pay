import type { Metadata } from "next";
import Link from "next/link";
import { connection } from "next/server";
import { SandboxChip } from "@/components/chips";
import { CARD, OutLink, PAGE } from "@/components/judge-ui";
import { ProgramFactsPanel } from "@/components/program-facts";
import { readProgramFacts } from "@/lib/chain";
import { TESTFLIGHT_STATUS, TESTFLIGHT_STATUS_AS_OF } from "@/lib/facts";
import { REPO_URL } from "@/lib/site";

// The judge door (PLAN.md 3.2): a numbered three-minute route through everything a judge
// can check without logging in. Rendered per request (connection()); the devnet reads
// behind step 2 are cached for 30 seconds in lib/chain.ts.

export const metadata: Metadata = {
  title: "Judge door | LOKA Pay",
  description: "A three-minute route through LOKA Pay: a receipt you check in your browser, the program on devnet, the live feed, the proof and the threat model. No login.",
};

// Every workflow in .github/workflows/, each labelled with its own job name. A red badge is
// shown as red: hiding one would make the list say less than GitHub does.
const WORKFLOWS = [
  { file: "ios", label: "ios (package tests, app build, release checks)" },
  { file: "android", label: "android (core tests, debug build, lint)" },
  { file: "program", label: "program (secp256r1 feature check, anchor test)" },
  { file: "server", label: "server (typecheck, unit, integration, vectors)" },
  { file: "web", label: "web (lint, typecheck, build, Playwright)" },
  { file: "hygiene", label: "hygiene (gitleaks, scrub guard, prose gate, FACTS)" },
] as const;

function Step({
  n,
  title,
  minutes,
  children,
}: {
  n: number;
  title: string;
  minutes: string;
  children: React.ReactNode;
}) {
  return (
    <li className={`${CARD} flex min-w-0 flex-col gap-4`} data-testid={`step-${n}`}>
      <div className="flex min-w-0 items-start gap-4">
        <span
          aria-hidden="true"
          className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full border-3 border-ink bg-pending font-display text-xl font-extrabold text-on-state"
        >
          {n}
        </span>
        <div className="flex min-w-0 flex-col gap-1">
          <h2 className="text-2xl sm:text-3xl">
            <span className="sr-only">Step {n}: </span>
            {title}
          </h2>
          <p className="text-sm font-bold text-muted">{minutes}</p>
        </div>
      </div>
      {children}
    </li>
  );
}

function GoLink({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <Link
      href={href}
      className="inline-flex w-fit items-center gap-2 rounded-full border-3 border-ink bg-ink px-5 py-2.5 font-bold text-paper shadow-hard transition-transform motion-safe:hover:-translate-y-0.5"
    >
      {children}
      <span aria-hidden="true">→</span>
    </Link>
  );
}

export default async function JudgePage() {
  await connection();
  const facts = await readProgramFacts();
  return (
    <main className={PAGE}>
      <header className="flex flex-col gap-4">
        <div className="flex flex-wrap items-center gap-x-4 gap-y-3">
          <h1 className="text-5xl sm:text-6xl">Judge door</h1>
          <SandboxChip />
        </div>
        <p className="text-xl leading-relaxed">
          Seven stops, about three minutes, no login anywhere. Chain facts on these pages are read from Solana devnet,
          each with the slot and time it was read, and marked when the value is a cached read.
        </p>
        <p className="text-muted">Sandbox only: test tokens on Solana devnet with no value. No real money moves.</p>
      </header>

      <ol className="flex flex-col gap-6" aria-label="Itinerary">
        <Step n={1} title="Check a receipt in your browser" minutes="About 30 seconds">
          <p className="leading-relaxed">
            Open the verifier and press <strong>Try the published test receipt</strong>. Your browser checks the
            payer&apos;s P-256 signature, the merchant&apos;s acknowledgement and the settlement server&apos;s
            confirmation on the page, with nothing sent anywhere. That receipt is a labelled test vector made from
            public test keys, not a real payment.
          </p>
          <GoLink href="/verify">Open /verify</GoLink>
        </Step>

        <Step n={2} title="The program on devnet" minutes="About 40 seconds">
          <p className="leading-relaxed">
            The <code className="font-mono text-sm">loka_vault</code> program verifies the phone&apos;s signature on
            chain and holds the sandbox tokens. These facts come from a devnet read; the line under them says when, and
            whether it was made for this page or is a cached read.
          </p>
          <ProgramFactsPanel read={facts} />
        </Step>

        <Step n={3} title="Watch the chain" minutes="About 30 seconds">
          <p className="leading-relaxed">
            Every transaction that touches the program, newest first, then each new one as it lands. Your browser reads
            devnet directly, so the feed keeps working even if our server is down.
          </p>
          <GoLink href="/live">Open /live</GoLink>
        </Step>

        <Step n={4} title="Proof" minutes="About 30 seconds">
          <p className="leading-relaxed">
            Each claim marked Live links to its evidence; the rest say Building. Then the vault&apos;s tokens against
            everything it owes, read at one slot, and what this team committed since hacking started.
          </p>
          <GoLink href="/proof">Open /proof</GoLink>
        </Step>

        <Step n={5} title="Trust" minutes="About 20 seconds">
          <p className="leading-relaxed">
            What the program checks before it moves money, what the protocol does not promise, and who holds which key.
          </p>
          <GoLink href="/trust">Open /trust</GoLink>
        </Step>

        <Step n={6} title="The iPhone app" minutes="About 10 seconds">
          <p className="leading-relaxed" data-testid="testflight-status">
            {TESTFLIGHT_STATUS}.
          </p>
          <p className="text-sm text-muted">
            Status as of <time dateTime={TESTFLIGHT_STATUS_AS_OF}>{TESTFLIGHT_STATUS_AS_OF}</time>.
          </p>
        </Step>

        <Step n={7} title="The code and its checks" minutes="About 20 seconds">
          <p className="leading-relaxed">
            The repository is public. Each badge below is GitHub&apos;s own live status for that workflow on the main
            branch; select one to open its runs.
          </p>
          <OutLink href={REPO_URL} testId="repo-link">
            github.com/StephenSook/loka-pay
          </OutLink>
          <ul className="flex flex-col gap-3" aria-label="GitHub Actions workflows">
            {WORKFLOWS.map((w) => (
              <li key={w.file} className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1">
                <a
                  href={`${REPO_URL}/actions/workflows/${w.file}.yml`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex shrink-0"
                >
                  {/* GitHub's live status badge: an SVG from github.com that must not be cached or resized by Next. */}
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={`${REPO_URL}/actions/workflows/${w.file}.yml/badge.svg`}
                    alt={`${w.file} workflow status on GitHub Actions (opens in a new tab)`}
                    height={20}
                    className="h-5 w-auto"
                    data-testid={`badge-${w.file}`}
                  />
                </a>
                <span className="text-sm text-muted">{w.label}</span>
              </li>
            ))}
          </ul>
          <p className="text-sm text-muted" data-testid="server-workflow-note">
            The server workflow tests the settlement server in server/, so its badge stays red until that code is merged
            into main.
          </p>
        </Step>
      </ol>
    </main>
  );
}
