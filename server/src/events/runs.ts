import type { RunWindow } from './stats.js';

// Frozen measurement windows for GET /api/stats?run=<id>, as unix seconds on the server's upload clock.
// EXP-PAY-001 is the task 3.6 real-run session. Its window is null until that session ends: fill it from
// experiments/EXP-PAY-001.md in a reviewed PR, after which the figures for the run no longer change.
export const RUNS: Record<string, RunWindow | null> = {
  'EXP-PAY-001': null,
};
