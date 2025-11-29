import { getLlmCacheKey, getCachedLlmResponse, setCachedLlmResponse, clearLlmCache } from '@/utils/cache';
import {
  fetchAvailableModels,
  translateBubbleText,
  translateFullImage,
  type OpenRouterModel,
} from '@/utils/vision-llm';

// Chrome types for offscreen API (not in standard webextension-polyfill)
declare const chrome: typeof globalThis.chrome;

// Offscreen document management
let creatingOffscreen: Promise<void> | null = null;

async function ensureOffscreenDocument() {
  const offscreenUrl = 'offscreen.html';

  // Check if offscreen document already exists
  // @ts-expect-error - chrome.offscreen types may not be available
  const existingContexts = await chrome.runtime.getContexts({
    contextTypes: ['OFFSCREEN_DOCUMENT'],
    documentUrls: [chrome.runtime.getURL(offscreenUrl)],
  });

  if (existingContexts.length > 0) {
    return; // Already exists
  }

  // Wait if another call is already creating it
  if (creatingOffscreen) {
    await creatingOffscreen;
    return;
  }

  // Create the offscreen document
  creatingOffscreen = chrome.offscreen.createDocument({
    url: offscreenUrl,
    reasons: [chrome.offscreen.Reason.WORKERS],
    justification: 'Run YOLO ML inference for comic bubble detection',
  });

  await creatingOffscreen;
  creatingOffscreen = null;
  console.log('[XSanctuary] Offscreen document created');
}

// Send message to offscreen document
async function sendToOffscreen(message: Record<string, unknown>) {
  await ensureOffscreenDocument();
  return chrome.runtime.sendMessage({ ...message, target: 'offscreen' });
}

export default defineBackground(() => {
  console.log('[XSanctuary] Background script loaded');

  // Handle all message types
  browser.runtime.onMessage.addListener((message, sender, sendResponse) => {
    // Ignore messages meant for offscreen
    if (message.target === 'offscreen') return;
    if (message.type === 'LLM_TRANSFORM') {
      handleLlmTransform(message, sender.tab?.id);
      return true; // Keep channel open for async response
    }

    if (message.type === 'FETCH_OPENROUTER_MODELS') {
      handleFetchModels(message.apiKey)
        .then(sendResponse)
        .catch((e) => sendResponse({ error: e.message }));
      return true;
    }

    if (message.type === 'VISION_TRANSLATE_BUBBLE') {
      handleTranslateBubble(message)
        .then(sendResponse)
        .catch((e) => sendResponse({ text: '', error: e.message }));
      return true;
    }

    if (message.type === 'VISION_TRANSLATE_IMAGE') {
      handleTranslateImage(message)
        .then(sendResponse)
        .catch((e) => sendResponse({ error: e.message }));
      return true;
    }

    if (message.type === 'CLEAR_LLM_CACHE') {
      clearLlmCache()
        .then(() => sendResponse({ success: true }))
        .catch((e) => sendResponse({ error: e.message }));
      return true;
    }

    // YOLO detection handlers - forward to offscreen document
    if (message.type === 'YOLO_DETECT') {
      console.log('[XSanctuary] Forwarding YOLO_DETECT to offscreen');
      sendToOffscreen(message)
        .then(sendResponse)
        .catch((e) => sendResponse({ error: e.message }));
      return true;
    }

    if (message.type === 'YOLO_GET_IMAGE_BASE64') {
      sendToOffscreen(message)
        .then(sendResponse)
        .catch((e) => sendResponse({ error: e.message }));
      return true;
    }

    if (message.type === 'YOLO_CROP_BUBBLE') {
      sendToOffscreen(message)
        .then(sendResponse)
        .catch((e) => sendResponse({ error: e.message }));
      return true;
    }
  });
});

// Handle fetching available models from OpenRouter
async function handleFetchModels(apiKey: string): Promise<{ models?: OpenRouterModel[]; error?: string }> {
  try {
    const models = await fetchAvailableModels(apiKey);
    return { models };
  } catch (e) {
    return { error: e instanceof Error ? e.message : 'Failed to fetch models' };
  }
}

// Handle bubble text translation
async function handleTranslateBubble(message: {
  apiKey: string;
  model: string;
  bubbleBase64: string;
  targetLanguage: string;
  cacheKey?: string;
  skipCache?: boolean;
}): Promise<{ text: string; textColor?: string; bgColor?: string; error?: string }> {
  const { apiKey, model, bubbleBase64, targetLanguage, cacheKey, skipCache } = message;

  // Check cache first (unless skipCache is true)
  if (cacheKey && !skipCache) {
    const cachedResult = await getCachedLlmResponse(cacheKey);
    if (cachedResult) {
      console.log('[XSanctuary] Using cached bubble translation:', cachedResult);
      // Try to parse as JSON (new format with colors)
      try {
        const parsed = JSON.parse(cachedResult);
        return { text: parsed.text, textColor: parsed.textColor, bgColor: parsed.bgColor };
      } catch {
        // Legacy cache entry (plain text)
        return { text: cachedResult };
      }
    }
  }

  console.log('[XSanctuary] Calling vision API with model:', model);
  console.log('[XSanctuary] Image size:', bubbleBase64.length, 'chars');

  const result = await translateBubbleText(apiKey, model, bubbleBase64, targetLanguage);

  console.log('[XSanctuary] Vision API result:', result);

  // Cache successful result (but not error responses like [empty] or [unreadable])
  if (cacheKey && result.text && !result.error && !result.text.startsWith('[')) {
    // Cache as JSON to preserve colors
    const cacheData = JSON.stringify({
      text: result.text,
      textColor: result.textColor,
      bgColor: result.bgColor,
    });
    await setCachedLlmResponse(cacheKey, cacheData);
    console.log('[XSanctuary] Cached bubble translation with colors');
  }

  return result;
}

