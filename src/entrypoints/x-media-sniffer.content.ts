/**
 * MAIN-world sniffer.
 *
 * X only ever exposes video variant URLs inside its own API responses — the
 * <video> element gets a blob: URL, so the DOM tells us nothing. Rather than
 * replicating X's GraphQL query IDs (which rotate constantly), we piggyback on
 * the requests the page already makes: patch fetch/XHR, read the JSON as it
 * flies past, and hand any media we spot to the isolated content script.
 *
 * This runs in the MAIN world, so it has no access to extension APIs. The only
 * channel out is a CustomEvent carrying a JSON string (a string survives the
 * world boundary cleanly in both Chrome and Firefox).
 */
import { extractMediaFromJson, X_MEDIA_EVENT } from '@/utils/x-media';

const API_URL_HINTS = ['/i/api/', '/graphql/', '/1.1/', '/2/timeline'];

const API_HOST = /(^|\.)(x|twitter)\.com$/;

/**
 * Matches the API requests X's own client makes.
 *
 * Parse rather than pattern-match the whole string: an earlier version tested
 * /(^|\.)(x|twitter)\.com/ against the full URL, which requires the host to sit
 * at the start of the string or follow a dot. In "https://x.com/i/api/..." it
 * follows a slash, so every absolute API URL was rejected and nothing was ever
 * captured. Comparing against a parsed hostname cannot fail that way.
 */
function looksLikeApiUrl(url: string): boolean {
  let parsed: URL;
  try {
    // The base handles relative URLs, which X also uses
    parsed = new URL(url, window.location.href);
  } catch {
    return false;
  }

  if (!API_HOST.test(parsed.hostname)) return false;
  return API_URL_HINTS.some((hint) => parsed.pathname.includes(hint));
}

function toUrlString(input: unknown): string {
  try {
    if (typeof input === 'string') return input;
    if (input instanceof URL) return input.href;
    if (input instanceof Request) return input.url;
  } catch {
    // fall through
  }
  return '';
}

function publish(payload: string): void {
  try {
    window.dispatchEvent(new CustomEvent(X_MEDIA_EVENT, { detail: payload }));
  } catch {
    // Never let a listener error surface to the page
  }
}

function handleJsonText(text: string): void {
  if (!text) return;
  // Cheap pre-filter: skip the JSON.parse entirely for the vast majority of
  // responses that carry no video at all.
  if (!text.includes('video_info')) return;

  try {
    const records = extractMediaFromJson(JSON.parse(text));
    if (records.length > 0) publish(JSON.stringify(records));
  } catch {
    // Malformed or unexpected payload — ignore
  }
}

export default defineContentScript({
  matches: ['*://*.x.com/*', '*://*.twitter.com/*'],
  runAt: 'document_start',
  world: 'MAIN',

  main() {
    // --- fetch ---------------------------------------------------------
    const originalFetch = window.fetch;

    window.fetch = function patchedFetch(
      this: unknown,
      input: RequestInfo | URL,
      init?: RequestInit
    ): Promise<Response> {
      const promise = originalFetch.call(this as typeof globalThis, input, init);
      const url = toUrlString(input);

      if (looksLikeApiUrl(url)) {
        promise
          .then((response) => {
            // Clone so the page still gets an unconsumed body. Reading the
            // clone is detached from the page's own promise chain on purpose.
            const clone = response.clone();
            const type = clone.headers.get('content-type') || '';
            if (!type.includes('json')) return;
            clone.text().then(handleJsonText).catch(() => {});
          })
          .catch(() => {});
      }

      return promise;
    } as typeof window.fetch;

    // --- XMLHttpRequest ------------------------------------------------
    const XHR = window.XMLHttpRequest;
    const originalOpen = XHR.prototype.open;
    const originalSend = XHR.prototype.send;
    const trackedUrl = new WeakMap<XMLHttpRequest, string>();

    XHR.prototype.open = function patchedOpen(
      this: XMLHttpRequest,
      method: string,
      url: string | URL,
      ...rest: unknown[]
    ) {
      try {
        trackedUrl.set(this, toUrlString(url));
      } catch {
        // ignore
      }
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      return (originalOpen as any).call(this, method, url, ...rest);
    } as typeof XHR.prototype.open;

    XHR.prototype.send = function patchedSend(this: XMLHttpRequest, ...args: unknown[]) {
      const url = trackedUrl.get(this);

      if (url && looksLikeApiUrl(url)) {
        this.addEventListener('load', () => {
          try {
            if (this.responseType !== '' && this.responseType !== 'text') return;
            handleJsonText(this.responseText);
          } catch {
            // ignore
          }
        });
      }

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      return (originalSend as any).call(this, ...args);
    } as typeof XHR.prototype.send;
  },
});
