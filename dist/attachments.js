import { limits, validateBackup } from './model.js';

export const attachmentLimits = { file: 5 * 1024 * 1024, perBill: 10, total: 50 * 1024 * 1024, backup: 75 * 1024 * 1024 };
const uuid = /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/;
const formats = new Map([
  ['application/pdf', 'PDF'], ['image/jpeg', 'JPEG'], ['image/png', 'PNG'],
  ['image/webp', 'WebP'], ['image/gif', 'GIF'], ['image/heic', 'HEIC'], ['image/heif', 'HEIF']
]);

export const fileSize = size => size >= 1024 * 1024
  ? (size / (1024 * 1024)).toFixed(1) + ' MB' : Math.ceil(size / 1024) + ' KB';
export const fileLabel = type => formats.get(type);
export const attachmentBytes = records => records.reduce((total, record) =>
  total + (record.attachments ?? []).reduce((sum, item) => sum + item.size, 0), 0);

function detectType(bytes) {
  const ascii = (start, length) => String.fromCharCode(...bytes.subarray(start, start + length));
  if (ascii(0, 5) === '%PDF-') return 'application/pdf';
  if (bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255) return 'image/jpeg';
  if ([137, 80, 78, 71, 13, 10, 26, 10].every((value, index) => bytes[index] === value)) return 'image/png';
  if (['GIF87a', 'GIF89a'].includes(ascii(0, 6))) return 'image/gif';
  if (ascii(0, 4) === 'RIFF' && ascii(8, 4) === 'WEBP') return 'image/webp';
  if (ascii(4, 4) === 'ftyp') {
    const brands = [];
    for (let index = 8; index + 4 <= bytes.length; index += 4) brands.push(ascii(index, 4));
    if (brands.some(brand => ['heic', 'heix', 'hevc', 'hevx'].includes(brand))) return 'image/heic';
    if (brands.some(brand => ['mif1', 'msf1'].includes(brand))) return 'image/heif';
  }
  throw new Error('Choose a PDF or a JPEG, PNG, WebP, GIF or HEIC photo.');
}

function validMetadata(file) {
  return file && typeof file.id === 'string' && uuid.test(file.id) &&
    typeof file.name === 'string' && file.name.length > 0 && file.name.length <= 180 &&
    !/[\u0000-\u001f\u007f/\\]/.test(file.name) &&
    Number.isInteger(file.size) && file.size > 0 && file.size <= attachmentLimits.file && formats.has(file.type);
}

export async function prepareAttachment(file) {
  if (!file.size) throw new Error('This file is empty. Choose another file.');
  if (file.size > attachmentLimits.file) throw new Error('Choose a file up to 5 MB.');
  const bytes = new Uint8Array(await file.slice(0, 128).arrayBuffer());
  const type = detectType(bytes);
  const name = file.name.replace(/[\u0000-\u001f\u007f/\\]/g, '_').slice(0, 180).trim() || 'Document';
  return { id: crypto.randomUUID(), name, type, size: file.size, blob: file.slice(0, file.size, type) };
}

export function attachFile(previous, recordId, file) {
  const record = previous.records.find(item => item.id === recordId);
  if (!record) throw new Error('This bill is no longer available. Reopen your bills.');
  if (!validMetadata(file) || file.blob?.size !== file.size) throw new Error('The file could not be saved.');
  if ((record.attachments ?? []).length >= attachmentLimits.perBill) throw new Error('You can attach up to 10 files to each bill.');
  if (attachmentBytes(previous.records) + file.size > attachmentLimits.total) {
    throw new Error('Your documents have reached 50 MB. Back up your bills, then remove files you no longer need.');
  }
  if (previous.records.some(item => item.attachments?.some(entry => entry.id === file.id))) {
    throw new Error('This attachment has already been saved.');
  }
  const { blob, ...metadata } = file;
  return { ...previous, records: previous.records.map(item => item.id === recordId
    ? { ...item, attachments: [...(item.attachments ?? []), metadata], revision: item.revision + 1 } : item) };
}