// Handle full image translation
async function handleTranslateImage(message: {
  apiKey: string;
  imageBase64: string;
  targetLanguage: string;
  cacheKey?: string;
}): Promise<{ imageBase64?: string; error?: string }> {
  const { apiKey, imageBase64, targetLanguage, cacheKey } = message;

  // Check cache first
  if (cacheKey) {
    const cachedResult = await getCachedLlmResponse(cacheKey);
    if (cachedResult) {
      console.log('[XSanctuary] Using cached image translation');
      return { imageBase64: cachedResult };
    }
  }

  const result = await translateFullImage(apiKey, imageBase64, targetLanguage);

  // Cache successful result
  if (cacheKey && result.imageBase64 && !result.error) {
    await setCachedLlmResponse(cacheKey, result.imageBase64);
    console.log('[XSanctuary] Cached image translation');
  }

  return result;
}

async function handleLlmTransform(
  message: { text: string; apiKey: string; prompt: string; model: string; requestId: string },
  tabId?: number
) {
  if (!tabId) return;

  const { text, apiKey, prompt, model, requestId } = message;

  // Check cache first
  const cacheKey = getLlmCacheKey(text, prompt, model);
  const cachedResult = await getCachedLlmResponse(cacheKey);

  if (cachedResult) {
    console.log('[XSanctuary] Using cached LLM response');
    // Send cached result as a single chunk
    browser.tabs.sendMessage(tabId, {
      type: 'LLM_TRANSFORM_CHUNK',
      requestId,
      chunk: cachedResult,
    });
    browser.tabs.sendMessage(tabId, {
      type: 'LLM_TRANSFORM_DONE',
      requestId,
    });
    return;
  }

  try {
    const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
        'HTTP-Referer': 'https://github.com/xsanctuary',
        'X-Title': 'XSanctuary',
      },
      body: JSON.stringify({
        model,
        messages: [
          {
            role: 'system',
            content: 'You are a text transformer. You will be given text and a transformation instruction. Output only the transformed text, nothing else.',
          },
          {
            role: 'user',
            content: `${prompt}\n\nText to transform:\n${text}`,
          },
        ],
        stream: true,
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      browser.tabs.sendMessage(tabId, {
        type: 'LLM_TRANSFORM_ERROR',
        requestId,
        error: `API error: ${response.status} - ${errorText}`,
      });
      return;
    }

    const reader = response.body?.getReader();
    if (!reader) {
      browser.tabs.sendMessage(tabId, {
        type: 'LLM_TRANSFORM_ERROR',
        requestId,
        error: 'No response body',
      });
      return;
    }

    const decoder = new TextDecoder();
    let buffer = '';
    let fullResult = ''; // Accumulate for caching

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() || '';

      for (const line of lines) {
        if (!line.startsWith('data: ')) continue;

        const data = line.slice(6).trim();
        if (data === '[DONE]' || !data) continue;

        try {
          const parsed = JSON.parse(data);
          const content = parsed.choices?.[0]?.delta?.content;
          if (content) {
            fullResult += content;
            // Send chunk to content script
            browser.tabs.sendMessage(tabId, {
              type: 'LLM_TRANSFORM_CHUNK',
              requestId,
              chunk: content,
            });
          }
        } catch {
          // Skip invalid JSON
        }
      }
    }

    // Process remaining buffer
    if (buffer.startsWith('data: ')) {
      const data = buffer.slice(6).trim();
      if (data && data !== '[DONE]') {
        try {
          const parsed = JSON.parse(data);
          const content = parsed.choices?.[0]?.delta?.content;
          if (content) {
            fullResult += content;
            browser.tabs.sendMessage(tabId, {
              type: 'LLM_TRANSFORM_CHUNK',
              requestId,
              chunk: content,
            });
          }
        } catch {
          // Ignore
        }
      }
    }

    // Cache the result for future use
    if (fullResult) {
      await setCachedLlmResponse(cacheKey, fullResult);
      console.log('[XSanctuary] Cached LLM response');
    }

    // Signal completion
    browser.tabs.sendMessage(tabId, {
      type: 'LLM_TRANSFORM_DONE',
      requestId,
    });
  } catch (error) {
    browser.tabs.sendMessage(tabId, {
      type: 'LLM_TRANSFORM_ERROR',
      requestId,
      error: error instanceof Error ? error.message : 'Unknown error',
    });
  }
}
