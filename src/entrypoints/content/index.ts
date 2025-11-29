import { getFlag, getCountryCode, isDeceptiveProfile, extractFlagEmojis, countryCodeToFlag, countryCodeToFlagUrl } from '@/utils/countries';
import { getSettings, saveSettings, type CountryRule, type Settings } from '@/utils/storage';
import { toUwuSpeak, toCatSpeak } from '@/utils/transforms';
import { blockUser, muteUser, fetchUserInfo, type UserInfo } from '@/utils/twitter-api';
import { LRUCache, BoundedSet } from '@/utils/lru-cache';
import {
  detectBubblesInImage,
  getImageAsBase64,
  cropBubbleToBase64,
  getBubbleAtPoint,
  getBubbleKey,
  type BubbleDetection,
  type DetectionResult,
} from '@/utils/comic-detector';
import './style.css';

// Helper to render flag (emoji or SVG image)
function renderFlag(flag: string, size: 'small' | 'medium' = 'medium'): string {
  const isUrl = flag.startsWith('http://') || flag.startsWith('https://');
  if (isUrl) {
    const dimensions = size === 'small' ? 'width="16" height="12"' : 'width="20" height="15"';
    return `<img src="${flag}" ${dimensions} style="display: inline-block; vertical-align: middle; object-fit: cover;" alt="flag" />`;
  }
  return flag;
}

// Pre-compiled regex for better performance
const USERNAME_REGEX = /^\/([A-Za-z0-9_]+)(?:\/|$)/;

// Reserved paths to skip (Set for O(1) lookup)
const RESERVED_PATHS = new Set([
  'home', 'explore', 'notifications', 'messages', 'bookmarks',
  'lists', 'profile', 'settings', 'compose', 'search', 'i',
  'intent', 'hashtag', 'tos', 'privacy', 'about', 'help',
  'status', 'photo', 'video', 'followers', 'following', 'likes',
]);

/**
 * Parse a CSS polygon() string into an array of {x, y} points (normalized 0-1)
 */
function parsePolygon(polygonStr: string): { x: number; y: number }[] {
  const points: { x: number; y: number }[] = [];
  // Match polygon(x% y%, x% y%, ...)
  const match = polygonStr.match(/polygon\(([^)]+)\)/);
  if (!match) return points;

  const pairs = match[1].split(',');
  for (const pair of pairs) {
    const coords = pair.trim().split(/\s+/);
    if (coords.length >= 2) {
      const x = parseFloat(coords[0]) / 100; // Convert % to 0-1
      const y = parseFloat(coords[1]) / 100;
      if (!isNaN(x) && !isNaN(y)) {
        points.push({ x, y });
      }
    }
  }
  return points;
}

/**
 * Find the horizontal bounds (left and right X) of a polygon at a given Y
 * Uses scanline algorithm to find edge intersections
 */
function getPolygonBoundsAtY(points: { x: number; y: number }[], normalizedY: number): { left: number; right: number } | null {
  if (points.length < 3) return null;

  const intersections: number[] = [];

  // Check each edge of the polygon
  for (let i = 0; i < points.length; i++) {
    const p1 = points[i];
    const p2 = points[(i + 1) % points.length];

    // Check if this edge crosses the Y level
    if ((p1.y <= normalizedY && p2.y > normalizedY) || (p2.y <= normalizedY && p1.y > normalizedY)) {
      // Calculate X intersection using linear interpolation
      const t = (normalizedY - p1.y) / (p2.y - p1.y);
      const x = p1.x + t * (p2.x - p1.x);
      intersections.push(x);
    }
  }

  if (intersections.length < 2) return null;

  // Sort and return leftmost and rightmost
  intersections.sort((a, b) => a - b);
  return {
    left: intersections[0],
    right: intersections[intersections.length - 1]
  };
}

/**
 * Get the width available at a given Y position
 * Uses polygon if provided, otherwise falls back to ellipse
 */
function getShapeWidthAtY(normalizedY: number, polygonPoints: { x: number; y: number }[] | null): { left: number; width: number } {
  // Try polygon first
  if (polygonPoints && polygonPoints.length >= 3) {
    const bounds = getPolygonBoundsAtY(polygonPoints, normalizedY);
    if (bounds) {
      return {
        left: bounds.left,
        width: bounds.right - bounds.left
      };
    }
  }

  // Fallback to ellipse
  const y = normalizedY - 0.5;
  const halfWidth = Math.sqrt(Math.max(0, 0.25 - y * y));
  return {
    left: 0.5 - halfWidth,
    width: halfWidth * 2
  };
}

/**
 * Fit text to bubble by laying out lines that respect the shape (polygon or ellipse)
 * Each line is sized and positioned to fit within the shape at that Y position
 */
function fitTextToBubble(element: HTMLElement, maskPath?: string) {
  const parent = element.parentElement;
  if (!parent) return;

  const containerWidth = parent.offsetWidth;
  const containerHeight = parent.offsetHeight;

  if (containerWidth === 0 || containerHeight === 0) return;

  const text = element.textContent || '';
  if (!text.trim()) return;

  // Parse polygon if provided
  const polygonPoints = maskPath ? parsePolygon(maskPath) : null;

  // Clear existing content
  element.textContent = '';
  element.style.display = 'flex';
  element.style.flexDirection = 'column';
  element.style.alignItems = 'center';
  element.style.justifyContent = 'center';
  element.style.padding = '0';

  // Calculate optimal font size based on area
  const usableArea = containerWidth * containerHeight * 0.5;
  const charCount = text.length;
  let fontSize = Math.sqrt(usableArea / (charCount * 0.9));
  fontSize = Math.max(9, Math.min(fontSize, 26));

  // Split into words
  const words = text.split(/\s+/);
  const lineHeight = fontSize * 1.15;

  // Estimate number of lines that fit
  const maxLines = Math.floor((containerHeight * 0.75) / lineHeight);
  const targetLines = Math.max(1, Math.min(maxLines, Math.ceil(words.length / 3)));

  // Distribute words across lines
  const lines: string[] = [];
  const wordsPerLine = Math.ceil(words.length / targetLines);
  for (let i = 0; i < words.length; i += wordsPerLine) {
    lines.push(words.slice(i, i + wordsPerLine).join(' '));
  }

  // Create line elements
  const totalTextHeight = lines.length * lineHeight;
  const startY = (containerHeight - totalTextHeight) / 2;

  lines.forEach((line, index) => {
    const lineEl = document.createElement('div');
    lineEl.style.textAlign = 'center';
    lineEl.style.whiteSpace = 'nowrap';
    lineEl.style.overflow = 'visible';
    lineEl.style.lineHeight = `${lineHeight}px`;
    lineEl.style.fontSize = `${fontSize}px`;

    // Calculate Y position of this line (normalized 0-1)
    const lineY = startY + (index + 0.5) * lineHeight;
    const normalizedY = lineY / containerHeight;

    // Get available width at this Y position
    const shape = getShapeWidthAtY(normalizedY, polygonPoints);
    const availableWidth = containerWidth * shape.width * 0.9;

    // Measure text and scale if needed
    lineEl.textContent = line;
    element.appendChild(lineEl);

    // Adjust font size for this line if it's too wide
    const textWidth = lineEl.scrollWidth;
    if (textWidth > availableWidth && availableWidth > 0) {
      const scale = availableWidth / textWidth;
      lineEl.style.fontSize = `${fontSize * scale}px`;
    }
  });
}

// Detect Twitter's light/dark theme
function detectTheme() {
  const bgColor = getComputedStyle(document.body).backgroundColor;
  const rgb = bgColor.match(/\d+/g)?.map(Number) || [0, 0, 0];
  const brightness = (rgb[0] * 299 + rgb[1] * 587 + rgb[2] * 114) / 1000;
  const isDark = brightness < 128;
  document.documentElement.setAttribute('data-xsanctuary-theme', isDark ? 'dark' : 'light');
}

// Track processed elements to avoid duplicates (WeakSet allows GC of removed elements)
const processedUsernames = new WeakSet<Element>();
const processedTweets = new WeakSet<Element>();

