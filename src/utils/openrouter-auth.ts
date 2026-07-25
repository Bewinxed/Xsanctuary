/**
 * OpenRouter OAuth (PKCE).
 *
 * Runs in the background worker because `identity.launchWebAuthFlow` isn't
 * available to content scripts, and the token exchange should happen somewhere
 * the code verifier never has to leave.
 */

const AUTH_URL = 'https://openrouter.ai/auth';
const TOKEN_URL = 'https://openrouter.ai/api/v1/auth/keys';

/** RFC 7636 unreserved characters. */
const VERIFIER_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-._~';

function randomVerifier(length = 64): string {
  const bytes = crypto.getRandomValues(new Uint8Array(length));
  let out = '';
  for (const byte of bytes) {
    out += VERIFIER_ALPHABET[byte % VERIFIER_ALPHABET.length];
  }
  return out;
}

/** base64url, without the padding or the +/ characters. */
function base64UrlEncode(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

async function createCodeChallenge(verifier: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier));
  return base64UrlEncode(digest);
}

export interface OAuthResult {
  key?: string;
  error?: string;
  canceled?: boolean;
}

/**
 * Opens OpenRouter's consent screen and trades the returned code for an API
 * key. Resolves with `canceled` when the user closes the window, which is a
 * normal outcome and shouldn't be surfaced as an error.
 */
export async function connectOpenRouter(): Promise<OAuthResult> {
  const verifier = randomVerifier();
  const challenge = await createCodeChallenge(verifier);

  // Chrome and Firefox both resolve this to a URL they intercept rather than
  // actually load, so nothing needs to be hosted.
  const redirectUri = browser.identity.getRedirectURL('openrouter');

  const authUrl =
    `${AUTH_URL}?callback_url=${encodeURIComponent(redirectUri)}` +
    `&code_challenge=${encodeURIComponent(challenge)}` +
    `&code_challenge_method=S256`;

  let redirect: string | undefined;

  try {
    redirect = await browser.identity.launchWebAuthFlow({
      url: authUrl,
      interactive: true,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    // Closing the window rejects rather than resolving, so read it as a cancel
    if (/cancel|closed|user did not approve/i.test(message)) {
      return { canceled: true };
    }
    return { error: message };
  }

  if (!redirect) return { canceled: true };

  const code = new URL(redirect).searchParams.get('code');
  if (!code) {
    const denied = new URL(redirect).searchParams.get('error');
    return denied ? { error: denied } : { canceled: true };
  }

  try {
    const response = await fetch(TOKEN_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        code,
        code_verifier: verifier,
        code_challenge_method: 'S256',
      }),
    });

    if (!response.ok) {
      const body = await response.text();
      return { error: `OpenRouter returned ${response.status}: ${body.slice(0, 200)}` };
    }

    const data = (await response.json()) as { key?: string };
    if (!data.key) return { error: 'OpenRouter did not return a key' };

    return { key: data.key };
  } catch (error) {
    return { error: error instanceof Error ? error.message : String(error) };
  }
}
