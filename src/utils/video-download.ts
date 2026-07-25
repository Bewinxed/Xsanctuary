/**
 * X video/GIF downloading: media registry, hover affordance, format menu.
 *
 * Media metadata arrives from the MAIN-world sniffer (see
 * entrypoints/x-media-sniffer.content.ts). Everything here runs in the isolated
 * content script, so it can talk to the background worker.
 */
import { LRUCache } from './lru-cache';
import { getSettings, type VideoDownloadSettings } from './storage';
import {
  X_MEDIA_EVENT,
  bestVariantForAudio,
  buildFilename,
  estimateBytes,
  formatBytes,
  isHls,
  isProgressive,
  qualityTag,
  sortVariants,
  variantLabel,
  type XMediaRecord,
  type XVideoVariant,
} from './x-media';

export const AUDIO_FORMATS = [
  {
    id: 'm4a',
    label: 'M4A · original quality',
    hint: 'Copies the source AAC track — no re-encode, near instant',
    ext: 'm4a',
    codec: null as string | null, // null = keep source codec
  },
  {
    id: 'mp3',
    label: 'MP3 · 192 kbps',
    hint: 'Widest compatibility — encoded locally with LAME',
    ext: 'mp3',
    codec: 'mp3',
  },
  {
    id: 'opus',
    label: 'Opus · 128 kbps',
    hint: 'Smallest file at equal quality',
    ext: 'opus',
    codec: 'opus',
  },
  {
    id: 'wav',
    label: 'WAV · uncompressed',
    hint: 'Lossless, large files',
    ext: 'wav',
    codec: 'pcm-s16',
  },
] as const;

export type AudioFormatId = (typeof AUDIO_FORMATS)[number]['id'];

// ---------------------------------------------------------------------------
// Registry
// ---------------------------------------------------------------------------

const byTweetId = new LRUCache<string, XMediaRecord>(300);
const byMediaKey = new LRUCache<string, XMediaRecord>(300);

// Resolves once the sniffer reports media for a tweet we're already waiting on
const waiters = new Map<string, Array<(record: XMediaRecord) => void>>();

function remember(record: XMediaRecord): void {
  byMediaKey.set(record.mediaKey, record);

  if (record.tweetId) {
    byTweetId.set(record.tweetId, record);

    const pending = waiters.get(record.tweetId);
    if (pending) {
      waiters.delete(record.tweetId);
      pending.forEach((resolve) => resolve(record));
    }
  }
}

function lookup(tweetId: string | null): XMediaRecord | null {
  if (!tweetId) return null;
  return byTweetId.get(tweetId) || null;
}

/** Waits briefly for the sniffer to catch up — media JSON often lands after the DOM. */
function waitForRecord(tweetId: string, timeoutMs = 8000): Promise<XMediaRecord | null> {
  const existing = lookup(tweetId);
  if (existing) return Promise.resolve(existing);

  return new Promise((resolve) => {
    const list = waiters.get(tweetId) || [];
    const settle = (record: XMediaRecord | null) => {
      clearTimeout(timer);
      resolve(record);
    };

    list.push(settle);
    waiters.set(tweetId, list);

    const timer = setTimeout(() => {
      const remaining = waiters.get(tweetId)?.filter((fn) => fn !== settle) || [];
      if (remaining.length > 0) waiters.set(tweetId, remaining);
      else waiters.delete(tweetId);
      resolve(null);
    }, timeoutMs);
  });
}

const STATUS_ID = /\/status\/(\d+)/;

function tweetIdForVideo(video: HTMLVideoElement): string | null {
  const article = video.closest('article[data-testid="tweet"]');

  if (article) {
    // The permalink (timestamp) anchor is the reliable one; the first
    // /status/ link in an article can belong to a quoted tweet.
    const links = Array.from(article.querySelectorAll<HTMLAnchorElement>('a[href*="/status/"]'));
    const permalink = links.find((a) => a.querySelector('time')) || links[0];
    const match = permalink?.getAttribute('href')?.match(STATUS_ID);
    if (match) return match[1];
  }

  const fromLocation = window.location.pathname.match(STATUS_ID);
  return fromLocation ? fromLocation[1] : null;
}

