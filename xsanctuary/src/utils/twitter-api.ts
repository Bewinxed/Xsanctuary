// Twitter API utilities for mute/block actions
import { getCachedUser, setCachedUser, type CachedUserInfo } from './cache';

const BEARER_TOKEN = 'AAAAAAAAAAAAAAAAAAAAANRILgAAAAAAnNwIzUejRCOuH5E6I8xnZz4puTs%3D1Zv7ttfk8LF81IUq16cHjhLTvJu4FA33AGWWjCpTnA';

// Request queue to throttle API calls
const requestQueue: Array<() => Promise<void>> = [];
let isProcessingQueue = false;

// Minimum delay between API requests (ms)
const REQUEST_DELAY_MS = 500;

// Track rate limit state
let rateLimitedUntil = 0;

async function processQueue(): Promise<void> {
  if (isProcessingQueue) return;
  isProcessingQueue = true;

  while (requestQueue.length > 0) {
    // Check if we're rate limited
    if (Date.now() < rateLimitedUntil) {
      const waitTime = rateLimitedUntil - Date.now();
      console.log(`[XSanctuary] Rate limited, waiting ${waitTime}ms`);
      await new Promise(resolve => setTimeout(resolve, waitTime));
    }

    const request = requestQueue.shift();
    if (request) {
      await request();
      await new Promise(resolve => setTimeout(resolve, REQUEST_DELAY_MS));
    }
  }

  isProcessingQueue = false;
}

function queueRequest<T>(fn: () => Promise<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    requestQueue.push(async () => {
      try {
        const result = await fn();
        resolve(result);
      } catch (error) {
        reject(error);
      }
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
      // Rate limited - back off for 1 minute
      rateLimitedUntil = Date.now() + 60000;
      console.warn('[XSanctuary] Rate limited on action API');
    }

    return response.ok;
  } catch (error) {
    console.error(`[XSanctuary] API call failed:`, error);
    return false;
  }
}

export async function blockUser(userId: string): Promise<boolean> {
  console.log(`[XSanctuary] Blocking user ${userId}`);
  return twitterApiCall('blocks/create.json', `user_id=${userId}`);
}

export async function unblockUser(userId: string): Promise<boolean> {
  console.log(`[XSanctuary] Unblocking user ${userId}`);
  return twitterApiCall('blocks/destroy.json', `user_id=${userId}`);
}

export async function muteUser(userId: string): Promise<boolean> {
  console.log(`[XSanctuary] Muting user ${userId}`);
  return twitterApiCall('mutes/users/create.json', `user_id=${userId}`);
}

export async function unmuteUser(userId: string): Promise<boolean> {
  console.log(`[XSanctuary] Unmuting user ${userId}`);
  return twitterApiCall('mutes/users/destroy.json', `user_id=${userId}`);
}

// Get user info including user_id from screen_name
export interface UserInfo {
  userId: string;
  screenName: string;
  name?: string;
  country: string | null;
}

export async function fetchUserInfo(screenName: string): Promise<UserInfo | null> {
  // Check cache first
  const cached = await getCachedUser(screenName);
  if (cached) {
    console.log(`[XSanctuary] Cache hit for @${screenName}`);
    return {
      userId: cached.userId,
      screenName: cached.screenName,
      country: cached.country,
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
      console.log(`[XSanctuary] Skipping fetch for @${screenName} - rate limited`);
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
        // Rate limited - back off for 2 minutes
        rateLimitedUntil = Date.now() + 120000;
        console.warn(`[XSanctuary] Rate limited! Backing off until ${new Date(rateLimitedUntil).toLocaleTimeString()}`);
        return null;
      }

      if (!response.ok) {
        console.log(`[XSanctuary] API returned ${response.status} for @${screenName}`);
        return null;
      }

      const data = await response.json();
      const result = data?.data?.user_result_by_screen_name?.result;

      if (!result) {
        return null;
      }

      const userInfo: UserInfo = {
        userId: result.rest_id,
        screenName: result.core?.screen_name || screenName,
        name: result.core?.name || '',
        country: result.about_profile?.account_based_in || null,
      };

      // Cache the result
      await setCachedUser({
        userId: userInfo.userId,
        screenName: userInfo.screenName,
        country: userInfo.country,
        cachedAt: Date.now(),
      });

      console.log(`[XSanctuary] Fetched and cached @${screenName}: ${userInfo.country || 'no location'}`);
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
