import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { expect, test } from "@playwright/test";
import { readReservesUncached } from "../lib/chain";
import { PINS } from "../lib/pins";
import { TOKEN_PROGRAM } from "../lib/vault";
import { allowanceBytes, merchantBytes, tokenAccountBytes } from "./accounts";
import { base64 } from "./bytes";

// The proof-of-reserves reader (lib/chain.ts readReservesUncached) against a TEST FIXTURE
// node on 127.0.0.1 that answers getProgramAccounts and getMultipleAccounts from accounts
// built here field by field. No request leaves this machine.

interface Account {
  owner: string;
  data: Uint8Array;
}

/** A fake devnet: its accounts, a slot that moves forward with every request, and a hook run before each answer. */
class FakeNode {
  slot = 600_000_000;
  readonly accounts = new Map<string, Account>();
  readonly calls: string[] = [];
  beforeAnswer: (method: string) => void = () => {};

  answer(method: string, params: unknown[]): unknown {
    this.calls.push(method);
    this.beforeAnswer(method);
    this.slot += 1;
    const context = { slot: this.slot };
    if (method === "getProgramAccounts") {
      const owned = [...this.accounts.entries()].filter(([, a]) => a.owner === params[0]);
      return {
        context,
        value: owned.map(([pubkey, a]) => ({
          pubkey,
          account: { data: [base64(a.data.subarray(0, 8)), "base64"], executable: false, owner: a.owner, lamports: 1, space: a.data.length },
        })),
      };
    }
    if (method === "getMultipleAccounts") {
      return {
        context,
        value: (params[0] as string[]).map((address) => {
          const a = this.accounts.get(address);
          return a ? { data: [base64(a.data), "base64"], executable: false, owner: a.owner, lamports: 1, space: a.data.length } : null;
        }),
      };
    }
    throw new Error(`not in the test fixture: ${method}`);
  }
}

const ALLOWANCE = PINS.wallets.canary;
const MERCHANT = PINS.wallets.send;

/** A vault holding 7.00 against an allowance (cap 5.00, redeemed 2.50, bond 1.00) and a merchant owed 2.50. */
function healthyNode(): FakeNode {
  const node = new FakeNode();
  node.accounts.set(PINS.accounts.vaultUsdcAccount, { owner: TOKEN_PROGRAM, data: tokenAccountBytes(PINS.mint, PINS.accounts.vault, BigInt(7_000_000)) });
  node.accounts.set(ALLOWANCE, {
    owner: PINS.programId,
    data: allowanceBytes({ id: BigInt(1), cap: BigInt(5_000_000), redeemed: BigInt(2_500_000), bond: BigInt(1_000_000), funder: PINS.wallets.tableDemo }),
  });
  node.accounts.set(MERCHANT, { owner: PINS.programId, data: merchantBytes(BigInt(2_500_000)) });
  return node;
}

let server: Server;
let url = "";
let node: FakeNode = healthyNode();

test.beforeAll(async () => {
  server = createServer((req, res) => {
    let body = "";
    req.on("data", (chunk) => (body += chunk));
    req.on("end", () => {
      const call = JSON.parse(body) as { id: number; method: string; params: unknown[] };
      let message: object;
      try {
        message = { jsonrpc: "2.0", id: call.id, result: node.answer(call.method, call.params) };
      } catch (e) {
        message = { jsonrpc: "2.0", id: call.id, error: { code: -32601, message: String(e) } };
      }
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify(message));
    });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  url = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

test.afterAll(async () => {
  server.closeAllConnections();
  await new Promise((resolve) => server.close(resolve));
});

const read = () => readReservesUncached({ url, retries: 0 });

test("a healthy vault: every balance from one call, exact totals in base units", async () => {
  node = healthyNode();
  const r = await read();
  expect(r.totals).toEqual({
    assets: "7000000",
    allowanceRemaining: "2500000",
    bonds: "1000000",
    merchantBalances: "2500000",
    liabilities: "6000000",
    difference: "1000000",
  });
  expect(r.vault).toMatchObject({ mint: PINS.mint, owner: PINS.accounts.vault, mintMatchesPins: true, ownerIsVault: true });
  expect(r.allowances.map((a) => a.address)).toEqual([ALLOWANCE]);
  expect(r.merchants.map((m) => m.address)).toEqual([MERCHANT]);
  // Listed, then every balance in one call, then listed again at or after that call's slot.
  expect(node.calls).toEqual(["getProgramAccounts", "getMultipleAccounts", "getProgramAccounts"]);
  expect(r.listedAt.first).toBeLessThan(r.slot);
  expect(r.listedAt.check).toBeGreaterThan(r.slot);
});

test.describe("an asset that is not the pinned sandbox USDC in the program's vault gets no verdict", () => {
  test("a vault account the SPL Token program does not own (here the system program)", async () => {
    node = healthyNode();
    node.accounts.set(PINS.accounts.vaultUsdcAccount, {
      owner: "11111111111111111111111111111111",
      data: tokenAccountBytes(PINS.mint, PINS.accounts.vault, BigInt(7_000_000)),
    });
    await expect(read()).rejects.toThrow(/owned by 11111111111111111111111111111111, not the SPL Token program; no reserves verdict/);
  });

  test("a token account for another mint", async () => {
    node = healthyNode();
    node.accounts.set(PINS.accounts.vaultUsdcAccount, { owner: TOKEN_PROGRAM, data: tokenAccountBytes(PINS.wallets.canary, PINS.accounts.vault, BigInt(7_000_000)) });
    await expect(read()).rejects.toThrow(/not the pinned devnet USDC mint; no reserves verdict/);
  });

  test("a token account whose authority is not the program's vault account", async () => {
    node = healthyNode();
    node.accounts.set(PINS.accounts.vaultUsdcAccount, { owner: TOKEN_PROGRAM, data: tokenAccountBytes(PINS.mint, PINS.wallets.send, BigInt(7_000_000)) });
    await expect(read()).rejects.toThrow(/not the program's vault account; no reserves verdict/);
  });
});
