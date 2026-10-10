import type { Metadata } from "next";
import { connection } from "next/server";
import { SandboxChip } from "@/components/chips";
import { CARD, PAGE, When } from "@/components/judge-ui";
import { SendForm } from "@/components/send-form";
import { MAX_SEND_UNITS, usd } from "@/lib/remittance";
import { sendApiBase, sendAvailability, sendVerifier } from "@/lib/send-server";
import { SETTLEMENT_HEALTH_URL, readServerHealth } from "@/lib/settlement";

// /send (PLAN.md 3.3, web half): fund a payer phone's sandbox allowance through the settlement
// server's POST /v1/remittances (protocol/API-V1.md section 9). Rendered per request: the
// server's health check is read on this server (cached, lib/settlement.ts), and the form is on
// only while that answer lists the route as registered. The page loads nothing from another
// site; the visitor's browser contacts api.zerobars.us only when they press Send.

export const metadata: Metadata = {
  title: "Send sandbox money | LOKA Pay",
  description: "Fund a LOKA Pay payer phone's sandbox allowance on Solana devnet, at most 1.00 test USDC, and get its signed certificate as a code.",
};

function Card({ title, children, testId }: { title: string; children: React.ReactNode; testId?: string }) {
  return (
    <section className={`${CARD} flex flex-col gap-3`} data-testid={testId}>
      <h2 className="text-2xl sm:text-3xl">{title}</h2>
      {children}
    </section>
  );
}

export default async function SendPage() {
  await connection();
  const health = await readServerHealth();
  const api = sendApiBase();
  const availability = sendAvailability(health, api);
  const verifier = sendVerifier();
  const cap = usd(MAX_SEND_UNITS);
  return (
    <main className={PAGE}>
      <header className="flex flex-col gap-4">
        <div className="flex flex-wrap items-center gap-x-4 gap-y-3">
          <h1 className="text-5xl sm:text-6xl">Send sandbox money</h1>
          <SandboxChip />
        </div>
        <p className="text-xl leading-relaxed">
          Fund a payer phone from this page. The settlement server opens a new allowance on Solana devnet for the same
          phone key, paid from its own sandbox send wallet, and signs a certificate the phone can carry with no signal.
        </p>
        <p className="text-muted">No login, no wallet. Sandbox only: test tokens on Solana devnet with no value. No real money moves.</p>
      </header>

      <SendForm apiBase={api.ok ? api.base : ""} availability={availability} verifier={verifier} />

      <p className="text-sm text-muted" data-testid="send-health-stamp">
        {health.ok ? (
          <>
            Server status from{" "}
            <a href={SETTLEMENT_HEALTH_URL} className="underline">
              api.zerobars.us/api/health
            </a>
            , read by this site&apos;s server <When ms={health.readAtMs} /> (kept up to 30 s).
          </>
        ) : (
          <>
            Server status from api.zerobars.us/api/health: the read at <When ms={health.atMs} /> failed.
          </>
        )}
      </p>

      <Card title="How it works">
        <ol className="flex list-decimal flex-col gap-2 pl-6 leading-relaxed">
          <li>You enter the payer phone&apos;s allowance id and an amount, at most {cap} sandbox USDC.</li>
          <li>
            Your browser sends those two values, and nothing else, to the settlement server at api.zerobars.us. While the
            server answers &quot;pending&quot;, the page sends the same request again, starting no new request more
            than 30 seconds after the first.
          </li>
          <li>
            The server reads that allowance on devnet to find the phone&apos;s public key, opens a new allowance for the
            same key from its sandbox send wallet, and waits for devnet to confirm it.
          </li>
          <li>
            It signs a certificate for the new allowance. This page checks that signature against the server key in
            config/pins.json before it draws the certificate as a code.
          </li>
        </ol>
      </Card>

      <Card title="Limits">
        <ul className="flex list-disc flex-col gap-2 pl-6 leading-relaxed">
          <li>At most {cap} sandbox USDC per send. The server refuses more.</li>
          <li>One live send per recipient allowance: sending again returns the first send&apos;s terms until it expires.</li>
          <li>The send wallet has a daily budget (days are UTC). When it is spent, sending stops until the next day.</li>
          <li>The server limits bursts of new sends from one network.</li>
          <li>Which merchants the new allowance can pay (its earmarks) is set by the server, not by this form.</li>
        </ul>
      </Card>

      <Card title="What works today" testId="send-status-card">
        <ul className="flex list-disc flex-col gap-2 pl-6 leading-relaxed">
          <li>
            This page checks what you type, sends the request, waits on a pending send, checks the returned
            certificate&apos;s signature in your browser, and draws it as a QR code.
          </li>
          <li data-testid="send-server-status">
            {availability.on
              ? "The settlement server's health check lists POST /v1/remittances as running."
              : `Off on the server right now. ${availability.reason}`}
          </li>
          <li>
            The iPhone app shows its allowance id on the Pay screen and imports a scanned certificate in builds that
            include the allowance import change (merged Oct 10); an older build does neither.
          </li>
        </ul>
      </Card>
    </main>
  );
}