// ---------------------------------------------------------------------------
// Capability probing (which audio codecs this browser can actually encode)
// ---------------------------------------------------------------------------

let capabilityPromise: Promise<Record<string, boolean>> | null = null;

function audioCapabilities(): Promise<Record<string, boolean>> {
  if (!capabilityPromise) {
    capabilityPromise = browser.runtime
      .sendMessage({ type: 'AUDIO_CAPABILITIES' })
      .then((res: { codecs?: Record<string, boolean> }) => res?.codecs || {})
      .catch(() => ({}));
  }
  return capabilityPromise;
}

// ---------------------------------------------------------------------------
// UI
// ---------------------------------------------------------------------------

const processedVideos = new WeakSet<HTMLVideoElement>();
let activeMenu: HTMLElement | null = null;
let settings: VideoDownloadSettings | null = null;

// Jobs in flight, keyed by the id we hand the background worker
const activeJobs = new Map<string, { onProgress: (ratio: number) => void }>();
let jobCounter = 0;

const VIDEO_CONTAINER_SELECTOR = [
  '[data-testid="videoPlayer"]',
  '[data-testid="videoComponent"]',
  '[data-testid="previewInterstitial"]',
  '[data-testid="tweetPhoto"]',
].join(', ');

function containerFor(video: HTMLVideoElement): HTMLElement | null {
  const container = video.closest<HTMLElement>(VIDEO_CONTAINER_SELECTOR);
  if (container) return container;
  return video.parentElement instanceof HTMLElement ? video.parentElement : null;
}

/**
 * Capturing variant URLs depends on a MAIN-world content script, which only
 * MV3 honours — Firefox's MV2 build silently drops the `world` key and would
 * leave a button that can never find a format. Better to not draw it there.
 */
export const isSupportedBrowser = import.meta.env.MANIFEST_VERSION === 3;

/** Scans an element (or the whole page) for video players and attaches the button. */
export function processVideos(root: ParentNode = document): void {
  if (!isSupportedBrowser) return;
  if (!settings?.enabled) return;

  const videos =
    root instanceof HTMLVideoElement ? [root] : Array.from(root.querySelectorAll('video'));

  for (const video of videos) {
    if (!(video instanceof HTMLVideoElement)) continue;
    if (processedVideos.has(video)) continue;

    const container = containerFor(video);
    if (!container) continue;

    processedVideos.add(video);
    attachDownloadButton(container, video);
  }
}

function attachDownloadButton(container: HTMLElement, video: HTMLVideoElement): void {
  if (container.querySelector('.xsanctuary-video-dl-btn')) return;

  if (getComputedStyle(container).position === 'static') {
    container.style.position = 'relative';
  }

  const btn = document.createElement('button');
  btn.className = 'xsanctuary-video-dl-btn';
  // The comic-translate button claims the same corner on tweetPhoto containers
  if (container.querySelector('.xsanctuary-image-translate-btn')) {
    btn.classList.add('xsanctuary-video-dl-btn--shifted');
  }
  btn.type = 'button';
  btn.setAttribute('aria-label', 'Download this video');
  btn.title = 'Download video / audio';
  btn.innerHTML = downloadIcon();

  // Hover anywhere on the player reveals the button
  container.classList.add('xsanctuary-video-host');

  const open = (e: MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    openFormatMenu(btn, video);
  };

  btn.addEventListener('click', open);
  // Right-clicking the player itself is the other documented entry point
  container.addEventListener('contextmenu', (e) => {
    if (!settings?.rightClickMenu) return;
    const target = e.target as HTMLElement;
    if (!target.closest(VIDEO_CONTAINER_SELECTOR)) return;
    e.preventDefault();
    e.stopPropagation();
    openFormatMenu(btn, video, { x: e.clientX, y: e.clientY });
  });

  container.appendChild(btn);
}

