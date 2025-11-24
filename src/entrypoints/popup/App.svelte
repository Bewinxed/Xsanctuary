<script lang="ts">
  import { onMount, tick } from 'svelte';
  import { Button } from '$lib/components/ui/button';
  import { Switch } from '$lib/components/ui/switch';
  import * as Select from '$lib/components/ui/select';
  import * as Popover from '$lib/components/ui/popover';
  import * as Command from '$lib/components/ui/command';
  import { Label } from '$lib/components/ui/label';
  import { Separator } from '$lib/components/ui/separator';
  import * as Card from '$lib/components/ui/card';
  import { ScrollArea } from '$lib/components/ui/scroll-area';
  import { getSettings, saveSettings, type Settings, type CountryRule, type SoftAction, type HardAction } from '@/utils/storage';
  import { allLocations, regions, type Country } from '@/utils/country-list';
  import { getCacheStats, clearCache } from '@/utils/cache';
  import { Checkbox } from '$lib/components/ui/checkbox';
  import { Trash2, Plus, Shield, Database, ChevronsUpDown, Check, EyeOff, Wifi } from 'lucide-svelte';

  let settings = $state<Settings>({
    rules: [],
    openRouterApiKey: '',
    defaultLlmPrompt: 'Rewrite this text in a funny way:',
    enabled: true,
  });

  let selectedCountry = $state<Country | undefined>(undefined);
  let cacheStats = $state({ total: 0, valid: 0 });
  let comboboxOpen = $state(false);
  let searchQuery = $state('');

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
  });

  async function save() {
    await saveSettings(settings);
  }

  function addRule() {
    if (!selectedCountry) return;
    if (settings.rules.some(r => r.countryCode === selectedCountry.code)) return;

    settings.rules = [...settings.rules, {
      country: selectedCountry.name,
      countryCode: selectedCountry.code,
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

  function updateRule(code: string, field: keyof CountryRule, value: string | boolean) {
    settings.rules = settings.rules.map(r =>
      r.countryCode === code ? { ...r, [field]: value } : r
    );
    save();
  }

  async function handleClearCache() {
    await clearCache();
    cacheStats = await getCacheStats();
  }

  function getCountryFlag(code: string): string {
    return allLocations.find(c => c.code === code)?.flag || '🏳️';
  }

  function selectCountry(location: Country) {
    selectedCountry = location;
    comboboxOpen = false;
    searchQuery = '';
  }

  $effect(() => {
    // Filter locations based on search
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

  <!-- Add Rule -->
  <div class="border-b p-3">
    <div class="flex gap-2">
      <Popover.Root bind:open={comboboxOpen}>
        <Popover.Trigger>
          <Button variant="outline" class="flex-1 justify-between min-w-[280px]">
            {#if selectedCountry}
              <span>{selectedCountry.flag} {selectedCountry.name}</span>
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
                    <Command.Item
                      value={location.code}
                      onSelect={() => selectCountry(location)}
                    >
                      <Check class="mr-2 h-4 w-4 {selectedCountry?.code === location.code ? 'opacity-100' : 'opacity-0'}" />
                      {location.flag} {location.name}
                    </Command.Item>
                  {/each}
                </Command.Group>
              {/if}
              {#if filteredLocations.some(l => !l.isRegion)}
                <Command.Group heading="Countries">
                  {#each filteredLocations.filter(l => !l.isRegion) as location}
                    <Command.Item
                      value={location.code}
                      onSelect={() => selectCountry(location)}
                    >
                      <Check class="mr-2 h-4 w-4 {selectedCountry?.code === location.code ? 'opacity-100' : 'opacity-0'}" />
                      {location.flag} {location.name}
                    </Command.Item>
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
      <div class="divide-y">
        {#each settings.rules as rule (rule.countryCode)}
          <div class="p-3">
            <div class="mb-2 flex items-center justify-between">
              <span class="font-medium">
                {getCountryFlag(rule.countryCode)} {rule.country}
              </span>
              <Button
                variant="ghost"
                size="icon"
                class="h-6 w-6"
                onclick={() => removeRule(rule.countryCode)}
              >
                <Trash2 class="h-3 w-3 text-destructive" />
              </Button>
            </div>
            <div class="grid grid-cols-2 gap-2">
              <div>
                <Label class="mb-1 text-xs text-muted-foreground">Content</Label>
                <Select.Root
                  type="single"
                  value={rule.softAction}
                  onValueChange={(v) => updateRule(rule.countryCode, 'softAction', v)}
                >
                  <Select.Trigger class="h-8 text-xs">
                    {softActions.find(a => a.value === rule.softAction)?.label}
                  </Select.Trigger>
                  <Select.Content>
                    {#each softActions as action}
                      <Select.Item value={action.value}>{action.label}</Select.Item>
                    {/each}
                  </Select.Content>
                </Select.Root>
              </div>
              <div>
                <Label class="mb-1 text-xs text-muted-foreground">User</Label>
                <Select.Root
                  type="single"
                  value={rule.hardAction}
                  onValueChange={(v) => updateRule(rule.countryCode, 'hardAction', v)}
                >
                  <Select.Trigger class="h-8 text-xs">
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
            <!-- Filters -->
            <div class="mt-2 flex flex-wrap gap-3 text-xs">
              <label class="flex items-center gap-1.5 cursor-pointer">
                <Checkbox
                  checked={rule.deceptionOnly ?? false}
                  onCheckedChange={(checked) => updateRule(rule.countryCode, 'deceptionOnly', checked)}
                />
                <EyeOff class="h-3 w-3 text-muted-foreground" />
                <span class="text-muted-foreground">Deception only</span>
              </label>
              <label class="flex items-center gap-1.5 cursor-pointer">
                <Checkbox
                  checked={rule.vpnOnly ?? false}
                  onCheckedChange={(checked) => updateRule(rule.countryCode, 'vpnOnly', checked)}
                />
                <Wifi class="h-3 w-3 text-muted-foreground" />
                <span class="text-muted-foreground">VPN only</span>
              </label>
            </div>
          </div>
        {/each}
      </div>
    {/if}
  </ScrollArea>

  <!-- Footer -->
  <div class="border-t p-3">
    <div class="flex items-center justify-between text-xs text-muted-foreground">
      <div class="flex items-center gap-1">
        <Database class="h-3 w-3" />
        <span>{cacheStats.valid} cached</span>
      </div>
      <Button variant="ghost" size="sm" class="h-6 text-xs" onclick={handleClearCache}>
        Clear cache
      </Button>
    </div>
  </div>
</div>
