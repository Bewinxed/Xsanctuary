import { getLlmCacheKey, getCachedLlmResponse, setCachedLlmResponse } from '@/utils/cache';

export default defineBackground(() => {
  console.log('[XSanctuary] Background script loaded');

  // Handle LLM transform requests with streaming
  browser.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message.type === 'LLM_TRANSFORM') {
      handleLlmTransform(message, sender.tab?.id);
      return true; // Keep channel open for async response
    }
  });
});

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