// Bounded caches to prevent memory leaks
const userInfoCache = new LRUCache<string, UserInfo | null>(500);
const pendingRequests = new Map<string, Promise<UserInfo | null>>();
const hardActionApplied = new BoundedSet<string>(1000);

// Comic detection caches
const imageDetectionCache = new Map<string, DetectionResult>();
const bubbleTranslationCache = new Map<string, string>();
const processedImages = new WeakSet<Element>();
const imageTranslationCache = new Map<string, string>(); // For auto mode translated images

// Normalize Twitter image URL (remove size parameters for consistent caching)
function normalizeTwitterImageUrl(url: string): string {
  try {
    const parsed = new URL(url);
    // Remove size-related parameters that change between inline and lightbox
    parsed.searchParams.delete('name');
    return parsed.toString();
  } catch {
    return url;
  }
}

// Settings cache
let cachedSettings: Settings | null = null;

// Debounced mutation processing
let pendingElements: Element[] = [];
let processingScheduled = false;

export default defineContentScript({
  matches: ['*://*.x.com/*', '*://*.twitter.com/*'],
  runAt: 'document_idle',

  async main(ctx) {
    console.log('[XSanctuary] Content script loaded');

    // Load Anime Ace font for manga translations
    // @ts-expect-error - WXT types are too strict for dynamic paths
    const fontUrl = browser.runtime.getURL('fonts/animeace.ttf');
    const fontFace = new FontFace('Anime Ace', `url(${fontUrl})`);
    fontFace.load().then((loadedFont) => {
      document.fonts.add(loadedFont);
      console.log('[XSanctuary] Anime Ace font loaded');
    }).catch((err) => {
      console.warn('[XSanctuary] Failed to load Anime Ace font:', err);
    });

    // Detect and track Twitter's theme
    detectTheme();
    const themeObserver = new MutationObserver(detectTheme);
    themeObserver.observe(document.documentElement, { attributes: true, attributeFilter: ['style'] });
    themeObserver.observe(document.body, { attributes: true, attributeFilter: ['style', 'class'] });

    // Load settings
    cachedSettings = await getSettings();

    // Listen for settings changes (store reference for cleanup)
    const storageListener = (changes: { [key: string]: { newValue?: unknown } }) => {
      if (changes.settings) {
        cachedSettings = changes.settings.newValue as Settings;
        console.log('[XSanctuary] Settings updated');
      }
    };
    browser.storage.onChanged.addListener(storageListener);

    // Process existing elements after a short delay
    setTimeout(() => processPage(), 500);

    // Debounced element processing function
    function scheduleProcessing() {
      if (processingScheduled || pendingElements.length === 0) return;
      processingScheduled = true;

      // Use requestIdleCallback if available, otherwise requestAnimationFrame
      const schedule = window.requestIdleCallback || ((cb: () => void) => setTimeout(cb, 16));
      schedule(() => {
        const elements = pendingElements;
        pendingElements = [];
        processingScheduled = false;
        elements.forEach(processElement);
      });
    }

    // Set up mutation observer for dynamic content with debouncing
    const observer = new MutationObserver((mutations) => {
      for (const mutation of mutations) {
        if (mutation.type === 'childList') {
          mutation.addedNodes.forEach((node) => {
            if (node instanceof Element) {
              pendingElements.push(node);
            }
          });
        }
      }
      scheduleProcessing();
    });

    observer.observe(document.body, {
      childList: true,
      subtree: true,
    });

    // Set up lightbox observer for comic translation (always set up, check settings when processing)
    const lightboxObserver = setupLightboxObserver();

    // Handle SPA navigation
    ctx.addEventListener(window, 'wxt:locationchange', () => {
      console.log('[XSanctuary] Location changed, reprocessing page');
      setTimeout(() => processPage(), 300);

      // Check if we navigated to a photo URL (lightbox)
      if (window.location.pathname.includes('/photo/')) {
        console.log('[XSanctuary] Photo URL detected, checking for lightbox');
        setTimeout(() => checkForLightboxImage(), 500);
      }
    });

    // Cleanup on context invalidation
    ctx.onInvalidated(() => {
      observer.disconnect();
      themeObserver.disconnect();
      lightboxObserver?.disconnect();
      browser.storage.onChanged.removeListener(storageListener);
      // Clear pending elements
      pendingElements = [];
      processingScheduled = false;
    });
  },
});

function processPage() {
  if (!cachedSettings?.enabled) return;

  // Find all username links and tweets
  document.querySelectorAll('a[href^="/"][role="link"]').forEach(processElement);
  document.querySelectorAll('article[data-testid="tweet"]').forEach(processTweet);
}

function processElement(element: Element) {
  if (!cachedSettings?.enabled) return;

  // Find username links (those starting with @)
  const links = element.matches('a[href^="/"][role="link"]')
    ? [element]
    : Array.from(element.querySelectorAll('a[href^="/"][role="link"]'));

  for (const link of links) {
    if (processedUsernames.has(link)) continue;

    const href = link.getAttribute('href');
    if (!href) continue;

    // Extract screen name using pre-compiled regex
    const match = href.match(USERNAME_REGEX);
    if (!match) continue;

    const screenName = match[1];

    // Skip reserved paths (using Set for O(1) lookup)
    if (RESERVED_PATHS.has(screenName.toLowerCase())) continue;

    // Only process username links (those that show @username)
    const linkText = link.textContent?.trim() || '';
    if (!linkText.startsWith('@')) continue;

    processedUsernames.add(link);
    addFlagBadge(link as HTMLElement, screenName);
  }

  // Also check for tweets within this element
  element.querySelectorAll('article[data-testid="tweet"]').forEach(processTweet);
}

async function processTweet(tweet: Element) {
  if (!cachedSettings?.enabled) return;
  if (processedTweets.has(tweet)) return;
  processedTweets.add(tweet);

  // Process images for comic translation
  processImagesInTweet(tweet);

  // Find the username in this tweet
  const usernameLink = tweet.querySelector('a[href^="/"][role="link"]');
  if (!usernameLink) return;

  const href = usernameLink.getAttribute('href');
  if (!href) return;

  const match = href.match(USERNAME_REGEX);
  if (!match) return;

  const screenName = match[1];

  // Get user info
  const userInfo = await getUserInfo(screenName);
  if (!userInfo?.country) return;

  const countryCode = getCountryCode(userInfo.country);
  if (!countryCode) return;

  // Get rule for this country
  const rule = cachedSettings?.rules.find(r => r.countryCode === countryCode);
  if (!rule) return;

  // Check if rule is paused
  if (rule.pausedUntil && Date.now() < rule.pausedUntil) {
    return;
  }

  // Check if user is excluded from this rule
  if (rule.excludedUsers?.includes(screenName.toLowerCase())) {
    return;
  }

  // Check deception filter
  if (rule.deceptionOnly) {
    const profileText = `${userInfo.name || ''} ${userInfo.bio || ''}`;
    if (!isDeceptiveProfile(profileText, countryCode)) {
      // User is not being deceptive (either no flags or has matching flag)
      return;
    }
    console.log(`[XSanctuary] Deception detected for @${screenName}: claims different country in profile`);
  }

  // Check VPN filter
  if (rule.vpnOnly) {
    if (userInfo.locationAccurate !== false) {
      // User is not using VPN (location is accurate)
      return;
    }
    console.log(`[XSanctuary] VPN detected for @${screenName}: location not accurate`);
  }

  // Apply hard action (only once per user)
  if (rule.hardAction !== 'none' && !hardActionApplied.has(screenName.toLowerCase())) {
    hardActionApplied.add(screenName.toLowerCase());
    applyHardAction(userInfo, rule);
  }

  // Apply soft action to tweet content
  if (rule.softAction !== 'none') {
    applySoftAction(tweet as HTMLElement, userInfo, rule);
  }
}

