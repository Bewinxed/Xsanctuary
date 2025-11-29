// OpenRouter Vision LLM utilities

export interface OpenRouterModel {
  id: string;
  name: string;
  description?: string;
  pricing: {
    prompt: string;
    completion: string;
    image?: string;
  };
  context_length: number;
  architecture?: {
    modality?: string;
    input_modalities?: string[];
    output_modalities?: string[];
  };
}

export interface TranslationResult {
  text: string;
  textColor?: string; // Hex color of original text
  bgColor?: string; // Hex color of bubble background
  error?: string;
}

export interface ImageGenerationResult {
  imageBase64?: string;
  error?: string;
}

// Cache for OpenRouter models
let modelsCache: OpenRouterModel[] | null = null;
let modelsCacheTime = 0;
const MODELS_CACHE_TTL = 60 * 60 * 1000; // 1 hour

/**
 * Fetch available models from OpenRouter API
 * Filters to only vision-capable models
 */
export async function fetchAvailableModels(apiKey: string): Promise<OpenRouterModel[]> {
  // Return cached models if still valid
  if (modelsCache && Date.now() - modelsCacheTime < MODELS_CACHE_TTL) {
    return modelsCache;
  }

  const response = await fetch('https://openrouter.ai/api/v1/models', {
    headers: {
      Authorization: `Bearer ${apiKey}`,
    },
  });

  if (!response.ok) {
    throw new Error(`Failed to fetch models: ${response.status}`);
  }

  const data = await response.json();
  const models: OpenRouterModel[] = data.data || [];

  // Filter to vision-capable models (can accept image input)
  const visionModels = models.filter((model) => {
    const inputModalities = model.architecture?.input_modalities || [];
    const modality = model.architecture?.modality || '';

    // Check if model supports image input
    return (
      inputModalities.includes('image') ||
      modality.includes('multimodal') ||
      model.id.includes('vision') ||
      model.id.includes('gpt-4o') ||
      model.id.includes('claude-3') ||
      model.id.includes('gemini')
    );
  });

  // Sort by name
  visionModels.sort((a, b) => a.name.localeCompare(b.name));

  // Cache results
  modelsCache = visionModels;
  modelsCacheTime = Date.now();

  return visionModels;
}

/**
 * Get image generation capable models
 */
export async function fetchImageGenerationModels(apiKey: string): Promise<OpenRouterModel[]> {
  const allModels = await fetchAvailableModels(apiKey);

  // Filter to models that can generate images
  return allModels.filter((model) => {
    const outputModalities = model.architecture?.output_modalities || [];
    return (
      outputModalities.includes('image') ||
      model.id.includes('gemini-2.5-flash-image') ||
      model.id.includes('dall-e')
    );
  });
}

/**
 * Translate text from a bubble image using a vision model
 * Returns translated text along with detected colors for styling
 */
export async function translateBubbleText(
  apiKey: string,
  model: string,
  bubbleBase64: string,
  targetLanguage: string
): Promise<TranslationResult> {
  const prompt = `Look at this speech bubble from a comic/manga.
The text may be in Japanese, Korean, Chinese, or another language.
The text may be vertical (top to bottom) or horizontal.
Extract ALL visible text and translate it to ${targetLanguage}.

Return ONLY a JSON object with these fields:
- "text": the translated text (keep it concise)
- "textColor": hex color of the original text (e.g. "#000000")
- "bgColor": hex color of the bubble background (e.g. "#FFFFFF")

If there are sound effects (onomatopoeia), translate or romanize them.
If the bubble appears empty or you truly cannot read any text, use "[empty]" for text.
If you can't determine colors, use defaults: textColor="#000000", bgColor="#FFFFFF"

Example response: {"text": "Hello!", "textColor": "#000000", "bgColor": "#FFFFFF"}`;

  try {
    const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
        'HTTP-Referer': 'https://github.com/xsanctuary',
        'X-Title': 'XSanctuary',
      },
      body: JSON.stringify({
        model,
        messages: [
          {
            role: 'user',
            content: [
              { type: 'text', text: prompt },
              {
                type: 'image_url',
                image_url: {
                  url: `data:image/png;base64,${bubbleBase64}`,
                },
              },
            ],
          },
        ],
        max_tokens: 500,
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      return { text: '', error: `API error: ${response.status} - ${errorText}` };
    }

    const data = await response.json();
    const content = data.choices?.[0]?.message?.content?.trim() || '';

    return parseTranslationResponse(content);
  } catch (e) {
    return { text: '', error: e instanceof Error ? e.message : 'Unknown error' };
  }
}

