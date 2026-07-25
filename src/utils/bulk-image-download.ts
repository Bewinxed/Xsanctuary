/**
 * Bulk image download from an X profile.
 *
 * Ported from the xitter-scraper extension, which is the same store listing
 * this codebase now publishes to. Existing users installed it for this
 * feature, so it has to keep working exactly as they expect: a download button
 * in the profile header, a count prompt, auto-scroll collection, and a ZIP.
 *
 * Behaviour is deliberately unchanged from the shipped version. The blob and
 * anchor-click save path is kept rather than routed through the downloads API,
 * because it already works from a content script and needs no round trip.
 */
import JSZip from 'jszip';

let isDownloadCancelled = false;
let downloadAbortController = new AbortController();

const BUTTON_ID = 'xsanctuary-bulk-image-download';

// X's own button classes, so the injected control matches the profile header
const X_BUTTON_CLASSES =
  'css-175oi2r r-sdzlij r-1phboty r-rs99b7 r-lrvibr r-6gpygo r-1wron08 r-2yi16 r-1qi8awa r-1loqt21 r-o7ynqc r-6416eg r-1ny4l3l';

interface ProgressHandle {
  updateProgress: (current: number, total: number, phase: string) => void;
  updateStatus: (message: string) => void;
  finish: () => void;
}

function triggerDownload(blob: Blob, filename: string): Promise<void> {
  return new Promise((resolve, reject) => {
    try {
      const downloadUrl = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = downloadUrl;
      link.download = filename;

      document.body.appendChild(link);
      link.click();

      setTimeout(() => {
        link.remove();
        URL.revokeObjectURL(downloadUrl);
        resolve();
      }, 1000);
    } catch (error) {
      reject(error);
    }
  });
}

function getHighestQualityUrl(url: string): string {
  const baseUrl = url.split('?')[0];
  return url.includes('format=jpg') || url.endsWith('.jpg')
    ? `${baseUrl}?format=jpg&name=orig`
    : `${baseUrl}?format=png&name=orig`;
}

function extensionForUrl(url: string): string {
  return url.includes('format=jpg') || url.endsWith('.jpg') ? 'jpg' : 'png';
}

// ---------------------------------------------------------------------------
// UI
// ---------------------------------------------------------------------------

export function injectBulkDownloadButton(): void {
  const buttonGroup = document.querySelector('div[data-testid="placementTracking"]')?.parentElement;
  if (!buttonGroup || document.getElementById(BUTTON_ID)) return;

  const btn = document.createElement('button');
  btn.id = BUTTON_ID;
  btn.className = X_BUTTON_CLASSES;
  btn.style.cssText = 'background-color: rgba(0, 0, 0, 0); border-color: rgb(83, 100, 113);';
  btn.setAttribute('aria-label', 'Download images from this profile');
  btn.innerHTML = `
    <div dir="ltr" class="css-146c3p1 r-bcqeeo r-qvutc0 r-37j5jr r-q4m81j r-a023e6 r-rjixqe r-b88u0q r-1awozwy r-6koalj r-18u37iz r-16y2uox r-1777fci" style="color: rgb(239, 243, 244);">
      <svg viewBox="0 0 24 24" class="r-4qtqp9 r-yyyyoo r-dnmrzs r-bnwqim r-lrvibr r-m6rgpd r-z80fyv r-19wmn03" style="color: rgb(239, 243, 244);">
        <path d="M19 9h-4V3H9v6H5l7 7 7-7zM5 18v2h14v-2H5z"/>
      </svg>
    </div>
  `;

  btn.onclick = showImageCountPrompt;
  buttonGroup.insertBefore(btn, buttonGroup.lastElementChild);
}

