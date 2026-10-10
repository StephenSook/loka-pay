import * as fs from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, expect, test, vi } from 'vitest';
import { saveJournal } from './journal.js';

vi.mock('node:fs', async importOriginal => {
  const actual = await importOriginal<typeof fs>();
  return { ...actual, writeFileSync: vi.fn(actual.writeFileSync), renameSync: vi.fn(actual.renameSync) };
});
const folders: string[] = [];
afterEach(() => {
  vi.restoreAllMocks();
  for (const folder of folders.splice(0)) fs.rmSync(folder, { recursive: true, force: true });
});
function fixture() {
  const folder = fs.mkdtempSync(join(tmpdir(), 'loka-journal-')); folders.push(folder);
  const path = join(folder, 'redeem.json');
  const previous = { attempts: [{ signature: 'saved-before-broadcast' }], complete: false };
  fs.writeFileSync(path, JSON.stringify(previous));
  return { folder, path, previous };
}
test('journal replacement renames a complete temporary file in the same directory', () => {
  const f = fixture(), next = { ...f.previous, complete: true };
  vi.mocked(fs.renameSync).mockImplementationOnce((from, to) => {
    expect(fs.readFileSync(f.path, 'utf8')).toBe(JSON.stringify(f.previous));
    expect(JSON.parse(fs.readFileSync(from, 'utf8'))).toEqual(next);
    expect(to).toBe(f.path);
    expect(fs.readdirSync(f.folder)).toHaveLength(2);
    fs.renameSync(from, to);
  });
  saveJournal(f.path, next);
  expect(JSON.parse(fs.readFileSync(f.path, 'utf8'))).toEqual(next);
  expect(fs.readdirSync(f.folder)).toEqual(['redeem.json']);
});
test('an interrupted temporary write preserves the previous evidence', () => {
  const f = fixture();
  vi.mocked(fs.writeFileSync).mockImplementationOnce((path, _data, options) => {
    fs.writeFileSync(path, '{"partial":', options); throw new Error('interrupted write');
  });
  expect(() => saveJournal(f.path, { complete: true })).toThrow('interrupted write');
  expect(JSON.parse(fs.readFileSync(f.path, 'utf8'))).toEqual(f.previous);
  expect(fs.readdirSync(f.folder)).toEqual(['redeem.json']);
});
test('a failed rename preserves the previous evidence and reports failure', () => {
  const f = fixture(); vi.mocked(fs.renameSync).mockImplementationOnce(() => { throw new Error('rename refused'); });
  expect(() => saveJournal(f.path, { complete: true })).toThrow('rename refused');
  expect(JSON.parse(fs.readFileSync(f.path, 'utf8'))).toEqual(f.previous);
  expect(fs.readdirSync(f.folder)).toEqual(['redeem.json']);
});
