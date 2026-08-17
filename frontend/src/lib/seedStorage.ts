/**
 * Seed storage with localStorage + IndexedDB fallback.
 * IndexedDB survives some embedded-browser storage clears that kill localStorage.
 */

const DB_NAME = "BlockSlide_Seeds";
const STORE_NAME = "seeds";

interface StoredSeed {
  address: string;
  seed: string;
  seedHash?: string; // hash of the seed for validation
  createdAt: number;
}

let dbInstance: IDBDatabase | null = null;

/**
 * Initialize IndexedDB connection (lazy init, cached)
 */
async function getDb(): Promise<IDBDatabase | null> {
  if (typeof window === "undefined" || !window.indexedDB) return null;

  if (dbInstance) return dbInstance;

  return new Promise((resolve) => {
    try {
      const request = indexedDB.open(DB_NAME, 1);

      request.onerror = () => {
        console.warn("[Seed Storage] IndexedDB open failed");
        resolve(null);
      };

      request.onsuccess = () => {
        dbInstance = request.result;
        resolve(dbInstance);
      };

      request.onupgradeneeded = (event) => {
        const db = (event.target as IDBOpenDBRequest).result;
        if (!db.objectStoreNames.contains(STORE_NAME)) {
          db.createObjectStore(STORE_NAME, { keyPath: "id", autoIncrement: true });
        }
      };
    } catch (err) {
      console.warn("[Seed Storage] IndexedDB initialization failed:", err);
      resolve(null);
    }
  });
}

/**
 * Store seed in IndexedDB as backup
 */
export async function storeSeedInIndexedDB(
  address: string,
  seed: string,
  seedHash?: string
): Promise<boolean> {
  try {
    const db = await getDb();
    if (!db) return false;

    const stored: StoredSeed = {
      address: address.toLowerCase(),
      seed,
      seedHash,
      createdAt: Date.now(),
    };

    return new Promise((resolve) => {
      try {
        const transaction = db.transaction([STORE_NAME], "readwrite");
        const store = transaction.objectStore(STORE_NAME);

        // Clear old entries for this address (keep only the latest)
        const clearRequest = store.clear();

        clearRequest.onsuccess = () => {
          const addRequest = store.add(stored);
          addRequest.onsuccess = () => {
            console.log(`[Seed Storage] Seed stored in IndexedDB for ${address.slice(0, 6)}...`);
            resolve(true);
          };
          addRequest.onerror = () => {
            console.warn("[Seed Storage] Failed to store seed in IndexedDB");
            resolve(false);
          };
        };

        clearRequest.onerror = () => {
          console.warn("[Seed Storage] Failed to clear old seeds");
          resolve(false);
        };
      } catch (err) {
        console.warn("[Seed Storage] IndexedDB write error:", err);
        resolve(false);
      }
    });
  } catch (err) {
    console.warn("[Seed Storage] Unexpected error storing seed:", err);
    return false;
  }
}

/**
 * Recover seed from IndexedDB (used when localStorage is lost)
 */
export async function recoverSeedFromIndexedDB(
  address: string
): Promise<string | null> {
  try {
    const db = await getDb();
    if (!db) return null;

    return new Promise((resolve) => {
      try {
        const transaction = db.transaction([STORE_NAME], "readonly");
        const store = transaction.objectStore(STORE_NAME);
        const request = store.getAll();

        request.onsuccess = () => {
          const seeds = request.result as StoredSeed[];
          const addressLower = address.toLowerCase();

          // Find the most recent seed for this address
          const matching = seeds
            .filter((s) => s.address === addressLower)
            .sort((a, b) => b.createdAt - a.createdAt)[0];

          if (matching) {
            console.log(`[Seed Storage] Recovered seed from IndexedDB for ${address.slice(0, 6)}...`);
            resolve(matching.seed);
          } else {
            resolve(null);
          }
        };

        request.onerror = () => {
          console.warn("[Seed Storage] IndexedDB read failed");
          resolve(null);
        };
      } catch (err) {
        console.warn("[Seed Storage] IndexedDB recovery error:", err);
        resolve(null);
      }
    });
  } catch (err) {
    console.warn("[Seed Storage] Unexpected error recovering seed:", err);
    return null;
  }
}

/**
 * Clear IndexedDB seeds (call after successful submission)
 */
export async function clearSeedFromIndexedDB(address: string): Promise<void> {
  try {
    const db = await getDb();
    if (!db) return;

    const transaction = db.transaction([STORE_NAME], "readwrite");
    const store = transaction.objectStore(STORE_NAME);
    const seeds = await new Promise<StoredSeed[]>((resolve) => {
      store.getAll().onsuccess = (e) => resolve((e.target as any).result);
    });

    const addressLower = address.toLowerCase();
    seeds
      .filter((s) => s.address === addressLower)
      .forEach(() => {
        store.clear();
      });
  } catch (err) {
    console.warn("[Seed Storage] Error clearing IndexedDB:", err);
  }
}
