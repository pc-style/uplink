// Minimal in-memory stand-in for the one KVNamespace method the Worker actually uses
// (get/put with expirationTtl). Not a full KVNamespace implementation.
type StoredValue = { value: string; expiresAt: number | null };

export class MemoryKVNamespace {
  readonly store = new Map<string, StoredValue>();

  async get(key: string): Promise<string | null> {
    const stored = this.store.get(key);
    if (!stored) return null;
    if (stored.expiresAt !== null && stored.expiresAt <= Date.now()) {
      this.store.delete(key);
      return null;
    }
    return stored.value;
  }

  async put(key: string, value: string, options?: { expirationTtl?: number }): Promise<void> {
    const expiresAt = options?.expirationTtl ? Date.now() + options.expirationTtl * 1000 : null;
    this.store.set(key, { value, expiresAt });
  }
}
