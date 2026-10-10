import { readFileSync } from "node:fs";
import path from "node:path";
import { expect, test } from "@playwright/test";
import { base64urlEncode, decodeTransport, fromHex, toHex } from "@lokapay/protocol";
import { E2E_SERVER_KEY_HEX } from "../e2e/fixtures/ports";
import { PINNED, TEST_EARMARKS, TEST_FAILED_TX, TEST_PAYER_KEY_HASH, TEST_TX, pendingBody, successBody, testAllowanceWire } from "../e2e/fixtures/remittance";
import {
  ALLOWANCE_CODE_PREFIX,
  PENDING_BOUND_MS,
  REFUSALS,
  allowanceCode,
  classifyAnswer,
  parseRecipient,
  parseRetryAfter,
  parseSendAmount,
  repostDelaySeconds,
  requestBody,
  sendRemittance,
  verifyCertificate,
  type PostResult,
  type RemittanceRequest,
  type RemittanceSuccess,
} from "../lib/remittance";
import type { SerializedDeployment } from "../lib/receipt";

// /send's rules (lib/remittance.ts) against the contract of POST /v1/remittances
// (protocol/API-V1.md section 9, server/src/remit/remittance.ts). Certificates are TEST FIXTURES signed
// with the published test vector server key (e2e/fixtures/remittance.ts).

const REQUEST: RemittanceRequest = { recipientAllowanceId: "1234567890123", amountUnits: "1000000" };
const PINNED_HEX: SerializedDeployment = {
  clusterId: 0,
  programIdHex: toHex(PINNED.programId),
  programIdBase58: "",
  mintHex: toHex(PINNED.mint),
  mintBase58: "",
  serverPublicKeyHex: E2E_SERVER_KEY_HEX,
};
const answer = (status: number, body: unknown, retryAfterSeconds: number | null = null) => ({ status, body, retryAfterSeconds });

// docs/ALLOWANCE-ID-QR.md: "LOKA-ALLOWANCE:<id>", prefix exact and case-sensitive,
// <id> a canonical decimal u64, whitespace ignored only around the whole text; or the bare id.
test.describe("parseRecipient: the phone's LOKA-ALLOWANCE:<id> code or the bare id, exactly as docs/ALLOWANCE-ID-QR.md defines it", () => {
  test("both forms round-trip to the same canonical id", () => {
    for (const id of ["0", "1", "42", "1234567890123", "18446744073709551615"]) {
      const code = `${ALLOWANCE_CODE_PREFIX}${id}`;
      expect(parseRecipient(code), code).toEqual({ ok: true, value: id });
      expect(parseRecipient(id), id).toEqual({ ok: true, value: id });
      // The id goes back into the same code: the round trip is exact.
      const back = parseRecipient(code);
      expect(back.ok && `${ALLOWANCE_CODE_PREFIX}${back.value}`).toBe(code);
      // Whitespace around the whole text only.
      expect(parseRecipient(`  \n${code}\t `)).toEqual({ ok: true, value: id });
      expect(parseRecipient(` ${id} `)).toEqual({ ok: true, value: id });
    }
  });

  test("everything else is refused by name, so it is never sent to the API", () => {
    const refused: Array<[string, string]> = [
      ["", "empty"],
      ["   ", "empty"],
      [ALLOWANCE_CODE_PREFIX, "no_id"],
      ["loka-allowance:42", "prefix_case"],
      ["Loka-Allowance:42", "prefix_case"],
      ["LOKA-ALLOWANCE:-42", "sign"],
      ["-1", "sign"],
      ["+42", "sign"],
      ["007", "leading_zero"],
      ["LOKA-ALLOWANCE:00", "leading_zero"],
      ["LOKA-ALLOWANCE:042", "leading_zero"],
      ["18446744073709551616", "too_large"],
      ["LOKA-ALLOWANCE:18446744073709551616", "too_large"],
      ["999999999999999999999", "too_large"],
      ["LOKA-ALLOWANCE: 42", "not_digits"],
      ["4 2", "not_digits"],
      ["1,000", "not_digits"],
      ["1e5", "not_digits"],
      ["12a", "not_digits"],
      ["0x10", "not_digits"],
      ["LOKA:42", "not_digits"],
      ["LOKA-ALLOWANCE:abc", "not_digits"],
    ];
    for (const [input, code] of refused) {
      const r = parseRecipient(input);
      expect(r.ok, input).toBe(false);
      if (!r.ok) {
        expect(r.code, input).toBe(code);
        expect(r.problem.length, input).toBeGreaterThan(0);
      }
    }
  });
});