function base64(bytes) {
  let binary = '';
  for (let start = 0; start < bytes.length; start += 32768) {
    binary += String.fromCharCode(...bytes.subarray(start, start + 32768));
  }
  return btoa(binary);
}

export async function createBackup(state, files) {
  const stored = new Map(files.map(file => [file.id, file.blob]));
  const attachments = [];
  for (const record of state.records) {
    for (const metadata of record.attachments ?? []) {
      const blob = stored.get(metadata.id);
      if (!blob || blob.size !== metadata.size) throw new Error('A document could not be read. Your backup was not created. Try again.');
      attachments.push({ ...metadata, recordId: record.id, data: base64(new Uint8Array(await blob.arrayBuffer())) });
    }
  }
  return { app: 'billnest', version: 2, records: state.records.map(({ revision, attachments, ...record }) => record), attachments };
}

export async function readBackup(data) {
  if (data?.version === 1) return { records: validateBackup(data), files: [] };
  if (data?.version !== 2 || !Array.isArray(data.attachments) || data.attachments.length > limits.records * attachmentLimits.perBill) {
    throw new Error('Choose a valid Outgoings backup.');
  }
  const records = validateBackup({ ...data, version: 1 });
  const recordsById = new Map(records.map(record => [record.id, record]));
  const ids = new Set();
  const files = [];
  let total = 0;
  for (const raw of data.attachments) {
    const record = recordsById.get(raw?.recordId);
    if (!validMetadata(raw) || !record || ids.has(raw.id) ||
        (record.attachments ?? []).length >= attachmentLimits.perBill ||
        typeof raw.data !== 'string' || raw.data.length !== Math.ceil(raw.size / 3) * 4 ||
        /[^A-Za-z0-9+/=]/.test(raw.data)) {
      throw new Error('A document in this backup is invalid. Nothing was imported.');
    }
    total += raw.size;
    if (total > attachmentLimits.total) throw new Error('The backup contains more than 50 MB of documents.');
    let binary;
    try { binary = atob(raw.data); }
    catch { throw new Error('A document in this backup is damaged. Nothing was imported.'); }
    const bytes = Uint8Array.from(binary, char => char.charCodeAt(0));
    if (bytes.length !== raw.size || detectType(bytes.subarray(0, 128)) !== raw.type) {
      throw new Error('A document in this backup is damaged or has the wrong file type.');
    }
    const metadata = { id: raw.id, name: raw.name, type: raw.type, size: raw.size };
    record.attachments ??= [];
    record.attachments.push(metadata);
    ids.add(raw.id);
    files.push({ ...metadata, recordId: record.id, blob: new Blob([bytes], { type: raw.type }) });
  }
  return { records, files };
}

export function mergeBackup(previous, incoming) {
  const existing = new Set(previous.records.map(record => record.id));
  const addedRecords = incoming.records.filter(record => !existing.has(record.id));
  if (previous.records.length + addedRecords.length > limits.records) throw new Error('Import would exceed the 500-bill limit.');
  const addedIds = new Set(addedRecords.map(record => record.id));
  const files = incoming.files.filter(file => addedIds.has(file.recordId));
  const existingFiles = new Set(previous.records.flatMap(record => (record.attachments ?? []).map(file => file.id)));
  if (files.some(file => existingFiles.has(file.id))) throw new Error('A document ID conflicts with a saved file. Nothing was imported.');
  if (attachmentBytes(previous.records) + attachmentBytes(addedRecords) > attachmentLimits.total) {
    throw new Error('Import would exceed the 50 MB document limit. Nothing was imported.');
  }
  return { state: { ...previous, records: [...addedRecords, ...previous.records], showExamples: false },
    files, count: addedRecords.length, skipped: incoming.records.length - addedRecords.length };
}
