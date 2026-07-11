export const openDatabase = (): Promise<IDBDatabase> => {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open("lagzapDatabase", 4);

    request.onupgradeneeded = (event) => {
      const db = (event.target as IDBOpenDBRequest).result;

      if (!db.objectStoreNames.contains("tokens")) {
        db.createObjectStore("tokens", { keyPath: "key" });
      }
    };

    request.onsuccess = (event) => {
      resolve((event.target as IDBOpenDBRequest).result);
    };

    request.onerror = (event) => {
      reject((event.target as IDBOpenDBRequest).error);
    };
  });
};

function waitForTransaction(transaction: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error);
    transaction.onabort = () => reject(transaction.error);
  });
}

export async function saveToken(key: string, token: string): Promise<void> {
  const db = await openDatabase();
  const transaction = db.transaction(["tokens"], "readwrite");
  const store = transaction.objectStore("tokens");
  store.put({ key, token });
  await waitForTransaction(transaction);
}

export async function getToken(key: string): Promise<string | undefined> {
  const db = await openDatabase();
  const transaction = db.transaction(["tokens"], "readonly");
  const store = transaction.objectStore("tokens");
  return new Promise((resolve, reject) => {
    const request = store.get(key);
    request.onsuccess = () => {
      resolve(request.result?.token);
    };
    request.onerror = () => {
      reject(request.error);
    };
  });
}

export async function removeToken(key: string): Promise<void> {
  const db = await openDatabase();
  const transaction = db.transaction(["tokens"], "readwrite");
  const store = transaction.objectStore("tokens");
  store.delete(key);
  await waitForTransaction(transaction);
}
