import { randomUUID } from 'node:crypto';
import { writeFileSync, renameSync, unlinkSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';

export function saveJournal(path: string, report: Record<string, unknown>): void {
  const temporary = join(dirname(path), `.${basename(path)}.${randomUUID()}.tmp`);
  try {
    writeFileSync(temporary, JSON.stringify(report, null, 2) + '\n', { flag: 'wx' });
    renameSync(temporary, path);
  } finally {
    // A crash may leave an orphan temporary file, but never partially overwrites the journal.
    try { unlinkSync(temporary); } catch { /* Already renamed or cleanup unavailable. */ }
  }
}