/**
 * Streaming version of translateBubbleText
 * Calls onChunk with partial text as it streams in
 */
export async function translateBubbleTextStreaming(
  apiKey: string,
  model: string,
  bubbleBase64: string,
  targetLanguage: string,
  onChunk: (partialText: string) => void
): Promise<TranslationResult> {
  const prompt = `Look at this speech bubble from a comic/manga.
The text may be in Japanese, Korean, Chinese, or another language.
The text may be vertical (top to bottom) or horizontal.
Extract ALL visible text and translate it to ${targetLanguage}.

Return ONLY a JSON object with these fields:
- "text": the translated text (keep it concise)
- "textColor": hex color of the original text (e.g. "#000000")
- "bgColor": hex color of the bubble background (e.g. "#FFFFFF")

If there are sound effects (onomatopoeia), translate or romanize them.
If the bubble appears empty or you truly cannot read any text, use "[empty]" for text.
If you can't determine colors, use defaults: textColor="#000000", bgColor="#FFFFFF"

Example response: {"text": "Hello!", "textColor": "#000000", "bgColor": "#FFFFFF"}`;

  try {
    const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
        'HTTP-Referer': 'https://github.com/xsanctuary',
        'X-Title': 'XSanctuary',
      },
      body: JSON.stringify({
        model,
        stream: true,
        messages: [
          {
            role: 'user',
            content: [
              { type: 'text', text: prompt },
              {
                type: 'image_url',
                image_url: {
                  url: `data:image/png;base64,${bubbleBase64}`,
                },
              },
            ],
          },
        ],
        max_tokens: 500,
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      return { text: '', error: `API error: ${response.status} - ${errorText}` };
    }

    // Read the SSE stream
    const reader = response.body?.getReader();
    if (!reader) {
      return { text: '', error: 'No response body' };
    }

    const decoder = new TextDecoder();
    let fullContent = '';
    let lastExtractedText = '';

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      const chunk = decoder.decode(value, { stream: true });
      const lines = chunk.split('\n');

      for (const line of lines) {
        if (line.startsWith('data: ')) {
          const data = line.slice(6);
          if (data === '[DONE]') continue;

          try {
            const parsed = JSON.parse(data);
            const delta = parsed.choices?.[0]?.delta?.content || '';
            if (delta) {
              fullContent += delta;

              // Try to extract partial text from JSON as it streams
              const partialText = extractPartialText(fullContent);
              if (partialText && partialText !== lastExtractedText) {
                lastExtractedText = partialText;
                onChunk(partialText);
              }
            }
          } catch {
            // Ignore JSON parse errors for incomplete chunks
          }
        }
      }
    }

    // Parse the complete response
    return parseTranslationResponse(fullContent);
  } catch (e) {
    return { text: '', error: e instanceof Error ? e.message : 'Unknown error' };
  }
}

/**
 * Extract partial text from a potentially incomplete JSON response
 */
function extractPartialText(content: string): string {
  // Try to find the "text" field value, even if JSON is incomplete
  // Match: "text": "some text here" or "text":"some text here"
  const textMatch = content.match(/"text"\s*:\s*"((?:[^"\\]|\\.)*)(?:"|$)/);
  if (textMatch) {
    // Unescape JSON string
    return textMatch[1]
      .replace(/\\n/g, '\n')
      .replace(/\\"/g, '"')
      .replace(/\\\\/g, '\\');
  }
  return '';
}

/**
 * Parse a complete translation response
 */
function parseTranslationResponse(content: string): TranslationResult {
  // Try to parse as JSON
  try {
    // Extract JSON from response (may be wrapped in markdown code blocks)
    const jsonMatch = content.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      const parsed = JSON.parse(jsonMatch[0]);
      return {
        text: parsed.text || '',
        textColor: parsed.textColor || '#000000',
        bgColor: parsed.bgColor || '#FFFFFF',
      };
    }
  } catch {
    // JSON parsing failed, fall back to treating content as plain text
  }

  // Fallback: return content as text with default colors
  return {
    text: content,
    textColor: '#000000',
    bgColor: '#FFFFFF',
  };
}

/**
 * Translate an entire comic image using Gemini Image (re-render with translated text)
 */