function downloadIcon(): string {
  return `<svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">
    <path fill="currentColor" d="M12 3a1 1 0 0 1 1 1v9.59l3.3-3.3a1 1 0 1 1 1.4 1.42l-5 5a1 1 0 0 1-1.4 0l-5-5a1 1 0 1 1 1.4-1.42l3.3 3.3V4a1 1 0 0 1 1-1Z"/>
    <path fill="currentColor" d="M4 18a1 1 0 0 1 1 1v1h14v-1a1 1 0 1 1 2 0v1a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-1a1 1 0 0 1 1-1Z"/>
  </svg>`;
}

function spinnerIcon(): string {
  return '<span class="xsanctuary-spinner"></span>';
}

export function closeVideoMenu(): void {
  if (activeMenu) {
    activeMenu.remove();
    activeMenu = null;
    document.removeEventListener('click', onDocumentClick, true);
    document.removeEventListener('keydown', onKeyDown, true);
  }
}

function onDocumentClick(e: MouseEvent): void {
  if (activeMenu && !activeMenu.contains(e.target as Node)) closeVideoMenu();
}

function onKeyDown(e: KeyboardEvent): void {
  if (e.key === 'Escape') closeVideoMenu();
}

async function openFormatMenu(
  anchor: HTMLElement,
  video: HTMLVideoElement,
  at?: { x: number; y: number }
): Promise<void> {
  closeVideoMenu();

  const menu = document.createElement('div');
  menu.className = 'xsanctuary-context-menu xsanctuary-video-menu';
  menu.innerHTML = `<div class="xsanctuary-menu-header">${spinnerIcon()} Reading formats…</div>`;
  document.body.appendChild(menu);
  activeMenu = menu;
  positionMenu(menu, anchor, at);

  setTimeout(() => {
    document.addEventListener('click', onDocumentClick, true);
    document.addEventListener('keydown', onKeyDown, true);
  }, 0);

  const tweetId = tweetIdForVideo(video);
  const record = tweetId ? await waitForRecord(tweetId) : null;

  // The menu may have been closed or replaced while we waited
  if (activeMenu !== menu) return;

  if (!record) {
    menu.innerHTML = `
      <div class="xsanctuary-menu-header">No formats found</div>
      <div class="xsanctuary-menu-note">
        X hasn't served this video's metadata yet. Reload the page or start
        playback once, then try again.
      </div>`;
    positionMenu(menu, anchor, at);
    return;
  }

  const caps = await audioCapabilities();
  if (activeMenu !== menu) return;

  renderMenu(menu, record, caps);
  positionMenu(menu, anchor, at);
}

