// IndexedDB is deliberately separate from the service-worker shell cache.
// Never put passwords, session tokens or CSRF secrets in this database.
export type Stored = {
  key: string;
  owner: string;
  kind: string;
  [key: string]: unknown;
};
let opening: Promise<IDBDatabase> | undefined;
function database() {
  if (!globalThis.indexedDB)
    return Promise.reject(new Error("IndexedDB unavailable"));
  return (opening ??= new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open("duet-ledger-offline", 1);
    request.onupgradeneeded = () => {
      const store = request.result.createObjectStore("items", {
        keyPath: "key",
      });
      store.createIndex("scope", ["owner", "kind"]);
    };
    request.onerror = () => {
      opening = undefined;
      reject(request.error);
    };
    request.onblocked = () => {
      opening = undefined;
      reject(new Error("IndexedDB blocked"));
    };
    request.onsuccess = () => {
      const db = request.result;
      db.onversionchange = () => {
        db.close();
        opening = undefined;
      };
      resolve(db);
    };
  }));
}
async function transaction<T>(
  write: boolean,
  run: (store: IDBObjectStore, done: (value: T) => void) => void,
): Promise<T> {
  const db = await database();
  return new Promise((resolve, reject) => {
    const tx = db.transaction("items", write ? "readwrite" : "readonly");
    let result: T;
    tx.oncomplete = () => resolve(result);
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error || new Error("IndexedDB aborted"));
    try {
      run(tx.objectStore("items"), (value) => {
        result = value;
      });
    } catch (e) {
      tx.abort();
      reject(e);
    }
  });
}
export const storedKey = (owner: string, kind: string, id: string) =>
  JSON.stringify([owner, kind, id]);
export const getStored = (key: string) =>
  transaction<Stored | undefined>(false, (s, done) => {
    const r = s.get(key);
    r.onsuccess = () => done(r.result);
  });
export const listStored = (owner: string, kind: string) =>
  transaction<Stored[]>(false, (s, done) => {
    const r = s.index("scope").getAll(IDBKeyRange.only([owner, kind]));
    r.onsuccess = () => done(r.result);
  });
export const putStored = (value: Stored) =>
  transaction<void>(true, (s) => {
    s.put(value);
  });
export const deleteStored = (key: string) =>
  transaction<void>(true, (s) => {
    s.delete(key);
  });
const held = new Map<string, { holder: string; release: () => void }>();
export async function acquireLease(
  owner: string,
  holder: string,
): Promise<boolean> {
  // Browser locks are released immediately when a tab closes or reloads. The
  // database lease is a fallback for browsers/HTTP origins without Web Locks.
  if (typeof navigator !== "undefined" && navigator.locks) {
    const current = held.get(owner);
    if (current) return current.holder === holder;
    return new Promise<boolean>((resolve, reject) => {
      void navigator.locks
        .request(
          "duet-ledger-sync:" + owner,
          { ifAvailable: true },
          async (lock) => {
            if (!lock) {
              resolve(false);
              return;
            }
            let release!: () => void;
            const done = new Promise<void>((r) => {
              release = r;
            });
            held.set(owner, { holder, release });
            resolve(true);
            await done;
          },
        )
        .catch(reject);
    });
  }

  return transaction<boolean>(true, (s, done) => {
    const key = storedKey(owner, "lease", "sync");
    const r = s.get(key);
    r.onsuccess = () => {
      const old = r.result;
      if (old && old.holder !== holder && old.until > Date.now()) {
        done(false);
        return;
      }
      s.put({ key, owner, kind: "lease", holder, until: Date.now() + 60000 });
      done(true);
    };
  });
}
export function releaseLease(owner: string, holder: string) {
  const current = held.get(owner);
  if (current) {
    if (current.holder === holder) {
      held.delete(owner);
      current.release();
    }
    return Promise.resolve();
  }

  return transaction<void>(true, (s) => {
    const key = storedKey(owner, "lease", "sync");
    const r = s.get(key);
    r.onsuccess = () => {
      if (r.result?.holder === holder) s.delete(key);
    };
  });
}
