import * as ort from 'onnxruntime-web';

// Configure ONNX Runtime WASM paths for browser extension
// The WASM files are in public/wasm/ and made web-accessible via manifest
// @ts-expect-error - 'wasm/' is a valid path but not in PublicPath type
const wasmBasePath = browser.runtime.getURL('wasm/') as string;
ort.env.wasm.wasmPaths = wasmBasePath;

// Disable multi-threading as it requires SharedArrayBuffer which needs specific headers
ort.env.wasm.numThreads = 1;

// Model configuration
const MODEL_URL = 'https://huggingface.co/kitsumed/yolov8m_seg-speech-bubble/resolve/main/model_dynamic.onnx';
const MODEL_DB_NAME = 'xsanctuary-models';
const MODEL_STORE_NAME = 'onnx-models';
const MODEL_KEY = 'speech-bubble-yolov8m';
const INPUT_SIZE = 640;

export interface BubbleDetection {
  x: number;      // Center x (normalized 0-1)
  y: number;      // Center y (normalized 0-1)
  width: number;  // Width (normalized 0-1)
  height: number; // Height (normalized 0-1)
  confidence: number;
  // Pixel coordinates (for overlay positioning)
  bbox: {
    x1: number;
    y1: number;
    x2: number;
    y2: number;
  };
  // SVG path for the bubble shape (from segmentation mask)
  maskPath?: string;
}

export interface DetectionResult {
  bubbles: BubbleDetection[];
  imageWidth: number;
  imageHeight: number;
  inferenceTime: number;
}

// Singleton state - use a more robust loading mechanism
let session: ort.InferenceSession | null = null;
let loadingPromise: Promise<ort.InferenceSession> | null = null;
let sessionError: Error | null = null;

// Progress callback type
export type DownloadProgressCallback = (progress: number, status: string) => void;

// IndexedDB helpers
async function openModelDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(MODEL_DB_NAME, 1);
    request.onerror = () => reject(request.error);
    request.onsuccess = () => resolve(request.result);
    request.onupgradeneeded = (event) => {
      const db = (event.target as IDBOpenDBRequest).result;
      if (!db.objectStoreNames.contains(MODEL_STORE_NAME)) {
        db.createObjectStore(MODEL_STORE_NAME);
      }
    };
  });
}

async function getCachedModel(): Promise<ArrayBuffer | null> {
  try {
    const db = await openModelDB();
    return new Promise((resolve, reject) => {
      const transaction = db.transaction(MODEL_STORE_NAME, 'readonly');
      const store = transaction.objectStore(MODEL_STORE_NAME);
      const request = store.get(MODEL_KEY);
      request.onerror = () => reject(request.error);
      request.onsuccess = () => resolve(request.result || null);
    });
  } catch {
    return null;
  }
}

async function cacheModel(data: ArrayBuffer): Promise<void> {
  try {
    const db = await openModelDB();
    return new Promise((resolve, reject) => {
      const transaction = db.transaction(MODEL_STORE_NAME, 'readwrite');
      const store = transaction.objectStore(MODEL_STORE_NAME);
      const request = store.put(data, MODEL_KEY);
      request.onerror = () => reject(request.error);
      request.onsuccess = () => resolve();
    });
  } catch (e) {
    console.warn('[YOLO] Failed to cache model:', e);
  }
}

async function downloadModel(onProgress?: DownloadProgressCallback): Promise<ArrayBuffer> {
  onProgress?.(0, 'Starting download...');

  const response = await fetch(MODEL_URL);
  if (!response.ok) {
    throw new Error(`Failed to download model: ${response.status}`);
  }

  const contentLength = response.headers.get('content-length');
  const totalSize = contentLength ? parseInt(contentLength, 10) : 0;

  if (!response.body) {
    throw new Error('Response body is null');
  }

  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let receivedSize = 0;

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    chunks.push(value);
    receivedSize += value.length;

    if (totalSize > 0) {
      const progress = (receivedSize / totalSize) * 100;
      onProgress?.(progress, `Downloading model: ${(receivedSize / 1024 / 1024).toFixed(1)}MB / ${(totalSize / 1024 / 1024).toFixed(1)}MB`);
    } else {
      onProgress?.(50, `Downloading model: ${(receivedSize / 1024 / 1024).toFixed(1)}MB`);
    }
  }

  onProgress?.(100, 'Download complete');

  // Combine chunks
  const modelData = new Uint8Array(receivedSize);
  let offset = 0;
  for (const chunk of chunks) {
    modelData.set(chunk, offset);
    offset += chunk.length;
  }

  return modelData.buffer;
}

