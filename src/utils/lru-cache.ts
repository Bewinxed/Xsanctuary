/**
 * Simple LRU (Least Recently Used) Cache implementation
 * Automatically evicts oldest entries when max size is reached
 */
export class LRUCache<K, V> {
  private cache: Map<K, V>;
  private readonly maxSize: number;

  constructor(maxSize: number) {
    this.cache = new Map();
    this.maxSize = maxSize;
  }

  get(key: K): V | undefined {
    const value = this.cache.get(key);
    if (value !== undefined) {
      // Move to end (most recently used)
      this.cache.delete(key);
      this.cache.set(key, value);
    }
    return value;
  }

  has(key: K): boolean {
    return this.cache.has(key);
  }

  set(key: K, value: V): void {
    // If key exists, delete first to update position
    if (this.cache.has(key)) {
      this.cache.delete(key);
    } else if (this.cache.size >= this.maxSize) {
      // Evict oldest (first) entry
      const oldestKey = this.cache.keys().next().value;
      if (oldestKey !== undefined) {
        this.cache.delete(oldestKey);
      }
    }
    this.cache.set(key, value);
  }

  delete(key: K): boolean {
    return this.cache.delete(key);
  }

  clear(): void {
    this.cache.clear();
  }

  get size(): number {
    return this.cache.size;
  }

  keys(): IterableIterator<K> {
    return this.cache.keys();
  }

  values(): IterableIterator<V> {
    return this.cache.values();
  }

  entries(): IterableIterator<[K, V]> {
    return this.cache.entries();
  }
}

/**
 * Bounded Set - automatically evicts oldest entries when max size is reached
 */
export class BoundedSet<T> {
  private set: Set<T>;
  private readonly maxSize: number;

  constructor(maxSize: number) {
    this.set = new Set();
    this.maxSize = maxSize;
  }

  has(value: T): boolean {
    return this.set.has(value);
  }

  add(value: T): void {
    if (this.set.has(value)) return;

    if (this.set.size >= this.maxSize) {
      // Evict oldest (first) entry
      const oldest = this.set.values().next().value;
      if (oldest !== undefined) {
        this.set.delete(oldest);
      }
    }
    this.set.add(value);
  }

  delete(value: T): boolean {
    return this.set.delete(value);
  }

  clear(): void {
    this.set.clear();
  }

  get size(): number {
    return this.set.size;
  }
}
