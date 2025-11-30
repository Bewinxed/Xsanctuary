/**
 * Offscreen document for YOLO inference
 * This runs in a normal document context where dynamic import() works
 */

import * as ort from 'onnxruntime-web';

// Chrome types for offscreen API (not in standard webextension-polyfill)
// eslint-disable-next-line @typescript-eslint/no-explicit-any
declare const chrome: any;

// Types
interface BubbleDetection {
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

interface DetectionResult {
  bubbles: BubbleDetection[];
  imageWidth: number;
  imageHeight: number;
  inferenceTime: number;
}

// Model configuration - YOLO
const MODEL_URL = 'https://huggingface.co/kitsumed/yolov8m_seg-speech-bubble/resolve/main/model_dynamic.onnx';
const MODEL_DB_NAME = 'xsanctuary-models';
const MODEL_STORE_NAME = 'onnx-models';
const MODEL_KEY = 'speech-bubble-yolov8m';
const INPUT_SIZE = 640;

// Model configuration - PaddleOCR
const PADDLE_DET_URL = 'https://huggingface.co/deepghs/paddleocr/resolve/main/det/ch_PP-OCRv3_det/model.onnx';
const PADDLE_REC_URL = 'https://huggingface.co/deepghs/paddleocr/resolve/main/rec/japan_PP-OCRv3_rec/model.onnx';
const PADDLE_DICT_URL = 'https://huggingface.co/deepghs/paddleocr/resolve/main/rec/japan_PP-OCRv3_rec/dict.txt';
const PADDLE_DET_KEY = 'paddleocr-det-v3';
const PADDLE_REC_KEY = 'paddleocr-rec-japan-v3';
const PADDLE_DICT_KEY = 'paddleocr-dict-japan';

// State - YOLO
let session: ort.InferenceSession | null = null;
let loadingPromise: Promise<ort.InferenceSession> | null = null;
let sessionError: Error | null = null;

// State - PaddleOCR
let paddleDetSession: ort.InferenceSession | null = null;
let paddleRecSession: ort.InferenceSession | null = null;
let paddleDict: string[] | null = null;
let paddleDetLoading: Promise<ort.InferenceSession> | null = null;
let paddleRecLoading: Promise<ort.InferenceSession> | null = null;

// OCR Result types
interface TextBox {
  points: number[][]; // 4 corner points [[x1,y1], [x2,y2], [x3,y3], [x4,y4]]
  text: string;
  confidence: number;
}

interface OCRResult {
  boxes: TextBox[];
  imageWidth: number;
  imageHeight: number;
  inferenceTime: number;
}

// Configure WASM paths on load
function configureWasm() {
  const wasmPath = chrome.runtime.getURL('wasm/');
  ort.env.wasm.wasmPaths = wasmPath;
  ort.env.wasm.numThreads = 1;
}

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
    console.warn('[Offscreen YOLO] Failed to cache model:', e);
  }
}

async function downloadModel(): Promise<ArrayBuffer> {

  const response = await fetch(MODEL_URL);
  if (!response.ok) {
    throw new Error(`Failed to download model: ${response.status}`);
  }

  const arrayBuffer = await response.arrayBuffer();

  return arrayBuffer;
}

async function loadModel(): Promise<ort.InferenceSession> {
  if (session) return session;
  if (sessionError) throw sessionError;
  if (loadingPromise) return loadingPromise;

  loadingPromise = (async () => {
    try {
      let modelData = await getCachedModel();

      if (!modelData) {
        modelData = await downloadModel();
        await cacheModel(modelData);
      } else {
      }

      session = await ort.InferenceSession.create(modelData, {
        executionProviders: ['wasm'],
        graphOptimizationLevel: 'all',
      });

      return session;
    } catch (error) {
      sessionError = error instanceof Error ? error : new Error(String(error));
      loadingPromise = null;
      throw sessionError;
    }
  })();

  return loadingPromise;
}