async function addFlagBadge(element: HTMLElement, screenName: string) {
  try {
    // Check if badge already added anywhere near this element
    if (element.querySelector('.xsanctuary-badge')) return;
    const parent = element.closest('[data-testid="User-Name"]') || element.parentElement;
    if (parent?.querySelector('.xsanctuary-badge')) return;

    // Create loading badge first
    const badge = document.createElement('span');
    badge.className = 'xsanctuary-badge xsanctuary-loading';
    badge.innerHTML = `<span class="xsanctuary-badge-loader"></span>`;
    badge.title = 'Loading location...';

    // Find the span containing the @username text and insert after it
    const usernameSpan = element.querySelector('span[class*="r-poiln3"]') ||
                         element.querySelector('span') ||
                         element;

    // Insert after the username span, inside its parent
    if (usernameSpan.parentNode) {
      usernameSpan.parentNode.insertBefore(badge, usernameSpan.nextSibling);
    } else {
      element.appendChild(badge);
    }

    // Fetch user info
    const userInfo = await getUserInfo(screenName);

    // Remove loading state
    badge.classList.remove('xsanctuary-loading');

    if (!userInfo?.country) {
      // No country data - remove the badge
      badge.remove();
      return;
    }

    const flag = getFlag(userInfo.country);
    if (!flag) {
      badge.remove();
      return;
    }

    // Check for deception (flags in profile don't match actual country)
    const profileText = `${userInfo.name || ''} ${userInfo.bio || ''}`;
    const claimedFlags = extractFlagEmojis(profileText);
    const countryCode = getCountryCode(userInfo.country);
    const isDeceptive = countryCode && claimedFlags.length > 0 &&
      !claimedFlags.some(f => f.toUpperCase() === countryCode.toUpperCase());

    // Add VPN indicator class if location is not accurate
    if (userInfo.locationAccurate === false) {
      badge.classList.add('xsanctuary-vpn');
    }

    // Add deception indicator class
    if (isDeceptive) {
      badge.classList.add('xsanctuary-deceptive');
    }

    // Build the expanded content
    let expandedContent = userInfo.country;
    let indicators: string[] = [];

    if (isDeceptive) {
      // Claimed flags from profile are always emojis, so keep using countryCodeToFlag for those
      // But for the actual country, we need to render it properly (might be SVG)
      const claimedFlagEmojis = claimedFlags.map(code => {
        const codePoints = code.toUpperCase().split('').map(char => 127397 + char.charCodeAt(0));
        return String.fromCodePoint(...codePoints);
      }).join('');
      expandedContent = `${claimedFlagEmojis} → ${renderFlag(flag, 'small')}`;
      indicators.push('Deceptive');
    }

    if (userInfo.locationAccurate === false) {
      indicators.push('VPN');
    }

    const indicatorText = indicators.length > 0 ? ` (${indicators.join(', ')})` : '';

    // Update badge with flag and country name (expands on hover)
    badge.innerHTML = `<span class="xsanctuary-badge-flag">${renderFlag(flag, 'small')}</span><span class="xsanctuary-badge-country">${expandedContent}${indicatorText}</span>`;
    badge.title = `XSanctuary: ${userInfo.country}${indicatorText} (right-click for options)`;

    // Add context menu handler
    badge.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      e.stopPropagation();
      showContextMenu(e as MouseEvent, userInfo);
    });
  } catch (error) {
    console.error(`[XSanctuary] Error adding badge for ${screenName}:`, error);
    // Remove badge on error
    element.querySelector('.xsanctuary-badge')?.remove();
  }
}

async function getUserInfo(screenName: string): Promise<UserInfo | null> {
  const cacheKey = screenName.toLowerCase();

  // Check cache
  if (userInfoCache.has(cacheKey)) {
    return userInfoCache.get(cacheKey)!;
  }

  // Check pending
  if (pendingRequests.has(cacheKey)) {
    return pendingRequests.get(cacheKey)!;
  }

  // Fetch user info - use .finally() to ensure cleanup even on error
  const requestPromise = fetchUserInfo(screenName)
    .then((info) => {
      userInfoCache.set(cacheKey, info);
      return info;
    })
    .catch((error) => {
      console.error(`[XSanctuary] Error fetching user info for @${screenName}:`, error);
      return null;
    })
    .finally(() => {
      pendingRequests.delete(cacheKey);
    });

  pendingRequests.set(cacheKey, requestPromise);
  return requestPromise;
}

async function applyHardAction(userInfo: UserInfo, rule: CountryRule) {
  console.log(`[XSanctuary] Applying ${rule.hardAction} to @${userInfo.screenName} (${userInfo.country})`);

  if (rule.hardAction === 'block') {
    await blockUser(userInfo.userId);
  } else if (rule.hardAction === 'mute') {
    await muteUser(userInfo.userId);
  }
}

async function applySoftAction(tweet: HTMLElement, userInfo: UserInfo, rule: CountryRule) {
  const flag = getFlag(userInfo.country || '') || '🏳️';

  // Find the tweet text element
  const tweetText = tweet.querySelector('[data-testid="tweetText"]') as HTMLElement;
  if (!tweetText) return;

  // Check if already processed
  if (tweetText.dataset.xsanctuaryProcessed) return;
  tweetText.dataset.xsanctuaryProcessed = 'true';

  const originalText = tweetText.textContent || '';
  const originalHtml = tweetText.innerHTML;

  switch (rule.softAction) {
    case 'hide':
      tweet.style.display = 'none';
      break;

    case 'blur':
      createBlurOverlay(tweet, tweetText, flag, userInfo.country || 'Unknown', userInfo.screenName, rule.countryCode);
      break;

    case 'uwu':
      tweetText.textContent = toUwuSpeak(originalText);
      addTransformBadge(tweetText, 'UwU', flag);
      break;

    case 'cat':
      tweetText.textContent = toCatSpeak(originalText);
      addTransformBadge(tweetText, '🐱', flag);
      break;

    case 'llm':
      if (!cachedSettings?.openRouterApiKey) {
        console.warn('[XSanctuary] LLM transform skipped: No API key configured');
        addTransformBadge(tweetText, '⚠️ API key needed', flag);
        break;
      }

      // Build context-aware prompt with user data
      const basePrompt = rule.llmPrompt || cachedSettings.defaultLlmPrompt;
      const userContext = buildUserContext(userInfo, rule);
      const fullPrompt = `${basePrompt}\n\nContext about this user:\n${userContext}`;

      const model = cachedSettings.llmModel || 'x-ai/grok-3-fast:free';

      // Add transforming indicator
      tweetText.classList.add('xsanctuary-transforming');

      // Animate out old text
      tweetText.classList.add('xsanctuary-fade-out');
      await new Promise(resolve => setTimeout(resolve, 300));

      // Show loading placeholder (native X.com style)
      const originalContent = tweetText.innerHTML;
      tweetText.innerHTML = `
        <div class="xsanctuary-transform-placeholder">
          <div class="xsanctuary-transform-spinner"></div>
          <span>Rewriting...</span>
        </div>
      `;
      tweetText.classList.remove('xsanctuary-fade-out');
      tweetText.classList.add('xsanctuary-fade-in');

      // Use background script for streaming (content scripts can't stream fetch properly)
      const requestId = `llm-${Date.now()}-${Math.random().toString(36).slice(2)}`;
      let isFirstChunk = true;
      let transformError: string | null = null;

      // Set up listener for streaming chunks
      const chunkHandler = (message: { type: string; requestId: string; chunk?: string; error?: string }) => {
        if (message.requestId !== requestId) return;

        if (message.type === 'LLM_TRANSFORM_CHUNK' && message.chunk) {
          if (isFirstChunk) {
            tweetText.innerHTML = '';
            tweetText.classList.remove('xsanctuary-fade-in');
            isFirstChunk = false;
          }
          tweetText.textContent += message.chunk;
        } else if (message.type === 'LLM_TRANSFORM_ERROR') {
          transformError = message.error || 'Unknown error';
        }
      };

      browser.runtime.onMessage.addListener(chunkHandler);

      try {
        // Send request to background script
        browser.runtime.sendMessage({
          type: 'LLM_TRANSFORM',
          requestId,
          text: originalText,
          apiKey: cachedSettings.openRouterApiKey,
          prompt: fullPrompt,
          model,
        });

        // Wait for completion or error
        await new Promise<void>((resolve, reject) => {
          const doneHandler = (message: { type: string; requestId: string; error?: string }) => {
            if (message.requestId !== requestId) return;

            if (message.type === 'LLM_TRANSFORM_DONE') {
              browser.runtime.onMessage.removeListener(doneHandler);
              resolve();
            } else if (message.type === 'LLM_TRANSFORM_ERROR') {
              browser.runtime.onMessage.removeListener(doneHandler);
              reject(new Error(message.error || 'Transform failed'));
            }
          };
          browser.runtime.onMessage.addListener(doneHandler);
        });

        // Remove chunk handler
        browser.runtime.onMessage.removeListener(chunkHandler);

        if (transformError) {
          throw new Error(transformError);
        }

        // Remove transforming state
        tweetText.classList.remove('xsanctuary-transforming');
        addTransformBadge(tweetText, '🤖', flag);
      } catch (error) {
        browser.runtime.onMessage.removeListener(chunkHandler);
        console.error('[XSanctuary] LLM transform failed:', error);
        tweetText.innerHTML = originalContent;
        tweetText.classList.remove('xsanctuary-transforming', 'xsanctuary-fade-in');
        addTransformBadge(tweetText, '❌ Transform failed', flag);
      }
      break;
  }
}

