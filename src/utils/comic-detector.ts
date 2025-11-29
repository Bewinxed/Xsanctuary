/**
 * Comic/manga detection utilities
 * Uses background script for YOLO inference to avoid blocking the main thread
 */

// Types (matching yolo-background.ts)
export interface BubbleDetection {
  x: number;
  y: number;
  width: number;
  height: number;
  confidence: number;
  bbox: {
    x1: number;
    y1: number;
    x2: number;
    y2: number;
  };
  maskPath?: string;
}

export interface DetectionResult {
  bubbles: BubbleDetection[];
  imageWidth: number;
  imageHeight: number;
  inferenceTime: number;
}

export type DownloadProgressCallback = (progress: number, status: string) => void;

// Cache for detection results (LRU-style with max size)
const detectionCache = new Map<string, DetectionResult>();
const MAX_CACHE_SIZE = 100;

// Default confidence threshold (can be overridden by settings)
const DEFAULT_CONFIDENCE_THRESHOLD = 0.3;

/**
 * Check if an image is a comic/manga (has speech bubbles)
 */
export async function isComic(imageUrl: string): Promise<boolean> {
  try {
    const result = await detectBubblesInImage(imageUrl);
    return result.bubbles.length >= 1;
  } catch (e) {
    console.warn('[ComicDetector] Failed to detect if image is comic:', e);
    return false;
  }
}

/**
 * Detect speech bubbles in an image
 * Runs in background script to avoid blocking UI
 * @param imageUrl - URL of the image to analyze
 * @param confidenceThreshold - Confidence threshold for detection (0.1-1.0), default 0.3
 * @param _onProgress - Optional progress callback (unused, kept for API compatibility)
 */
export async function detectBubblesInImage(
  imageUrl: string,
  confidenceThreshold: number = DEFAULT_CONFIDENCE_THRESHOLD,
  _onProgress?: DownloadProgressCallback
): Promise<DetectionResult> {
  // Check cache first
  const cached = detectionCache.get(imageUrl);
  if (cached) {
    return cached;
  }

  // Send to background script for processing
  const response = await browser.runtime.sendMessage({
    type: 'YOLO_DETECT',
    imageUrl,
    confidenceThreshold,
    nmsThreshold: 0.5,
  });

  if (response.error) {
    throw new Error(response.error);
  }

  const result = response as DetectionResult;

  // Cache result (LRU eviction)
  if (detectionCache.size >= MAX_CACHE_SIZE) {
    const firstKey = detectionCache.keys().next().value;
    if (firstKey) detectionCache.delete(firstKey);
  }
  detectionCache.set(imageUrl, result);

  return result;
}

/**
 * Convert an image URL to base64
 * Runs in background script using OffscreenCanvas
 */
export async function getImageAsBase64(imageUrl: string): Promise<string> {
  const response = await browser.runtime.sendMessage({
    type: 'YOLO_GET_IMAGE_BASE64',
    imageUrl,
  });

  if (response.error) {
    throw new Error(response.error);
  }

  return response.base64;
}

/**
 * Crop a specific bubble from an image and return as base64
 * Runs in background script using OffscreenCanvas
 */
export async function cropBubbleToBase64(
  imageUrl: string,
  bubble: BubbleDetection,
  padding: number = 20,
  originalWidth?: number,
  originalHeight?: number
): Promise<string> {
  const response = await browser.runtime.sendMessage({
    type: 'YOLO_CROP_BUBBLE',
    imageUrl,
    bubble,
    padding,
    originalWidth,
    originalHeight,
  });

  if (response.error) {
    throw new Error(response.error);
  }

  return response.base64;
}

/**
 * Preload the YOLO model (triggers background script to load it)
 */
export async function preloadModel(): Promise<void> {
  // Just trigger a detection to warm up the model
  // The background script will cache the model after first load
  try {
    await browser.runtime.sendMessage({
      type: 'YOLO_DETECT',
      imageUrl: 'about:blank', // Will fail gracefully but load the model
      confidenceThreshold: 0.5,
      nmsThreshold: 0.5,
    });
  } catch {
    // Expected to fail, but model is now loaded
  }
}

/**
 * Check if the model is loaded (always true since background handles it)
 */
export function isDetectionModelLoaded(): boolean {
  return true; // Background script manages model state
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
  x: number,
  y: number,
  imageWidth: number,
  imageHeight: number
): BubbleDetection | null {
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
