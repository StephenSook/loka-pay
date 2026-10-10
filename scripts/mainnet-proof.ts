import { mainnetProofCli } from '../server/src/proof/mainnet.js';
mainnetProofCli().catch(() => {
  console.error('Proof stopped. Inspect any printed signature before another run. Nothing is automatically retried.');
  process.exitCode = 1;
});