test.describe("parseSendAmount: more than 0, at most 1.00 sandbox USDC, at most 6 decimals, in base units", () => {
  test("accepted", () => {
    const ok: Array<[string, string]> = [
      ["1", "1000000"],
      ["1.00", "1000000"],
      ["1.000000", "1000000"],
      ["0.25", "250000"],
      [".5", "500000"],
      ["$0.50", "500000"],
      [" 0.000001 ", "1"],
    ];
    for (const [input, value] of ok) expect(parseSendAmount(input), input).toEqual({ ok: true, value });
  });

  test("refused", () => {
    for (const input of ["", "0", "0.00", "0.0000001", "1.000001", "1.01", "2", "-1", "abc", "1,00", "1.", "1e-3", "$"]) {
      expect(parseSendAmount(input).ok, input).toBe(false);
    }
  });
});

test("the request body is exactly the two contract fields, in base units as decimal strings", () => {
  expect(requestBody(REQUEST)).toBe('{"recipientAllowanceId":"1234567890123","amountUnits":"1000000"}');
  expect(Object.keys(JSON.parse(requestBody(REQUEST)))).toEqual(["recipientAllowanceId", "amountUnits"]);
});

test.describe("classifyAnswer: status plus error NAME, never the message", () => {
  const cert = { allowanceId: BigInt(77), cap: BigInt(1_000_000) };

  test("201 is a new send, 200 the repeat of the first one", () => {
    const created = classifyAnswer(answer(201, successBody(REQUEST.recipientAllowanceId, cert)), REQUEST);
    expect(created.kind).toBe("success");
    if (created.kind === "success") {
      expect(created.created).toBe(true);
      expect(created.success.allowanceId).toBe("77");
      expect(created.success.signature).toBe(TEST_TX);
    }
    const repeat = classifyAnswer(answer(200, successBody(REQUEST.recipientAllowanceId, cert)), REQUEST);
    expect(repeat.kind === "success" && repeat.created).toBe(false);
  });

  test("a success body off the contract is unexpected, never shown as sent", () => {
    const good = successBody(REQUEST.recipientAllowanceId, cert);
    const bad: Array<[unknown, string]> = [
      [null, "not a JSON object"],
      [{ ...good, recipientAllowanceId: "1" }, "different recipient"],
      [{ ...good, allowanceId: 77 }, "not a u64"],
      [{ ...good, allowanceId: "18446744073709551616" }, "not a u64"],
      [{ ...good, allow: undefined }, "no allowance certificate"],
      [{ ...good, allow: `${good.allow}=` }, "not canonical base64url"],
      [{ ...good, earmarks: ["ABC"] }, "earmarks"],
      [{ ...good, signature: "not-base58!" }, "transaction signature"],
      [{ ...good, signature: "1111" }, "transaction signature"],
      [{ ...good, sandbox: false }, "sandbox"],
    ];
    for (const [body, detail] of bad) {
      const o = classifyAnswer(answer(201, body), REQUEST);
      expect(o.kind, detail).toBe("unexpected");
      if (o.kind === "unexpected") expect(o.detail).toContain(detail);
    }
  });

  test("202 pending carries the saved signature (or null) and retryAfter", () => {
    expect(classifyAnswer(answer(202, pendingBody(REQUEST.recipientAllowanceId)), REQUEST)).toEqual({ kind: "pending", signature: null, retryAfterSeconds: 2 });
    expect(classifyAnswer(answer(202, pendingBody(REQUEST.recipientAllowanceId, TEST_TX, 4)), REQUEST)).toEqual({ kind: "pending", signature: TEST_TX, retryAfterSeconds: 4 });
    expect(classifyAnswer(answer(202, { status: "done" }), REQUEST).kind).toBe("unexpected");
    expect(classifyAnswer(answer(202, pendingBody(REQUEST.recipientAllowanceId, "zz")), REQUEST).kind).toBe("unexpected");
  });

  test("every named refusal maps by its name", () => {
    const table: Array<[number, string, string]> = [
      [422, "amount_cap", "refused"],
      [422, "unknown_allowance", "refused"],
      [429, "budget_exhausted", "refused"],
      [429, "rate_limited", "refused"],
      [503, "chain_unavailable", "refused"],
      [400, "bad_json", "refused"],
      [500, "internal_error", "refused"],
    ];
    for (const [status, error] of table) {
      const o = classifyAnswer(answer(status, { error, message: "whatever the server wrote" }, 3600), REQUEST);
      expect(o, error).toEqual({ kind: "refused", error, retryAfterSeconds: 3600 });
    }
    expect(Object.keys(REFUSALS).sort()).toEqual(table.map((r) => r[1]).sort());
    // Only chain_unavailable and internal_error invite sending the same request again.
    expect(Object.entries(REFUSALS).filter(([, r]) => r.retryable).map(([n]) => n).sort()).toEqual(["chain_unavailable", "internal_error"]);
  });

  test("409 remittance_failed is a failed transaction, with its signature when the server sends one", () => {
    expect(classifyAnswer(answer(409, { error: "remittance_failed", signature: TEST_FAILED_TX }), REQUEST)).toEqual({ kind: "failed_on_chain", signature: TEST_FAILED_TX });
    expect(classifyAnswer(answer(409, { error: "remittance_failed" }), REQUEST)).toEqual({ kind: "failed_on_chain", signature: null });
  });

  test("404 unknown_route means the server does not run the route; other 404s and unknown names are unexpected", () => {
    expect(classifyAnswer(answer(404, { error: "unknown_route", message: "Unknown API route." }), REQUEST)).toEqual({ kind: "server_off" });
    expect(classifyAnswer(answer(404, { message: "Not Found" }), REQUEST).kind).toBe("unexpected");
    expect(classifyAnswer(answer(418, { error: "teapot" }), REQUEST)).toEqual({ kind: "unexpected", status: 418, detail: 'error "teapot"' });
    // The message is never read: a message naming a refusal does not make it one.
    expect(classifyAnswer(answer(429, { message: "budget_exhausted" }), REQUEST).kind).toBe("unexpected");
  });
});

