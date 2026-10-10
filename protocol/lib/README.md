# @lokapay/protocol

PAYMENT-V1 (`protocol/PAYMENT-V1.md`) in JavaScript for the settlement server and the web pages: encode, decode and verify every structure, the ordered note checks with named errors, receipt and conflict bindings, the `L1|P|1|...` transport, base units, and the secp256r1 precompile instruction data.

Plain ESM with `src/index.d.ts`, so TypeScript and JavaScript import it with no build step:

```jsonc
// server/package.json or web/package.json
"dependencies": { "@lokapay/protocol": "link:../protocol/lib" }
```

```ts
import { validateNoteWire, secp256r1InstructionData, signConfWire } from '@lokapay/protocol';

const v = validateNoteWire(wireBytes, deployment); // throws PaymentError with .code, e.g. "high_s"
const data = secp256r1InstructionData([{ publicKey: v.payerPublicKey, signature: v.signature, message: v.noteBytes }]);
```

`pnpm test` runs every vector in `protocol/vectors/payment-v1.json`; `pnpm typecheck` compiles `test/types-check.ts` against the types. CI runs both in `hygiene.yml`. Amounts and ids are `bigint`.