function showImageCountPrompt(): void {
  const backdrop = document.createElement('div');
  backdrop.className = 'xsanctuary-bulk-backdrop';

  const modal = document.createElement('div');
  modal.className = 'xsanctuary-bulk-modal';
  modal.innerHTML = `
    <h2>Download images</h2>
    <label for="xsanctuary-bulk-count">Number of images to download</label>
    <input id="xsanctuary-bulk-count" type="number" min="1" value="50">
    <div class="xsanctuary-bulk-actions">
      <button type="button" data-role="cancel">Cancel</button>
      <button type="button" data-role="start">Download</button>
    </div>
  `;

  document.body.appendChild(backdrop);
  document.body.appendChild(modal);

  const close = () => {
    modal.remove();
    backdrop.remove();
    document.removeEventListener('keydown', onKey, true);
  };

  // Escape and backdrop clicks both dismiss, which the original couldn't do
  function onKey(e: KeyboardEvent) {
    if (e.key === 'Escape') close();
  }

  document.addEventListener('keydown', onKey, true);
  backdrop.addEventListener('click', close);

  const input = modal.querySelector<HTMLInputElement>('#xsanctuary-bulk-count');
  modal.querySelector<HTMLButtonElement>('[data-role="cancel"]')?.addEventListener('click', close);
  modal.querySelector<HTMLButtonElement>('[data-role="start"]')?.addEventListener('click', () => {
    const count = Number.parseInt(input?.value || '', 10);
    if (Number.isFinite(count) && count > 0) {
      close();
      void handleImageCollection(count);
    }
  });

  input?.focus();
  input?.select();
}

function createProgressBar(): ProgressHandle {
  const container = document.createElement('div');
  container.className = 'xsanctuary-bulk-progress';
  container.innerHTML = `
    <div class="xsanctuary-bulk-progress-title">
      <span>Downloading images</span><span data-role="percent">0%</span>
    </div>
    <div class="xsanctuary-bulk-progress-track">
      <div class="xsanctuary-bulk-progress-fill" data-role="fill"></div>
    </div>
    <div class="xsanctuary-bulk-progress-detail" data-role="detail">Preparing...</div>
    <button type="button" class="xsanctuary-bulk-cancel" data-role="cancel">Cancel download</button>
  `;

  document.body.appendChild(container);

  const percent = container.querySelector<HTMLElement>('[data-role="percent"]');
  const fill = container.querySelector<HTMLElement>('[data-role="fill"]');
  const detail = container.querySelector<HTMLElement>('[data-role="detail"]');
  const cancel = container.querySelector<HTMLButtonElement>('[data-role="cancel"]');

  cancel?.addEventListener('click', () => {
    isDownloadCancelled = true;
    if (detail) detail.textContent = 'Cancelling, saving what has been downloaded...';
    if (cancel) cancel.disabled = true;
  });

  return {
    updateProgress: (current, total, phase) => {
      const ratio = total > 0 ? current / total : 0;
      if (percent) percent.textContent = `${Math.round(ratio * 100)}%`;
      // scaleX keeps this on the compositor instead of laying out every frame
      if (fill) fill.style.transform = `scaleX(${Math.min(1, ratio)})`;
      if (detail) detail.textContent = `${phase} (${current}/${total})`;
    },
    updateStatus: (message) => {
      if (detail) detail.textContent = message;
    },
    finish: () => {
      container.classList.add('finished');
      setTimeout(() => container.remove(), 500);
    },
  };
}

// ---------------------------------------------------------------------------
// Collection and download
// ---------------------------------------------------------------------------