function createBlurOverlay(tweet: HTMLElement, tweetText: HTMLElement, flag: string, country: string, screenName: string, countryCode: string) {
  // Blur the text
  tweetText.style.filter = 'blur(4px)';
  tweetText.style.userSelect = 'none';
  tweetText.classList.add('xsanctuary-blurred');

  // Find the tweet header area (where timestamp and ... menu are)
  const headerRight = tweet.querySelector('[data-testid="User-Name"]')?.parentElement?.querySelector('div:last-child') ||
                      tweet.querySelector('time')?.closest('a')?.parentElement;

  if (!headerRight) {
    // Fallback: insert after username
    const userName = tweet.querySelector('[data-testid="User-Name"]');
    if (!userName) return;
  }

  // Create action buttons styled to match Twitter but with our accent
  const actionBar = document.createElement('div');
  actionBar.className = 'xsanctuary-header-actions';
  actionBar.dataset.country = countryCode;
  actionBar.dataset.screenName = screenName.toLowerCase();
  actionBar.innerHTML = `
    <button data-action="reveal" data-tooltip="Reveal">
      <svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor">
        <path d="M12 4.5C7 4.5 2.73 7.61 1 12c1.73 4.39 6 7.5 11 7.5s9.27-3.11 11-7.5c-1.73-4.39-6-7.5-11-7.5zM12 17c-2.76 0-5-2.24-5-5s2.24-5 5-5 5 2.24 5 5-2.24 5-5 5zm0-8c-1.66 0-3 1.34-3 3s1.34 3 3 3 3-1.34 3-3-1.34-3-3-3z"/>
      </svg>
    </button>
    <button data-action="pause-1h" data-tooltip="Pause 1h">
      <svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor">
        <path d="M6 19h4V5H6v14zm8-14v14h4V5h-4z"/>
      </svg>
    </button>
    <button data-action="exclude" data-tooltip="Allow @${screenName}">
      <svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor">
        <path d="M9 16.17L4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41z"/>
      </svg>
    </button>
  `;

  // Insert before the ... menu or at the end of header
  const menuButton = tweet.querySelector('[data-testid="caret"]');
  if (menuButton?.parentElement) {
    menuButton.parentElement.insertBefore(actionBar, menuButton);
  } else if (headerRight) {
    headerRight.appendChild(actionBar);
  } else {
    // Last resort: append to User-Name area
    const userName = tweet.querySelector('[data-testid="User-Name"]');
    userName?.appendChild(actionBar);
  }

  // Add tooltip listeners to buttons
  actionBar.querySelectorAll('button').forEach(btn => {
    const tooltip = btn.getAttribute('data-tooltip');
    if (tooltip) {
      btn.addEventListener('mouseenter', () => showTooltip(btn as HTMLElement, tooltip));
      btn.addEventListener('mouseleave', hideTooltip);
    }
  });

  // Handle all button clicks
  actionBar.addEventListener('click', async (e) => {
    e.stopPropagation();
    e.preventDefault();
    const target = (e.target as HTMLElement).closest('button');
    if (!target) return;

    const action = target.dataset.action;
    const settings = await getSettings();
    const rule = settings.rules.find(r => r.countryCode === countryCode);

    // Helper to unblur this tweet
    const unblurThis = () => {
      // Add reveal animation
      tweetText.classList.add('xsanctuary-revealing');
      tweetText.style.filter = '';
      tweetText.style.userSelect = '';
      setTimeout(() => {
        tweetText.classList.remove('xsanctuary-blurred', 'xsanctuary-revealing');
      }, 500);
      actionBar.remove();
    };

    switch (action) {
      case 'reveal':
        unblurThis();
        break;

      case 'pause-1h':
        if (rule) {
          rule.pausedUntil = Date.now() + 60 * 60 * 1000;
          await saveSettings(settings);
          cachedSettings = settings;
          showToast(`${renderFlag(flag, 'small')} Paused for 1 hour`);
          // Re-evaluate all blurred content
          reEvaluateBlurredContent();
        }
        break;

      case 'exclude':
        if (rule) {
          rule.excludedUsers = rule.excludedUsers || [];
          rule.excludedUsers.push(screenName.toLowerCase());
          await saveSettings(settings);
          cachedSettings = settings;
          showToast(`${renderFlag(flag, 'small')} @${screenName} excluded`);
          // Re-evaluate all blurred content
          reEvaluateBlurredContent();
        }
        break;
    }
  });
}

// Re-evaluate all blurred content against current rules
function reEvaluateBlurredContent() {
  document.querySelectorAll('.xsanctuary-header-actions').forEach(async (actionBar) => {
    const countryCode = (actionBar as HTMLElement).dataset.country;
    const screenName = (actionBar as HTMLElement).dataset.screenName;
    if (!countryCode) return;

    const rule = cachedSettings?.rules.find(r => r.countryCode === countryCode);

    // Check if rule still applies
    let shouldRemainBlurred = false;

    if (rule && rule.softAction === 'blur') {
      // Check if paused
      if (rule.pausedUntil && Date.now() < rule.pausedUntil) {
        shouldRemainBlurred = false;
      }
      // Check if user is excluded
      else if (screenName && rule.excludedUsers?.includes(screenName.toLowerCase())) {
        shouldRemainBlurred = false;
      }
      else {
        shouldRemainBlurred = true;
      }
    }

    if (!shouldRemainBlurred) {
      // Find the tweet and its blurred text
      const tweet = actionBar.closest('article[data-testid="tweet"]');
      const textEl = tweet?.querySelector('.xsanctuary-blurred') as HTMLElement;
      if (textEl) {
        textEl.style.filter = '';
        textEl.style.userSelect = '';
        textEl.classList.remove('xsanctuary-blurred');
      }
      actionBar.remove();
    }
  });
}

function addTransformBadge(element: HTMLElement, emoji: string, flag: string) {
  const badge = document.createElement('span');
  badge.className = 'xsanctuary-transform-badge';
  badge.innerHTML = ` ${renderFlag(flag, 'small')} ${emoji}`;
  element.appendChild(badge);
}

