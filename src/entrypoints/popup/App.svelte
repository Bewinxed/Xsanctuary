<script lang="ts">
  import { onMount, tick } from 'svelte';
  import { Button } from '$lib/components/ui/button';
  import { Switch } from '$lib/components/ui/switch';
  import * as Select from '$lib/components/ui/select';
  import * as Popover from '$lib/components/ui/popover';
  import * as Command from '$lib/components/ui/command';
  import * as Collapsible from '$lib/components/ui/collapsible';
  import { Input } from '$lib/components/ui/input';
  import { Label } from '$lib/components/ui/label';
  import { Separator } from '$lib/components/ui/separator';
  import { Slider } from '$lib/components/ui/slider';
  import * as Card from '$lib/components/ui/card';
  import { ScrollArea } from '$lib/components/ui/scroll-area';
  import { getSettings, saveSettings, type Settings, type CountryRule, type SoftAction, type HardAction, type Theme, type ComicTranslationSettings, type VideoDownloadSettings, type DefaultAudioFormat } from '@/utils/storage';
  import { allLocations, regions, type Country } from '@/utils/country-list';
  import { getCacheStats, clearCache } from '@/utils/cache';
  import { SUPPORTED_LANGUAGES, type OpenRouterModel } from '@/utils/vision-llm';
  import { Trash2, Plus, Shield, Database, ChevronsUpDown, Check, Settings as SettingsIcon, ChevronDown, ExternalLink, Sun, Moon, Monitor, Languages, Image as ImageIcon, Download, Flag } from 'lucide-svelte';

  let settings = $state<Settings>({
    rules: [],
    openRouterApiKey: '',
    defaultLlmPrompt: 'Rewrite this text in a funny way:',
    llmModel: 'x-ai/grok-3-fast:free',
    enabled: true,
    theme: 'system',
    comicTranslation: {
      enabled: false,
      mode: 'bubble',
      targetLanguage: 'en',
      triggerMode: 'button',
      bubbleModel: 'google/gemini-2.5-flash',
      confidenceThreshold: 0.3,
      bubbleShape: 'mask',
      showAllBubbles: false,
    },
    videoDownload: {
      enabled: true,
      rightClickMenu: true,
      defaultAudioFormat: 'm4a',
    },
    locationIntelligence: {
      enabled: false,
    },
  });

  let selectedCountry = $state<Country | undefined>(undefined);
  let cacheStats = $state({ total: 0, valid: 0 });
  let comboboxOpen = $state(false);
  let searchQuery = $state('');
  let settingsOpen = $state(false);
  let showApiKey = $state(false);
  let manualKeyOpen = $state(false);
  let connecting = $state(false);
  let authError = $state('');

  // Show enough of the key to recognise it, never enough to leak it
  const maskedKey = $derived(
    settings.openRouterApiKey
      ? `${settings.openRouterApiKey.slice(0, 8)}...${settings.openRouterApiKey.slice(-4)}`
      : ''
  );

  async function connectOpenRouter() {
    connecting = true;
    authError = '';

    try {
      const result = await browser.runtime.sendMessage({ type: 'OPENROUTER_CONNECT' });

      if (result?.success) {
        // The background worker wrote the key, so re-read rather than guessing
        settings = await getSettings();
      } else if (result?.error) {
        authError = result.error;
      }
      // A cancel is a deliberate user action, so it needs no error message
    } catch (e) {
      authError = e instanceof Error ? e.message : 'Could not reach OpenRouter';
    } finally {
      connecting = false;
    }
  }

  function disconnectOpenRouter() {
    settings.openRouterApiKey = '';
    authError = '';
    manualKeyOpen = false;
    save();
  }
  let models = $state<{ id: string; name: string; free?: boolean }[]>([
    { id: 'x-ai/grok-3-fast:free', name: 'Grok 3 Fast (Free)', free: true },
  ]);
  let modelError = $state('');
  let loadingModels = $state(false);
  let modelSearchQuery = $state('');
  let modelComboboxOpen = $state(false);

  // Comic translation settings state
  let comicSettingsOpen = $state(false);
  let videoSettingsOpen = $state(false);
  let visionModels = $state<OpenRouterModel[]>([]);
  let loadingVisionModels = $state(false);
  let visionModelSearchQuery = $state('');
  let visionModelComboboxOpen = $state(false);

  const filteredVisionModels = $derived(
    visionModelSearchQuery.trim() === ''
      ? visionModels
      : visionModels.filter(m =>
          m.name.toLowerCase().includes(visionModelSearchQuery.toLowerCase()) ||
          m.id.toLowerCase().includes(visionModelSearchQuery.toLowerCase())
        )
  );

  const filteredModels = $derived(
    modelSearchQuery.trim() === ''
      ? models
      : models.filter(m =>
          m.name.toLowerCase().includes(modelSearchQuery.toLowerCase()) ||
          m.id.toLowerCase().includes(modelSearchQuery.toLowerCase())
        )
  );

  const softActions: { value: SoftAction; label: string }[] = [
    { value: 'none', label: 'None' },
    { value: 'hide', label: 'Hide' },
    { value: 'blur', label: 'Blur' },
    { value: 'uwu', label: 'UwU' },
    { value: 'cat', label: 'Cat' },
    { value: 'llm', label: 'LLM' },
  ];

  const hardActions: { value: HardAction; label: string }[] = [
    { value: 'none', label: 'None' },
    { value: 'mute', label: 'Mute' },
    { value: 'block', label: 'Block' },
  ];

  onMount(async () => {
    settings = await getSettings();
    cacheStats = await getCacheStats();
    applyTheme(settings.theme);

    // Opening the popup counts as having read the update notice
    browser.runtime.sendMessage({ type: 'NOTICE_SEEN' }).catch(() => {});
  });

  function applyTheme(theme: Theme) {
    const root = document.documentElement;
    if (theme === 'system') {
      const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
      root.classList.toggle('dark', prefersDark);
    } else {
      root.classList.toggle('dark', theme === 'dark');
    }
  }

  function cycleTheme() {
    const themes: Theme[] = ['light', 'dark', 'system'];
    const currentIndex = themes.indexOf(settings.theme);
    settings.theme = themes[(currentIndex + 1) % themes.length];
    applyTheme(settings.theme);
    save();
  }

  // Watch for system theme changes
  $effect(() => {
    if (settings.theme === 'system') {
      const mediaQuery = window.matchMedia('(prefers-color-scheme: dark)');
      const handler = (e: MediaQueryListEvent) => applyTheme('system');
      mediaQuery.addEventListener('change', handler);
      return () => mediaQuery.removeEventListener('change', handler);
    }
  });

  async function save() {
    await saveSettings(settings);
  }

  function addRule() {
    const country = selectedCountry;
    if (!country) return;
    if (settings.rules.some(r => r.countryCode === country.code)) return;

    settings.rules = [...settings.rules, {
      country: country.name,
      countryCode: country.code,
      softAction: 'blur',
      hardAction: 'none',
    }];
    selectedCountry = undefined;
    save();
  }

  function removeRule(code: string) {
    settings.rules = settings.rules.filter(r => r.countryCode !== code);
    save();
  }

  function updateRule(code: string, field: keyof CountryRule, value: string | boolean | undefined) {
    // Guard against undefined values from Select components
    if (value === undefined) return;
    settings.rules = settings.rules.map(r =>
      r.countryCode === code ? { ...r, [field]: value } : r
    );
    save();
  }

  async function handleClearCache() {
    await clearCache();
    cacheStats = await getCacheStats();
  }

  function openShowcase() {
    browser.tabs.create({ url: browser.runtime.getURL('/showcase.html') });
  }

  function updateApiKey(e: Event) {
    settings.openRouterApiKey = (e.target as HTMLInputElement).value;
    save();
  }

  function updatePrompt(e: Event) {
    settings.defaultLlmPrompt = (e.target as HTMLInputElement).value;
    save();
  }

  async function fetchModels() {
    if (!settings.openRouterApiKey) return;

    loadingModels = true;
    modelError = '';
    try {
      const res = await fetch('https://openrouter.ai/api/v1/models', {
        headers: {
          'Authorization': `Bearer ${settings.openRouterApiKey}`,
        },
      });

      if (res.ok) {
        const data = await res.json();

        // Every model, not just the free ones. Filtering to ':free' left 18 of
        // 345 and made a live list look like a hardcoded stub.
        const all = (data.data || [])
          .map((m: any) => ({
            id: m.id,
            name: m.name || m.id,
            free: m.id.includes(':free') || m.pricing?.prompt === '0',
          }))
          // Free first so it stays easy to find, then alphabetical
          .sort((a: any, b: any) =>
            a.free === b.free ? a.name.localeCompare(b.name) : a.free ? -1 : 1
          );

        // Keep the current selection visible even if OpenRouter has dropped it,
        // otherwise the trigger shows a model the list does not contain.
        if (settings.llmModel && !all.some((m: any) => m.id === settings.llmModel)) {
          all.unshift({ id: settings.llmModel, name: settings.llmModel, free: false });
        }

        models = all;
      } else {
        modelError = `OpenRouter returned ${res.status}`;
      }
    } catch (e) {
      modelError = e instanceof Error ? e.message : 'Could not reach OpenRouter';
      console.error('Failed to fetch models:', e);
    } finally {
      loadingModels = false;
    }
  }

  function updateModel(modelId: string) {
    settings.llmModel = modelId;
    save();
  }

  // Comic translation functions
  async function fetchVisionModels() {
    if (!settings.openRouterApiKey) return;

    loadingVisionModels = true;
    try {
      const response = await browser.runtime.sendMessage({
        type: 'FETCH_OPENROUTER_MODELS',
        apiKey: settings.openRouterApiKey,
      });

      if (response.models) {
        visionModels = response.models;
        // Ensure default model is in list
        if (!visionModels.some(m => m.id === 'google/gemini-2.5-flash')) {
          visionModels.unshift({
            id: 'google/gemini-2.5-flash',
            name: 'Gemini 2.5 Flash',
            pricing: { prompt: '0', completion: '0' },
            context_length: 128000,
          });
        }
      }
    } catch (e) {
      console.error('Failed to fetch vision models:', e);
    } finally {
      loadingVisionModels = false;
    }
  }

  function updateComicTranslation<K extends keyof ComicTranslationSettings>(
    key: K,
    value: ComicTranslationSettings[K]
  ) {
    settings.comicTranslation = {
      ...settings.comicTranslation,
      [key]: value,
    };
    save();
  }

  function updateVideoDownload<K extends keyof VideoDownloadSettings>(
    key: K,
    value: VideoDownloadSettings[K]
  ) {
    settings.videoDownload = {
      ...settings.videoDownload,
      [key]: value,
    };
    save();
  }

  const AUDIO_FORMAT_OPTIONS: { value: DefaultAudioFormat; label: string; hint: string }[] = [
    { value: 'm4a', label: 'M4A', hint: 'Original quality, no re-encode' },
    { value: 'mp3', label: 'MP3', hint: 'Widest compatibility' },
    { value: 'opus', label: 'Opus', hint: 'Smallest files' },
    { value: 'wav', label: 'WAV', hint: 'Lossless, large' },
  ];

  // Auto-fetch vision models when dropdown opens
  $effect(() => {
    if (visionModelComboboxOpen && settings.openRouterApiKey && visionModels.length === 0) {
      fetchVisionModels();
    }
  });

  function getCountryFlag(code: string): string {
    return allLocations.find(c => c.code === code)?.flag || '🏳️';
  }

  // Check if a flag string is a URL or emoji
  function isFlagUrl(flag: string): boolean {
    return flag.startsWith('http://') || flag.startsWith('https://');
  }

  function selectCountry(location: Country) {
    selectedCountry = location;
    comboboxOpen = false;
    searchQuery = '';
  }

  // Auto-fetch models when dropdown opens
  $effect(() => {
    if (modelComboboxOpen && settings.openRouterApiKey && models.length <= 1) {
      fetchModels();
    }
  });

  const filteredLocations = $derived(
    searchQuery.trim() === ''
      ? allLocations
      : allLocations.filter(loc =>
          loc.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
          loc.code.toLowerCase().includes(searchQuery.toLowerCase())
        )
  );