function renderMenu(
  menu: HTMLElement,
  record: XMediaRecord,
  caps: Record<string, boolean>
): void {
  const variants = sortVariants(record.variants);
  const progressive = variants.filter(isProgressive);
  const adaptive = variants.filter(isHls);

  const kindLabel = record.kind === 'animated_gif' ? 'GIF' : 'Video';
  const duration = record.durationMs
    ? ` · ${Math.round(record.durationMs / 1000)}s`
    : '';

  const rows: string[] = [
    `<div class="xsanctuary-menu-header">${kindLabel}${duration}${
      record.screenName ? ` · @${record.screenName}` : ''
    }</div>`,
    '<div class="xsanctuary-menu-divider"></div>',
    '<div class="xsanctuary-menu-section">Video</div>',
  ];

  // GIFs don't encode a resolution in their URL, so borrow the tweet's own
  // original_info dimensions for the label.
  const fallbackDims = { width: record.width, height: record.height };

  for (const variant of progressive) {
    const size = estimateBytes(variant, record.durationMs);
    const tag = qualityTag(variant, record.height);
    rows.push(menuItem({
      action: 'video',
      url: variant.url,
      quality: tag,
      icon: '🎬',
      title: record.kind === 'animated_gif' ? 'Original' : tag,
      detail: variantLabel(variant, fallbackDims) + (size ? `  ·  ~${formatBytes(size)}` : ''),
    }));
  }

  for (const variant of adaptive) {
    rows.push(menuItem({
      action: 'hls',
      url: variant.url,
      quality: 'auto',
      icon: '🎬',
      title: 'Best available (adaptive)',
      detail: 'Downloads the stream and remuxes it to MP4',
    }));
  }

  if (progressive.length === 0 && adaptive.length === 0) {
    rows.push('<div class="xsanctuary-menu-note">No downloadable video track.</div>');
  }

  // Audio is extracted from whichever variant decodes most cheaply
  const audioSource = bestVariantForAudio(record.variants);
  if (audioSource) {
    rows.push('<div class="xsanctuary-menu-divider"></div>');
    rows.push('<div class="xsanctuary-menu-section">Audio</div>');

    for (const format of AUDIO_FORMATS) {
      // `null` codec means "copy the source track", which never needs an encoder
      const supported = format.codec === null || caps[format.codec] !== false;
      rows.push(menuItem({
        action: 'audio',
        url: audioSource.url,
        quality: format.id,
        icon: '🎧',
        title: format.label,
        detail: supported ? format.hint : 'Not supported by this browser',
        disabled: !supported,
      }));
    }
  }

  rows.push('<div class="xsanctuary-menu-divider"></div>');
  rows.push(menuItem({
    action: 'copy',
    url: (progressive[0] || adaptive[0] || { url: '' }).url,
    quality: 'link',
    icon: '🔗',
    title: 'Copy direct link',
    detail: 'Puts the highest-quality media URL on your clipboard',
  }));

  menu.innerHTML = rows.join('');

  menu.querySelectorAll<HTMLElement>('.xsanctuary-menu-item').forEach((item) => {
    item.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      if (item.hasAttribute('data-disabled')) return;
      void runAction(item, record);
    });
  });
}

function menuItem(opts: {
  action: string;
  url: string;
  quality: string;
  icon: string;
  title: string;
  detail: string;
  disabled?: boolean;
}): string {
  return `
    <button class="xsanctuary-menu-item xsanctuary-menu-item-rich" type="button"
      data-action="${opts.action}"
      data-url="${escapeAttr(opts.url)}"
      data-quality="${escapeAttr(opts.quality)}"
      ${opts.disabled ? 'data-disabled="true" disabled' : ''}>
      <span class="xsanctuary-menu-icon">${opts.icon}</span>
      <span class="xsanctuary-menu-text">
        <span class="xsanctuary-menu-title">${escapeHtml(opts.title)}</span>
        <span class="xsanctuary-menu-detail">${escapeHtml(opts.detail)}</span>
      </span>
    </button>`;
}

function escapeHtml(value: string): string {
  const el = document.createElement('span');
  el.textContent = value;
  return el.innerHTML;
}