/** A fake network and clock: answers in order, time moves only when the page sleeps. */
function fake(answers: PostResult[]) {
  let t = 1_000_000;
  const bodies: string[] = [];
  const sleeps: number[] = [];
  const pendings: Array<[string | null, number]> = [];
  return {
    bodies,
    sleeps,
    pendings,
    deps: {
      post: async (body: string) => {
        bodies.push(body);
        const next = answers.shift();
        if (!next) throw new Error("the fake network ran out of answers");
        return next;
      },
      sleep: async (ms: number) => {
        sleeps.push(ms);
        t += ms;
      },
      now: () => t,
      onPending: (p: { signature: string | null }, wait: number) => pendings.push([p.signature, wait]),
    },
  };
}
const http = (status: number, body: unknown): PostResult => ({ kind: "answer", status, body, retryAfterSeconds: null });

test.describe("sendRemittance: the pending repost loop, with a fake clock", () => {
  test("202, 202, then 201: the SAME request is sent three times, waiting retryAfter between", async () => {
    const id = REQUEST.recipientAllowanceId;
    const f = fake([http(202, pendingBody(id)), http(202, pendingBody(id, TEST_TX)), http(201, successBody(id, { allowanceId: BigInt(5), cap: BigInt(1_000_000) }))]);
    const out = await sendRemittance(REQUEST, f.deps);
    expect(out.kind).toBe("success");
    expect(f.bodies).toEqual([requestBody(REQUEST), requestBody(REQUEST), requestBody(REQUEST)]);
    expect(f.sleeps).toEqual([2000, 2000]);
    expect(f.pendings).toEqual([
      [null, 2],
      [TEST_TX, 2],
    ]);
  });

  test("bounded: a send that stays pending stops at 30 s with its saved signature, never spins", async () => {
    const id = REQUEST.recipientAllowanceId;
    const f = fake(Array.from({ length: 100 }, () => http(202, pendingBody(id, TEST_TX))));
    const out = await sendRemittance(REQUEST, f.deps);
    expect(out).toEqual({ kind: "still_pending", signature: TEST_TX });
    // Posts at 0, 2, 4, ... 30 s: 16 posts and 15 waits, never a wait past the bound.
    expect(f.bodies.length).toBe(16);
    expect(f.sleeps.reduce((a, b) => a + b, 0)).toBe(PENDING_BOUND_MS);
  });

  test("retryAfter is held to 1 to 10 seconds", async () => {
    expect([0, -5, 0.2, 1, 2.5, 10, 60, 3600].map(repostDelaySeconds)).toEqual([1, 1, 1, 1, 3, 10, 10, 10]);
    const id = REQUEST.recipientAllowanceId;
    const f = fake([http(202, pendingBody(id, null, 3600)), http(409, { error: "remittance_failed" })]);
    expect((await sendRemittance(REQUEST, f.deps)).kind).toBe("failed_on_chain");
    expect(f.sleeps).toEqual([10_000]);
  });

  test("no answer (network or timeout) and every refusal end the loop at once, with no repost", async () => {
    for (const result of [
      { kind: "network", reason: "could not reach api.zerobars.us" } as PostResult,
      { kind: "timeout", seconds: 20 } as PostResult,
      http(503, { error: "chain_unavailable" }),
      http(404, { error: "unknown_route" }),
    ]) {
      const f = fake([result]);
      const out = await sendRemittance(REQUEST, f.deps);
      expect(out.kind).not.toBe("pending");
      expect(f.bodies.length).toBe(1);
      expect(f.sleeps).toEqual([]);
    }
  });
});

