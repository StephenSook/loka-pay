import { runRedeems } from '../server/src/volume/run.js';
runRedeems('load_test').catch(() => { console.error('Load test stopped. Inspect saved signatures; never automatically repeat uncertain sends.'); process.exitCode = 1; });
