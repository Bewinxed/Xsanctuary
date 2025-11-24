// Text transformation utilities

// UwU speak transformation
export function toUwuSpeak(text: string): string {
  return text
    // Replace r and l with w
    .replace(/[rl]/g, 'w')
    .replace(/[RL]/g, 'W')
    // Replace n before vowels with ny
    .replace(/n([aeiou])/gi, 'ny$1')
    .replace(/N([aeiou])/gi, 'Ny$1')
    .replace(/N([AEIOU])/gi, 'NY$1')
    // Replace ove with uv
    .replace(/ove/g, 'uv')
    .replace(/OVE/g, 'UV')
    // Add stuttering occasionally
    .replace(/\b([a-zA-Z])/g, (match, letter) => {
      return Math.random() > 0.85 ? `${letter}-${letter}` : letter;
    })
    // Add expressions
    .replace(/[.!?]+$/gm, (match) => {
      const expressions = [' uwu', ' owo', ' >w<', ' ^w^', ' :3', ' nya~'];
      return match + expressions[Math.floor(Math.random() * expressions.length)];
    });
}

// Cat speak transformation
export function toCatSpeak(text: string): string {
  return text
    // Add nya~ at the end of sentences
    .replace(/([.!?]+)/g, ' nya~$1')
    // Replace now with meow
    .replace(/\bnow\b/gi, 'meow')
    // Replace me/my with mew/mya
    .replace(/\bme\b/g, 'mew')
    .replace(/\bME\b/g, 'MEW')
    .replace(/\bmy\b/g, 'mya')
    .replace(/\bMy\b/g, 'Mya')
    .replace(/\bMY\b/g, 'MYA')
    // Add purr occasionally
    .replace(/\b(is|are|was|were)\b/gi, (match) => {
      return Math.random() > 0.7 ? `${match} *purr*` : match;
    })
    // Add cat actions
    .replace(/\b(I|i)\b/g, (match) => {
      return Math.random() > 0.9 ? `${match} *stretches*` : match;
    });
}

// LLM transformation via OpenRouter
export async function toLlmTransform(
  text: string,
  apiKey: string,
  prompt: string,
  model: string = 'x-ai/grok-3-fast:free',
  onChunk?: (chunk: string) => void
): Promise<string> {
  if (!apiKey) {
    throw new Error('OpenRouter API key not configured');
  }

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
    console.error('[XSanctuary] OpenRouter error response:', errorText);
    throw new Error(`OpenRouter API error: ${response.status} - ${errorText}`);
  }

  const reader = response.body?.getReader();
  if (!reader) {
    throw new Error('No response body');
  }

  const decoder = new TextDecoder();
  let result = '';
  let buffer = '';

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    // Append to buffer and process complete lines
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split('\n');

    // Keep the last incomplete line in buffer
    buffer = lines.pop() || '';

    for (const line of lines) {
      if (!line.startsWith('data: ')) continue;

      const data = line.slice(6).trim();
      if (data === '[DONE]' || !data) continue;

      try {
        const parsed = JSON.parse(data);
        const content = parsed.choices?.[0]?.delta?.content;
        if (content) {
          result += content;
          onChunk?.(content);
        }
      } catch (e) {
        // Skip invalid JSON lines but log for debugging
        console.debug('[XSanctuary] Skipping invalid SSE line:', data);
      }
    }
  }

  // Process any remaining buffer
  if (buffer.startsWith('data: ')) {
    const data = buffer.slice(6).trim();
    if (data && data !== '[DONE]') {
      try {
        const parsed = JSON.parse(data);
        const content = parsed.choices?.[0]?.delta?.content;
        if (content) {
          result += content;
          onChunk?.(content);
        }
      } catch {
        // Ignore final incomplete chunk
      }
    }
  }

  return result;
}