// Build context string about the user for LLM prompt
function buildUserContext(userInfo: UserInfo, rule: CountryRule): string {
  const lines: string[] = [];

  lines.push(`- Country: ${userInfo.country || 'Unknown'}`);
  lines.push(`- Username: @${userInfo.screenName}`);

  if (userInfo.name) {
    lines.push(`- Display name: ${userInfo.name}`);
  }

  if (userInfo.locationAccurate === false) {
    lines.push(`- VPN detected: Yes (location may be obfuscated)`);
  }

  // Check for deception
  const profileText = `${userInfo.name || ''} ${userInfo.bio || ''}`;
  const claimedFlags = extractFlagEmojis(profileText);
  const countryCode = getCountryCode(userInfo.country || '');

  if (claimedFlags.length > 0 && countryCode) {
    const hasMatchingFlag = claimedFlags.some(
      f => f.toUpperCase() === countryCode.toUpperCase()
    );
    if (!hasMatchingFlag) {
      const claimedCountries = claimedFlags.map(f => countryCodeToFlag(f)).join(' ');
      lines.push(`- Deceptive profile: User displays ${claimedCountries} flags but is actually from ${userInfo.country}`);
    }
  }

  if (rule.deceptionOnly) {
    lines.push(`- Rule trigger: Deception filter matched`);
  }

  if (rule.vpnOnly) {
    lines.push(`- Rule trigger: VPN filter matched`);
  }

  return lines.join('\n');
}

// Context menu for flag badges
let activeContextMenu: HTMLElement | null = null;

function showContextMenu(e: MouseEvent, userInfo: UserInfo) {
  // Remove any existing context menu
  hideContextMenu();

  const countryCode = getCountryCode(userInfo.country || '');
  if (!countryCode) return;

  const flag = getFlag(userInfo.country || '') || '🏳️';

  const menu = document.createElement('div');
  menu.className = 'xsanctuary-context-menu';
  menu.innerHTML = `
    <div class="xsanctuary-menu-header">${renderFlag(flag, 'medium')} ${userInfo.country}</div>
    <div class="xsanctuary-menu-divider"></div>
    <button class="xsanctuary-menu-item" data-action="hide">
      <span>🙈</span> Hide content from this country
    </button>
    <button class="xsanctuary-menu-item" data-action="blur">
      <span>🔒</span> Blur content from this country
    </button>
    <div class="xsanctuary-menu-divider"></div>
    <button class="xsanctuary-menu-item" data-action="mute">
      <span>🔇</span> Auto-mute users from this country
    </button>
    <button class="xsanctuary-menu-item xsanctuary-menu-item-danger" data-action="block">
      <span>🚫</span> Auto-block users from this country
    </button>
  `;

  // Position the menu
  menu.style.left = `${e.clientX}px`;
  menu.style.top = `${e.clientY}px`;

  // Add click handlers
  menu.querySelectorAll('.xsanctuary-menu-item').forEach((item) => {
    item.addEventListener('click', async (evt) => {
      const action = (evt.currentTarget as HTMLElement).dataset.action;
      await handleContextMenuAction(action!, userInfo.country!, countryCode);
      hideContextMenu();
    });
  });

  document.body.appendChild(menu);
  activeContextMenu = menu;

  // Close on click outside
  setTimeout(() => {
    document.addEventListener('click', hideContextMenu, { once: true });
  }, 0);
}

function hideContextMenu() {
  if (activeContextMenu) {
    activeContextMenu.remove();
    activeContextMenu = null;
  }
}

async function handleContextMenuAction(action: string, country: string, countryCode: string) {
  const settings = await getSettings();

  // Find or create rule for this country
  let rule = settings.rules.find(r => r.countryCode === countryCode);

  if (!rule) {
    rule = {
      country,
      countryCode,
      softAction: 'none',
      hardAction: 'none',
    };
    settings.rules.push(rule);
  }

  switch (action) {
    case 'hide':
      rule.softAction = 'hide';
      break;
    case 'blur':
      rule.softAction = 'blur';
      break;
    case 'mute':
      rule.hardAction = 'mute';
      break;
    case 'block':
      rule.hardAction = 'block';
      break;
  }

  await saveSettings(settings);
  cachedSettings = settings;

  // Show confirmation
  const flag = getFlag(country) || '🏳️';
  showToast(`${renderFlag(flag, 'small')} Rule added for ${country}`);
}

function showToast(message: string) {
  const toast = document.createElement('div');
  toast.className = 'xsanctuary-toast';
  toast.innerHTML = message; // Use innerHTML to support flag images
  document.body.appendChild(toast);

  setTimeout(() => {
    toast.classList.add('xsanctuary-toast-hide');
    setTimeout(() => toast.remove(), 300);
  }, 2000);
}

// Tooltip management
let activeTooltip: HTMLElement | null = null;

function showTooltip(target: HTMLElement, text: string) {
  hideTooltip();

  const tooltip = document.createElement('div');
  tooltip.className = 'xsanctuary-tooltip';
  tooltip.textContent = text;
  document.body.appendChild(tooltip);

  // Position above the button
  const rect = target.getBoundingClientRect();
  const tooltipRect = tooltip.getBoundingClientRect();

  tooltip.style.left = `${rect.left + rect.width / 2 - tooltipRect.width / 2}px`;
  tooltip.style.top = `${rect.top - tooltipRect.height - 6}px`;

  // Show with slight delay
  requestAnimationFrame(() => {
    tooltip.classList.add('visible');
  });

  activeTooltip = tooltip;
}

function hideTooltip() {
  if (activeTooltip) {
    activeTooltip.remove();
    activeTooltip = null;
  }
}

// ============================================================================
// Comic Detection & Translation
// ============================================================================

// Process images in tweets for comic detection
async function processImagesInTweet(tweet: Element) {
  console.log('[XSanctuary Comic] processImagesInTweet called, settings:', {
    comicEnabled: cachedSettings?.comicTranslation?.enabled,
    hasApiKey: !!cachedSettings?.openRouterApiKey,
  });

  if (!cachedSettings?.comicTranslation?.enabled) {
    console.log('[XSanctuary Comic] Comic translation is disabled in settings');
    return;
  }
  if (!cachedSettings?.openRouterApiKey) {
    console.log('[XSanctuary Comic] Comic translation skipped: No API key');
    return;
  }

  // Get the main tweet's status ID from the tweet article's permalink
  // The main tweet's permalink is typically in a time element's parent link
  const tweetPermalink = tweet.querySelector('a[href*="/status/"] time')?.closest('a');
  const mainTweetStatusMatch = tweetPermalink?.getAttribute('href')?.match(/\/status\/(\d+)/);
  const mainTweetStatusId = mainTweetStatusMatch?.[1];

  console.log('[XSanctuary Comic] Main tweet status ID:', mainTweetStatusId);

  // Find images in the tweet - only target actual media images, not profile pics
  // tweetPhoto is the container for tweet images/media
  const allImages = tweet.querySelectorAll(
    'div[data-testid="tweetPhoto"] img, ' +
    'img[src*="twimg.com/media"]'
  );

  // Filter out images that are inside quoted tweets (nested tweet structures)
  const images = Array.from(allImages).filter((img) => {
    // Check if this image is inside a card wrapper (quoted tweet card)
    const cardWrapper = img.closest('[data-testid="card.wrapper"]');
    if (cardWrapper) {
      console.log('[XSanctuary Comic] Excluding image in card.wrapper');
      return false;
    }

    // Get the image's parent link to check status ID
    const imageLink = img.closest('a[href*="/status/"]');
    if (!imageLink) {
      // Image not in a status link - include it
      return true;
    }

    const imageLinkHref = imageLink.getAttribute('href') || '';
    const imageStatusMatch = imageLinkHref.match(/\/status\/(\d+)/);
    const imageStatusId = imageStatusMatch?.[1];

    // If we have a main tweet status ID, only include images from the same tweet
    if (mainTweetStatusId && imageStatusId) {
      if (imageStatusId !== mainTweetStatusId) {
        console.log('[XSanctuary Comic] Excluding image from different status:', imageStatusId, 'vs main:', mainTweetStatusId);
        return false;
      }
    }

    return true;
  }) as HTMLImageElement[];

  if (images.length === 0) return;

  console.log(`[XSanctuary] Found ${images.length} main tweet images (filtered from ${allImages.length})`);

  // Add a single translate button to the tweet (not per-image)
  addTweetTranslateButton(tweet, images);
}