export async function translateFullImage(
  apiKey: string,
  imageBase64: string,
  targetLanguage: string
): Promise<ImageGenerationResult> {
  const prompt = `This is a comic/manga image with text in speech bubbles.
Please recreate this image with all text translated to ${targetLanguage}.
Keep the art style, characters, and layout exactly the same.
Only change the text in speech bubbles and any visible text to ${targetLanguage}.`;

  try {
    const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
        'HTTP-Referer': 'https://github.com/xsanctuary',
        'X-Title': 'XSanctuary',
      },
      body: JSON.stringify({
        model: 'google/gemini-2.5-flash-image',
        messages: [
          {
            role: 'user',
            content: [
              { type: 'text', text: prompt },
              {
                type: 'image_url',
                image_url: {
                  url: `data:image/png;base64,${imageBase64}`,
                },
              },
            ],
          },
        ],
        // Request image output
        response_format: { type: 'image' },
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      return { error: `API error: ${response.status} - ${errorText}` };
    }

    const data = await response.json();

    // Extract generated image from response
    // The format may vary - check for common patterns
    const content = data.choices?.[0]?.message?.content;

    if (typeof content === 'string') {
      // Check if content is base64 or contains image data
      if (content.startsWith('data:image')) {
        return { imageBase64: content.split(',')[1] };
      }
      // May be raw base64
      if (content.length > 1000 && !content.includes(' ')) {
        return { imageBase64: content };
      }
    }

    // Check for image in content array
    if (Array.isArray(content)) {
      for (const part of content) {
        if (part.type === 'image_url' || part.type === 'image') {
          const imageUrl = part.image_url?.url || part.url || part.data;
          if (imageUrl) {
            if (imageUrl.startsWith('data:image')) {
              return { imageBase64: imageUrl.split(',')[1] };
            }
            return { imageBase64: imageUrl };
          }
        }
      }
    }

    // Check data.image field (some APIs return this way)
    if (data.image) {
      return { imageBase64: data.image };
    }

    return { error: 'No image returned from API' };
  } catch (e) {
    return { error: e instanceof Error ? e.message : 'Unknown error' };
  }
}

/**
 * Get OCR text from an image (without translation)
 */
export async function extractTextFromImage(
  apiKey: string,
  model: string,
  imageBase64: string
): Promise<TranslationResult> {
  const prompt = `Extract all visible text from this image.
Return the text exactly as it appears, preserving line breaks.
If you cannot read any text, respond with "[no text found]".`;

  try {
    const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
        'HTTP-Referer': 'https://github.com/xsanctuary',
        'X-Title': 'XSanctuary',
      },
      body: JSON.stringify({
        model,
        messages: [
          {
            role: 'user',
            content: [
              { type: 'text', text: prompt },
              {
                type: 'image_url',
                image_url: {
                  url: `data:image/png;base64,${imageBase64}`,
                },
              },
            ],
          },
        ],
        max_tokens: 1000,
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      return { text: '', error: `API error: ${response.status} - ${errorText}` };
    }

    const data = await response.json();
    const text = data.choices?.[0]?.message?.content?.trim() || '';

    return { text };
  } catch (e) {
    return { text: '', error: e instanceof Error ? e.message : 'Unknown error' };
  }
}

// Clear models cache
export function clearModelsCache(): void {
  modelsCache = null;
  modelsCacheTime = 0;
}

// Default recommended models
export const DEFAULT_BUBBLE_MODEL = 'google/gemini-2.5-flash';
export const DEFAULT_IMAGE_MODEL = 'google/gemini-2.5-flash-image';

// Common languages for translation
export const SUPPORTED_LANGUAGES = [
  { code: 'en', name: 'English' },
  { code: 'ja', name: 'Japanese' },
  { code: 'ko', name: 'Korean' },
  { code: 'zh', name: 'Chinese (Simplified)' },
  { code: 'zh-TW', name: 'Chinese (Traditional)' },
  { code: 'es', name: 'Spanish' },
  { code: 'fr', name: 'French' },
  { code: 'de', name: 'German' },
  { code: 'it', name: 'Italian' },
  { code: 'pt', name: 'Portuguese' },
  { code: 'ru', name: 'Russian' },
  { code: 'ar', name: 'Arabic' },
  { code: 'th', name: 'Thai' },
  { code: 'vi', name: 'Vietnamese' },
  { code: 'id', name: 'Indonesian' },
] as const;
