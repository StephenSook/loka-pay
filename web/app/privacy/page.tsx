import type { Metadata } from "next";
import { SERVER_RPC_URL } from "@/lib/server-rpc";
import { CONTACT_EMAIL } from "@/lib/site";
import { DEFAULT_RPC_URL, RPC_URL, WS_URL, hostsOf, wsUrlFor } from "@/lib/solana";

// Also the App Store Connect privacy policy URL for the TestFlight build
// (https://zerobars.us/privacy). Every sentence here must be true today. The settlement server
// rows of the "What we store" table follow the server's code (server/src/settle, server/src/remit,
// server/src/app); each row names, in a comment, the tables and columns it covers.

export const metadata: Metadata = {
  title: "Privacy | LOKA Pay",
  description: "LOKA Pay privacy policy: no sign-up, no login, no profile.",
};

const UPDATED = "2026-10-10";

// The hosts named below come from the endpoints this build actually uses (lib/solana.ts and
// lib/server-rpc.ts), host names only, so an override can never leave this page untrue.
const BROWSER_HOSTS = hostsOf(RPC_URL, WS_URL);
const browserRpc =
  RPC_URL === DEFAULT_RPC_URL && WS_URL === wsUrlFor(DEFAULT_RPC_URL)
    ? `Solana's public devnet server (${BROWSER_HOSTS.join(" and ")})`
    : `the Solana devnet RPC server at ${BROWSER_HOSTS.join(" and ")}`;
const serverHosts = hostsOf(SERVER_RPC_URL).join(" and ");

// What the settlement server stores, read from its code on Oct 10, then the two /call rows (PLAN.md 3.9).
const STORED = [
  // registration_jobs.key_hash and .plan (publicKey, keyHash, kind, pool, allowanceId, expiry,
  // policy), .result (the signed certificate), registration_attempts (server/src/remit/store.ts).
  // On chain the Allowance account holds payer_key and the Merchant account key_hash
  // (programs/loka_vault/src/state.rs).
  {
    field: "A phone's public key and its hash, its sandbox allowance (cap, offline limit, expiry) and the certificate the server signs for it",
    where: "The settlement server; on Solana devnet a payer's key and allowance, and a merchant's key hash, are public",
    why: "To open the allowance and let the program check that each payment was signed by that phone",
  },
  // registration_jobs.plan.name and the MERCH certificate in registration_jobs.result
  // (server/src/remit/service.ts displayName). Not stored on chain.
  {
    field: "A merchant's display name, typed by the merchant",
    where: "The settlement server, in the merchant's registration and inside its signed certificate",
    why: "So the certificate shows the same name every time",
  },
  // registration_budgets (pool, day, units, funder, fee), settlement_fee_budgets (fee_payer, day,
  // spent), settlement_rate_limits (allowance_key = program, cluster, mint and allowance id;
  // window_start, used): server/src/remit/store.ts, server/src/settle/fee-budget.ts and rate-limit.ts.
  {
    field: "Counters: how many notes each allowance sent in the current window, and how much each sandbox pool and fee payer spent each day",
    where: "The settlement server",
    why: "To limit how fast one allowance can settle and how much the sandbox wallets spend in a day",
  },
  // The burst guard in server/src/app/app.ts: an HMAC of the client address with a random
  // per-boot key, in a Map in memory. The logger (privateLogger) writes method, route and status only.
  {
    field: "A keyed hash of your network address (not the address), with a count of your recent requests",
    where: "The settlement server's memory only: never written to its database or logs, and made with a random key that changes whenever the server restarts",
    why: "To answer \"too many requests\" when one network sends a burst",
  },
  // settlement_attempts.uploaded_at, .attempt and .replacement (the signed transaction),
  // .decision (status, slot, block time, error, the signed confirmation), saved_broadcasts
  // (signature, sends): server/src/settle/store.ts and broadcast.ts.
  {
    field: "When the server received each payment, the devnet transactions it signs and sends, and their results",
    where: "The settlement server; every transaction is also public on Solana devnet",
    why: "To send each transaction once, recover after a restart, and sign the confirmation a phone shows",
  },
  // settlement_attempts.note and .ack (server/src/settle/store.ts): the note and ack wires of
  // protocol/PAYMENT-V1.md 4.1 and 4.2.
  {
    field: "Payment notes and acks: amount, key hashes, signatures and when the merchant received it",
    where: "The settlement server; each settled payment is also public on Solana devnet",
    why: "To settle each payment once and show how long it was held offline",
  },
  {
    field: "Your phone number, if you ask for a call on /call",
    where: "Stored nowhere. Our server passes it once to Vonage to place one call; Vonage keeps a record of the call",
    why: "To place the one call you asked for",
  },
  {
    field: "The words the call says",
    where: "Sent to ElevenLabs to make the voice: public payment details only (the amount, when it settled, that the signature was checked)",
    why: "To read the payment out loud",
  },
];

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="flex flex-col gap-2">
      <h2 className="text-2xl">{title}</h2>
      {children}
    </section>
  );
}

