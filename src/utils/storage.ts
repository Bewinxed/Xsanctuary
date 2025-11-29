import { storage } from 'wxt/utils/storage';

export type SoftAction = 'none' | 'hide' | 'blur' | 'uwu' | 'cat' | 'llm';
export type HardAction = 'none' | 'mute' | 'block';

export interface CountryRule {
  country: string;
  countryCode: string;
  softAction: SoftAction;
  hardAction: HardAction;
  llmPrompt?: string;
  deceptionOnly?: boolean; // Only apply if user has flag emojis that don't match their actual country
  vpnOnly?: boolean; // Only apply if user is using VPN (location_accurate: false)
  pausedUntil?: number; // Timestamp when pause expires
  excludedUsers?: string[]; // List of screen names excluded from this rule
}

export type Theme = 'light' | 'dark' | 'system';

export type ComicTranslationMode = 'bubble' | 'auto';
export type ComicTriggerMode = 'button' | 'auto';

export interface ComicTranslationSettings {
  enabled: boolean;
  mode: ComicTranslationMode;
  targetLanguage: string;
  triggerMode: ComicTriggerMode;
  bubbleModel: string; // User-selected model for bubble OCR
  confidenceThreshold: number; // Detection confidence 0.1 to 1.0
}

export interface Settings {
  rules: CountryRule[];
  openRouterApiKey: string;
  defaultLlmPrompt: string;
  llmModel: string;
  enabled: boolean;
  theme: Theme;
  comicTranslation: ComicTranslationSettings;
}

const defaultComicTranslationSettings: ComicTranslationSettings = {
  enabled: false,
  mode: 'bubble',
  targetLanguage: 'en',
  triggerMode: 'button',
  bubbleModel: 'google/gemini-2.5-flash',
  confidenceThreshold: 0.3, // Default 0.3 for more sensitive detection
};

const defaultSettings: Settings = {
  rules: [],
  openRouterApiKey: '',
  defaultLlmPrompt: 'Rewrite this text in a funny way while keeping the meaning:',
  llmModel: 'x-ai/grok-3-fast:free',
  enabled: true,
  theme: 'system',
  comicTranslation: defaultComicTranslationSettings,
};

// Storage items
export const settingsStorage = storage.defineItem<Settings>('local:settings', {
  fallback: defaultSettings,
});

// Helper to convert object with numeric keys back to array
function ensureArray<T>(value: T[] | Record<string, T> | undefined | null): T[] {
  if (!value) return [];
  if (Array.isArray(value)) return value;
  // Convert object with numeric keys to array
  if (typeof value === 'object') {
    return Object.values(value);
  }
  return [];
}

// Helper functions
export async function getSettings(): Promise<Settings> {
  const stored = await settingsStorage.getValue();

  // Merge with defaults to ensure all fields exist
  // Note: Chrome storage can convert arrays to objects with numeric keys
  const settings: Settings = {
    ...defaultSettings,
    ...stored,
    rules: ensureArray(stored?.rules as CountryRule[] | Record<string, CountryRule>),
    comicTranslation: {
      ...defaultComicTranslationSettings,
      ...(stored?.comicTranslation || {}),
    },
  };

  return settings;
}

export async function saveSettings(settings: Settings): Promise<void> {
  await settingsStorage.setValue(settings);
}

export async function addRule(rule: CountryRule): Promise<void> {
  const settings = await getSettings();
  // Remove existing rule for the same country if exists
  settings.rules = settings.rules.filter(r => r.countryCode !== rule.countryCode);
  settings.rules.push(rule);
  await saveSettings(settings);
}

export async function removeRule(countryCode: string): Promise<void> {
  const settings = await getSettings();
  settings.rules = settings.rules.filter(r => r.countryCode !== countryCode);
  await saveSettings(settings);
}

export async function getRuleForCountry(countryCode: string): Promise<CountryRule | undefined> {
  const settings = await getSettings();
  return settings.rules.find(r => r.countryCode === countryCode);
}

export async function setApiKey(apiKey: string): Promise<void> {
  const settings = await getSettings();
  settings.openRouterApiKey = apiKey;
  await saveSettings(settings);
}

export async function setEnabled(enabled: boolean): Promise<void> {
  const settings = await getSettings();
  settings.enabled = enabled;
  await saveSettings(settings);
}

export async function updateComicTranslationSettings(
  updates: Partial<ComicTranslationSettings>
): Promise<void> {
  const settings = await getSettings();
  settings.comicTranslation = {
    ...settings.comicTranslation,
    ...updates,
  };
  await saveSettings(settings);
}

export async function getComicTranslationSettings(): Promise<ComicTranslationSettings> {
  const settings = await getSettings();
  return settings.comicTranslation;
}
