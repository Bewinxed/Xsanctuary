import { getFlag, getCountryCode } from '@/utils/countries';
import { getSettings, saveSettings, type CountryRule, type Settings } from '@/utils/storage';
import { toUwuSpeak, toCatSpeak, toLlmTransform } from '@/utils/transforms';
import { blockUser, muteUser, fetchUserInfo, type UserInfo } from '@/utils/twitter-api';
import './style.css';

// Track processed elements to avoid duplicates
const processedUsernames = new WeakSet<Element>();
const processedTweets = new WeakSet<Element>();
// Cache for user info (screenName -> UserInfo)
const userInfoCache = new Map<string, UserInfo | null>();
// Track pending requests to avoid duplicate fetches
const pendingRequests = new Map<string, Promise<UserInfo | null>>();
// Track users we've already applied hard actions to
const hardActionApplied = new Set<string>();
// Settings cache
let cachedSettings: Settings | null = null;

export default defineContentScript({
  matches: ['*://*.x.com/*', '*://*.twitter.com/*'],
  runAt: 'document_idle',

  async main(ctx) {
    console.log('[XSanctuary] Content script loaded');

    // Load settings
    cachedSettings = await getSettings();

    // Listen for settings changes
    browser.storage.onChanged.addListener((changes) => {
      if (changes.settings) {
        cachedSettings = changes.settings.newValue;
        console.log('[XSanctuary] Settings updated');
      }
    });

    // Process existing elements after a short delay
    setTimeout(() => processPage(), 500);

    // Set up mutation observer for dynamic content
    const observer = new MutationObserver((mutations) => {
      for (const mutation of mutations) {
        if (mutation.type === 'childList') {
          mutation.addedNodes.forEach((node) => {
            if (node instanceof Element) {
              processElement(node);
            }
          });
        }
      }
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

    // Update badge with flag
    badge.innerHTML = `<span class="xsanctuary-badge-flag">${flag}</span>`;
    badge.title = `XSanctuary: ${userInfo.country} (right-click for options)`;

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
      createBlurOverlay(tweet, tweetText, flag, userInfo.country || 'Unknown', originalHtml);
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
      if (cachedSettings?.openRouterApiKey) {
        const prompt = rule.llmPrompt || cachedSettings.defaultLlmPrompt;
        tweetText.textContent = '✨ Transforming...';
        try {
          const transformed = await toLlmTransform(
            originalText,
            cachedSettings.openRouterApiKey,
            prompt,
            (chunk) => {
              // Stream the transformation
              if (tweetText.textContent === '✨ Transforming...') {
                tweetText.textContent = chunk;
              } else {
                tweetText.textContent += chunk;
              }
            }
          );
          addTransformBadge(tweetText, '🤖', flag);
        } catch (error) {
          console.error('[XSanctuary] LLM transform failed:', error);
          tweetText.textContent = originalText;
        }
      }
      break;
  }
}

function createBlurOverlay(tweet: HTMLElement, tweetText: HTMLElement, flag: string, country: string, originalHtml: string) {
  // Blur the content
  tweetText.style.filter = 'blur(8px)';
  tweetText.style.userSelect = 'none';
  tweetText.style.pointerEvents = 'none';

  // Create overlay
  const overlay = document.createElement('div');
  overlay.className = 'xsanctuary-blur-overlay';
  overlay.innerHTML = `
    <div class="xsanctuary-blur-content">
      <span class="xsanctuary-blur-flag">${flag}</span>
      <span class="xsanctuary-blur-text">Content from ${country}</span>
      <button class="xsanctuary-reveal-btn">Reveal</button>
    </div>
  `;

  // Position overlay over tweet text
  tweetText.style.position = 'relative';
  tweetText.appendChild(overlay);

  // Reveal button handler
  overlay.querySelector('.xsanctuary-reveal-btn')?.addEventListener('click', (e) => {
    e.stopPropagation();
    tweetText.style.filter = '';
    tweetText.style.userSelect = '';
    tweetText.style.pointerEvents = '';
    overlay.remove();
    tweetText.innerHTML = originalHtml;
    addTransformBadge(tweetText, '👁️', flag);
  });
}

function addTransformBadge(element: HTMLElement, emoji: string, flag: string) {
  const badge = document.createElement('span');
  badge.className = 'xsanctuary-transform-badge';
  badge.textContent = ` ${flag} ${emoji}`;
  element.appendChild(badge);
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
