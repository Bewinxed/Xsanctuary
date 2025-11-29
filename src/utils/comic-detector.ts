import {
  detectBubbles,
  isModelLoaded,
  loadModel,
  type BubbleDetection,
  type DetectionResult,
  type DownloadProgressCallback,
} from './yolo-inference';

// Re-export types
export type { BubbleDetection, DetectionResult, DownloadProgressCallback };

// Cache for detection results
const detectionCache = new Map<string, DetectionResult>();
const MAX_CACHE_SIZE = 100;

// Minimum number of bubbles to consider an image a comic
const MIN_BUBBLES_FOR_COMIC = 1;

// Minimum confidence threshold for comic detection (0.5 = 50% confidence)
const COMIC_DETECTION_CONFIDENCE = 0.5;

/**
 * Check if an image is a comic/manga (has speech bubbles)
 */
export async function isComic(
  imageUrl: string,
  onProgress?: DownloadProgressCallback
): Promise<boolean> {
  try {
    const result = await detectBubblesInImage(imageUrl, onProgress);
    return result.bubbles.length >= MIN_BUBBLES_FOR_COMIC;
  } catch (e) {
    console.warn('[ComicDetector] Failed to detect if image is comic:', e);
    return false;
  }
}

/**
 * Detect speech bubbles in an image
 * Returns cached result if available
 */
export async function detectBubblesInImage(
  imageUrl: string,
  onProgress?: DownloadProgressCallback
): Promise<DetectionResult> {
  // Check cache first
  const cached = detectionCache.get(imageUrl);
  if (cached) {
    return cached;
  }

  // Run detection
  const result = await detectBubbles(imageUrl, COMIC_DETECTION_CONFIDENCE, 0.5, onProgress);

  // Cache result
  if (detectionCache.size >= MAX_CACHE_SIZE) {
    // Remove oldest entry
    const firstKey = detectionCache.keys().next().value;
    if (firstKey) detectionCache.delete(firstKey);
  }
  detectionCache.set(imageUrl, result);

  return result;
}

// Fetch image as blob to avoid CORS issues (extension has host permissions)
async function fetchImageAsBlob(imageUrl: string): Promise<string> {
  try {
    const response = await fetch(imageUrl);
    if (!response.ok) throw new Error(`HTTP ${response.status}`);

    // Read the entire response body as an array buffer first
    const arrayBuffer = await response.arrayBuffer();
    console.log(`[XSanctuary] Fetched ${arrayBuffer.byteLength} bytes from ${imageUrl.substring(0, 80)}...`);

    // Create blob from the complete data
    const blob = new Blob([arrayBuffer], { type: response.headers.get('content-type') || 'image/jpeg' });
    return URL.createObjectURL(blob);
  } catch (e) {
    console.warn('[ComicDetector] Fetch failed, using original URL:', e);
    return imageUrl;
  }
}

/**
 * Convert an image URL to base64
 */
export async function getImageAsBase64(imageUrl: string): Promise<string> {
  const blobUrl = await fetchImageAsBlob(imageUrl);

  return new Promise((resolve, reject) => {
    const img = new Image();

    img.onload = () => {
      try {
        const canvas = document.createElement('canvas');
        canvas.width = img.width;
        canvas.height = img.height;
        const ctx = canvas.getContext('2d')!;
        ctx.drawImage(img, 0, 0);

        // Get as PNG base64
        const dataUrl = canvas.toDataURL('image/png');
        // Remove the "data:image/png;base64," prefix
        const base64 = dataUrl.split(',')[1];

        if (blobUrl !== imageUrl) URL.revokeObjectURL(blobUrl);
        resolve(base64);
      } catch (e) {
        if (blobUrl !== imageUrl) URL.revokeObjectURL(blobUrl);
        reject(e);
      }
    };

    img.onerror = () => {
      if (blobUrl !== imageUrl) URL.revokeObjectURL(blobUrl);
      reject(new Error('Failed to load image for base64 conversion'));
    };
    img.src = blobUrl;
  });
}

/**
 * Crop a specific bubble from an image and return as base64
 */
