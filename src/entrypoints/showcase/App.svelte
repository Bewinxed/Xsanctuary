<script lang="ts">
  import { Shield, Moon, Sun, Globe, Eye, EyeOff, Bot, ShieldAlert, ShieldCheck } from 'lucide-svelte';

  let theme = $state<'dark' | 'light'>('dark');

  function toggleTheme() {
    theme = theme === 'dark' ? 'light' : 'dark';
    document.documentElement.classList.toggle('dark', theme === 'dark');
  }

  const mockTweets = [
    {
      id: 1,
      name: 'Sarah Johnson',
      handle: 'sarahjohnson',
      avatar: 'https://api.dicebear.com/7.x/avataaars/svg?seed=sarah',
      time: '2h',
      content: 'Just finished my morning run! The weather is perfect today. Who else is enjoying the sunshine?',
      country: 'United States',
      flag: '🇺🇸',
      isVpn: false,
      isDeceptive: false,
      state: 'normal',
    },
    {
      id: 2,
      name: 'محمد الكويتي',
      handle: 'mohammed_kw',
      avatar: 'https://api.dicebear.com/7.x/avataaars/svg?seed=mohammed',
      time: '1h',
      content: 'Great discussion at the conference today. Looking forward to implementing these new ideas!',
      country: 'Kuwait',
      flag: '🇰🇼',
      isVpn: false,
      isDeceptive: false,
      state: 'blurred',
    },
    {
      id: 3,
      name: 'Alex Freedom 🇺🇸🇬🇧',
      handle: 'alex_patriot',
      avatar: 'https://api.dicebear.com/7.x/avataaars/svg?seed=alex',
      time: '45m',
      content: 'Democracy and freedom must be protected at all costs. Never give up the fight!',
      country: 'Russia',
      flag: '🇷🇺',
      claimedFlags: '🇺🇸🇬🇧',
      isVpn: true,
      isDeceptive: true,
      state: 'deceptive',
    },
    {
      id: 4,
      name: 'Carlos Silva',
      handle: 'carlossilva',
      avatar: 'https://api.dicebear.com/7.x/avataaars/svg?seed=carlos',
      time: '30m',
      content: 'Working on a new project today. The coffee is strong and the code is flowing nicely!',
      country: 'Brazil',
      flag: '🇧🇷',
      isVpn: true,
      isDeceptive: false,
      state: 'vpn',
    },
    {
      id: 5,
      name: 'Emma Wilson',
      handle: 'emmawilson',
      avatar: 'https://api.dicebear.com/7.x/avataaars/svg?seed=emma',
      time: '15m',
      content: 'Hewwo evewyone! Just had the most amazing bweakfast uwu Hope you\'w all having a gweat day! ^w^',
      originalContent: 'Hello everyone! Just had the most amazing breakfast. Hope you\'re all having a great day!',
      country: 'Iran',
      flag: '🇮🇷',
      isVpn: false,
      isDeceptive: false,
      state: 'uwu',
    },
  ];
</script>