export async function loadModel(onProgress?: DownloadProgressCallback): Promise<ort.InferenceSession> {
  // Return existing session if loaded
  if (session) {
    return session;
  }

  // If there was a previous error, throw it
  if (sessionError) {
    throw sessionError;
  }

  // Return existing promise if loading (prevent concurrent initialization)
  if (loadingPromise) {
    return loadingPromise;
  }

  // Create a new loading promise
  loadingPromise = (async () => {
    try {
      // Try to get cached model first
      onProgress?.(0, 'Checking for cached model...');
      let modelData = await getCachedModel();

      if (!modelData) {
        // Download if not cached
        console.log('[YOLO] Downloading model from HuggingFace...');
        modelData = await downloadModel(onProgress);

        // Cache for future use
        onProgress?.(100, 'Caching model...');
        await cacheModel(modelData);
        console.log('[YOLO] Model cached to IndexedDB');
      } else {
        console.log('[YOLO] Using cached model from IndexedDB');
        onProgress?.(100, 'Model loaded from cache');
      }

      // Configure ONNX Runtime
      onProgress?.(100, 'Initializing inference session...');

      // Use only WASM to avoid WebGPU/WebGL session conflicts
      // WebGPU can cause "session already started" errors with concurrent requests
      const executionProviders: ort.InferenceSession.ExecutionProviderConfig[] = ['wasm'];

      session = await ort.InferenceSession.create(modelData, {
        executionProviders,
        graphOptimizationLevel: 'all',
      });

      console.log('[YOLO] Model loaded successfully');
      console.log('[YOLO] Input names:', session.inputNames);
      console.log('[YOLO] Output names:', session.outputNames);

      return session;
    } catch (error) {
      // Store error to prevent retry loops
      sessionError = error instanceof Error ? error : new Error(String(error));
      console.error('[YOLO] Failed to load model:', sessionError);
      throw sessionError;
    } finally {
      // Don't clear loadingPromise on success - keep it so subsequent calls return the same session
      // Only clear on error so it can be retried
      if (sessionError) {
        loadingPromise = null;
      }
    }
  })();

  return loadingPromise;
}

export function isModelLoaded(): boolean {
  return session !== null;
}

// Fetch image as blob to avoid CORS issues (extension has host permissions)
async function fetchImageAsBlob(imageUrl: string): Promise<string> {
  try {
    const response = await fetch(imageUrl);
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const blob = await response.blob();
    return URL.createObjectURL(blob);
  } catch (e) {
    console.warn('[YOLO] Fetch failed, using original URL:', e);
    return imageUrl;
  }
}