// Check for lightbox image when navigating to photo URL
function checkForLightboxImage() {
  if (!cachedSettings?.comicTranslation?.enabled) return;

  // Look for lightbox image in various containers
  const selectors = [
    '[data-testid="swipe-to-dismiss"] img[src*="twimg.com/media"]',
    '[aria-label="Image"] img[src*="twimg.com/media"]',
    '#layers img[src*="twimg.com/media"]',
  ];

  for (const selector of selectors) {
    const img = document.querySelector(selector) as HTMLImageElement;
    if (img && !processedImages.has(img)) {
      console.log('[XSanctuary] Found lightbox image via URL check:', img.src);
      processImageForLightbox(img);
      return;
    }
  }

  console.log('[XSanctuary] No lightbox image found yet, will retry...');
  // Retry a few times as the image might not be loaded yet
  setTimeout(() => {
    for (const selector of selectors) {
      const img = document.querySelector(selector) as HTMLImageElement;
      if (img && !processedImages.has(img)) {
        console.log('[XSanctuary] Found lightbox image via retry:', img.src);
        processImageForLightbox(img);
        return;
      }
    }
  }, 500);
}

// Also watch for lightbox/media viewer
function setupLightboxObserver() {
  // Twitter's lightbox can appear in #layers or as a swipe-to-dismiss element
  const observer = new MutationObserver((mutations) => {
    for (const mutation of mutations) {
      mutation.addedNodes.forEach((node) => {
        if (node instanceof Element) {
          // Look for lightbox images - check multiple selectors
          // Lightbox uses swipe-to-dismiss container or aria-label="Image"
          const lightboxContainers = node.querySelectorAll(
            '[data-testid="swipe-to-dismiss"], [aria-label="Image"]'
          );

          // Also check if the node itself is a lightbox container
          if (node.matches('[data-testid="swipe-to-dismiss"], [aria-label="Image"]')) {
            const img = node.querySelector('img[src*="twimg.com/media"]') as HTMLImageElement;
            if (img && !processedImages.has(img)) {
              console.log('[XSanctuary] Found lightbox image (direct match):', img.src);
              processImageForLightbox(img);
            }
          }

          lightboxContainers.forEach((container) => {
            const img = container.querySelector('img[src*="twimg.com/media"]') as HTMLImageElement;
            if (img && !processedImages.has(img)) {
              console.log('[XSanctuary] Found lightbox image:', img.src);
              processImageForLightbox(img);
            }
          });

          // Fallback: check for any media image in the added node
          const allMediaImgs = node.querySelectorAll('img[src*="twimg.com/media"]');
          allMediaImgs.forEach((img) => {
            const imgEl = img as HTMLImageElement;
            // Only process if it looks like a lightbox (large image, in layers)
            if (!processedImages.has(imgEl) && imgEl.closest('#layers')) {
              console.log('[XSanctuary] Found lightbox image (fallback):', imgEl.src);
              processImageForLightbox(imgEl);
            }
          });
        }
      });
    }
  });

  // Observe both #layers and document.body for lightbox detection
  const layers = document.querySelector('#layers');
  if (layers) {
    console.log('[XSanctuary] Observing #layers for lightbox');
    observer.observe(layers, { childList: true, subtree: true });
  } else {
    // Fallback to body if #layers doesn't exist yet
    console.log('[XSanctuary] #layers not found, observing body');
    observer.observe(document.body, { childList: true, subtree: true });
  }

  return observer;
}

function processImageForLightbox(img: HTMLImageElement) {
  if (processedImages.has(img)) return;

  // Wait for image to be ready
  if (img.clientHeight < 50) {
    const resizeObserver = new ResizeObserver(() => {
      if (img.clientWidth >= 150 && img.clientHeight >= 150) {
        resizeObserver.disconnect();
        applyLightboxTranslation(img);
      }
    });
    resizeObserver.observe(img);
    return;
  }

  applyLightboxTranslation(img);
}

function applyLightboxTranslation(img: HTMLImageElement) {
  processedImages.add(img);

  // Normalize URL for cache lookup (Twitter uses different size params for inline vs lightbox)
  const normalizedUrl = normalizeTwitterImageUrl(img.src);
  console.log('[XSanctuary] Applying lightbox translation, normalized URL:', normalizedUrl);
  console.log('[XSanctuary] Cache has', imageDetectionCache.size, 'entries');

  // Check if we already have detection results cached for this image URL
  const cachedResult = imageDetectionCache.get(normalizedUrl);

  if (cachedResult && cachedResult.bubbles.length > 0) {
    // Auto-apply the overlays since we already translated this image
    console.log('[XSanctuary] Applying cached translation to lightbox, bubbles:', cachedResult.bubbles.length);
    addBubbleOverlaysToLightbox(img, normalizedUrl, cachedResult);
  } else {
    // No cached results - add translate button
    console.log('[XSanctuary] No cached results, adding translate button');
    addLightboxTranslateButton(img);
  }
}

function addBubbleOverlaysToLightbox(img: HTMLImageElement, imageUrl: string, detectionResult: DetectionResult) {
  // Find a suitable container for the lightbox overlay
  const container = img.parentElement as HTMLElement;
  if (!container) {
    console.warn('[XSanctuary] Lightbox: No parent container found for image');
    return;
  }

  console.log('[XSanctuary] Lightbox: Adding overlays to container:', container.className);
  console.log('[XSanctuary] Lightbox: Image dimensions:', img.clientWidth, 'x', img.clientHeight);

  // Ensure container has relative positioning
  if (getComputedStyle(container).position === 'static') {
    container.style.position = 'relative';
    console.log('[XSanctuary] Lightbox: Set container position to relative');
  }

  // Remove any existing overlays
  container.querySelectorAll('.xsanctuary-bubble-container').forEach((el) => el.remove());

  // Create overlay container
  const overlayContainer = document.createElement('div');
  overlayContainer.className = 'xsanctuary-bubble-container xsanctuary-lightbox-overlay';

  // Create hover zones for each bubble
  for (const bubble of detectionResult.bubbles) {
    const overlay = document.createElement('div');
    overlay.className = 'xsanctuary-bubble-overlay xsanctuary-bubble-fetched'; // Already fetched

    // Use exact bbox coordinates from YOLO (no padding)
    const left = (bubble.bbox.x1 / detectionResult.imageWidth) * 100;
    const top = (bubble.bbox.y1 / detectionResult.imageHeight) * 100;
    const width = ((bubble.bbox.x2 - bubble.bbox.x1) / detectionResult.imageWidth) * 100;
    const height = ((bubble.bbox.y2 - bubble.bbox.y1) / detectionResult.imageHeight) * 100;

    const translationEl = document.createElement('div');
    translationEl.className = 'xsanctuary-bubble-translation';

    // Check if we have a cached translation for this bubble
    const cacheKey = getBubbleKey(imageUrl, bubble);
    const cachedTranslation = bubbleTranslationCache.get(cacheKey);

    if (cachedTranslation) {
      // Parse cached data (may include colors)
      try {
        const parsed = JSON.parse(cachedTranslation);
        translationEl.textContent = parsed.text || cachedTranslation;
        if (parsed.textColor) {
          translationEl.style.color = parsed.textColor;
          translationEl.style.borderColor = parsed.textColor;
        }
        if (parsed.bgColor) translationEl.style.backgroundColor = parsed.bgColor;
      } catch {
        translationEl.textContent = cachedTranslation;
      }
      // Defer text fitting until element is in DOM (pass maskPath for shape-aware layout)
      const maskPathForFit = bubble.maskPath;
      requestAnimationFrame(() => fitTextToBubble(translationEl, maskPathForFit));
    } else {
      translationEl.innerHTML = '<span class="xsanctuary-bubble-loading">...</span>';
    }

    overlay.style.cssText = `
      position: absolute;
      left: ${left}%;
      top: ${top}%;
      width: ${width}%;
      height: ${height}%;
      pointer-events: auto;
      cursor: pointer;
    `;

    // Use ellipse border-radius but text will flow according to actual mask shape
    translationEl.style.borderRadius = '50%';

    overlay.appendChild(translationEl);

    // Fetch translation if not cached
    let translationFetched = !!cachedTranslation;

    overlay.addEventListener('mouseenter', async () => {
      overlay.classList.add('xsanctuary-bubble-active');

      if (!translationFetched) {
        translationFetched = true;
        await fetchBubbleTranslation(translationEl, imageUrl, bubble, detectionResult.imageWidth, detectionResult.imageHeight);
      }
    });

    overlay.addEventListener('mouseleave', () => {
      overlay.classList.remove('xsanctuary-bubble-active');
    });

    overlayContainer.appendChild(overlay);
  }

  container.appendChild(overlayContainer);
}

