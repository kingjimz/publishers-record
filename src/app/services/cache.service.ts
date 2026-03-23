import { Injectable } from '@angular/core';

interface CacheEntry<T> {
  value: T;
  expiresAt: number;
}

@Injectable({ providedIn: 'root' })
export class CacheService {
  private readonly store = new Map<string, CacheEntry<unknown>>();

  /** Default TTL: 2 minutes. */
  private static readonly DEFAULT_TTL_MS = 2 * 60 * 1000;

  get<T>(key: string): T | undefined {
    const entry = this.store.get(key);
    if (!entry) return undefined;
    if (Date.now() > entry.expiresAt) {
      this.store.delete(key);
      return undefined;
    }
    return entry.value as T;
  }

  set<T>(key: string, value: T, ttlMs = CacheService.DEFAULT_TTL_MS): void {
    this.store.set(key, { value, expiresAt: Date.now() + ttlMs });
  }

  /** Remove a single key. */
  invalidate(key: string): void {
    this.store.delete(key);
  }

  /** Remove all keys that start with the given prefix. */
  invalidatePrefix(prefix: string): void {
    for (const key of this.store.keys()) {
      if (key.startsWith(prefix)) {
        this.store.delete(key);
      }
    }
  }

  /** Clear the entire cache (e.g. on sign-out). */
  clear(): void {
    this.store.clear();
  }
}
