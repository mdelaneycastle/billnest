import test from 'node:test';
import assert from 'node:assert/strict';
import { indexedDB } from 'fake-indexeddb';
import {
  attachmentLimits, attachFile, createBackup, mergeBackup, prepareAttachment, readBackup
} from '../dist/attachments.js';

globalThis.indexedDB = indexedDB;
const id = '72f35576-fb5b-46e4-ac34-14cfbf63bc1f';
const record = {
  id, title: 'Policy', provider: 'Example', category: 'insurance', amount: 12000,
  frequency: 'annual', payment: '', renewal: '2027-01-10', reference: '', contact: '', notes: '',
  lead: 7, anchorDay: 10, archived: false, revision: 1
};
const state = { records: [record], revision: 1, push: null, showExamples: false };
const pdf = new File(['%PDF-1.4\nDocument test\n%%EOF'], 'policy.pdf', { type: 'application/pdf' });
const pngBytes = Uint8Array.from([137, 80, 78, 71, 13, 10, 26, 10, 0, 0, 0, 0]);
const png = new File([pngBytes], 'screenshot.png', { type: 'image/png' });

test('accepts PDF and image signatures, bounds size, sanitizes names and rejects executable uploads', async () => {
  const file = await prepareAttachment(pdf);
  assert.equal(file.type, 'application/pdf');
  assert.equal(file.blob.size, pdf.size);
  assert.equal((await prepareAttachment(png)).type, 'image/png');
  await assert.rejects(prepareAttachment(new File(['<svg onload="alert(1)">'], 'image.png', { type: 'image/png' })), /Choose a PDF/);
  await assert.rejects(prepareAttachment(new File([], 'empty.pdf')), /empty/);
  await assert.rejects(prepareAttachment(new File([new Uint8Array(attachmentLimits.file + 1)], 'large.pdf')), /5 MB/);
  assert.equal((await prepareAttachment(new File([pdf], '../policy.pdf'))).name, '.._policy.pdf');
});

test('round trips attachments with archived bills and accepts existing v1 backups', async () => {
  const file = await prepareAttachment(pdf);
  const withFile = attachFile({ ...state, records: [{ ...record, archived: true }] }, id, file);
  const backup = JSON.parse(JSON.stringify(await createBackup(withFile, [file])));
  assert.equal(backup.version, 2);
  assert.equal(backup.records[0].attachments, undefined);
  const restored = await readBackup(backup);
  assert.equal(restored.records[0].archived, true);
  assert.equal(restored.records[0].attachments[0].name, 'policy.pdf');
  assert.equal(await restored.files[0].blob.text(), await pdf.text());
  const legacy = await readBackup({ app: 'billnest', version: 1, records: [record] });
  assert.equal(legacy.records[0].id, id);
  assert.deepEqual(legacy.files, []);
  await assert.rejects(createBackup(withFile, []), /could not be read/);
});

test('rejects corrupt files, conflicting metadata, duplicates and orphans before import', async () => {
  const file = await prepareAttachment(pdf);
  const backup = await createBackup(attachFile(state, id, file), [file]);
  for (const override of [{ type: 'image/png' }, { data: '!'.repeat(backup.attachments[0].data.length) },
    { size: file.size + 1 }, { name: '<script>/file.pdf' }, { recordId: crypto.randomUUID() }]) {
    await assert.rejects(readBackup({ ...backup, attachments: [{ ...backup.attachments[0], ...override }] }));
  }
  await assert.rejects(readBackup({ ...backup, attachments: [...backup.attachments, ...backup.attachments] }), /invalid/);
});

test('merges new bills with files while preserving all data on existing bills', async () => {
  const file = await prepareAttachment(pdf);
  const incoming = await readBackup(await createBackup(attachFile(state, id, file), [file]));
  const empty = { ...state, records: [] };
  const merged = mergeBackup(empty, incoming);
  assert.equal(merged.count, 1);
  assert.equal(merged.files.length, 1);
  const repeated = mergeBackup(merged.state, incoming);
  assert.equal(repeated.count, 0);
  assert.equal(repeated.files.length, 0);
  assert.equal(repeated.state.records.length, 1);
  assert.equal(repeated.state.records[0].attachments.length, 1);
  const tooMany = { ...record, attachments: Array.from({ length: 10 }, () => ({ ...file })) };
  assert.throws(() => attachFile({ ...state, records: [tooMany] }, id, file), /10 files/);
});

test('upgrades old storage, commits file and metadata atomically, and keeps concurrent changes', async () => {
  await new Promise((resolve, reject) => {
    const request = indexedDB.open('billnest-local', 1);
    request.onupgradeneeded = () => request.result.createObjectStore('household');
    request.onerror = () => reject(request.error);
    request.onsuccess = () => {
      const db = request.result;
      const transaction = db.transaction('household', 'readwrite');
      transaction.objectStore('household').put(state, 'current');
      transaction.oncomplete = () => { db.close(); resolve(); };
    };
  });
  const storage = await import('../dist/storage.js');
  assert.equal((await storage.readState()).records[0].title, 'Policy');
  const file = await prepareAttachment(pdf);
  const image = await prepareAttachment(png);
  await Promise.all([storage.saveAttachment(id, file), storage.saveAttachment(id, image)]);
  const saved = await storage.readState();
  assert.equal(saved.records[0].attachments.length, 2);
  assert.equal(saved.revision, 3);
  assert.equal(await (await storage.readAttachment(file.id)).text(), await pdf.text());

  // A clone failure after the metadata write must roll the entire transaction back.
  const uncloneable = { ...await prepareAttachment(pdf), blob: { size: pdf.size, invalid: () => {} } };
  await assert.rejects(storage.saveAttachment(id, uncloneable));
  assert.deepEqual(await storage.readState(), saved);
  assert.equal(await storage.readAttachment(uncloneable.id), undefined);

  const snapshot = await storage.backupSnapshot();
  assert.equal(snapshot.files.length, 2);
  const backup = await createBackup(snapshot.state, snapshot.files);
  await storage.changeState(previous => ({ ...previous, records: [] }));
  const restored = await storage.importBackup(await readBackup(backup));
  assert.equal(restored.count, 1);
  assert.equal(restored.state.records[0].attachments.length, 2);

  await storage.removeAttachment(id, file.id);
  assert.equal(await storage.readAttachment(file.id), undefined);
  const afterRemoval = await storage.readState();
  await assert.rejects(storage.removeAttachment(id, file.id), /already been removed/);
  assert.deepEqual(await storage.readState(), afterRemoval);
  assert.equal(afterRemoval.records[0].attachments.length, 1);
});
