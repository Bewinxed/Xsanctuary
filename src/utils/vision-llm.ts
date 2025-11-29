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
Return ONLY the translated text, nothing else. Keep it concise.
If there are sound effects (onomatopoeia), translate or romanize them.
If the bubble appears empty or you truly cannot read any text, respond with "[empty]".`;

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
    const text = data.choices?.[0]?.message?.content?.trim() || '';

    return { text };
  } catch (e) {
    return { text: '', error: e instanceof Error ? e.message : 'Unknown error' };
  }
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
