import { attachFile, mergeBackup } from './attachments.js';

const databaseName = 'billnest-local';
const storeName = 'household';
const filesStore = 'documents';
const stateKey = 'current';
let opening;

const emptyState = () => ({ records: [], showExamples: true, revision: 0, push: null });

function database() {
  if (opening) return opening;
  opening = new Promise((resolve, reject) => {
    const request = indexedDB.open(databaseName, 2);
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains(storeName)) request.result.createObjectStore(storeName);
      if (!request.result.objectStoreNames.contains(filesStore)) request.result.createObjectStore(filesStore, { keyPath: 'id' });
    };
    request.onerror = () => reject(request.error);
    request.onblocked = () => reject(new Error('Storage is busy. Close other Outgoings tabs and reload.'));
    request.onsuccess = () => {
      request.result.onversionchange = () => {
        request.result.close();
        opening = undefined;
      };
      resolve(request.result);
    };
  }).catch(error => {
    opening = undefined;
    throw error;
  });
  return opening;
}

export async function readState() {
  const db = await database();
  return new Promise((resolve, reject) => {
    const request = db.transaction(storeName).objectStore(storeName).get(stateKey);
    request.onsuccess = () => resolve(request.result ?? emptyState());
    request.onerror = () => reject(request.error);
  });
}

async function commit(change) {
  const db = await database();
  return new Promise((resolve, reject) => {
    const tx = db.transaction([storeName, filesStore], 'readwrite');
    const store = tx.objectStore(storeName);
    const documents = tx.objectStore(filesStore);
    const request = store.get(stateKey);
    let result;
    let failure;
    request.onsuccess = () => {
      try {
        const previous = request.result ?? emptyState();
        const { state, files = [], remove = [] } = change(previous);
        result = { ...state, revision: previous.revision + 1 };
        store.put(result, stateKey);
        for (const file of files) documents.put({ id: file.id, blob: file.blob });
        for (const id of remove) documents.delete(id);
      } catch (error) {
        failure = error;
        tx.abort();
      }
    };
    tx.oncomplete = () => resolve(result);
    tx.onabort = () => reject(failure ?? tx.error);
  });
}

export const changeState = change => commit(previous => ({ state: change(previous) }));
export const saveAttachment = (recordId, file) => commit(previous => ({
  state: attachFile(previous, recordId, file), files: [file]
}));

export const removeAttachment = (recordId, fileId) => commit(previous => {
  const record = previous.records.find(item => item.id === recordId);
  if (!record?.attachments?.some(file => file.id === fileId)) throw new Error('This document has already been removed.');
  return { state: { ...previous, records: previous.records.map(item => item.id === recordId
    ? { ...item, attachments: item.attachments.filter(file => file.id !== fileId), revision: item.revision + 1 } : item) },
    remove: [fileId] };
});

export async function readAttachment(id) {
  const db = await database();
  return new Promise((resolve, reject) => {
    const request = db.transaction(filesStore).objectStore(filesStore).get(id);
    request.onsuccess = () => resolve(request.result?.blob);
    request.onerror = () => reject(request.error);
  });
}

export async function backupSnapshot() {
  const db = await database();
  return new Promise((resolve, reject) => {
    const tx = db.transaction([storeName, filesStore]);
    const state = tx.objectStore(storeName).get(stateKey);
    const files = tx.objectStore(filesStore).getAll();
    tx.oncomplete = () => resolve({ state: state.result ?? emptyState(), files: files.result });
    tx.onabort = () => reject(tx.error);
  });
}

export async function importBackup(incoming) {
  let merged;
  const state = await commit(previous => {
    merged = mergeBackup(previous, incoming);
    return merged;
  });
  return { state, count: merged.count, skipped: merged.skipped };
}
