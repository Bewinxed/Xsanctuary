/**
 * Whole-page bubble translation.
 *
 * Every bubble on a page is composited into a single numbered strip (see
 * composeBubbleSheet in the offscreen document) and translated in one call.
 * That matters for comics: a translator seeing one bubble in isolation cannot
 * resolve pronouns, honorifics, who is speaking, or a joke that pays off two
 * panels later. One image also costs far less than one request per bubble.
 *
 * Results come back through the AI SDK's elementStream, so each bubble is
 * validated and delivered the moment the model finishes it rather than after
 * the whole page is done.
 */
import { createOpenRouter } from '@openrouter/ai-sdk-provider';
import { Output, streamText } from 'ai';
import { z } from 'zod';

export const bubbleTranslationSchema = z.object({
  index: z.number().int().describe('The number printed beside the bubble in the strip'),
  text: z.string().describe('The translated line, kept short enough to fit the bubble'),
  // Colours are measured from the pixels, not asked for. These stay as an
  // optional fallback for bubbles the sampler declined to judge.
  textColor: z.string().optional(),
  bgColor: z.string().optional(),
});

export type BubbleTranslation = z.infer<typeof bubbleTranslationSchema>;

function buildPrompt(count: number, targetLanguage: string): string {
  return `This image is ${count} speech bubbles cropped from a single comic page and stacked in reading order. Each one has its number printed to its left.

Translate every bubble into ${targetLanguage}.

Because you can see all ${count} bubbles at once, use that: they are one continuous conversation. Keep pronouns, names, honorifics and speaker voice consistent across them, and let a line that sets up a joke or a reveal pay off correctly in the later bubble.

For each bubble return:
- index: the number printed beside it
- text: the translation, short enough to fit in the original bubble. Prefer a natural, idiomatic line over a literal one.

Return one entry for every bubble, numbered 1 to ${count}, even if a bubble is empty or unreadable. For those, use an empty string for text.`;
}

export interface PageTranslateOptions {
  apiKey: string;
  model: string;
  /** The composited strip, as a data URL or bare base64. */
  sheetBase64: string;
  bubbleCount: number;
  targetLanguage: string;
  /** Called as each bubble's translation is validated and ready. */
  onBubble: (bubble: BubbleTranslation) => void;
}

export async function translatePage(
  options: PageTranslateOptions
): Promise<{ translations: BubbleTranslation[]; error?: string }> {
  const { apiKey, model, sheetBase64, bubbleCount, targetLanguage, onBubble } = options;

  const openrouter = createOpenRouter({
    apiKey,
    headers: {
      'HTTP-Referer': 'https://github.com/Bewinxed/xsanctuary',
      'X-Title': 'XSanctuary',
    },
  });

  const data = sheetBase64.startsWith('data:')
    ? sheetBase64
    : `data:image/png;base64,${sheetBase64}`;

  const translations: BubbleTranslation[] = [];

  try {
    const { elementStream } = streamText({
      model: openrouter(model),
      output: Output.array({ element: bubbleTranslationSchema }),
      messages: [
        {
          role: 'user',
          content: [
            { type: 'text', text: buildPrompt(bubbleCount, targetLanguage) },
            { type: 'file', mediaType: 'image', data },
          ],
        },
      ],
    });

    // Each element arrives complete and schema-checked, so it can go straight
    // onto the page without waiting for the rest.
    for await (const bubble of elementStream) {
      translations.push(bubble);
      try {
        onBubble(bubble);
      } catch {
        // A failed delivery must not abort the remaining bubbles
      }
    }

    return { translations };
  } catch (error) {
    return {
      translations,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}
