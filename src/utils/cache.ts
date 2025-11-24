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

// Cache TTL: 7 days (location doesn't change often)
const CACHE_TTL_MS = 7 * 24 * 60 * 60 * 1000;

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
}