// Preprocess image for YOLO
async function preprocessImage(imageUrl: string): Promise<{ tensor: ort.Tensor; originalWidth: number; originalHeight: number }> {
  // Fetch image as blob to avoid CORS issues
  const blobUrl = await fetchImageAsBlob(imageUrl);

  return new Promise((resolve, reject) => {
    const img = new Image();

    img.onload = () => {
      try {
        const canvas = document.createElement('canvas');
        canvas.width = INPUT_SIZE;
        canvas.height = INPUT_SIZE;
        const ctx = canvas.getContext('2d')!;

        // Calculate scaling to maintain aspect ratio
        const scale = Math.min(INPUT_SIZE / img.width, INPUT_SIZE / img.height);
        const scaledWidth = img.width * scale;
        const scaledHeight = img.height * scale;
        const offsetX = (INPUT_SIZE - scaledWidth) / 2;
        const offsetY = (INPUT_SIZE - scaledHeight) / 2;

        // Fill with gray (letterbox)
        ctx.fillStyle = '#808080';
        ctx.fillRect(0, 0, INPUT_SIZE, INPUT_SIZE);

        // Draw scaled image
        ctx.drawImage(img, offsetX, offsetY, scaledWidth, scaledHeight);

        // Get image data
        const imageData = ctx.getImageData(0, 0, INPUT_SIZE, INPUT_SIZE);
        const pixels = imageData.data;

        // Convert to CHW format and normalize (RGB, 0-1)
        const float32Data = new Float32Array(3 * INPUT_SIZE * INPUT_SIZE);

        for (let i = 0; i < INPUT_SIZE * INPUT_SIZE; i++) {
          const pixelIndex = i * 4;
          // RGB channels normalized to 0-1
          float32Data[i] = pixels[pixelIndex] / 255;     // R
          float32Data[i + INPUT_SIZE * INPUT_SIZE] = pixels[pixelIndex + 1] / 255;     // G
          float32Data[i + 2 * INPUT_SIZE * INPUT_SIZE] = pixels[pixelIndex + 2] / 255; // B
        }

        const tensor = new ort.Tensor('float32', float32Data, [1, 3, INPUT_SIZE, INPUT_SIZE]);

        // Clean up blob URL
        if (blobUrl !== imageUrl) {
          URL.revokeObjectURL(blobUrl);
        }

        resolve({
          tensor,
          originalWidth: img.width,
          originalHeight: img.height,
        });
      } catch (e) {
        reject(e);
      }
    };

    img.onerror = () => {
      if (blobUrl !== imageUrl) {
        URL.revokeObjectURL(blobUrl);
      }
      reject(new Error('Failed to load image'));
    };

    img.src = blobUrl;
  });
}

// Non-Maximum Suppression
function nms(boxes: BubbleDetection[], iouThreshold: number = 0.5): BubbleDetection[] {
  if (boxes.length === 0) return [];

  // Sort by confidence (descending)
  const sorted = [...boxes].sort((a, b) => b.confidence - a.confidence);
  const keep: BubbleDetection[] = [];
  const used = new Set<number>();

  for (let i = 0; i < sorted.length; i++) {
    if (used.has(i)) continue;

    keep.push(sorted[i]);

    for (let j = i + 1; j < sorted.length; j++) {
      if (used.has(j)) continue;

      const iou = calculateIoU(sorted[i], sorted[j]);
      if (iou > iouThreshold) {
        used.add(j);
      }
    }
  }

  return keep;
}

function calculateIoU(a: BubbleDetection, b: BubbleDetection): number {
  const x1 = Math.max(a.bbox.x1, b.bbox.x1);
  const y1 = Math.max(a.bbox.y1, b.bbox.y1);
  const x2 = Math.min(a.bbox.x2, b.bbox.x2);
  const y2 = Math.min(a.bbox.y2, b.bbox.y2);

  const intersection = Math.max(0, x2 - x1) * Math.max(0, y2 - y1);

  const areaA = (a.bbox.x2 - a.bbox.x1) * (a.bbox.y2 - a.bbox.y1);
  const areaB = (b.bbox.x2 - b.bbox.x1) * (b.bbox.y2 - b.bbox.y1);

  const union = areaA + areaB - intersection;

  return intersection / union;
}

// Sigmoid activation
function sigmoid(x: number): number {
  return 1 / (1 + Math.exp(-x));
}

// Generate SVG path from mask (simplified contour extraction)
function maskToSvgPath(mask: Float32Array, maskWidth: number, maskHeight: number, threshold: number = 0.5): string {
  // Find contour points using marching squares (simplified)
  const points: { x: number; y: number }[] = [];

  // Sample points around the mask boundary
  const step = 2; // Sample every 2 pixels for performance

  for (let y = 0; y < maskHeight; y += step) {
    for (let x = 0; x < maskWidth; x += step) {
      const idx = y * maskWidth + x;
      const val = mask[idx];

      if (val > threshold) {
        // Check if this is a boundary pixel
        const left = x > 0 ? mask[idx - 1] : 0;
        const right = x < maskWidth - 1 ? mask[idx + 1] : 0;
        const top = y > 0 ? mask[idx - maskWidth] : 0;
        const bottom = y < maskHeight - 1 ? mask[idx + maskWidth] : 0;

        if (left <= threshold || right <= threshold || top <= threshold || bottom <= threshold) {
          points.push({ x: (x / maskWidth) * 100, y: (y / maskHeight) * 100 });
        }
      }
    }
  }

  if (points.length < 3) return '';

  // Sort points by angle from centroid for proper polygon
  const cx = points.reduce((s, p) => s + p.x, 0) / points.length;
  const cy = points.reduce((s, p) => s + p.y, 0) / points.length;

  points.sort((a, b) => {
    const angleA = Math.atan2(a.y - cy, a.x - cx);
    const angleB = Math.atan2(b.y - cy, b.x - cx);
    return angleA - angleB;
  });

  // Create polygon path as percentage coordinates
  const pathPoints = points.map(p => `${p.x.toFixed(1)}% ${p.y.toFixed(1)}%`).join(', ');
  return `polygon(${pathPoints})`;
}