function escapeAttr(value: string): string {
  return escapeHtml(value).replace(/"/g, '&quot;');
}

async function runAction(item: HTMLElement, record: XMediaRecord): Promise<void> {
  const action = item.dataset.action || '';
  const url = item.dataset.url || '';
  const quality = item.dataset.quality || '';

  if (action === 'copy') {
    try {
      await navigator.clipboard.writeText(url);
      toast('Link copied');
    } catch {
      toast('Could not access the clipboard');
    }
    closeVideoMenu();
    return;
  }

  if (action === 'video') {
    const filename = buildFilename(record, quality, 'mp4');
    closeVideoMenu();
    toast(`Downloading ${quality}…`);
    const res = await browser.runtime.sendMessage({
      type: 'DOWNLOAD_MEDIA',
      url,
      filename,
    });
    if (res?.error) toast(`Download failed: ${res.error}`);
    return;
  }

  // HLS remux and audio extraction both round-trip through the offscreen
  // document, so they report progress inline instead of closing the menu.
  const format = AUDIO_FORMATS.find((f) => f.id === quality);
  const ext = action === 'hls' ? 'mp4' : format?.ext || 'm4a';
  const filename = buildFilename(record, action === 'hls' ? 'best' : quality, ext);
  const jobId = `xsanctuary-job-${++jobCounter}-${Date.now()}`;

  const detail = item.querySelector('.xsanctuary-menu-detail');
  const original = detail?.textContent || '';
  item.setAttribute('data-disabled', 'true');
  item.classList.add('working');
  if (detail) detail.textContent = 'Starting…';

  activeJobs.set(jobId, {
    onProgress: (ratio) => {
      if (detail) detail.textContent = `Converting… ${Math.round(ratio * 100)}%`;
    },
  });

  try {
    const res = await browser.runtime.sendMessage({
      type: action === 'hls' ? 'REMUX_VIDEO' : 'EXTRACT_AUDIO',
      jobId,
      url,
      filename,
      codec: format?.codec ?? null,
      bitrate: quality === 'mp3' ? 192_000 : 128_000,
    });

    if (res?.error) {
      if (detail) detail.textContent = `Failed: ${res.error}`;
      item.classList.remove('working');
      item.classList.add('failed');
      toast(`Conversion failed: ${res.error}`);
      return;
    }

    if (detail) detail.textContent = 'Saved';
    item.classList.remove('working');
    item.classList.add('done');
    toast(`Saved ${filename}`);
    setTimeout(closeVideoMenu, 900);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (detail) detail.textContent = `Failed: ${message}`;
    item.classList.remove('working');
    item.classList.add('failed');
  } finally {
    activeJobs.delete(jobId);
    setTimeout(() => {
      if (detail && detail.textContent === 'Saved') detail.textContent = original;
    }, 3000);
  }
}

function positionMenu(menu: HTMLElement, anchor: HTMLElement, at?: { x: number; y: number }): void {
  const margin = 8;
  const rect = menu.getBoundingClientRect();

  let left: number;
  let top: number;

  if (at) {
    left = at.x;
    top = at.y;
  } else {
    const anchorRect = anchor.getBoundingClientRect();
    left = anchorRect.right - rect.width;
    top = anchorRect.bottom + 6;
  }

  left = Math.min(Math.max(margin, left), window.innerWidth - rect.width - margin);
  top = Math.min(Math.max(margin, top), window.innerHeight - rect.height - margin);

  menu.style.left = `${left}px`;
  menu.style.top = `${top}px`;
}

function toast(message: string): void {
  const el = document.createElement('div');
  el.className = 'xsanctuary-toast';
  el.textContent = message;
  document.body.appendChild(el);

  setTimeout(() => {
    el.classList.add('xsanctuary-toast-hide');
    setTimeout(() => el.remove(), 300);
  }, 2200);
}

// ---------------------------------------------------------------------------
// Wiring
// ---------------------------------------------------------------------------

/** Handles progress relays from the background worker. Returns true if consumed. */
export function handleVideoDownloadMessage(message: { type?: string; jobId?: string; progress?: number }): boolean {
  if (message?.type !== 'MEDIA_JOB_PROGRESS' || !message.jobId) return false;
  activeJobs.get(message.jobId)?.onProgress(message.progress ?? 0);
  return true;
}

export async function initVideoDownloads(): Promise<() => void> {
  if (!isSupportedBrowser) return () => {};

  settings = (await getSettings()).videoDownload;

  const onMedia = (event: Event) => {
    const detail = (event as CustomEvent).detail;
    if (typeof detail !== 'string') return;
    try {
      const records = JSON.parse(detail) as XMediaRecord[];
      records.forEach(remember);
    } catch {
      // ignore malformed payloads
    }
  };

  window.addEventListener(X_MEDIA_EVENT, onMedia);

  const onSettingsChanged = (changes: { [key: string]: { newValue?: unknown } }) => {
    if (!changes.settings) return;
    const next = changes.settings.newValue as { videoDownload?: VideoDownloadSettings } | undefined;
    if (next?.videoDownload) {
      settings = next.videoDownload;
      if (settings.enabled) processVideos();
      else document.querySelectorAll('.xsanctuary-video-dl-btn').forEach((el) => el.remove());
    }
  };

  browser.storage.onChanged.addListener(onSettingsChanged);

  return () => {
    window.removeEventListener(X_MEDIA_EVENT, onMedia);
    browser.storage.onChanged.removeListener(onSettingsChanged);
    closeVideoMenu();
  };
}
