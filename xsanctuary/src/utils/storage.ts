import { storage } from 'wxt/utils/storage';

export type SoftAction = 'none' | 'hide' | 'blur' | 'uwu' | 'cat' | 'llm';
export type HardAction = 'none' | 'mute' | 'block';

export interface CountryRule {
  country: string;
  countryCode: string;
  softAction: SoftAction;
  hardAction: HardAction;
  llmPrompt?: string;
}

export interface Settings {
  rules: CountryRule[];
  openRouterApiKey: string;
  defaultLlmPrompt: string;
  enabled: boolean;
}

const defaultSettings: Settings = {
  rules: [],
  openRouterApiKey: '',
  defaultLlmPrompt: 'Rewrite this text in a funny way while keeping the meaning:',
  enabled: true,
};

// Storage items
export const settingsStorage = storage.defineItem<Settings>('local:settings', {
  fallback: defaultSettings,
});

// Helper functions
export async function getSettings(): Promise<Settings> {
  return await settingsStorage.getValue();
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