test("parseRetryAfter reads whole seconds only", () => {
  expect(parseRetryAfter("3600")).toBe(3600);
  expect(parseRetryAfter(" 60 ")).toBe(60);
  expect(parseRetryAfter(null)).toBeNull();
  expect(parseRetryAfter("Wed, 21 Oct 2015 07:28:00 GMT")).toBeNull();
  expect(parseRetryAfter("-1")).toBeNull();
});

test.describe("verifyCertificate: the returned ALLOW against the server key, before any code is drawn", () => {
  const success = (wire: Uint8Array, allowanceId: string, earmarks: string[] = []): RemittanceSuccess => ({
    recipientAllowanceId: REQUEST.recipientAllowanceId,
    allowanceId,
    allowBytes: wire,
    earmarks,
    signature: TEST_TX,
  });

  test("a certificate the key signed for this deployment verifies, with its fields", () => {
    const wire = testAllowanceWire({ allowanceId: BigInt(9), cap: BigInt(750_000), earmarks: TEST_EARMARKS });
    const v = verifyCertificate(success(wire, "9", TEST_EARMARKS), PINNED_HEX);
    expect(v).toEqual({
      verified: true,
      certificate: {
        allowanceId: "9",
        payerKeyHashHex: toHex(TEST_PAYER_KEY_HASH),
        capUnits: "750000",
        offlineLimitUnits: "750000",
        expiry: "1792000000",
        earmarks: TEST_EARMARKS,
        bondUnits: "0",
      },
    });
  });

  test("one changed byte, another key, another deployment, another allowance or other earmarks: Not verified", () => {
    const wire = testAllowanceWire({ allowanceId: BigInt(9), cap: BigInt(750_000) });
    const flipped = Uint8Array.from(wire);
    flipped[130] ^= 0x01; // a byte of the offline limit (ALLOW_V1 offsets 129 to 136)
    expect(verifyCertificate(success(flipped, "9"), PINNED_HEX)).toEqual({ verified: false, reason: "its signature does not match the server key" });

    const otherKey = { ...PINNED_HEX, serverPublicKeyHex: "11".repeat(32) };
    expect(verifyCertificate(success(wire, "9"), otherKey).verified).toBe(false);

    // The published vector allowance is signed by the same test key for the vector deployment.
    const vectors = JSON.parse(readFileSync(path.join(__dirname, "..", "..", "protocol", "vectors", "payment-v1.json"), "utf8"));
    const vectorWire = fromHex(vectors.allowances[0].wireHex);
    expect(verifyCertificate(success(vectorWire, "9"), PINNED_HEX)).toEqual({ verified: false, reason: "it names a different program" });

    expect(verifyCertificate(success(wire, "10"), PINNED_HEX)).toEqual({ verified: false, reason: "the certificate is for allowance 9, not 10" });
    expect(verifyCertificate(success(wire, "9", TEST_EARMARKS), PINNED_HEX)).toEqual({
      verified: false,
      reason: "the certificate's earmarks differ from the ones the answer lists",
    });
    expect(verifyCertificate(success(wire.subarray(0, 200), "9"), PINNED_HEX)).toEqual({ verified: false, reason: "the certificate is too short" });
  });

  test("the code is PAYMENT-V1 section 5 content of kind A that decodes back to the same bytes", () => {
    const wire = testAllowanceWire({ allowanceId: BigInt(9), cap: BigInt(1_000_000), earmarks: TEST_EARMARKS });
    const code = allowanceCode(wire);
    expect(code).toBe(`L1|P|1|A|${base64urlEncode(wire)}`);
    const back = decodeTransport(code);
    expect(back?.kind).toBe("A");
    expect(toHex(back!.payload)).toBe(toHex(wire));
  });
});