async function handleRateLimit(progress: ProgressHandle): Promise<void> {
  for (let i = 60; i > 0; i--) {
    if (isDownloadCancelled) break;
    progress.updateStatus(`Rate limited by X. Waiting ${i}s...`);
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
}

async function fetchWithRetry(url: string, maxRetries = 3): Promise<Response> {
  let retries = 0;

  while (retries < maxRetries) {
    try {
      const response = await fetch(url, { signal: downloadAbortController.signal });
      if (response.status === 429) throw new Error('rate-limit');
      return response;
    } catch (error) {
      if ((error as Error).name === 'AbortError') throw error;
      if ((error as Error).message === 'rate-limit' && retries < maxRetries - 1) {
        retries++;
        await new Promise((resolve) => setTimeout(resolve, 60_000));
        continue;
      }
      throw error;
    }
  }

  throw new Error('Max retries reached');
}

async function collectImages(count: number, progress: ProgressHandle) {
  const images: Array<{ url: string; ext: string }> = [];
  const seen = new Set<string>();
  let lastHeight = 0;
  let attempts = 0;
  const maxAttempts = 50;

  while (images.length < count && attempts < maxAttempts) {
    if (isDownloadCancelled) return images;

    const imgElements = document.querySelectorAll<HTMLImageElement>(
      'article[data-testid="tweet"] img[src*="pbs.twimg.com/media"]'
    );

    for (const img of imgElements) {
      if (isDownloadCancelled) return images;

      const highQualityUrl = getHighestQualityUrl(img.src);

      // A Set keeps this O(1) rather than rescanning the array per image,
      // which mattered once the count got into the hundreds.
      if (!seen.has(highQualityUrl)) {
        seen.add(highQualityUrl);
        images.push({ url: highQualityUrl, ext: extensionForUrl(img.src) });
      }

      progress.updateProgress(images.length, count, 'Collecting images');
      if (images.length >= count) break;
    }

    if (images.length < count) {
      const previousHeight = lastHeight;
      window.scrollTo(0, document.body.scrollHeight);
      await new Promise((r) => setTimeout(r, 1000));
      lastHeight = document.body.scrollHeight;
      attempts = previousHeight === lastHeight ? attempts + 1 : 0;
    }
  }

  return images;
}

async function createAndDownloadZip(
  downloadedImages: Array<{ blob: Blob; ext: string }>,
  progress: ProgressHandle
): Promise<void> {
  progress.updateStatus('Creating zip file...');
  const zip = new JSZip();

  downloadedImages.forEach((img, index) => {
    zip.file(`image_${index + 1}.${img.ext}`, img.blob);
  });

  progress.updateStatus('Generating zip...');
  // STORE, not DEFLATE: JPEG and PNG are already compressed, so deflating them
  // costs time for almost no size saving.
  const zipBlob = await zip.generateAsync({ type: 'blob', compression: 'STORE' });

  const username = window.location.pathname.split('/')[1] || 'x';
  const suffix = isDownloadCancelled ? '-partial' : '';
  const filename = `x_${username}_${downloadedImages.length}_[xsanctuary]${suffix}.zip`;

  progress.updateStatus('Saving...');
  await triggerDownload(zipBlob, filename);
}

export async function handleImageCollection(count: number) {
  isDownloadCancelled = false;
  downloadAbortController = new AbortController();

  const progress = createProgressBar();
  const downloadedImages: Array<{ blob: Blob; ext: string }> = [];

  try {
    let collected: Array<{ url: string; ext: string }> = [];

    try {
      collected = await collectImages(count, progress);
    } catch (error) {
      console.error('[XSanctuary] Image collection failed:', error);
      if (collected.length === 0) throw new Error('No images found');
    }

    if (collected.length === 0) {
      progress.updateStatus('No images found on this profile');
      setTimeout(() => progress.finish(), 2000);
      return { success: false, count: 0, reason: 'empty' };
    }

    progress.updateStatus(`Processing ${collected.length} collected images...`);

    for (let i = 0; i < collected.length; i++) {
      // Stop early on cancel, but keep whatever already came down
      if (isDownloadCancelled && downloadedImages.length > 0) break;

      const { url, ext } = collected[i];

      try {
        const response = await fetchWithRetry(url);

        if (!response.ok) {
          if (response.status === 429) {
            await handleRateLimit(progress);
            if (!isDownloadCancelled) {
              const retry = await fetchWithRetry(url);
              if (retry.ok) downloadedImages.push({ blob: await retry.blob(), ext });
            }
            continue;
          }
          throw new Error(`HTTP ${response.status}`);
        }

        downloadedImages.push({ blob: await response.blob(), ext });
        progress.updateProgress(i + 1, collected.length, 'Downloading images');
      } catch (error) {
        if ((error as Error).name === 'AbortError') break;
        console.error(`[XSanctuary] Failed to fetch image ${i + 1}:`, error);
      }
    }

    if (downloadedImages.length === 0) {
      progress.updateStatus('No images could be downloaded');
      setTimeout(() => progress.finish(), 2000);
      return { success: false, count: 0, reason: 'failed' };
    }

    progress.updateStatus(`Saving ${downloadedImages.length} images...`);
    await createAndDownloadZip(downloadedImages, progress);
    progress.updateStatus('Download complete');

    setTimeout(() => progress.finish(), 2000);
    return {
      success: true,
      count: downloadedImages.length,
      reason: isDownloadCancelled ? 'cancelled' : 'completed',
    };
  } catch (error) {
    console.error('[XSanctuary] Bulk download failed:', error);

    // Salvage anything already fetched rather than losing the whole run
    if (downloadedImages.length > 0) {
      progress.updateStatus(`Error. Saving ${downloadedImages.length} images anyway...`);
      try {
        await createAndDownloadZip(downloadedImages, progress);
        progress.updateStatus('Partial download saved');
      } catch {
        progress.updateStatus('Could not save the images');
      }
    } else {
      progress.updateStatus('Download failed');
    }

    setTimeout(() => progress.finish(), 2000);
    return { success: false, count: downloadedImages.length, reason: 'error' };
  } finally {
    downloadAbortController = new AbortController();
  }
}
