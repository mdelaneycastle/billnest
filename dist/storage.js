const databaseName = 'billnest-local';
const storeName = 'household';
const stateKey = 'current';
let opening;

const emptyState = () => ({ records: [], showExamples: true, revision: 0, push: null });

function database() {
  if (opening) return opening;
  opening = new Promise((resolve, reject) => {
    const request = indexedDB.open(databaseName, 1);
    request.onupgradeneeded = () => request.result.createObjectStore(storeName);
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

export async function changeState(change) {
  const db = await database();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, 'readwrite');
    const store = tx.objectStore(storeName);
    const request = store.get(stateKey);
    let result;
    let failure;
    request.onsuccess = () => {
      try {
        const previous = request.result ?? emptyState();
        result = { ...change(previous), revision: previous.revision + 1 };
        store.put(result, stateKey);
      } catch (error) {
        failure = error;
        tx.abort();
      }
    };
    tx.oncomplete = () => resolve(result);
    tx.onabort = () => reject(failure ?? tx.error);
  });
}
