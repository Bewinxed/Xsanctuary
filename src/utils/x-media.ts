// Shared model for X video/GIF media captured from X's own API responses.
// Used by the MAIN-world sniffer, the content script UI, and the offscreen converter.

export type XMediaKind = 'video' | 'animated_gif';

export interface XVideoVariant {
  url: string;
  contentType: string;
  bitrate?: number;
  width?: number;
  height?: number;
}

export interface XMediaRecord {
  mediaKey: string;
  kind: XMediaKind;
  tweetId?: string;
  screenName?: string;
  poster?: string;
  durationMs?: number;
  width?: number;
  height?: number;
  variants: XVideoVariant[];
  capturedAt: number;
}

// The event the MAIN-world sniffer dispatches on `window` for the content script to pick up
export const X_MEDIA_EVENT = 'xsanctuary:x-media';

// Matches the resolution segment X bakes into progressive MP4 URLs,
// e.g. https://video.twimg.com/ext_tw_video/123/pu/vid/avc1/1280x720/abc.mp4
const RESOLUTION_IN_URL = /\/(\d{2,5})x(\d{2,5})\//;

// https://x.com/someone/status/1234567890/video/1
const EXPANDED_URL = /(?:twitter|x)\.com\/([A-Za-z0-9_]+)\/status\/(\d+)/;

export function isProgressive(variant: XVideoVariant): boolean {
  return variant.contentType === 'video/mp4';
}

export function isHls(variant: XVideoVariant): boolean {
  return /mpegurl/i.test(variant.contentType);
}

/**
 * Short quality tag for a variant — "720p", or "auto" for adaptive HLS.
 * GIFs carry no resolution in their URL, so they fall back to "original".
 */
export function qualityTag(variant: XVideoVariant, fallbackHeight?: number): string {
  const height = variant.height || fallbackHeight;
  if (height) return `${height}p`;
  if (isHls(variant)) return 'auto';
  if (variant.bitrate) return `${Math.round(variant.bitrate / 1000)}k`;
  return 'original';
}

/** Human-readable menu label, e.g. "1280x720  ·  2.1 Mbps". */
export function variantLabel(
  variant: XVideoVariant,
  fallback?: { width?: number; height?: number }
): string {
  const parts: string[] = [];
  const width = variant.width || fallback?.width;
  const height = variant.height || fallback?.height;

  if (width && height) {
    parts.push(`${width}×${height}`);
  } else if (isHls(variant)) {
    parts.push('Adaptive stream');
  }

  if (variant.bitrate) {
    const mbps = variant.bitrate / 1_000_000;
    parts.push(mbps >= 1 ? `${mbps.toFixed(1)} Mbps` : `${Math.round(variant.bitrate / 1000)} kbps`);
  }

  return parts.join('  ·  ') || 'MP4 · original quality';
}

/** Rough byte estimate from bitrate x duration; null when we can't tell. */
export function estimateBytes(variant: XVideoVariant, durationMs?: number): number | null {
  if (!variant.bitrate || !durationMs) return null;
  return Math.round((variant.bitrate / 8) * (durationMs / 1000));
}

export function formatBytes(bytes: number): string {
  if (bytes >= 1024 ** 3) return `${(bytes / 1024 ** 3).toFixed(1)} GB`;
  if (bytes >= 1024 ** 2) return `${(bytes / 1024 ** 2).toFixed(1)} MB`;
  return `${Math.max(1, Math.round(bytes / 1024))} KB`;
}

/** Highest-quality first: by pixel height, then bitrate. HLS sinks to the bottom. */
export function sortVariants(variants: XVideoVariant[]): XVideoVariant[] {
  return [...variants].sort((a, b) => {
    if (isHls(a) !== isHls(b)) return isHls(a) ? 1 : -1;
    if ((b.height || 0) !== (a.height || 0)) return (b.height || 0) - (a.height || 0);
    return (b.bitrate || 0) - (a.bitrate || 0);
  });
}

/**
 * Best variant to feed a decoder. Progressive MP4 wins because it needs no
 * playlist parsing; HLS is the fallback for videos X only serves adaptively.
 */
