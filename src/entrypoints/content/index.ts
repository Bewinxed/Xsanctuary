import { getFlag, getCountryCode, isDeceptiveProfile, extractFlagEmojis, countryCodeToFlag } from '@/utils/countries';
import { getSettings, saveSettings, type CountryRule, type Settings } from '@/utils/storage';
import { toUwuSpeak, toCatSpeak } from '@/utils/transforms';
import { blockUser, muteUser, fetchUserInfo, type UserInfo } from '@/utils/twitter-api';
import { LRUCache, BoundedSet } from '@/utils/lru-cache';
import './style.css';

// Pre-compiled regex for better performance
const USERNAME_REGEX = /^\/([A-Za-z0-9_]+)(?:\/|$)/;

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

    // Handle SPA navigation
    ctx.addEventListener(window, 'wxt:locationchange', () => {
      console.log('[XSanctuary] Location changed, reprocessing page');
      setTimeout(() => processPage(), 300);
    });

    // Cleanup on context invalidation
    ctx.onInvalidated(() => {
      observer.disconnect();
      themeObserver.disconnect();
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

    // Extract screen name
    const match = href.match(/^\/([A-Za-z0-9_]+)(?:\/|$)/);
    if (!match) continue;

    const screenName = match[1];

    // Skip reserved paths
    const reservedPaths = [
      'home', 'explore', 'notifications', 'messages', 'bookmarks',
      'lists', 'profile', 'settings', 'compose', 'search', 'i',
      'intent', 'hashtag', 'tos', 'privacy', 'about', 'help',
      'status', 'photo', 'video', 'followers', 'following', 'likes',
    ];
    if (reservedPaths.includes(screenName.toLowerCase())) continue;

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

  // Find the username in this tweet
  const usernameLink = tweet.querySelector('a[href^="/"][role="link"]');
  if (!usernameLink) return;

  const href = usernameLink.getAttribute('href');
  if (!href) return;

  const match = href.match(/^\/([A-Za-z0-9_]+)(?:\/|$)/);
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
      const claimedFlagEmojis = claimedFlags.map(code => countryCodeToFlag(code)).join('');
      expandedContent = `${claimedFlagEmojis} → ${flag}`;
      indicators.push('Deceptive');
    }

    if (userInfo.locationAccurate === false) {
      indicators.push('VPN');
    }

    const indicatorText = indicators.length > 0 ? ` (${indicators.join(', ')})` : '';

    // Update badge with flag and country name (expands on hover)
    badge.innerHTML = `<span class="xsanctuary-badge-flag">${flag}</span><span class="xsanctuary-badge-country">${expandedContent}${indicatorText}</span>`;
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

  // Fetch user info
  const requestPromise = fetchUserInfo(screenName).then((info) => {
    userInfoCache.set(cacheKey, info);
    pendingRequests.delete(cacheKey);
    return info;
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
          showToast(`${flag} Paused for 1 hour`);
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
          showToast(`${flag} @${screenName} excluded`);
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
  badge.textContent = ` ${flag} ${emoji}`;
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
    <div class="xsanctuary-menu-header">${flag} ${userInfo.country}</div>
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
  showToast(`${getFlag(country)} Rule added for ${country}`);
}

function showToast(message: string) {
  const toast = document.createElement('div');
  toast.className = 'xsanctuary-toast';
  toast.textContent = message;
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