</script>

<div class="w-[380px] bg-background text-foreground">
  <!-- Header -->
  <div class="flex items-center justify-between border-b p-3">
    <div class="flex items-center gap-2">
      <Shield class="h-5 w-5 text-primary" />
      <span class="font-semibold">XSanctuary</span>
    </div>
    <div class="flex items-center gap-3">
      <!-- Theme toggle -->
      <button
        onclick={cycleTheme}
        class="p-1.5 rounded-md hover:bg-secondary transition-colors"
        title={`Theme: ${settings.theme}`}
      >
        {#if settings.theme === 'light'}
          <Sun class="h-4 w-4 text-muted-foreground" />
        {:else if settings.theme === 'dark'}
          <Moon class="h-4 w-4 text-muted-foreground" />
        {:else}
          <Monitor class="h-4 w-4 text-muted-foreground" />
        {/if}
      </button>
      <!-- Enable/disable toggle -->
      <div class="flex items-center gap-2">
        <Label for="enabled" class="text-xs text-muted-foreground">
          {settings.enabled ? 'On' : 'Off'}
        </Label>
        <Switch
          id="enabled"
          checked={settings.enabled}
          onCheckedChange={(checked) => {
            settings.enabled = checked;
            save();
          }}
        />
      </div>
    </div>
  </div>

  <!-- Add Rule -->
  <div class="border-b p-3">
    <div class="flex gap-2">
      <Popover.Root bind:open={comboboxOpen}>
        <Popover.Trigger>
          <Button variant="outline" class="flex-1 justify-between min-w-[280px]">
            {#if selectedCountry}
              <span class="flex items-center gap-2">
                {#if isFlagUrl(selectedCountry.flag)}
                  <img src={selectedCountry.flag} alt={selectedCountry.name} class="w-4 h-3 object-cover" />
                {:else}
                  <span>{selectedCountry.flag}</span>
                {/if}
                {selectedCountry.name}
              </span>
            {:else}
              <span class="text-muted-foreground">Search country or region...</span>
            {/if}
            <ChevronsUpDown class="ml-2 h-4 w-4 shrink-0 opacity-50" />
          </Button>
        </Popover.Trigger>
        <Popover.Content class="w-[280px] p-0" align="start">
          <Command.Root>
            <Command.Input
              placeholder="Search..."
              bind:value={searchQuery}
            />
            <Command.List class="max-h-[200px] overflow-auto">
              <Command.Empty>No location found.</Command.Empty>
              {#if filteredLocations.some(l => l.isRegion)}
                <Command.Group heading="Regions">
                  {#each filteredLocations.filter(l => l.isRegion) as location}
                    <button
                      class="relative flex w-full cursor-default select-none items-center gap-2 rounded-sm px-2 py-1.5 text-sm outline-none hover:bg-accent"
                      onclick={() => selectCountry(location)}
                    >
                      <Check class="h-4 w-4 {selectedCountry?.code === location.code ? 'opacity-100' : 'opacity-0'}" />
                      {#if isFlagUrl(location.flag)}
                        <img src={location.flag} alt={location.name} class="w-4 h-3 object-cover inline-block" />
                      {:else}
                        <span>{location.flag}</span>
                      {/if}
                      {location.name}
                    </button>
                  {/each}
                </Command.Group>
              {/if}
              {#if filteredLocations.some(l => !l.isRegion)}
                <Command.Group heading="Countries">
                  {#each filteredLocations.filter(l => !l.isRegion) as location}
                    <button
                      class="relative flex w-full cursor-default select-none items-center gap-2 rounded-sm px-2 py-1.5 text-sm outline-none hover:bg-accent"
                      onclick={() => selectCountry(location)}
                    >
                      <Check class="h-4 w-4 {selectedCountry?.code === location.code ? 'opacity-100' : 'opacity-0'}" />
                      {#if isFlagUrl(location.flag)}
                        <img src={location.flag} alt={location.name} class="w-4 h-3 object-cover inline-block" />
                      {:else}
                        <span>{location.flag}</span>
                      {/if}
                      {location.name}
                    </button>
                  {/each}
                </Command.Group>
              {/if}
            </Command.List>
          </Command.Root>
        </Popover.Content>
      </Popover.Root>
      <Button size="sm" onclick={addRule} disabled={!selectedCountry}>
        <Plus class="h-4 w-4" />
      </Button>
    </div>
  </div>

  <!-- Rules List -->
  <ScrollArea class="h-[280px]">
    {#if settings.rules.length === 0}
      <div class="flex h-full items-center justify-center p-6 text-center text-sm text-muted-foreground">
        No rules yet. Add a country above.
      </div>
    {:else}
      <div class="p-2 space-y-2">
        {#each settings.rules as rule (rule.countryCode)}
          <div class="rounded-lg border bg-card/50 overflow-hidden">
            <!-- Header -->
            <div class="flex items-center justify-between px-3 py-2 bg-muted/30">
              <div class="flex items-center gap-2">
                {#if isFlagUrl(getCountryFlag(rule.countryCode))}
                  <img src={getCountryFlag(rule.countryCode)} alt={rule.country} class="w-5 h-4 object-cover" />
                {:else}
                  <span class="text-base">{getCountryFlag(rule.countryCode)}</span>
                {/if}
                <span class="text-sm font-medium">{rule.country}</span>
              </div>
              <Button
                variant="ghost"
                size="icon"
                class="h-6 w-6 -mr-1 opacity-50 hover:opacity-100"
                onclick={() => removeRule(rule.countryCode)}
              >
                <Trash2 class="h-3.5 w-3.5" />
              </Button>
            </div>

            <!-- Actions Row -->
            <div class="px-3 py-2 flex items-center gap-4">
              <div class="flex items-center gap-2 flex-1">
                <span class="text-xs text-muted-foreground w-12">Content</span>
                <Select.Root
                  type="single"
                  value={rule.softAction}
                  onValueChange={(v) => updateRule(rule.countryCode, 'softAction', v)}
                >
                  <Select.Trigger class="h-7 text-xs flex-1">
                    {softActions.find(a => a.value === rule.softAction)?.label}
                  </Select.Trigger>
                  <Select.Content>
                    {#each softActions as action}
                      <Select.Item value={action.value}>{action.label}</Select.Item>
                    {/each}
                  </Select.Content>
                </Select.Root>
              </div>
              <div class="flex items-center gap-2 flex-1">
                <span class="text-xs text-muted-foreground w-8">User</span>
                <Select.Root
                  type="single"
                  value={rule.hardAction}
                  onValueChange={(v) => updateRule(rule.countryCode, 'hardAction', v)}
                >
                  <Select.Trigger class="h-7 text-xs flex-1">
                    {hardActions.find(a => a.value === rule.hardAction)?.label}
                  </Select.Trigger>
                  <Select.Content>
                    {#each hardActions as action}
                      <Select.Item value={action.value}>{action.label}</Select.Item>
                    {/each}
                  </Select.Content>
                </Select.Root>
              </div>
            </div>

            <!-- Filters Row -->
            <div class="px-3 py-2 border-t border-border/50 flex items-center gap-6 bg-muted/20">
              <label class="flex items-center gap-2 cursor-pointer group">
                <Switch
                  checked={rule.deceptionOnly ?? false}
                  onCheckedChange={(checked) => updateRule(rule.countryCode, 'deceptionOnly', checked)}
                  class="scale-75"
                />
                <span class="text-xs text-muted-foreground group-hover:text-foreground transition-colors">Deception only</span>
              </label>
              <label class="flex items-center gap-2 cursor-pointer group">
                <Switch
                  checked={rule.vpnOnly ?? false}
                  onCheckedChange={(checked) => updateRule(rule.countryCode, 'vpnOnly', checked)}
                  class="scale-75"
                />
                <span class="text-xs text-muted-foreground group-hover:text-foreground transition-colors">VPN only</span>
              </label>
            </div>
          </div>
        {/each}
      </div>
    {/if}
  </ScrollArea>

  <!-- Settings Section -->
  <Collapsible.Root bind:open={settingsOpen} class="border-t">
    <Collapsible.Trigger class="flex w-full items-center justify-between p-3 hover:bg-muted/50 transition-colors">
      <div class="flex items-center gap-2 text-sm">
        <SettingsIcon class="h-4 w-4" />
        <span>Settings</span>
      </div>
      <ChevronDown class="h-4 w-4 transition-transform {settingsOpen ? 'rotate-180' : ''}" />
    </Collapsible.Trigger>
    <Collapsible.Content class="px-3 pb-3 space-y-3">
      <!-- OpenRouter connection -->
      <div class="space-y-1.5">
        <Label class="text-xs text-muted-foreground">OpenRouter</Label>

        {#if settings.openRouterApiKey}
          <div class="flex items-center justify-between gap-2 rounded-md border border-border px-2.5 py-1.5">
            <span class="flex items-center gap-1.5 text-xs min-w-0">
              <Check class="h-3 w-3 shrink-0 text-primary" />
              <span class="truncate font-mono text-muted-foreground">{maskedKey}</span>
            </span>
            <button
              type="button"
              class="shrink-0 text-[11px] text-muted-foreground transition-colors hover:text-destructive"
              onclick={disconnectOpenRouter}
            >
              Disconnect
            </button>
          </div>
        {:else}
          <Button
            variant="outline"
            size="sm"
            class="h-8 w-full text-xs"
            disabled={connecting}
            onclick={connectOpenRouter}
          >
            {connecting ? 'Waiting for OpenRouter...' : 'Connect OpenRouter'}
          </Button>
        {/if}

        {#if authError}
          <p class="text-[10px] text-destructive">{authError}</p>
        {/if}

        <button
          type="button"
          class="text-[10px] text-muted-foreground underline-offset-2 hover:underline"
          onclick={() => manualKeyOpen = !manualKeyOpen}
        >
          {manualKeyOpen ? 'Hide manual key entry' : 'Or paste a key manually'}
        </button>

        {#if manualKeyOpen}
          <div class="relative">
            <Input
              type={showApiKey ? 'text' : 'password'}
              placeholder="sk-or-..."
              value={settings.openRouterApiKey}
              oninput={updateApiKey}
              class="h-8 text-xs pr-16"
            />
            <button
              type="button"
              class="absolute right-2 top-1/2 -translate-y-1/2 text-xs text-muted-foreground hover:text-foreground"
              onclick={() => showApiKey = !showApiKey}
            >
              {showApiKey ? 'Hide' : 'Show'}
            </button>
          </div>
        {/if}

        <p class="text-[10px] text-muted-foreground">
          Needed for comic translation and LLM text rewriting. Video downloads work without it.
        </p>
      </div>

      <!-- Model Selection -->
      <div class="space-y-1.5">
        <div class="flex items-center justify-between">
          <Label class="text-xs text-muted-foreground">LLM Model</Label>
          <button
            type="button"
            class="text-[10px] text-primary hover:underline disabled:opacity-50"
            onclick={fetchModels}
            disabled={loadingModels || !settings.openRouterApiKey}
          >
            {loadingModels ? 'Loading...' : 'Refresh models'}
          </button>
        </div>
        {#if modelError}
          <p class="text-[10px] text-destructive">{modelError}</p>
        {:else if models.length > 1}
          <p class="text-[10px] text-muted-foreground">{models.length} models available</p>
        {/if}
        <Popover.Root bind:open={modelComboboxOpen}>
          <Popover.Trigger class="w-full">
            <Button variant="outline" class="w-full justify-between h-8 text-xs">
              <span class="truncate">{models.find(m => m.id === settings.llmModel)?.name || settings.llmModel}</span>
              <ChevronsUpDown class="ml-2 h-3 w-3 shrink-0 opacity-50" />
            </Button>
          </Popover.Trigger>
          <Popover.Content class="w-[320px] p-0" align="start">
            <Command.Root>
              <Command.Input
                placeholder="Search models..."
                bind:value={modelSearchQuery}
                class="h-8 text-xs"
              />
              <Command.List class="max-h-[200px] overflow-auto">
                <Command.Empty>No models found.</Command.Empty>
                {#each filteredModels as model}
                  <button
                    class="relative flex w-full cursor-default select-none items-center gap-2 rounded-sm px-2 py-1.5 text-xs outline-none hover:bg-accent"
                    onclick={() => {
                      updateModel(model.id);
                      modelComboboxOpen = false;
                      modelSearchQuery = '';
                    }}
                  >
                    <Check class="h-3 w-3 shrink-0 {settings.llmModel === model.id ? 'opacity-100' : 'opacity-0'}" />
                    <span class="truncate">{model.name}</span>
                    {#if model.free}
                      <span class="ml-auto shrink-0 rounded bg-primary/20 px-1 text-[9px] text-primary">Free</span>
                    {/if}
                  </button>
                {/each}
              </Command.List>
            </Command.Root>
          </Popover.Content>
        </Popover.Root>
      </div>

      <!-- Default Prompt -->
      <div class="space-y-1.5">
        <Label class="text-xs text-muted-foreground">Default LLM Prompt</Label>
        <Input
          type="text"
          placeholder="Rewrite this text..."
          value={settings.defaultLlmPrompt}
          oninput={updatePrompt}
          class="h-8 text-xs"
        />
      </div>
    </Collapsible.Content>
  </Collapsible.Root>

  <!-- Location Intelligence toggle -->
  <div class="flex items-center justify-between border-t p-3">
    <div class="flex items-center gap-2 text-sm">
      <Flag class="h-4 w-4" />
      <span>Location badges &amp; rules</span>
      {#if settings.locationIntelligence.enabled}
        <span class="text-[10px] px-1.5 py-0.5 rounded bg-primary/20 text-primary">On</span>
      {/if}
    </div>
    <Switch
      checked={settings.locationIntelligence.enabled}
      onCheckedChange={(checked) => {
        settings.locationIntelligence = { ...settings.locationIntelligence, enabled: checked };
        save();
      }}
    />
  </div>

  <!-- Video Download Section -->
  <Collapsible.Root bind:open={videoSettingsOpen} class="border-t">
    <Collapsible.Trigger class="flex w-full items-center justify-between p-3 hover:bg-muted/50 transition-colors">
      <div class="flex items-center gap-2 text-sm">
        <Download class="h-4 w-4" />
        <span>Video Downloads</span>
        {#if settings.videoDownload.enabled}
          <span class="text-[10px] px-1.5 py-0.5 rounded bg-primary/20 text-primary">On</span>
        {/if}
      </div>
      <ChevronDown class="h-4 w-4 transition-transform {videoSettingsOpen ? 'rotate-180' : ''}" />
    </Collapsible.Trigger>
    <Collapsible.Content class="px-3 pb-3 space-y-3">
      <div class="flex items-center justify-between">
        <Label class="text-xs text-muted-foreground">Show download button on videos</Label>
        <Switch
          checked={settings.videoDownload.enabled}
          onCheckedChange={(checked) => updateVideoDownload('enabled', checked)}
        />
      </div>

      {#if settings.videoDownload.enabled}
        <div class="flex items-center justify-between">
          <Label class="text-xs text-muted-foreground">Right-click a video to open the menu</Label>
          <Switch
            checked={settings.videoDownload.rightClickMenu}
            onCheckedChange={(checked) => updateVideoDownload('rightClickMenu', checked)}
          />
        </div>

        <div class="space-y-1.5">
          <Label class="text-xs text-muted-foreground">Preferred audio format</Label>
          <div class="grid grid-cols-4 gap-1.5">
            {#each AUDIO_FORMAT_OPTIONS as option}
              <button
                type="button"
                title={option.hint}
                onclick={() => updateVideoDownload('defaultAudioFormat', option.value)}
                class="flex flex-col items-center gap-0.5 p-2 rounded-md border text-xs transition-colors {settings.videoDownload.defaultAudioFormat === option.value ? 'border-primary bg-primary/10' : 'border-border hover:bg-muted/50'}"
              >
                <span class="font-medium">{option.label}</span>
              </button>
            {/each}
          </div>
          <p class="text-[10px] text-muted-foreground leading-relaxed">
            {AUDIO_FORMAT_OPTIONS.find(o => o.value === settings.videoDownload.defaultAudioFormat)?.hint}
            — audio is extracted locally with mediabunny; nothing is uploaded.
          </p>
        </div>
      {/if}
    </Collapsible.Content>
  </Collapsible.Root>

  <!-- Comic Translation Section -->
  <Collapsible.Root bind:open={comicSettingsOpen} class="border-t">
    <Collapsible.Trigger class="flex w-full items-center justify-between p-3 hover:bg-muted/50 transition-colors">
      <div class="flex items-center gap-2 text-sm">
        <Languages class="h-4 w-4" />
        <span>Comic Translation</span>
        {#if settings.comicTranslation.enabled}
          <span class="text-[10px] px-1.5 py-0.5 rounded bg-primary/20 text-primary">On</span>
        {/if}
      </div>
      <ChevronDown class="h-4 w-4 transition-transform {comicSettingsOpen ? 'rotate-180' : ''}" />
    </Collapsible.Trigger>
    <Collapsible.Content class="px-3 pb-3 space-y-3">
      <!-- Enable Toggle -->
      <div class="flex items-center justify-between">
        <Label class="text-xs text-muted-foreground">Enable Comic Translation</Label>
        <Switch
          checked={settings.comicTranslation.enabled}
          onCheckedChange={(checked) => updateComicTranslation('enabled', checked)}
        />
      </div>

      {#if settings.comicTranslation.enabled}
        <!-- Target Language -->
        <div class="space-y-1.5">
          <Label class="text-xs text-muted-foreground">Target Language</Label>
          <Select.Root
            type="single"
            value={settings.comicTranslation.targetLanguage}
            onValueChange={(v) => v && updateComicTranslation('targetLanguage', v)}
          >
            <Select.Trigger class="h-8 text-xs">
              {SUPPORTED_LANGUAGES.find(l => l.code === settings.comicTranslation.targetLanguage)?.name || settings.comicTranslation.targetLanguage}
            </Select.Trigger>
            <Select.Content>
              {#each SUPPORTED_LANGUAGES as lang}
                <Select.Item value={lang.code}>{lang.name}</Select.Item>
              {/each}
            </Select.Content>
          </Select.Root>
        </div>

        <!-- Detection Sensitivity -->
        <div class="space-y-1.5">
          <div class="flex items-center justify-between">
            <Label class="text-xs text-muted-foreground">Detection Sensitivity</Label>
            <span class="text-xs text-muted-foreground">{Math.round((settings.comicTranslation.confidenceThreshold ?? 0.3) * 100)}%</span>
          </div>
          <Slider
            type="single"
            value={settings.comicTranslation.confidenceThreshold ?? 0.3}
            min={0.1}
            max={0.9}
            step={0.05}
            onValueChange={(v: number) => updateComicTranslation('confidenceThreshold', v)}
            class="w-full"
          />
          <p class="text-[10px] text-muted-foreground">
            Lower = more bubbles detected (may include false positives)
          </p>
        </div>

        <!-- Reveal all translations at once -->
        <div class="flex items-start justify-between gap-3">
          <div class="min-w-0">
            <Label class="text-xs text-muted-foreground">Show all translations</Label>
            <p class="mt-0.5 text-[10px] leading-relaxed text-muted-foreground/80">
              Reveal every bubble as soon as it is translated, instead of one at a time on hover.
            </p>
          </div>
          <Switch
            checked={settings.comicTranslation.showAllBubbles}
            onCheckedChange={(checked) => updateComicTranslation('showAllBubbles', checked)}
          />
        </div>

        <!-- Bubble Shape -->
        <div class="space-y-1.5">
          <Label class="text-xs text-muted-foreground">Bubble Shape</Label>
          <div class="grid grid-cols-2 gap-2">
            <button
              class="flex flex-col items-center gap-1 p-2 rounded-md border text-xs transition-colors {settings.comicTranslation.bubbleShape === 'ellipse' ? 'border-primary bg-primary/10' : 'border-border hover:bg-muted/50'}"
              onclick={() => updateComicTranslation('bubbleShape', 'ellipse')}
            >
              <span class="text-lg">⭕</span>
              <span class="font-medium">Ellipse</span>
              <span class="text-[10px] text-muted-foreground text-center">Simple oval shape</span>
            </button>
            <button
              class="flex flex-col items-center gap-1 p-2 rounded-md border text-xs transition-colors {settings.comicTranslation.bubbleShape === 'mask' ? 'border-primary bg-primary/10' : 'border-border hover:bg-muted/50'}"
              onclick={() => updateComicTranslation('bubbleShape', 'mask')}
            >
              <span class="text-lg">🎭</span>
              <span class="font-medium">Mask</span>
              <span class="text-[10px] text-muted-foreground text-center">Match actual bubble</span>
            </button>
          </div>
        </div>

        <!-- Mode Selection -->
        <div class="space-y-1.5">
          <Label class="text-xs text-muted-foreground">Translation Mode</Label>
          <div class="grid grid-cols-2 gap-2">
            <button
              class="flex flex-col items-center gap-1 p-2 rounded-md border text-xs transition-colors {settings.comicTranslation.mode === 'bubble' ? 'border-primary bg-primary/10' : 'border-border hover:bg-muted/50'}"
              onclick={() => updateComicTranslation('mode', 'bubble')}
            >
              <span class="text-lg">💬</span>
              <span class="font-medium">Bubble</span>
              <span class="text-[10px] text-muted-foreground text-center">Hover to see translation</span>
            </button>
            <button
              class="flex flex-col items-center gap-1 p-2 rounded-md border text-xs transition-colors {settings.comicTranslation.mode === 'auto' ? 'border-primary bg-primary/10' : 'border-border hover:bg-muted/50'}"
              onclick={() => updateComicTranslation('mode', 'auto')}
            >
              <ImageIcon class="h-5 w-5" />
              <span class="font-medium">Auto</span>
              <span class="text-[10px] text-muted-foreground text-center">Re-render whole image</span>
            </button>
          </div>
        </div>

        <!-- Trigger Mode -->
        <div class="space-y-1.5">
          <Label class="text-xs text-muted-foreground">Trigger</Label>
          <Select.Root
            type="single"
            value={settings.comicTranslation.triggerMode}
            onValueChange={(v) => v && updateComicTranslation('triggerMode', v as 'button' | 'auto')}
          >
            <Select.Trigger class="h-8 text-xs">
              {settings.comicTranslation.triggerMode === 'button' ? 'Manual (click button)' : 'Automatic (on load)'}
            </Select.Trigger>
            <Select.Content>
              <Select.Item value="button">Manual (click button)</Select.Item>
              <Select.Item value="auto">Automatic (on load)</Select.Item>
            </Select.Content>
          </Select.Root>
        </div>

        <!-- Vision Model Selection (for bubble mode) -->
        {#if settings.comicTranslation.mode === 'bubble'}
          <div class="space-y-1.5">
            <div class="flex items-center justify-between">
              <Label class="text-xs text-muted-foreground">Vision Model</Label>
              <button
                type="button"
                class="text-[10px] text-primary hover:underline disabled:opacity-50"
                onclick={fetchVisionModels}
                disabled={loadingVisionModels || !settings.openRouterApiKey}
              >
                {loadingVisionModels ? 'Loading...' : 'Refresh'}
              </button>
            </div>
            <Popover.Root bind:open={visionModelComboboxOpen}>
              <Popover.Trigger class="w-full">
                <Button variant="outline" class="w-full justify-between h-8 text-xs">
                  <span class="truncate">
                    {visionModels.find(m => m.id === settings.comicTranslation.bubbleModel)?.name || settings.comicTranslation.bubbleModel}
                  </span>
                  <ChevronsUpDown class="ml-2 h-3 w-3 shrink-0 opacity-50" />
                </Button>
              </Popover.Trigger>
              <Popover.Content class="w-[320px] p-0" align="start">
                <Command.Root>
                  <Command.Input
                    placeholder="Search vision models..."
                    bind:value={visionModelSearchQuery}
                    class="h-8 text-xs"
                  />
                  <Command.List class="max-h-[200px] overflow-auto">
                    <Command.Empty>
                      {#if !settings.openRouterApiKey}
                        Add API key to load models
                      {:else if loadingVisionModels}
                        Loading models...
                      {:else}
                        No models found
                      {/if}
                    </Command.Empty>
                    {#each filteredVisionModels as model}
                      <button
                        class="relative flex w-full cursor-default select-none items-center gap-2 rounded-sm px-2 py-1.5 text-xs outline-none hover:bg-accent"
                        onclick={() => {
                          updateComicTranslation('bubbleModel', model.id);
                          visionModelComboboxOpen = false;
                          visionModelSearchQuery = '';
                        }}
                      >
                        <Check class="h-3 w-3 {settings.comicTranslation.bubbleModel === model.id ? 'opacity-100' : 'opacity-0'}" />
                        <span class="truncate">{model.name}</span>
                      </button>
                    {/each}
                  </Command.List>
                </Command.Root>
              </Popover.Content>
            </Popover.Root>
            <p class="text-[10px] text-muted-foreground">
              Used for extracting and translating text from speech bubbles
            </p>
          </div>
        {:else}
          <p class="text-[10px] text-muted-foreground p-2 bg-muted/50 rounded">
            Auto mode uses Gemini 2.5 Flash Image to re-render the entire comic with translated text
          </p>
        {/if}

        {#if !settings.openRouterApiKey}
          <p class="text-[10px] text-amber-500 p-2 bg-amber-500/10 rounded">
            Add your OpenRouter API key in Settings to enable comic translation
          </p>
        {/if}
      {/if}
    </Collapsible.Content>
  </Collapsible.Root>

  <!-- Footer -->
  <div class="border-t p-3">
    <div class="flex items-center justify-between text-xs text-muted-foreground">
      <div class="flex items-center gap-3">
        <div class="flex items-center gap-1">
          <Database class="h-3 w-3" />
          <span>{cacheStats.valid} cached</span>
        </div>
        <button onclick={openShowcase} class="flex items-center gap-1 hover:text-primary transition-colors">
          <ExternalLink class="h-3 w-3" />
          <span>Showcase</span>
        </button>
      </div>
      <Button variant="ghost" size="sm" class="h-6 text-xs" onclick={handleClearCache}>
        Clear cache
      </Button>
    </div>
  </div>
</div>