<div class="min-h-screen bg-background text-foreground">
  <!-- Header -->
  <header class="border-b border-border sticky top-0 bg-background/95 backdrop-blur z-10">
    <div class="max-w-5xl mx-auto px-6 py-5 flex items-center justify-between">
      <div class="flex items-center gap-4">
        <div class="p-2 rounded-xl bg-primary/10">
          <Shield class="h-8 w-8 text-primary" />
        </div>
        <div>
          <h1 class="text-2xl font-bold tracking-tight">XSanctuary</h1>
          <p class="text-sm text-muted-foreground">Location-aware content moderation for X</p>
        </div>
      </div>
      <button
        onclick={toggleTheme}
        class="p-2.5 rounded-full bg-secondary hover:bg-secondary/80 transition-colors"
        aria-label="Toggle theme"
      >
        {#if theme === 'dark'}
          <Sun class="h-5 w-5" />
        {:else}
          <Moon class="h-5 w-5" />
        {/if}
      </button>
    </div>
  </header>

  <main class="max-w-5xl mx-auto px-6 py-10 space-y-16">
    <!-- Hero Section -->
    <section class="text-center space-y-4">
      <h2 class="text-4xl font-bold tracking-tight">See where users really are</h2>
      <p class="text-lg text-muted-foreground max-w-2xl mx-auto">
        XSanctuary reveals the true location of X users, detects VPN usage and deceptive profiles,
        and lets you filter content based on geography.
      </p>
    </section>

    <!-- Badge Examples -->
    <section>
      <h2 class="text-xl font-semibold mb-6">Badge Indicators</h2>
      <div class="grid grid-cols-1 md:grid-cols-3 gap-4">
        <div class="p-5 rounded-xl bg-card border border-border">
          <div class="flex items-center gap-3 mb-3">
            <span class="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-sm bg-primary/10 border border-primary/30">
              <span class="text-base">🇺🇸</span>
              <span class="text-primary text-xs font-medium">United States</span>
            </span>
          </div>
          <h3 class="font-medium mb-1">Standard Location</h3>
          <p class="text-sm text-muted-foreground">Shows the user's detected country with a subtle blue border.</p>
        </div>

        <div class="p-5 rounded-xl bg-card border border-border">
          <div class="flex items-center gap-3 mb-3">
            <span class="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-sm bg-orange-500/10 border-[1.5px] border-dashed border-orange-500/60">
              <span class="text-base">🇧🇷</span>
              <span class="text-orange-500 text-xs font-medium">Brazil (VPN)</span>
            </span>
          </div>
          <h3 class="font-medium mb-1">VPN Detected</h3>
          <p class="text-sm text-muted-foreground">Dashed orange border indicates the user's location may be obscured.</p>
        </div>

        <div class="p-5 rounded-xl bg-card border border-border">
          <div class="flex items-center gap-3 mb-3">
            <span class="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-sm bg-red-500/15 border border-red-500/60">
              <span class="text-base">🇷🇺</span>
              <span class="text-red-500 text-xs font-medium">🇺🇸→🇷🇺</span>
            </span>
          </div>
          <h3 class="font-medium mb-1">Deceptive Profile</h3>
          <p class="text-sm text-muted-foreground">Red border when profile flags don't match actual location.</p>
        </div>
      </div>
    </section>

    <!-- Timeline Demo -->
    <section>
      <h2 class="text-xl font-semibold mb-6">Timeline Preview</h2>
      <div class="rounded-2xl border border-border overflow-hidden bg-card shadow-lg">
        {#each mockTweets as tweet (tweet.id)}
          <article class="p-4 border-b border-border last:border-b-0 hover:bg-secondary/20 transition-colors">
            <div class="flex gap-3">
              <img
                src={tweet.avatar}
                alt={tweet.name}
                class="w-12 h-12 rounded-full bg-secondary flex-shrink-0"
              />
              <div class="flex-1 min-w-0">
                <!-- Tweet Header -->
                <div class="flex items-center gap-1.5 flex-wrap">
                  <span class="font-bold">{tweet.name}</span>

                  <!-- Country Badge -->
                  <span class={[
                    'inline-flex items-center px-1.5 py-0.5 rounded-full text-sm',
                    tweet.isDeceptive ? 'bg-red-500/15 border border-red-500/60' :
                    tweet.isVpn ? 'bg-orange-500/10 border-[1.5px] border-dashed border-orange-500/60' :
                    'bg-primary/10 border border-primary/30'
                  ].join(' ')}>
                    <span>{tweet.flag}</span>
                  </span>

                  <span class="text-muted-foreground">@{tweet.handle}</span>
                  <span class="text-muted-foreground">·</span>
                  <span class="text-muted-foreground">{tweet.time}</span>

                  <!-- Action buttons for blurred content -->
                  {#if tweet.state === 'blurred'}
                    <div class="ml-auto flex items-center gap-0.5">
                      <button class="w-8 h-8 flex items-center justify-center rounded-full hover:bg-primary/10 text-primary transition-colors" title="Reveal content">
                        <Eye class="w-[18px] h-[18px]" />
                      </button>
                      <button class="w-8 h-8 flex items-center justify-center rounded-full hover:bg-muted text-muted-foreground hover:text-foreground transition-colors" title="Pause rule for 1 hour">
                        <svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor">
                          <path d="M6 19h4V5H6v14zm8-14v14h4V5h-4z"/>
                        </svg>
                      </button>
                      <button class="w-8 h-8 flex items-center justify-center rounded-full hover:bg-muted text-muted-foreground hover:text-foreground transition-colors" title="Allow this user">
                        <svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor">
                          <path d="M9 16.17L4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41z"/>
                        </svg>
                      </button>
                    </div>
                  {/if}
                </div>

                <!-- Tweet Content -->
                <p class={[
                  'mt-2 text-[15px] leading-normal',
                  tweet.state === 'blurred' ? 'blur-[6px] select-none' : ''
                ].join(' ')}>
                  {tweet.content}
                </p>

                <!-- Transform badge -->
                {#if tweet.state === 'uwu'}
                  <span class="inline-flex items-center gap-1 mt-2 px-2 py-0.5 rounded bg-primary/10 text-xs text-primary">
                    <Bot class="w-3 h-3" />
                    UwU transformed
                  </span>
                {/if}

                <!-- Warning indicators -->
                {#if tweet.isDeceptive}
                  <div class="flex items-center gap-1.5 mt-2 text-xs text-red-500">
                    <ShieldAlert class="w-3.5 h-3.5" />
                    <span>Profile displays {tweet.claimedFlags} but located in {tweet.country}</span>
                  </div>
                {:else if tweet.isVpn}
                  <div class="flex items-center gap-1.5 mt-2 text-xs text-orange-500">
                    <ShieldCheck class="w-3.5 h-3.5" />
                    <span>VPN or proxy detected</span>
                  </div>
                {/if}
              </div>
            </div>
          </article>
        {/each}
      </div>
    </section>

    <!-- Features Grid -->
    <section>
      <h2 class="text-xl font-semibold mb-6">Features</h2>
      <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div class="p-5 rounded-xl border border-border bg-card/50 hover:bg-card transition-colors">
          <div class="flex items-center gap-3 mb-3">
            <div class="p-2 rounded-lg bg-primary/10">
              <Globe class="w-5 h-5 text-primary" />
            </div>
            <h3 class="font-semibold">Location Detection</h3>
          </div>
          <p class="text-sm text-muted-foreground">Automatically detects user locations using X's API and displays country flags next to usernames.</p>
        </div>

        <div class="p-5 rounded-xl border border-border bg-card/50 hover:bg-card transition-colors">
          <div class="flex items-center gap-3 mb-3">
            <div class="p-2 rounded-lg bg-primary/10">
              <EyeOff class="w-5 h-5 text-primary" />
            </div>
            <h3 class="font-semibold">Content Actions</h3>
          </div>
          <p class="text-sm text-muted-foreground">Hide, blur, or transform content from specific countries. Apply UwU speak, cat speak, or AI transformations.</p>
        </div>

        <div class="p-5 rounded-xl border border-border bg-card/50 hover:bg-card transition-colors">
          <div class="flex items-center gap-3 mb-3">
            <div class="p-2 rounded-lg bg-orange-500/10">
              <ShieldCheck class="w-5 h-5 text-orange-500" />
            </div>
            <h3 class="font-semibold">VPN Detection</h3>
          </div>
          <p class="text-sm text-muted-foreground">Identifies users with inaccurate location data, indicating potential VPN or proxy usage.</p>
        </div>

        <div class="p-5 rounded-xl border border-border bg-card/50 hover:bg-card transition-colors">
          <div class="flex items-center gap-3 mb-3">
            <div class="p-2 rounded-lg bg-red-500/10">
              <ShieldAlert class="w-5 h-5 text-red-500" />
            </div>
            <h3 class="font-semibold">Deception Detection</h3>
          </div>
          <p class="text-sm text-muted-foreground">Detects when users display flag emojis that don't match their actual location.</p>
        </div>

        <div class="p-5 rounded-xl border border-border bg-card/50 hover:bg-card transition-colors">
          <div class="flex items-center gap-3 mb-3">
            <div class="p-2 rounded-lg bg-primary/10">
              <Bot class="w-5 h-5 text-primary" />
            </div>
            <h3 class="font-semibold">AI Transformations</h3>
          </div>
          <p class="text-sm text-muted-foreground">Transform content using LLMs via OpenRouter. Stream responses in real-time with custom prompts.</p>
        </div>

        <div class="p-5 rounded-xl border border-border bg-card/50 hover:bg-card transition-colors">
          <div class="flex items-center gap-3 mb-3">
            <div class="p-2 rounded-lg bg-primary/10">
              <Shield class="w-5 h-5 text-primary" />
            </div>
            <h3 class="font-semibold">User Actions</h3>
          </div>
          <p class="text-sm text-muted-foreground">Automatically mute or block users from specific countries, with VPN and deception filters.</p>
        </div>
      </div>
    </section>
  </main>

  <!-- Footer -->
  <footer class="border-t border-border mt-16 py-8 text-center">
    <p class="text-sm text-muted-foreground">
      XSanctuary - Open source location-aware content moderation for X
    </p>
  </footer>
</div>