export async function cropBubbleToBase64(
  imageUrl: string,
  bubble: BubbleDetection,
  padding: number = 20, // Increased padding for better context
  originalWidth?: number, // Original image width from detection
  originalHeight?: number // Original image height from detection
): Promise<string> {
  const blobUrl = await fetchImageAsBlob(imageUrl);

  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';

    img.onload = async () => {
      try {
        // Wait for image to be fully decoded (not just metadata loaded)
        if (img.decode) {
          await img.decode();
        }

        // Scale bbox if the loaded image has different dimensions than the detection image
        let scaleX = 1;
        let scaleY = 1;

        if (originalWidth && originalHeight && (img.width !== originalWidth || img.height !== originalHeight)) {
          scaleX = img.width / originalWidth;
          scaleY = img.height / originalHeight;
          console.log(`[XSanctuary] Scaling crop: detection was ${originalWidth}x${originalHeight}, loaded ${img.width}x${img.height}, scale: ${scaleX.toFixed(2)}x${scaleY.toFixed(2)}`);
        }

        // Scale and add padding around the bubble
        const x1 = Math.max(0, (bubble.bbox.x1 * scaleX) - padding);
        const y1 = Math.max(0, (bubble.bbox.y1 * scaleY) - padding);
        const x2 = Math.min(img.width, (bubble.bbox.x2 * scaleX) + padding);
        const y2 = Math.min(img.height, (bubble.bbox.y2 * scaleY) + padding);

        const width = x2 - x1;
        const height = y2 - y1;

        console.log(`[XSanctuary] Cropping: original bbox (${bubble.bbox.x1.toFixed(0)},${bubble.bbox.y1.toFixed(0)})-(${bubble.bbox.x2.toFixed(0)},${bubble.bbox.y2.toFixed(0)}), scaled crop (${x1.toFixed(0)},${y1.toFixed(0)})-(${x2.toFixed(0)},${y2.toFixed(0)})`);
        console.log(`[XSanctuary] Image naturalWidth: ${img.naturalWidth}, naturalHeight: ${img.naturalHeight}, complete: ${img.complete}`);

        const canvas = document.createElement('canvas');
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext('2d')!;

        ctx.drawImage(img, x1, y1, width, height, 0, 0, width, height);

        // Get as PNG base64
        const dataUrl = canvas.toDataURL('image/png');
        const base64 = dataUrl.split(',')[1];

        if (blobUrl !== imageUrl) URL.revokeObjectURL(blobUrl);
        resolve(base64);
      } catch (e) {
        if (blobUrl !== imageUrl) URL.revokeObjectURL(blobUrl);
        reject(e);
      }
    };

    img.onerror = () => {
      if (blobUrl !== imageUrl) URL.revokeObjectURL(blobUrl);
      reject(new Error('Failed to load image for cropping'));
    };
    img.src = blobUrl;
  });
}

/**
 * Preload the YOLO model
 */
export async function preloadModel(onProgress?: DownloadProgressCallback): Promise<void> {
  await loadModel(onProgress);
}

/**
 * Check if the model is already loaded
 */
export function isDetectionModelLoaded(): boolean {
  return isModelLoaded();
}

/**
 * Clear detection cache
 */
export function clearDetectionCache(): void {
  detectionCache.clear();
}

/**
 * Get bubble at specific coordinates (for hover detection)
 */
export function getBubbleAtPoint(
  result: DetectionResult,
  x: number, // Mouse X relative to image
  y: number, // Mouse Y relative to image
  imageWidth: number,
  imageHeight: number
): BubbleDetection | null {
  // Normalize coordinates
  const normalizedX = x / imageWidth;
  const normalizedY = y / imageHeight;

  for (const bubble of result.bubbles) {
    const halfWidth = bubble.width / 2;
    const halfHeight = bubble.height / 2;

    if (
      normalizedX >= bubble.x - halfWidth &&
      normalizedX <= bubble.x + halfWidth &&
      normalizedY >= bubble.y - halfHeight &&
      normalizedY <= bubble.y + halfHeight
    ) {
      return bubble;
    }
  }

  return null;
}

/**
 * Generate a unique key for a bubble (for caching translations)
 */
export function getBubbleKey(imageUrl: string, bubble: BubbleDetection): string {
  return `${imageUrl}:${bubble.bbox.x1.toFixed(0)},${bubble.bbox.y1.toFixed(0)},${bubble.bbox.x2.toFixed(0)},${bubble.bbox.y2.toFixed(0)}`;
}