// Image preprocessing using OffscreenCanvas
async function preprocessImage(imageUrl: string): Promise<{ tensor: ort.Tensor; originalWidth: number; originalHeight: number }> {
  const response = await fetch(imageUrl);
  if (!response.ok) throw new Error(`Failed to fetch image: ${response.status}`);
  const blob = await response.blob();

  const imageBitmap = await createImageBitmap(blob);
  const originalWidth = imageBitmap.width;
  const originalHeight = imageBitmap.height;

  const canvas = new OffscreenCanvas(INPUT_SIZE, INPUT_SIZE);
  const ctx = canvas.getContext('2d')!;

  const scale = Math.min(INPUT_SIZE / originalWidth, INPUT_SIZE / originalHeight);
  const scaledWidth = originalWidth * scale;
  const scaledHeight = originalHeight * scale;
  const offsetX = (INPUT_SIZE - scaledWidth) / 2;
  const offsetY = (INPUT_SIZE - scaledHeight) / 2;

  ctx.fillStyle = '#808080';
  ctx.fillRect(0, 0, INPUT_SIZE, INPUT_SIZE);
  ctx.drawImage(imageBitmap, offsetX, offsetY, scaledWidth, scaledHeight);
  imageBitmap.close();

  const imageData = ctx.getImageData(0, 0, INPUT_SIZE, INPUT_SIZE);
  const pixels = imageData.data;
  const float32Data = new Float32Array(3 * INPUT_SIZE * INPUT_SIZE);

  for (let i = 0; i < INPUT_SIZE * INPUT_SIZE; i++) {
    const pixelIndex = i * 4;
    float32Data[i] = pixels[pixelIndex] / 255;
    float32Data[i + INPUT_SIZE * INPUT_SIZE] = pixels[pixelIndex + 1] / 255;
    float32Data[i + 2 * INPUT_SIZE * INPUT_SIZE] = pixels[pixelIndex + 2] / 255;
  }

  return {
    tensor: new ort.Tensor('float32', float32Data, [1, 3, INPUT_SIZE, INPUT_SIZE]),
    originalWidth,
    originalHeight,
  };
}

