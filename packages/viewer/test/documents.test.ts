import { describe, expect, it } from 'vitest';
import {
  addDocuments,
  documentsBlocking,
  documentSize,
  keptDocuments,
  pastedFiles,
  readDocuments,
  type DocumentEntry,
} from '../src/workspaces/documents.js';

const ID = 'a'.repeat(32);
const LIMITS = { maxFiles: 3, maxBytes: 100, maxTotal: 250 };
const file = (name: string, size: number) => ({ name, size });
const kept = (name: string, size: number, id = ID): DocumentEntry => ({
  key: `${name}-${id}`,
  name,
  size,
  state: 'kept',
  id,
});

describe('readDocuments (V40)', () => {
  it("reads the draft's kept documents; anything else is none", () => {
    const documents = [{ id: ID, name: 'spec.pdf', size: 12 }];
    expect(readDocuments({ documents })).toEqual([
      { key: ID, name: 'spec.pdf', size: 12, state: 'kept', id: ID },
    ]);
    for (const draft of [
      null,
      'x',
      {},
      { documents: 'spec.pdf' },
      { documents: [{ id: 'x', name: 'a', size: 1 }] },
      { documents: [{ id: ID, name: 3, size: 1 }] },
      { documents: [{ id: ID, name: 'a', size: -1 }] },
      { documents: [null] },
    ]) {
      expect(readDocuments(draft), JSON.stringify(draft)).toEqual([]);
    }
  });
});

describe('pastedFiles (V40)', () => {
  const clipboard = (text: string, files: { name: string; type: string }[]) => ({
    getData: (type: string) => (type === 'text/plain' ? text : ''),
    files: files as unknown as File[],
  });
  it("is the clipboard's files of any kind, unless it holds text: text pastes as text (V36's rule)", () => {
    const shot = { name: 'image.png', type: 'image/png' };
    const pdf = { name: 'spec.pdf', type: 'application/pdf' };
    expect(pastedFiles(clipboard('', [shot, pdf]))).toEqual([shot, pdf]);
    expect(pastedFiles(clipboard('A1\tB1', [shot]))).toEqual([]);
    expect(pastedFiles(clipboard('', []))).toEqual([]);
    expect(pastedFiles(null)).toEqual([]);
  });
});

describe('addDocuments (V40)', () => {
  it('lists each file to upload, or why it cannot be: too large, one too many, too much in all', () => {
    const listed = [kept('a.md', 100)];
    const added = addDocuments(
      listed,
      [
        file('b.png', 101),
        file('c.pdf', 100),
        file('d.txt', 60),
        file('e.txt', 1),
        file('f.txt', 1),
      ],
      LIMITS,
    );
    // Those not added count for nothing.
    expect(added.map(({ name, state, error }) => [name, state, error])).toEqual([
      ['a.md', 'kept', undefined],
      ['b.png', 'failed', 'Larger than 100 B.'],
      ['c.pdf', 'uploading', undefined],
      ['d.txt', 'failed', 'More than 250 B in all.'],
      ['e.txt', 'uploading', undefined],
      ['f.txt', 'failed', 'More than 3 files.'],
    ]);
    // Each its own key, for its row and its upload.
    expect(new Set(added.map((d) => d.key)).size).toBe(added.length);
  });
});

describe('documentsBlocking (V40)', () => {
  it('says why Start waits: a file on its way, or one not kept; nothing once all are kept', () => {
    expect(documentsBlocking([])).toBeNull();
    expect(documentsBlocking([kept('a.md', 1)])).toBeNull();
    const uploading: DocumentEntry = { key: 'k', name: 'b.png', size: 2, state: 'uploading' };
    expect(documentsBlocking([kept('a.md', 1), uploading])).toBe('A file is being added.');
    const failed: DocumentEntry = { ...uploading, state: 'failed', error: 'Larger than 20 MB.' };
    expect(documentsBlocking([failed])).toBe('b.png was not added: remove it to start.');
    expect(keptDocuments([kept('a.md', 1), uploading, failed])).toEqual([{ id: ID, name: 'a.md' }]);
  });
});

describe('documentSize (V40)', () => {
  it('reads as bytes, KB or MB, one decimal under 10', () => {
    expect(documentSize(0)).toBe('0 B');
    expect(documentSize(999)).toBe('999 B');
    expect(documentSize(1536)).toBe('1.5 KB');
    expect(documentSize(204_800)).toBe('200 KB');
    expect(documentSize(3_250_000)).toBe('3.1 MB');
    expect(documentSize(20 * 1024 * 1024)).toBe('20 MB');
  });
});