// Parse YOLO output
function parseOutput(
  output: ort.Tensor,
  maskProtos: ort.Tensor | undefined,
  originalWidth: number,
  originalHeight: number,
  confidenceThreshold: number = 0.25
): BubbleDetection[] {
  const data = output.data as Float32Array;
  const [, numFeatures, numBoxes] = output.dims;

  // YOLOv8 seg output format: [1, 4 + num_classes + 32, num_boxes]
  // First 4 values per box: x_center, y_center, width, height
  // Next value(s): class confidences
  // Last 32 values: mask coefficients

  const detections: BubbleDetection[] = [];

  // Calculate letterbox parameters
  const scale = Math.min(INPUT_SIZE / originalWidth, INPUT_SIZE / originalHeight);
  const scaledWidth = originalWidth * scale;
  const scaledHeight = originalHeight * scale;
  const offsetX = (INPUT_SIZE - scaledWidth) / 2;
  const offsetY = (INPUT_SIZE - scaledHeight) / 2;

  // Mask prototype dimensions (typically 160x160 for YOLOv8)
  const protoData = maskProtos?.data as Float32Array | undefined;
  const protoDims = maskProtos?.dims; // [1, 32, 160, 160]
  const numMaskCoeffs = 32;
  const maskH = protoDims ? protoDims[2] : 160;
  const maskW = protoDims ? protoDims[3] : 160;

  for (let i = 0; i < numBoxes; i++) {
    // Get box coordinates (in INPUT_SIZE space)
    const xCenter = data[0 * numBoxes + i];
    const yCenter = data[1 * numBoxes + i];
    const width = data[2 * numBoxes + i];
    const height = data[3 * numBoxes + i];

    // Get class confidence - for single class model, it's at index 4
    const confidence = data[4 * numBoxes + i];

    if (confidence < confidenceThreshold) continue;

    // Convert from letterboxed coordinates to original image coordinates
    const x1Letterbox = xCenter - width / 2;
    const y1Letterbox = yCenter - height / 2;
    const x2Letterbox = xCenter + width / 2;
    const y2Letterbox = yCenter + height / 2;

    // Remove letterbox offset and scale back to original
    const x1 = (x1Letterbox - offsetX) / scale;
    const y1 = (y1Letterbox - offsetY) / scale;
    const x2 = (x2Letterbox - offsetX) / scale;
    const y2 = (y2Letterbox - offsetY) / scale;

    // Clamp to image bounds
    const clampedX1 = Math.max(0, Math.min(originalWidth, x1));
    const clampedY1 = Math.max(0, Math.min(originalHeight, y1));
    const clampedX2 = Math.max(0, Math.min(originalWidth, x2));
    const clampedY2 = Math.max(0, Math.min(originalHeight, y2));

    // Generate mask path if prototypes available
    let maskPath: string | undefined;

    if (protoData && protoDims) {
      try {
        // Extract mask coefficients (last 32 values for this detection)
        const maskCoeffs: number[] = [];
        for (let c = 0; c < numMaskCoeffs; c++) {
          const coeffIdx = (5 + c) * numBoxes + i; // Start after class confidence
          maskCoeffs.push(data[coeffIdx]);
        }

        // Generate mask by multiplying coefficients with prototypes
        const mask = new Float32Array(maskH * maskW);

        for (let y = 0; y < maskH; y++) {
          for (let x = 0; x < maskW; x++) {
            let val = 0;
            for (let c = 0; c < numMaskCoeffs; c++) {
              // Prototype shape: [1, 32, 160, 160]
              const protoIdx = c * maskH * maskW + y * maskW + x;
              val += maskCoeffs[c] * protoData[protoIdx];
            }
            mask[y * maskW + x] = sigmoid(val);
          }
        }

        // Crop mask to bounding box region (in 160x160 space)
        const maskScale = maskW / INPUT_SIZE;
        const mx1 = Math.floor(x1Letterbox * maskScale);
        const my1 = Math.floor(y1Letterbox * maskScale);
        const mx2 = Math.ceil(x2Letterbox * maskScale);
        const my2 = Math.ceil(y2Letterbox * maskScale);

        const cropW = Math.max(1, mx2 - mx1);
        const cropH = Math.max(1, my2 - my1);
        const croppedMask = new Float32Array(cropW * cropH);

        for (let y = 0; y < cropH; y++) {
          for (let x = 0; x < cropW; x++) {
            const srcX = Math.min(maskW - 1, Math.max(0, mx1 + x));
            const srcY = Math.min(maskH - 1, Math.max(0, my1 + y));
            croppedMask[y * cropW + x] = mask[srcY * maskW + srcX];
          }
        }

        maskPath = maskToSvgPath(croppedMask, cropW, cropH, 0.5);
      } catch (e) {
        console.warn('[YOLO] Failed to generate mask:', e);
      }
    }

    detections.push({
      x: (clampedX1 + clampedX2) / 2 / originalWidth,
      y: (clampedY1 + clampedY2) / 2 / originalHeight,
      width: (clampedX2 - clampedX1) / originalWidth,
      height: (clampedY2 - clampedY1) / originalHeight,
      confidence: confidence,
      bbox: {
        x1: clampedX1,
        y1: clampedY1,
        x2: clampedX2,
        y2: clampedY2,
      },
      maskPath,
    });
  }

  return detections;
}