export default function PrivacyPage() {
  return (
    <main className="mx-auto flex w-full max-w-3xl flex-col gap-8 px-4 py-10 leading-relaxed sm:px-6 sm:py-16">
      <header className="flex flex-col gap-2">
        <h1 className="text-5xl sm:text-6xl">Privacy</h1>
        <p className="text-muted">
          Updated <time dateTime={UPDATED}>{UPDATED}</time>
        </p>
      </header>

      <div className="rounded-card border-3 border-ink bg-surface p-5 shadow-hard">
        <p className="text-xl font-bold">No sign-up, no login, no profile.</p>
        <p className="mt-2">
          LOKA Pay has no accounts. There is nothing to sign up for or log in to, and we keep no
          profile of you.
        </p>
      </div>

      <p>
        LOKA Pay is a sandbox prototype built at the Hacklanta II hackathon. It uses test tokens on
        Solana devnet that have no monetary value. &quot;We&quot; means the LOKA Pay team.
      </p>

      <Section title="The iPhone app">
        <p>
          The iPhone app keeps its keys on the phone. Messages, photos and voice notes travel
          end-to-end encrypted to the person you send them to, over Bluetooth or a local Wi-Fi
          network, and are stored on the phones involved. The app does not send them to us.
        </p>
        <p>
          The app asks for these permissions, each only for the feature named: Bluetooth (to reach
          nearby phones), camera (to scan codes and take photos for messages), microphone (to record
          voice notes), contacts (to find a name for a phone number you type; contacts stay on the
          phone and are never uploaded), local network (to reach nearby phones on Wi-Fi) and Face ID
          (to approve each payment).
        </p>
      </Section>

      <Section title="This website">
        <p>
          This website sets no cookies and runs no analytics or tracking. Its fonts are served from
          this site&apos;s own address.
        </p>
        <p>
          Three pages make your browser contact another website, and only to read public data: /live
          connects to {browserRpc} to read the program&apos;s transactions, /watch connects to the same
          server to read the one allowance it shows and the transactions that touch it, and /call
          connects to the same server to watch for the next settled payment, only after you press
          &quot;Call me when the next payment settles&quot;. That site sees your browser&apos;s request, as any website
          does; this site sends it nothing about you, and never your phone number. Every other page
          makes no request to any other website, except /send below.
        </p>
        <p>
          /send makes your browser contact our settlement server at api.zerobars.us only after you
          press its Send button: one request carrying the recipient allowance id and the amount you
          entered, sent again unchanged while the server answers that the send is pending. The
          server sees your browser&apos;s request, as any website does; nothing else about you is
          sent.
        </p>
        <p>
          The /judge, /proof and /trust pages read public data from Solana devnet ({serverHosts}) and
          GitHub (api.github.com) on our server, not from your browser, and those reads carry
          nothing about you. /call also reads public payment data from Solana devnet on our server,
          to find the payment the call reads out.
        </p>
        <p>
          It is hosted on Vercel. We have not turned on Vercel Web Analytics or Speed Insights.
        </p>
      </Section>

      <Section title="Phone calls (/call)">
        <p>
          If you enter a phone number on /call and press a button, your browser sends it once to our
          server, in the body of one request. Our server uses it to ask Vonage, the phone company we
          use, to place one call, and does not store or log it. Vonage keeps a record of the call.
        </p>
        <p>
          To enforce the call limits, our server&apos;s memory keeps a keyed hash of the number (not
          the number) for up to 24 hours. It is never written to disk and is gone when the server
          restarts.
        </p>
        <p>
          Calls need a desk code we give out at the LOKA Pay table. If a request carries a wrong or
          missing code, our server&apos;s memory keeps a keyed hash of your network address (not the
          address, and made with a random key that changes whenever the server restarts) for up to
          10 minutes, to limit guessing. It is never written to disk or logged.
        </p>
        <p>
          The voice is made by ElevenLabs from public payment details only: the amount, how long ago
          the payment settled, and that the chain checked the payer&apos;s signature. Your number
          is never sent to ElevenLabs.
        </p>
      </Section>

      <Section title="The settlement server">
        <p>
          The settlement server at api.zerobars.us is running on Solana devnet. It has no accounts
          and never asks for a person&apos;s name, phone number or email; the only name it takes is
          the shop name a merchant types.
        </p>
        <p>
          All but the last two rows of the table below are what it stores, read from its code
          (server/ in the repository); the last two are what the /call page handles. Its log has one
          line per response, with the method, the route and the status code, and no address, header
          or body. The /proof and /send pages read its public health check
          (api.zerobars.us/api/health) from our web server, not from your browser, and that read
          carries nothing about you.
        </p>
      </Section>

      <Section title="What we store">
        <table className="w-full table-fixed border-collapse border-3 border-ink bg-surface text-left">
          <thead>
            <tr>
              <th scope="col" className="border-2 border-ink p-3 align-top font-bold">
                Field
              </th>
              <th scope="col" className="border-2 border-ink p-3 align-top font-bold">
                Where it lives
              </th>
              <th scope="col" className="border-2 border-ink p-3 align-top font-bold">
                Why
              </th>
            </tr>
          </thead>
          <tbody>
            {STORED.map((row) => (
              <tr key={row.field}>
                <td className="break-words border-2 border-ink p-3 align-top">{row.field}</td>
                <td className="break-words border-2 border-ink p-3 align-top">{row.where}</td>
                <td className="break-words border-2 border-ink p-3 align-top">{row.why}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </Section>

      <Section title="Contact">
        <p>
          Questions about privacy:{" "}
          <a href={`mailto:${CONTACT_EMAIL}`} className="break-all font-bold underline">
            {CONTACT_EMAIL}
          </a>
        </p>
      </Section>
    </main>
  );
}
