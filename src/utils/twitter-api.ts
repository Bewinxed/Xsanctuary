// Twitter API utilities for mute/block actions
import { getCachedUser, setCachedUser, type CachedUserInfo } from './cache';

const BEARER_TOKEN = 'AAAAAAAAAAAAAAAAAAAAANRILgAAAAAAnNwIzUejRCOuH5E6I8xnZz4puTs%3D1Zv7ttfk8LF81IUq16cHjhLTvJu4FA33AGWWjCpTnA';

// Request queue to throttle API calls
const MAX_QUEUE_SIZE = 50; // Prevent unbounded queue growth
const requestQueue: Array<{ fn: () => Promise<void>; reject: (reason?: unknown) => void }> = [];
let isProcessingQueue = false;

// Minimum delay between API requests (ms)
const REQUEST_DELAY_MS = 500;

// Rate limit state with exponential backoff
let rateLimitedUntil = 0;
let consecutiveRateLimits = 0;

// Calculate backoff time with exponential increase (max 5 minutes)
function getBackoffMs(): number {
  const baseMs = 30000; // 30 seconds base
  const maxMs = 5 * 60 * 1000; // 5 minutes max
  const backoff = Math.min(baseMs * Math.pow(2, consecutiveRateLimits), maxMs);
  return backoff;
}

// Reset backoff on successful request
function resetBackoff(): void {
  consecutiveRateLimits = 0;
}

async function processQueue(): Promise<void> {
  if (isProcessingQueue) return;
  isProcessingQueue = true;

  while (requestQueue.length > 0) {
    // Check if we're rate limited
    if (Date.now() < rateLimitedUntil) {
      const waitTime = rateLimitedUntil - Date.now();
      await new Promise(resolve => setTimeout(resolve, waitTime));
    }

    const request = requestQueue.shift();
    if (request) {
      try {
        await request.fn();
      } catch (error) {
        request.reject(error);
      }
      await new Promise(resolve => setTimeout(resolve, REQUEST_DELAY_MS));
    }
  }

  isProcessingQueue = false;
}

function queueRequest<T>(fn: () => Promise<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    // Reject if queue is full to prevent memory issues
    if (requestQueue.length >= MAX_QUEUE_SIZE) {
      console.warn('[XSanctuary] Request queue full, dropping request');
      reject(new Error('Request queue full'));
      return;
    }

    requestQueue.push({
      fn: async () => {
        try {
          const result = await fn();
          resolve(result);
        } catch (error) {
          reject(error);
        }
      },
      reject,
    });
    processQueue();
  });
}

function getCsrfToken(): string | null {
  const match = document.cookie.match(/ct0=([^;]+)/);
  return match ? match[1] : null;
}

async function twitterApiCall(endpoint: string, body: string): Promise<boolean> {
  const csrfToken = getCsrfToken();
  if (!csrfToken) {
    console.error('[XSanctuary] No CSRF token found');
    return false;
  }

  try {
    const response = await fetch(`https://x.com/i/api/1.1/${endpoint}`, {
      method: 'POST',
      credentials: 'include',
      headers: {
        'accept': '*/*',
        'authorization': `Bearer ${BEARER_TOKEN}`,
        'content-type': 'application/x-www-form-urlencoded',
        'x-csrf-token': csrfToken,
        'x-twitter-active-user': 'yes',
        'x-twitter-auth-type': 'OAuth2Session',
        'x-twitter-client-language': 'en',
      },
      body,
    });

    if (response.status === 429) {
      // Rate limited - use exponential backoff
      consecutiveRateLimits++;
      rateLimitedUntil = Date.now() + getBackoffMs();
      console.warn(`[XSanctuary] Rate limited on action API, backing off ${Math.round(getBackoffMs() / 1000)}s`);
      return false;
    }

    if (response.ok) {
      resetBackoff();
    }

    return response.ok;
  } catch (error) {
    console.error(`[XSanctuary] API call failed:`, error);
    return false;
  }
}

export async function blockUser(userId: string): Promise<boolean> {
  return twitterApiCall('blocks/create.json', `user_id=${userId}`);
}

export async function unblockUser(userId: string): Promise<boolean> {
  return twitterApiCall('blocks/destroy.json', `user_id=${userId}`);
}

export async function muteUser(userId: string): Promise<boolean> {
  return twitterApiCall('mutes/users/create.json', `user_id=${userId}`);
}

export async function unmuteUser(userId: string): Promise<boolean> {
  return twitterApiCall('mutes/users/destroy.json', `user_id=${userId}`);
}

// Get user info including user_id from screen_name
export interface UserInfo {
  userId: string;
  screenName: string;
  name?: string;
  bio?: string;
  country: string | null;
  locationAccurate?: boolean; // false = likely using VPN
}

export async function fetchUserInfo(screenName: string): Promise<UserInfo | null> {
  // Check cache first
  const cached = await getCachedUser(screenName);
  if (cached) {
    return {
      userId: cached.userId,
      screenName: cached.screenName,
      name: cached.name,
      bio: cached.bio,
      country: cached.country,
      locationAccurate: cached.locationAccurate,
    };
  }

  // Queue the request to avoid rate limiting
  return queueRequest(async () => {
    const csrfToken = getCsrfToken();
    if (!csrfToken) {
      console.error('[XSanctuary] No CSRF token found');
      return null;
    }

    // Check if we're rate limited
    if (Date.now() < rateLimitedUntil) {
      return null;
    }

    try {
      const variables = JSON.stringify({ screenName });
      const url = `https://x.com/i/api/graphql/XRqGa7EeokUU5kppkh13EA/AboutAccountQuery?variables=${encodeURIComponent(variables)}`;

      const response = await fetch(url, {
        method: 'GET',
        credentials: 'include',
        headers: {
          'accept': '*/*',
          'authorization': `Bearer ${BEARER_TOKEN}`,
          'content-type': 'application/json',
          'x-csrf-token': csrfToken,
          'x-twitter-active-user': 'yes',
          'x-twitter-auth-type': 'OAuth2Session',
          'x-twitter-client-language': 'en',
        },
      });

      if (response.status === 429) {
        // Rate limited - use exponential backoff
        consecutiveRateLimits++;
        rateLimitedUntil = Date.now() + getBackoffMs();
        console.warn(`[XSanctuary] Rate limited! Backing off ${Math.round(getBackoffMs() / 1000)}s`);
        return null;
      }

      if (!response.ok) {
        return null;
      }

      // Success - reset backoff counter
      resetBackoff();

      const data = await response.json();
      const result = data?.data?.user_result_by_screen_name?.result;

      if (!result) {
        return null;
      }

      const userInfo: UserInfo = {
        userId: result.rest_id,
        screenName: result.core?.screen_name || screenName,
        name: result.core?.name || '',
        bio: result.core?.description || '',
        country: result.about_profile?.account_based_in || null,
        locationAccurate: result.about_profile?.location_accurate ?? true,
      };

      // Cache the result
      await setCachedUser({
        userId: userInfo.userId,
        screenName: userInfo.screenName,
        name: userInfo.name,
        bio: userInfo.bio,
        country: userInfo.country,
        locationAccurate: userInfo.locationAccurate,
        cachedAt: Date.now(),
      });

      return userInfo;
    } catch (error) {
      console.error(`[XSanctuary] Error fetching user info for @${screenName}:`, error);
      return null;
    }
  });
}

// Check if we're currently rate limited
export function isRateLimited(): boolean {
  return Date.now() < rateLimitedUntil;
}

// Get time until rate limit expires
export function getRateLimitRemainingMs(): number {
  return Math.max(0, rateLimitedUntil - Date.now());
}