export function bestVariantForAudio(variants: XVideoVariant[]): XVideoVariant | null {
  const sorted = sortVariants(variants);
  return sorted.find(isProgressive) || sorted[0] || null;
}

function parseVariant(raw: Record<string, unknown>): XVideoVariant | null {
  const url = typeof raw.url === 'string' ? raw.url : null;
  if (!url) return null;

  const variant: XVideoVariant = {
    url,
    contentType: typeof raw.content_type === 'string' ? raw.content_type : 'video/mp4',
    bitrate: typeof raw.bitrate === 'number' ? raw.bitrate : undefined,
  };

  const dims = url.match(RESOLUTION_IN_URL);
  if (dims) {
    variant.width = Number(dims[1]);
    variant.height = Number(dims[2]);
  }

  return variant;
}

/**
 * Deep-walks a parsed X API response and pulls out every media object carrying
 * `video_info.variants`. X nests these differently across timeline, TweetDetail
 * and notification payloads, so a structural walk is more durable than pathing.
 */
export function extractMediaFromJson(root: unknown): XMediaRecord[] {
  const found = new Map<string, XMediaRecord>();
  const seen = new WeakSet<object>();
  const stack: unknown[] = [root];
  // Guards against pathological payloads locking up the page
  let visited = 0;
  const MAX_NODES = 200_000;

  while (stack.length > 0 && visited < MAX_NODES) {
    const node = stack.pop();
    visited++;

    if (!node || typeof node !== 'object') continue;
    if (seen.has(node as object)) continue;
    seen.add(node as object);

    if (Array.isArray(node)) {
      for (const child of node) stack.push(child);
      continue;
    }

    const obj = node as Record<string, unknown>;
    const videoInfo = obj.video_info as Record<string, unknown> | undefined;

    if (videoInfo && Array.isArray(videoInfo.variants)) {
      const record = buildRecord(obj, videoInfo);
      if (record && !found.has(record.mediaKey)) {
        found.set(record.mediaKey, record);
      }
    }

    for (const value of Object.values(obj)) {
      if (value && typeof value === 'object') stack.push(value);
    }
  }

  return [...found.values()];
}

function buildRecord(
  media: Record<string, unknown>,
  videoInfo: Record<string, unknown>
): XMediaRecord | null {
  const variants = (videoInfo.variants as Record<string, unknown>[])
    .map(parseVariant)
    .filter((v): v is XVideoVariant => v !== null);

  if (variants.length === 0) return null;

  const mediaKey =
    (typeof media.media_key === 'string' && media.media_key) ||
    (typeof media.id_str === 'string' && media.id_str) ||
    variants[0].url;

  const record: XMediaRecord = {
    mediaKey,
    kind: media.type === 'animated_gif' ? 'animated_gif' : 'video',
    poster: typeof media.media_url_https === 'string' ? media.media_url_https : undefined,
    durationMs: typeof videoInfo.duration_millis === 'number' ? videoInfo.duration_millis : undefined,
    variants,
    capturedAt: Date.now(),
  };

  const expanded = typeof media.expanded_url === 'string' ? media.expanded_url : '';
  const match = expanded.match(EXPANDED_URL);
  if (match) {
    record.screenName = match[1];
    record.tweetId = match[2];
  }

  const originalInfo = media.original_info as Record<string, unknown> | undefined;
  if (originalInfo) {
    if (typeof originalInfo.width === 'number') record.width = originalInfo.width;
    if (typeof originalInfo.height === 'number') record.height = originalInfo.height;
  }

  return record;
}

export function sanitizeFilename(name: string): string {
  return name
    .replace(/[\\/:*?"<>|]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 120);
}

/** e.g. "x-jack-1234567890-720p.mp4" */
export function buildFilename(record: XMediaRecord, quality: string, ext: string): string {
  const who = record.screenName ? `-${record.screenName}` : '';
  const which = record.tweetId ? `-${record.tweetId}` : `-${record.mediaKey}`;
  return sanitizeFilename(`x${who}${which}-${quality}`) + `.${ext}`;
}
