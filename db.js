/* ==========================================================================
   db.js — a tiny promise-based wrapper around IndexedDB.

   Database "kid-tally", version 1, with two object stores:
     kids  (keyPath "id")  — one record per kid, including the photo Blob
     meta  (keyPath "key") — small settings, e.g. { key: "lastReset", value: 1700000000000 }

   Think of each object store as a table whose rows are plain JS objects.
   Every function here returns a Promise, so callers can use `await`.
   ========================================================================== */

const db = (() => {
  const DB_NAME = 'kid-tally';
  const DB_VERSION = 1;

  let dbPromise = null;

  // Open (and if needed create) the database. Only opens once, then reuses it.
  function open() {
    if (!dbPromise) {
      dbPromise = new Promise((resolve, reject) => {
        const req = indexedDB.open(DB_NAME, DB_VERSION);

        // Runs only when the database is new or DB_VERSION goes up:
        // this is where the "tables" are created.
        req.onupgradeneeded = () => {
          const d = req.result;
          if (!d.objectStoreNames.contains('kids')) d.createObjectStore('kids', { keyPath: 'id' });
          if (!d.objectStoreNames.contains('meta')) d.createObjectStore('meta', { keyPath: 'key' });
        };

        req.onsuccess = () => {
          const d = req.result;
          // If a newer version of the app opens the DB in another tab, let it upgrade.
          d.onversionchange = () => d.close();
          resolve(d);
        };
        req.onerror = () => reject(req.error);
      });
    }
    return dbPromise;
  }

  // Run `work(transaction)` inside one transaction. The promise resolves when
  // the transaction has fully committed (so the data really is saved).
  // If `work` returns an IDBRequest, its result is what the promise resolves to.
  async function tx(storeNames, mode, work) {
    const d = await open();
    return new Promise((resolve, reject) => {
      const t = d.transaction(storeNames, mode);
      let result;
      t.oncomplete = () => resolve(result);
      t.onerror = () => reject(t.error);
      t.onabort = () => reject(t.error);
      const req = work(t);
      if (req) req.onsuccess = () => { result = req.result; };
    });
  }

  return {
    /** All kids, sorted by their `order` field. */
    async getAllKids() {
      const kids = await tx('kids', 'readonly', t => t.objectStore('kids').getAll());
      return (kids || []).sort((a, b) => a.order - b.order);
    },

    /** Insert or update one kid. */
    putKid(kid) {
      return tx('kids', 'readwrite', t => { t.objectStore('kids').put(kid); });
    },

    /** Insert or update several kids in one transaction (all or nothing). */
    putKids(kids) {
      return tx('kids', 'readwrite', t => {
        const store = t.objectStore('kids');
        kids.forEach(k => store.put(k));
      });
    },

    deleteKid(id) {
      return tx('kids', 'readwrite', t => { t.objectStore('kids').delete(id); });
    },

    /** Read a meta value, or undefined if it isn't set. */
    async getMeta(key) {
      const row = await tx('meta', 'readonly', t => t.objectStore('meta').get(key));
      return row ? row.value : undefined;
    },

    setMeta(key, value) {
      return tx('meta', 'readwrite', t => { t.objectStore('meta').put({ key, value }); });
    },

    /** Wipe all kids and replace them (used by "Import backup"). */
    replaceAll(kids, lastReset) {
      return tx(['kids', 'meta'], 'readwrite', t => {
        const store = t.objectStore('kids');
        store.clear();
        kids.forEach(k => store.put(k));
        t.objectStore('meta').put({ key: 'lastReset', value: lastReset });
      });
    },
  };
})();