function addLightboxTranslateButton(img: HTMLImageElement) {
  const container = img.parentElement;
  if (!container || container.querySelector('.xsanctuary-translate-btn')) return;

  const btn = document.createElement('button');
  btn.className = 'xsanctuary-translate-btn xsanctuary-lightbox-btn';
  btn.innerHTML = '<span>🌐 Translate</span>';
  btn.title = 'Detect & translate speech bubbles';

  btn.addEventListener('click', async (e) => {
    e.stopPropagation();
    e.preventDefault();

    btn.classList.add('loading');
    btn.innerHTML = '<span class="xsanctuary-spinner"></span>';

    try {
      await detectAndProcessComic(img, img.src);
      btn.style.display = 'none';
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      console.error('[XSanctuary] Lightbox detection failed:', errorMessage);
      btn.innerHTML = '<span>❌</span>';
      btn.title = `Detection failed: ${errorMessage}`;
      btn.classList.remove('loading');
    }
  });

  container.style.position = 'relative';
  container.appendChild(btn);
}

// Clear all translation caches
async function clearTranslationCaches() {
  imageDetectionCache.clear();
  bubbleTranslationCache.clear();
  imageTranslationCache.clear();
  // Also clear the persistent LLM cache in background
  try {
    await browser.runtime.sendMessage({ type: 'CLEAR_LLM_CACHE' });
    console.log('[XSanctuary] All translation caches cleared (including persistent LLM cache)');
  } catch (e) {
    console.log('[XSanctuary] In-memory caches cleared (LLM cache clear failed)');
  }
  showToast('Translation cache cleared');
}

// Expose to window for debugging
(window as any).xsanctuaryClearCache = clearTranslationCaches;

// Add translate button to each image (top-right corner)
function addTweetTranslateButton(tweet: Element, images: HTMLImageElement[]) {
  for (const img of images) {
    addImageTranslateButton(img);
  }
}

// Add translate button to a single image
function addImageTranslateButton(img: HTMLImageElement) {
  // Find the tweetPhoto container
  const container = img.closest('div[data-testid="tweetPhoto"]') as HTMLElement;
  if (!container) return;

  // Don't add if already added
  if (container.querySelector('.xsanctuary-image-translate-btn')) return;

  // Ensure container has relative positioning
  if (getComputedStyle(container).position === 'static') {
    container.style.position = 'relative';
  }

  const btn = document.createElement('button');
  btn.className = 'xsanctuary-image-translate-btn';
  btn.innerHTML = '🌐';
  btn.title = 'Translate comic (right-click to clear cache)';

  // Right-click to clear cache
  btn.addEventListener('contextmenu', (e) => {
    e.preventDefault();
    e.stopPropagation();
    clearTranslationCaches();
  });

  btn.addEventListener('click', async (e) => {
    e.stopPropagation();
    e.preventDefault();

    btn.classList.add('loading');
    btn.innerHTML = '<span class="xsanctuary-spinner"></span>';

    try {
      // Wait for image to be ready
      if (img.clientWidth < 100 || img.clientHeight < 100) {
        await new Promise<void>((resolve) => {
          const observer = new ResizeObserver(() => {
            if (img.clientWidth >= 100 && img.clientHeight >= 100) {
              observer.disconnect();
              resolve();
            }
          });
          observer.observe(img);
          setTimeout(() => { observer.disconnect(); resolve(); }, 3000);
        });
      }

      const result = await detectAndProcessComic(img, img.src);

      if (result && result.bubbles.length > 0) {
        btn.innerHTML = '✓';
        btn.title = `Found ${result.bubbles.length} bubble${result.bubbles.length > 1 ? 's' : ''}`;
        btn.classList.add('success');
      } else {
        btn.innerHTML = '∅';
        btn.title = 'No speech bubbles found';
      }
      btn.classList.remove('loading');
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      console.error('[XSanctuary] Image translation failed:', errorMessage);
      btn.innerHTML = '❌';
      btn.title = `Detection failed: ${errorMessage}`;
      btn.classList.remove('loading');
    }
  });

  container.appendChild(btn);
}

async function detectAndProcessComic(img: HTMLImageElement, imageUrl: string): Promise<DetectionResult | null> {
  const mode = cachedSettings?.comicTranslation.mode || 'bubble';
  const normalizedUrl = normalizeTwitterImageUrl(imageUrl);

  console.log('[XSanctuary] detectAndProcessComic called with:');
  console.log('[XSanctuary]   Original URL:', imageUrl);
  console.log('[XSanctuary]   Normalized URL:', normalizedUrl);
  console.log('[XSanctuary]   Image dimensions:', img.naturalWidth, 'x', img.naturalHeight);

  // Check cache first
  let detectionResult = imageDetectionCache.get(normalizedUrl);

  if (!detectionResult) {
    // Run YOLO detection with configurable confidence
    const confidenceThreshold = cachedSettings?.comicTranslation?.confidenceThreshold ?? 0.3;
    console.log('[XSanctuary] Running comic detection on:', normalizedUrl, 'with confidence:', confidenceThreshold);
    detectionResult = await detectBubblesInImage(imageUrl, confidenceThreshold);
    imageDetectionCache.set(normalizedUrl, detectionResult);
    console.log(`[XSanctuary] Detection result:`, {
      bubbles: detectionResult.bubbles.length,
      imageWidth: detectionResult.imageWidth,
      imageHeight: detectionResult.imageHeight,
      inferenceTime: detectionResult.inferenceTime,
    });
  } else {
    console.log('[XSanctuary] Using cached detection result:', detectionResult.bubbles.length, 'bubbles');
  }

  if (detectionResult.bubbles.length === 0) {
    return detectionResult;
  }

  if (mode === 'bubble') {
    // Bubble mode: add hover overlays
    addBubbleOverlays(img, normalizedUrl, detectionResult);
  } else {
    // Auto mode: send whole image for re-rendering
    await translateFullImageAndReplace(img, normalizedUrl);
  }

  return detectionResult;
}

