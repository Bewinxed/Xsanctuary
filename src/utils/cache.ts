import { storage } from 'wxt/utils/storage';

export interface CachedUserInfo {
  userId: string;
  screenName: string;
  name?: string;
  bio?: string;
  country: string | null;
  locationAccurate?: boolean;
  cachedAt: number;
}

interface UserCache {
  [screenName: string]: CachedUserInfo;
}

// Cache configuration
const CACHE_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 days TTL
const MAX_USER_CACHE_SIZE = 2000; // Max users to cache
const MAX_LLM_CACHE_SIZE = 500; // Max LLM responses to cache

// Storage for user cache
const userCacheStorage = storage.defineItem<UserCache>('local:userCache', {
  fallback: {},
});

// In-memory cache for faster access during session
let memoryCache: UserCache = {};
let memoryCacheLoaded = false;

async function loadMemoryCache(): Promise<void> {
  if (memoryCacheLoaded) return;
  memoryCache = await userCacheStorage.getValue();
  memoryCacheLoaded = true;
}

export async function getCachedUser(screenName: string): Promise<CachedUserInfo | null> {
  await loadMemoryCache();

  const key = screenName.toLowerCase();
  const cached = memoryCache[key];

  if (!cached) return null;

  // Check if cache is expired
  if (Date.now() - cached.cachedAt > CACHE_TTL_MS) {
    // Don't delete here, just return null - we'll update on next fetch
    return null;
  }

  return cached;
}

export async function setCachedUser(info: CachedUserInfo): Promise<void> {
  await loadMemoryCache();

  const key = info.screenName.toLowerCase();
  memoryCache[key] = {
    ...info,
    cachedAt: Date.now(),
  };

  // Evict oldest entries if over max size (LRU eviction)
  const keys = Object.keys(memoryCache);
  if (keys.length > MAX_USER_CACHE_SIZE) {
    // Sort by cachedAt and remove oldest entries
    const sortedKeys = keys.sort((a, b) => memoryCache[a].cachedAt - memoryCache[b].cachedAt);
    const toRemove = sortedKeys.slice(0, keys.length - MAX_USER_CACHE_SIZE);
    for (const removeKey of toRemove) {
      delete memoryCache[removeKey];
    }
    console.log(`[XSanctuary] Evicted ${toRemove.length} old cache entries`);
  }

  // Persist to storage (debounced)
  debouncedPersist();
}

// Debounce storage writes to avoid excessive writes
let persistTimeout: ReturnType<typeof setTimeout> | null = null;

function debouncedPersist(): void {
  if (persistTimeout) {
    clearTimeout(persistTimeout);
  }
  persistTimeout = setTimeout(async () => {
    await userCacheStorage.setValue(memoryCache);
    persistTimeout = null;
  }, 1000);
}

// Clean up old cache entries periodically
export async function cleanupCache(): Promise<void> {
  await loadMemoryCache();

  const now = Date.now();
  let cleaned = false;

  for (const key of Object.keys(memoryCache)) {
    if (now - memoryCache[key].cachedAt > CACHE_TTL_MS) {
      delete memoryCache[key];
      cleaned = true;
    }
  }

  if (cleaned) {
    await userCacheStorage.setValue(memoryCache);
  }
}

// Get cache stats
export async function getCacheStats(): Promise<{ total: number; valid: number }> {
  await loadMemoryCache();

  const now = Date.now();
  const entries = Object.values(memoryCache);
  const valid = entries.filter(e => now - e.cachedAt <= CACHE_TTL_MS).length;

  return { total: entries.length, valid };
}

// Clear all cache
export async function clearCache(): Promise<void> {
  memoryCache = {};
  await userCacheStorage.setValue({});
  // Also clear LLM cache
  llmMemoryCache = {};
  await llmCacheStorage.setValue({});
}

// ============================================
// LLM Response Cache
// ============================================

interface LlmCacheEntry {
  result: string;
  cachedAt: number;
}

interface LlmCache {
  [hash: string]: LlmCacheEntry;
}

// Cache TTL for LLM responses: 24 hours
const LLM_CACHE_TTL_MS = 24 * 60 * 60 * 1000;

const llmCacheStorage = storage.defineItem<LlmCache>('local:llmCache', {
  fallback: {},
});

let llmMemoryCache: LlmCache = {};
let llmCacheLoaded = false;

async function loadLlmCache(): Promise<void> {
  if (llmCacheLoaded) return;
  llmMemoryCache = await llmCacheStorage.getValue();
  llmCacheLoaded = true;
}

// Simple hash function for cache keys
function hashString(str: string): string {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    const char = str.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash = hash & hash; // Convert to 32-bit integer
  }
  return hash.toString(36);
}

export function getLlmCacheKey(text: string, prompt: string, model: string): string {
  return hashString(`${model}:${prompt}:${text}`);
}

export async function getCachedLlmResponse(cacheKey: string): Promise<string | null> {
  await loadLlmCache();

  const cached = llmMemoryCache[cacheKey];
  if (!cached) return null;

  // Check if expired
  if (Date.now() - cached.cachedAt > LLM_CACHE_TTL_MS) {
    return null;
  }

  return cached.result;
}

export async function setCachedLlmResponse(cacheKey: string, result: string): Promise<void> {
  await loadLlmCache();

  llmMemoryCache[cacheKey] = {
    result,
    cachedAt: Date.now(),
  };

  // Evict oldest entries if over max size (LRU eviction)
  const keys = Object.keys(llmMemoryCache);
  if (keys.length > MAX_LLM_CACHE_SIZE) {
    const sortedKeys = keys.sort((a, b) => llmMemoryCache[a].cachedAt - llmMemoryCache[b].cachedAt);
    const toRemove = sortedKeys.slice(0, keys.length - MAX_LLM_CACHE_SIZE);
    for (const removeKey of toRemove) {
      delete llmMemoryCache[removeKey];
    }
    console.log(`[XSanctuary] Evicted ${toRemove.length} old LLM cache entries`);
  }

  // Persist (debounced)
  debouncedLlmPersist();
}

let llmPersistTimeout: ReturnType<typeof setTimeout> | null = null;

function debouncedLlmPersist(): void {
  if (llmPersistTimeout) {
    clearTimeout(llmPersistTimeout);
  }
  llmPersistTimeout = setTimeout(async () => {
    // Clean up expired entries before persisting
    const now = Date.now();
    for (const key of Object.keys(llmMemoryCache)) {
      if (now - llmMemoryCache[key].cachedAt > LLM_CACHE_TTL_MS) {
        delete llmMemoryCache[key];
      }
    }
    await llmCacheStorage.setValue(llmMemoryCache);
    llmPersistTimeout = null;
  }, 2000);
}

export async function getLlmCacheStats(): Promise<{ total: number; valid: number }> {
  await loadLlmCache();

  const now = Date.now();
  const entries = Object.values(llmMemoryCache);
  const valid = entries.filter(e => now - e.cachedAt <= LLM_CACHE_TTL_MS).length;

  return { total: entries.length, valid };
}
