import { runRedeems } from '../server/src/volume/run.js';
runRedeems('measurement').catch(() => { console.error('Measurement stopped. Inspect the output journal; no automatic resend.'); process.exitCode = 1; });