function addBubbleOverlays(img: HTMLImageElement, imageUrl: string, detectionResult: DetectionResult) {
  const container = img.closest('div[data-testid="tweetPhoto"]') as HTMLElement;
  if (!container) return;

  // Ensure container has relative positioning for absolute children
  if (getComputedStyle(container).position === 'static') {
    container.style.position = 'relative';
  }

  // Remove any existing overlays
  container.querySelectorAll('.xsanctuary-bubble-container').forEach((el) => el.remove());

  // Create overlay container that sits on top of the image
  const overlayContainer = document.createElement('div');
  overlayContainer.className = 'xsanctuary-bubble-container';

  // Use CSS class for positioning (defined in style.css)
  // The container is positioned relative to parent with pointer-events: none

  // Create hover zones for each bubble
  for (const bubble of detectionResult.bubbles) {
    const overlay = document.createElement('div');
    overlay.className = 'xsanctuary-bubble-overlay';

    // Use exact bbox coordinates from YOLO (no padding)
    const left = (bubble.bbox.x1 / detectionResult.imageWidth) * 100;
    const top = (bubble.bbox.y1 / detectionResult.imageHeight) * 100;
    const width = ((bubble.bbox.x2 - bubble.bbox.x1) / detectionResult.imageWidth) * 100;
    const height = ((bubble.bbox.y2 - bubble.bbox.y1) / detectionResult.imageHeight) * 100;

    // Create translation text element (hidden by default)
    const translationEl = document.createElement('div');
    translationEl.className = 'xsanctuary-bubble-translation';
    translationEl.innerHTML = '<span class="xsanctuary-bubble-loading">...</span>';

    overlay.style.cssText = `
      position: absolute;
      left: ${left}%;
      top: ${top}%;
      width: ${width}%;
      height: ${height}%;
      pointer-events: auto;
      cursor: pointer;
    `;

    // Always use ellipse for text - clip-path would cut off text
    // The ellipse approximates most speech bubble shapes well
    translationEl.style.borderRadius = '50%';

    overlay.appendChild(translationEl);

    // Pre-fetch translation on first hover
    let translationFetched = false;

    overlay.addEventListener('mouseenter', async () => {
      // Show the translation overlay with fade-in
      overlay.classList.add('xsanctuary-bubble-active');

      if (!translationFetched) {
        translationFetched = true;
        await fetchBubbleTranslation(translationEl, imageUrl, bubble, detectionResult.imageWidth, detectionResult.imageHeight);
      }
    });

    overlay.addEventListener('mouseleave', () => {
      overlay.classList.remove('xsanctuary-bubble-active');
    });

    overlayContainer.appendChild(overlay);
  }

  container.appendChild(overlayContainer);
}

async function fetchBubbleTranslation(
  translationEl: HTMLElement,
  imageUrl: string,
  bubble: BubbleDetection,
  originalWidth?: number,
  originalHeight?: number
) {
  const cacheKey = getBubbleKey(imageUrl, bubble);
  const overlay = translationEl.parentElement;

  // Check cache first
  const cachedData = bubbleTranslationCache.get(cacheKey);

  if (cachedData) {
    // Parse cached data (may include colors)
    try {
      const parsed = JSON.parse(cachedData);
      translationEl.textContent = parsed.text || cachedData;
      if (parsed.textColor) {
        translationEl.style.color = parsed.textColor;
        translationEl.style.borderColor = parsed.textColor; // Stroke matches text
      }
      if (parsed.bgColor) translationEl.style.backgroundColor = parsed.bgColor;
    } catch {
      // Legacy cache entry (plain text)
      translationEl.textContent = cachedData;
    }
    // Fit text to bubble (pass maskPath for shape-aware layout)
    fitTextToBubble(translationEl, bubble.maskPath);
    overlay?.classList.add('xsanctuary-bubble-fetched');
    return;
  }

  try {
    const bubbleBase64 = await cropBubbleToBase64(imageUrl, bubble, 20, originalWidth, originalHeight);

    // Debug: Log the cropped image URL (paste in browser address bar to view)
    console.log('[XSanctuary] Bubble crop for translation:');
    console.log(`[XSanctuary] Original dimensions: ${originalWidth}x${originalHeight}`);
    console.log('[XSanctuary] Bubble bbox:', bubble.bbox);
    console.log('[XSanctuary] Full image URL (copy to view):');
    console.log(`data:image/png;base64,${bubbleBase64}`);

    const response = await browser.runtime.sendMessage({
      type: 'VISION_TRANSLATE_BUBBLE',
      apiKey: cachedSettings?.openRouterApiKey,
      model: cachedSettings?.comicTranslation.bubbleModel || 'google/gemini-2.5-flash',
      bubbleBase64,
      targetLanguage: cachedSettings?.comicTranslation.targetLanguage || 'en',
      cacheKey,
    });

    if (response.error) {
      console.warn('[XSanctuary] Bubble translation error:', response.error);
      translationEl.textContent = '⚠️';
      translationEl.title = response.error;
    } else {
      const translatedText = response.text || '[No text]';
      const textColor = response.textColor || '#000000';
      const bgColor = response.bgColor || '#FFFFFF';

      console.log('[XSanctuary] Bubble translation result:', { text: translatedText, textColor, bgColor });

      // Cache the full result including colors
      bubbleTranslationCache.set(cacheKey, JSON.stringify({ text: translatedText, textColor, bgColor }));

      // Apply text and colors
      translationEl.textContent = translatedText;
      translationEl.style.color = textColor;
      translationEl.style.backgroundColor = bgColor;
      translationEl.style.borderColor = textColor; // Stroke matches text color

      // Calculate optimal font size based on bubble size and text length (shape-aware)
      fitTextToBubble(translationEl, bubble.maskPath);
    }
    overlay?.classList.add('xsanctuary-bubble-fetched');
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    console.error('[XSanctuary] Bubble translation failed:', errorMessage);
    translationEl.textContent = '⚠️';
    translationEl.title = 'Translation failed';
    overlay?.classList.add('xsanctuary-bubble-fetched');
  }
}


async function translateFullImageAndReplace(img: HTMLImageElement, imageUrl: string) {
  // Check cache first
  const cachedTranslation = imageTranslationCache.get(imageUrl);
  if (cachedTranslation) {
    swapImageWithTranslation(img, cachedTranslation, imageUrl);
    return;
  }

  // Show loading overlay
  const container = img.closest('div[data-testid="tweetPhoto"]') || img.parentElement;
  if (!container) return;

  const loadingOverlay = document.createElement('div');
  loadingOverlay.className = 'xsanctuary-image-loading';
  loadingOverlay.innerHTML = `
    <div class="xsanctuary-image-loading-content">
      <span class="xsanctuary-spinner"></span>
      <span>Translating image...</span>
    </div>
  `;
  container.appendChild(loadingOverlay);

  try {
    // Get image as base64
    const imageBase64 = await getImageAsBase64(imageUrl);

    // Send to Gemini Image for translation
    const response = await browser.runtime.sendMessage({
      type: 'VISION_TRANSLATE_IMAGE',
      apiKey: cachedSettings?.openRouterApiKey,
      imageBase64,
      targetLanguage: cachedSettings?.comicTranslation.targetLanguage || 'en',
      cacheKey: `img:${imageUrl}:${cachedSettings?.comicTranslation.targetLanguage}`,
    });

    loadingOverlay.remove();

    if (response.error) {
      showToast(`Translation failed: ${response.error}`);
      return;
    }

    if (response.imageBase64) {
      imageTranslationCache.set(imageUrl, response.imageBase64);
      swapImageWithTranslation(img, response.imageBase64, imageUrl);
    } else {
      showToast('No translated image returned');
    }
  } catch (error) {
    loadingOverlay.remove();
    console.error('[XSanctuary] Image translation failed:', error);
    showToast('Image translation failed');
  }
}

function swapImageWithTranslation(img: HTMLImageElement, translatedBase64: string, originalUrl: string) {
  const container = img.closest('div[data-testid="tweetPhoto"]') || img.parentElement;
  if (!container) return;

  // Store original src
  const originalSrc = img.src;

  // Create toggle button
  let toggleBtn = container.querySelector('.xsanctuary-toggle-btn') as HTMLButtonElement;
  if (!toggleBtn) {
    toggleBtn = document.createElement('button');
    toggleBtn.className = 'xsanctuary-toggle-btn';
    toggleBtn.innerHTML = '🔄';
    toggleBtn.title = 'Toggle original/translated';
    container.appendChild(toggleBtn);
  }

  // Set translated image
  img.src = `data:image/png;base64,${translatedBase64}`;
  img.dataset.xsanctuaryOriginal = originalSrc;
  img.dataset.xsanctuaryTranslated = 'true';

  // Toggle handler
  toggleBtn.onclick = (e) => {
    e.stopPropagation();
    e.preventDefault();

    if (img.dataset.xsanctuaryTranslated === 'true') {
      img.src = originalSrc;
      img.dataset.xsanctuaryTranslated = 'false';
      toggleBtn.title = 'Show translated';
    } else {
      img.src = `data:image/png;base64,${translatedBase64}`;
      img.dataset.xsanctuaryTranslated = 'true';
      toggleBtn.title = 'Show original';
    }
  };

  showToast('Image translated');
}