export async function detectBubbles(
  imageUrl: string,
  confidenceThreshold: number = 0.25,
  nmsThreshold: number = 0.5,
  onProgress?: DownloadProgressCallback
): Promise<DetectionResult> {
  const startTime = performance.now();

  // Ensure model is loaded
  const model = await loadModel(onProgress);

  // Preprocess image
  const { tensor, originalWidth, originalHeight } = await preprocessImage(imageUrl);

  // Run inference
  const feeds: Record<string, ort.Tensor> = {};
  feeds[model.inputNames[0]] = tensor;

  const results = await model.run(feeds);
  const output0 = results[model.outputNames[0]]; // Detections
  const output1 = results[model.outputNames[1]]; // Mask prototypes

  // Log output shapes for debugging
  console.log('[YOLO] Detection output shape:', output0.dims);
  console.log('[YOLO] Mask prototype shape:', output1?.dims);

  // Parse output with mask prototypes
  const rawDetections = parseOutput(output0, output1, originalWidth, originalHeight, confidenceThreshold);
  console.log('[YOLO] Raw detections before NMS:', rawDetections.length);

  // Apply NMS
  const bubbles = nms(rawDetections, nmsThreshold);

  const inferenceTime = performance.now() - startTime;

  console.log(`[YOLO] Detected ${bubbles.length} speech bubbles in ${inferenceTime.toFixed(0)}ms`);

  return {
    bubbles,
    imageWidth: originalWidth,
    imageHeight: originalHeight,
    inferenceTime,
  };
}

// Clear cached model
export async function clearModelCache(): Promise<void> {
  try {
    const db = await openModelDB();
    return new Promise((resolve, reject) => {
      const transaction = db.transaction(MODEL_STORE_NAME, 'readwrite');
      const store = transaction.objectStore(MODEL_STORE_NAME);
      const request = store.delete(MODEL_KEY);
      request.onerror = () => reject(request.error);
      request.onsuccess = () => {
        session = null;
        loadingPromise = null;
        sessionError = null;
        resolve();
      };
    });
  } catch (e) {
    console.warn('[YOLO] Failed to clear model cache:', e);
  }
}

// Reset session error to allow retry
export function resetSessionError(): void {
  sessionError = null;
  loadingPromise = null;
}