// Convert image to base64
async function getImageAsBase64(imageUrl: string): Promise<string> {
  const response = await fetch(imageUrl);
  if (!response.ok) throw new Error(`Failed to fetch image: ${response.status}`);
  const blob = await response.blob();

  const imageBitmap = await createImageBitmap(blob);

  // Scale down large images
  const maxDim = 1500;
  let width = imageBitmap.width;
  let height = imageBitmap.height;
  const currentMax = Math.max(width, height);

  if (currentMax > maxDim) {
    const scale = maxDim / currentMax;
    width = Math.round(width * scale);
    height = Math.round(height * scale);
  }

  const canvas = new OffscreenCanvas(width, height);
  const ctx = canvas.getContext('2d')!;
  ctx.drawImage(imageBitmap, 0, 0, width, height);
  imageBitmap.close();

  const outputBlob = await canvas.convertToBlob({ type: 'image/jpeg', quality: 0.85 });
  const arrayBuffer = await outputBlob.arrayBuffer();
  const bytes = new Uint8Array(arrayBuffer);

  let binary = '';
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

// Crop bubble
async function cropBubbleToBase64(
  imageUrl: string,
  bubble: BubbleDetection,
  padding: number = 20,
  originalWidth?: number,
  originalHeight?: number
): Promise<string> {
  const response = await fetch(imageUrl);
  if (!response.ok) throw new Error(`Failed to fetch image: ${response.status}`);
  const blob = await response.blob();

  const imageBitmap = await createImageBitmap(blob);

  let scaleX = 1;
  let scaleY = 1;

  if (originalWidth && originalHeight && (imageBitmap.width !== originalWidth || imageBitmap.height !== originalHeight)) {
    scaleX = imageBitmap.width / originalWidth;
    scaleY = imageBitmap.height / originalHeight;
  }

  const x1 = Math.max(0, (bubble.bbox.x1 * scaleX) - padding);
  const y1 = Math.max(0, (bubble.bbox.y1 * scaleY) - padding);
  const x2 = Math.min(imageBitmap.width, (bubble.bbox.x2 * scaleX) + padding);
  const y2 = Math.min(imageBitmap.height, (bubble.bbox.y2 * scaleY) + padding);

  const width = x2 - x1;
  const height = y2 - y1;

  const canvas = new OffscreenCanvas(width, height);
  const ctx = canvas.getContext('2d')!;
  ctx.drawImage(imageBitmap, x1, y1, width, height, 0, 0, width, height);
  imageBitmap.close();

  const outputBlob = await canvas.convertToBlob({ type: 'image/jpeg', quality: 0.9 });
  const arrayBuffer = await outputBlob.arrayBuffer();
  const bytes = new Uint8Array(arrayBuffer);

  let binary = '';
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

// Helper functions
function sigmoid(x: number): number {
  return 1 / (1 + Math.exp(-x));
}

function maskToSvgPath(mask: Float32Array, maskWidth: number, maskHeight: number, threshold: number = 0.5): string {
  const points: { x: number; y: number }[] = [];
  const step = 2;

  for (let y = 0; y < maskHeight; y += step) {
    for (let x = 0; x < maskWidth; x += step) {
      const idx = y * maskWidth + x;
      const val = mask[idx];

      if (val > threshold) {
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

  const cx = points.reduce((s, p) => s + p.x, 0) / points.length;
  const cy = points.reduce((s, p) => s + p.y, 0) / points.length;

  points.sort((a, b) => Math.atan2(a.y - cy, a.x - cx) - Math.atan2(b.y - cy, b.x - cx));

  return `polygon(${points.map(p => `${p.x.toFixed(1)}% ${p.y.toFixed(1)}%`).join(', ')})`;
}

function nms(boxes: BubbleDetection[], iouThreshold: number = 0.5): BubbleDetection[] {
  if (boxes.length === 0) return [];

  const sorted = [...boxes].sort((a, b) => b.confidence - a.confidence);
  const keep: BubbleDetection[] = [];
  const used = new Set<number>();

  for (let i = 0; i < sorted.length; i++) {
    if (used.has(i)) continue;
    keep.push(sorted[i]);

    for (let j = i + 1; j < sorted.length; j++) {
      if (used.has(j)) continue;
      const iou = calculateIoU(sorted[i], sorted[j]);
      if (iou > iouThreshold) used.add(j);
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

  return intersection / (areaA + areaB - intersection);
}

function parseOutput(
  output: ort.Tensor,
  maskProtos: ort.Tensor | undefined,
  originalWidth: number,
  originalHeight: number,
  confidenceThreshold: number
): BubbleDetection[] {
  const data = output.data as Float32Array;
  const [, , numBoxes] = output.dims;
  const detections: BubbleDetection[] = [];

  const scale = Math.min(INPUT_SIZE / originalWidth, INPUT_SIZE / originalHeight);
  const scaledWidth = originalWidth * scale;
  const scaledHeight = originalHeight * scale;
  const offsetX = (INPUT_SIZE - scaledWidth) / 2;
  const offsetY = (INPUT_SIZE - scaledHeight) / 2;

  const protoData = maskProtos?.data as Float32Array | undefined;
  const protoDims = maskProtos?.dims;
  const numMaskCoeffs = 32;
  const maskH = protoDims ? Number(protoDims[2]) : 160;
  const maskW = protoDims ? Number(protoDims[3]) : 160;

  for (let i = 0; i < numBoxes; i++) {
    const xCenter = data[0 * numBoxes + i];
    const yCenter = data[1 * numBoxes + i];
    const width = data[2 * numBoxes + i];
    const height = data[3 * numBoxes + i];
    const confidence = data[4 * numBoxes + i];

    if (confidence < confidenceThreshold) continue;

    const x1Letterbox = xCenter - width / 2;
    const y1Letterbox = yCenter - height / 2;
    const x2Letterbox = xCenter + width / 2;
    const y2Letterbox = yCenter + height / 2;

    const x1 = (x1Letterbox - offsetX) / scale;
    const y1 = (y1Letterbox - offsetY) / scale;
    const x2 = (x2Letterbox - offsetX) / scale;
    const y2 = (y2Letterbox - offsetY) / scale;

    const clampedX1 = Math.max(0, Math.min(originalWidth, x1));
    const clampedY1 = Math.max(0, Math.min(originalHeight, y1));
    const clampedX2 = Math.max(0, Math.min(originalWidth, x2));
    const clampedY2 = Math.max(0, Math.min(originalHeight, y2));

    let maskPath: string | undefined;

    if (protoData && protoDims) {
      try {
        const maskCoeffs: number[] = [];
        for (let c = 0; c < numMaskCoeffs; c++) {
          maskCoeffs.push(data[(5 + c) * numBoxes + i]);
        }

        const mask = new Float32Array(maskH * maskW);
        for (let y = 0; y < maskH; y++) {
          for (let x = 0; x < maskW; x++) {
            let val = 0;
            for (let c = 0; c < numMaskCoeffs; c++) {
              val += maskCoeffs[c] * protoData[c * maskH * maskW + y * maskW + x];
            }
            mask[y * maskW + x] = sigmoid(val);
          }
        }

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
      } catch {
        // Ignore mask errors
      }
    }

    detections.push({
      x: (clampedX1 + clampedX2) / 2 / originalWidth,
      y: (clampedY1 + clampedY2) / 2 / originalHeight,
      width: (clampedX2 - clampedX1) / originalWidth,
      height: (clampedY2 - clampedY1) / originalHeight,
      confidence,
      bbox: { x1: clampedX1, y1: clampedY1, x2: clampedX2, y2: clampedY2 },
      maskPath,
    });
  }

  return detections;
}

async function detectBubbles(
  imageUrl: string,
  confidenceThreshold: number = 0.5,
  nmsThreshold: number = 0.5
): Promise<DetectionResult> {

  const model = await loadModel();
  const startTime = performance.now();

  const { tensor, originalWidth, originalHeight } = await preprocessImage(imageUrl);

  const feeds: Record<string, ort.Tensor> = {};
  feeds[model.inputNames[0]] = tensor;

  const results = await model.run(feeds);
  const output0 = results[model.outputNames[0]];
  const output1 = results[model.outputNames[1]];

  const rawDetections = parseOutput(output0, output1, originalWidth, originalHeight, confidenceThreshold);

  const bubbles = nms(rawDetections, nmsThreshold);

  const inferenceTime = performance.now() - startTime;

  if (bubbles.length > 0) {
  }

  return { bubbles, imageWidth: originalWidth, imageHeight: originalHeight, inferenceTime };
}

// ============================================================================
// PaddleOCR Implementation
// ============================================================================

async function downloadAndCache(url: string, key: string): Promise<ArrayBuffer> {
  // Check cache first
  try {
    const db = await openModelDB();
    const cached = await new Promise<ArrayBuffer | null>((resolve, reject) => {
      const transaction = db.transaction(MODEL_STORE_NAME, 'readonly');
      const store = transaction.objectStore(MODEL_STORE_NAME);
      const request = store.get(key);
      request.onerror = () => reject(request.error);
      request.onsuccess = () => resolve(request.result || null);
    });
    if (cached) return cached;
  } catch {
    // Continue to download
  }

  // Download
  const response = await fetch(url);
  if (!response.ok) throw new Error(`Failed to download: ${response.status}`);
  const data = await response.arrayBuffer();

  // Cache
  try {
    const db = await openModelDB();
    await new Promise<void>((resolve, reject) => {
      const transaction = db.transaction(MODEL_STORE_NAME, 'readwrite');
      const store = transaction.objectStore(MODEL_STORE_NAME);
      const request = store.put(data, key);
      request.onerror = () => reject(request.error);
      request.onsuccess = () => resolve();
    });
  } catch {
    // Ignore cache errors
  }

  return data;
}

async function loadPaddleDict(): Promise<string[]> {
  if (paddleDict) return paddleDict;

  // Check cache first
  try {
    const db = await openModelDB();
    const cached = await new Promise<string | null>((resolve, reject) => {
      const transaction = db.transaction(MODEL_STORE_NAME, 'readonly');
      const store = transaction.objectStore(MODEL_STORE_NAME);
      const request = store.get(PADDLE_DICT_KEY);
      request.onerror = () => reject(request.error);
      request.onsuccess = () => resolve(request.result || null);
    });
    if (cached) {
      paddleDict = cached.split('\n').filter(line => line.trim());
      return paddleDict;
    }
  } catch {
    // Continue to download
  }

  // Download
  const response = await fetch(PADDLE_DICT_URL);
  if (!response.ok) throw new Error(`Failed to download dict: ${response.status}`);
  const text = await response.text();

  // Cache
  try {
    const db = await openModelDB();
    await new Promise<void>((resolve, reject) => {
      const transaction = db.transaction(MODEL_STORE_NAME, 'readwrite');
      const store = transaction.objectStore(MODEL_STORE_NAME);
      const request = store.put(text, PADDLE_DICT_KEY);
      request.onerror = () => reject(request.error);
      request.onsuccess = () => resolve();
    });
  } catch {
    // Ignore cache errors
  }

  paddleDict = text.split('\n').filter(line => line.trim());
  return paddleDict;
}

async function loadPaddleDetModel(): Promise<ort.InferenceSession> {
  if (paddleDetSession) return paddleDetSession;
  if (paddleDetLoading) return paddleDetLoading;

  paddleDetLoading = (async () => {
    const modelData = await downloadAndCache(PADDLE_DET_URL, PADDLE_DET_KEY);
    paddleDetSession = await ort.InferenceSession.create(modelData, {
      executionProviders: ['wasm'],
      graphOptimizationLevel: 'all',
    });
    return paddleDetSession;
  })();

  return paddleDetLoading;
}

async function loadPaddleRecModel(): Promise<ort.InferenceSession> {
  if (paddleRecSession) return paddleRecSession;
  if (paddleRecLoading) return paddleRecLoading;

  paddleRecLoading = (async () => {
    const modelData = await downloadAndCache(PADDLE_REC_URL, PADDLE_REC_KEY);
    paddleRecSession = await ort.InferenceSession.create(modelData, {
      executionProviders: ['wasm'],
      graphOptimizationLevel: 'all',
    });
    return paddleRecSession;
  })();

  return paddleRecLoading;
}

// Preprocess image for PaddleOCR detection
async function preprocessForDetection(imageUrl: string): Promise<{
  tensor: ort.Tensor;
  originalWidth: number;
  originalHeight: number;
  resizeRatio: number;
}> {
  const response = await fetch(imageUrl);
  if (!response.ok) throw new Error(`Failed to fetch image: ${response.status}`);
  const blob = await response.blob();
  const imageBitmap = await createImageBitmap(blob);

  const originalWidth = imageBitmap.width;
  const originalHeight = imageBitmap.height;

  // Resize to max dimension 960 while maintaining aspect ratio
  const maxDim = 960;
  let newWidth = originalWidth;
  let newHeight = originalHeight;
  const resizeRatio = Math.min(maxDim / originalWidth, maxDim / originalHeight, 1);

  if (resizeRatio < 1) {
    newWidth = Math.round(originalWidth * resizeRatio);
    newHeight = Math.round(originalHeight * resizeRatio);
  }

  // Make dimensions divisible by 32 (required by PaddleOCR)
  newWidth = Math.ceil(newWidth / 32) * 32;
  newHeight = Math.ceil(newHeight / 32) * 32;

  const canvas = new OffscreenCanvas(newWidth, newHeight);
  const ctx = canvas.getContext('2d')!;
  ctx.drawImage(imageBitmap, 0, 0, newWidth, newHeight);
  imageBitmap.close();

  const imageData = ctx.getImageData(0, 0, newWidth, newHeight);
  const pixels = imageData.data;

  // Normalize: (pixel / 255 - mean) / std
  const mean = [0.485, 0.456, 0.406];
  const std = [0.229, 0.224, 0.225];
  const float32Data = new Float32Array(3 * newWidth * newHeight);

  for (let i = 0; i < newWidth * newHeight; i++) {
    const pixelIndex = i * 4;
    float32Data[i] = (pixels[pixelIndex] / 255 - mean[0]) / std[0];
    float32Data[i + newWidth * newHeight] = (pixels[pixelIndex + 1] / 255 - mean[1]) / std[1];
    float32Data[i + 2 * newWidth * newHeight] = (pixels[pixelIndex + 2] / 255 - mean[2]) / std[2];
  }

  return {
    tensor: new ort.Tensor('float32', float32Data, [1, 3, newHeight, newWidth]),
    originalWidth,
    originalHeight,
    resizeRatio: newWidth / originalWidth,
  };
}

// Post-process detection output to get text boxes
function postProcessDetection(
  output: ort.Tensor,
  originalWidth: number,
  originalHeight: number,
  resizeRatio: number,
  threshold: number = 0.3
): number[][][] {
  const data = output.data as Float32Array;
  const [, , height, width] = output.dims;

  // Create binary mask
  const boxes: number[][][] = [];

  // Find contours in the probability map
  // Simple approach: find connected components above threshold
  const visited = new Set<number>();
  const directions = [[-1, 0], [1, 0], [0, -1], [0, 1]];

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const idx = y * width + x;
      if (visited.has(idx) || data[idx] < threshold) continue;

      // BFS to find connected component
      const component: { x: number; y: number }[] = [];
      const queue = [{ x, y }];
      visited.add(idx);

      while (queue.length > 0) {
        const current = queue.shift()!;
        component.push(current);

        for (const [dx, dy] of directions) {
          const nx = current.x + dx;
          const ny = current.y + dy;
          if (nx < 0 || nx >= width || ny < 0 || ny >= height) continue;
          const nidx = ny * width + nx;
          if (visited.has(nidx) || data[nidx] < threshold) continue;
          visited.add(nidx);
          queue.push({ x: nx, y: ny });
        }
      }

      // Skip small components
      if (component.length < 10) continue;

      // Get bounding box of component
      let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
      for (const p of component) {
        minX = Math.min(minX, p.x);
        minY = Math.min(minY, p.y);
        maxX = Math.max(maxX, p.x);
        maxY = Math.max(maxY, p.y);
      }

      // Convert to original image coordinates
      const scaleX = originalWidth / width;
      const scaleY = originalHeight / height;

      const box = [
        [minX * scaleX, minY * scaleY],
        [maxX * scaleX, minY * scaleY],
        [maxX * scaleX, maxY * scaleY],
        [minX * scaleX, maxY * scaleY],
      ];

      boxes.push(box);
    }
  }

  return boxes;
}

// Crop and preprocess text region for recognition
async function cropForRecognition(
  imageUrl: string,
  box: number[][]
): Promise<ort.Tensor> {
  const response = await fetch(imageUrl);
  if (!response.ok) throw new Error(`Failed to fetch image: ${response.status}`);
  const blob = await response.blob();
  const imageBitmap = await createImageBitmap(blob);

  // Get bounding rect
  const xs = box.map(p => p[0]);
  const ys = box.map(p => p[1]);
  const x1 = Math.max(0, Math.floor(Math.min(...xs)));
  const y1 = Math.max(0, Math.floor(Math.min(...ys)));
  const x2 = Math.min(imageBitmap.width, Math.ceil(Math.max(...xs)));
  const y2 = Math.min(imageBitmap.height, Math.ceil(Math.max(...ys)));

  const cropWidth = x2 - x1;
  const cropHeight = y2 - y1;

  if (cropWidth <= 0 || cropHeight <= 0) {
    imageBitmap.close();
    throw new Error('Invalid crop region');
  }

  // Resize to height 48 (standard for PaddleOCR recognition)
  const targetHeight = 48;
  const targetWidth = Math.max(48, Math.round(cropWidth * targetHeight / cropHeight));

  const canvas = new OffscreenCanvas(targetWidth, targetHeight);
  const ctx = canvas.getContext('2d')!;
  ctx.fillStyle = '#FFFFFF';
  ctx.fillRect(0, 0, targetWidth, targetHeight);
  ctx.drawImage(imageBitmap, x1, y1, cropWidth, cropHeight, 0, 0, targetWidth, targetHeight);
  imageBitmap.close();

  const imageData = ctx.getImageData(0, 0, targetWidth, targetHeight);
  const pixels = imageData.data;

  // Normalize
  const float32Data = new Float32Array(3 * targetWidth * targetHeight);
  const mean = 0.5;
  const std = 0.5;

  for (let i = 0; i < targetWidth * targetHeight; i++) {
    const pixelIndex = i * 4;
    float32Data[i] = (pixels[pixelIndex] / 255 - mean) / std;
    float32Data[i + targetWidth * targetHeight] = (pixels[pixelIndex + 1] / 255 - mean) / std;
    float32Data[i + 2 * targetWidth * targetHeight] = (pixels[pixelIndex + 2] / 255 - mean) / std;
  }

  return new ort.Tensor('float32', float32Data, [1, 3, targetHeight, targetWidth]);
}

// Decode recognition output using CTC
function decodeRecognition(output: ort.Tensor, dict: string[]): { text: string; confidence: number } {
  const data = output.data as Float32Array;
  const [, seqLen, numClasses] = output.dims;

  let text = '';
  let totalConf = 0;
  let numChars = 0;
  let prevIdx = 0;

  for (let t = 0; t < seqLen; t++) {
    // Find max class at this timestep
    let maxIdx = 0;
    let maxVal = -Infinity;
    for (let c = 0; c < numClasses; c++) {
      const val = data[t * numClasses + c];
      if (val > maxVal) {
        maxVal = val;
        maxIdx = c;
      }
    }

    // CTC decoding: skip blank (index 0) and repeated characters
    if (maxIdx !== 0 && maxIdx !== prevIdx) {
      // Index 0 is blank, actual characters start from index 1
      if (maxIdx - 1 < dict.length) {
        text += dict[maxIdx - 1];
        totalConf += Math.exp(maxVal); // Convert from log prob
        numChars++;
      }
    }
    prevIdx = maxIdx;
  }

  return {
    text,
    confidence: numChars > 0 ? totalConf / numChars : 0,
  };
}

// Main OCR function
async function performOCR(imageUrl: string): Promise<OCRResult> {
  const startTime = performance.now();

  // Load models in parallel
  const [detModel, recModel, dict] = await Promise.all([
    loadPaddleDetModel(),
    loadPaddleRecModel(),
    loadPaddleDict(),
  ]);

  // Run detection
  const { tensor: detTensor, originalWidth, originalHeight, resizeRatio } = await preprocessForDetection(imageUrl);
  const detFeeds: Record<string, ort.Tensor> = {};
  detFeeds[detModel.inputNames[0]] = detTensor;
  const detResults = await detModel.run(detFeeds);
  const detOutput = detResults[detModel.outputNames[0]];

  // Get text boxes
  const textBoxes = postProcessDetection(detOutput, originalWidth, originalHeight, resizeRatio);

  // Recognize text in each box
  const boxes: TextBox[] = [];
  for (const box of textBoxes) {
    try {
      const recTensor = await cropForRecognition(imageUrl, box);
      const recFeeds: Record<string, ort.Tensor> = {};
      recFeeds[recModel.inputNames[0]] = recTensor;
      const recResults = await recModel.run(recFeeds);
      const recOutput = recResults[recModel.outputNames[0]];

      const { text, confidence } = decodeRecognition(recOutput, dict);

      if (text.trim()) {
        boxes.push({
          points: box,
          text: text.trim(),
          confidence,
        });
      }
    } catch {
      // Skip boxes that fail recognition
    }
  }

  const inferenceTime = performance.now() - startTime;

  return {
    boxes,
    imageWidth: originalWidth,
    imageHeight: originalHeight,
    inferenceTime,
  };
}

// Initialize WASM on load
configureWasm();

// Listen for messages from background script
chrome.runtime.onMessage.addListener((message: Record<string, unknown>, _sender: unknown, sendResponse: (response: unknown) => void) => {
  if (message.target !== 'offscreen') return;

  const handleMessage = async () => {
    try {
      switch (message.type) {
        case 'YOLO_DETECT': {
          const result = await detectBubbles(
            message.imageUrl as string,
            (message.confidenceThreshold as number) || 0.5,
            (message.nmsThreshold as number) || 0.5
          );
          return result;
        }
        case 'YOLO_GET_IMAGE_BASE64': {
          const base64 = await getImageAsBase64(message.imageUrl as string);
          return { base64 };
        }
        case 'YOLO_CROP_BUBBLE': {
          const base64 = await cropBubbleToBase64(
            message.imageUrl as string,
            message.bubble as BubbleDetection,
            (message.padding as number) || 20,
            message.originalWidth as number,
            message.originalHeight as number
          );
          return { base64 };
        }
        case 'PADDLE_OCR': {
          const result = await performOCR(message.imageUrl as string);
          return result;
        }
        default:
          return { error: 'Unknown message type' };
      }
    } catch (error) {
      console.error('[Offscreen YOLO] Error:', error);
      return { error: error instanceof Error ? error.message : String(error) };
    }
  };

  handleMessage().then(sendResponse);
  return true; // Keep channel open for async response
});

