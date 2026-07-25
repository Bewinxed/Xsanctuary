<script lang="ts">
  import { onMount } from 'svelte';
  import { Download, Music, Images, Flag, Languages, KeyRound, ShieldCheck } from 'lucide-svelte';

  // Staggered entry, kept short so nothing blocks reading
  let mounted = $state(false);
  let previousVersion = $state('');

  onMount(async () => {
    requestAnimationFrame(() => (mounted = true));

    try {
      const stored = await browser.storage.local.get('lastSeenVersion');
      previousVersion = (stored.lastSeenVersion as string) || '';
    } catch {
      // Not important enough to surface
    }
  });

  const features = [
    {
      icon: Download,
      title: 'Download videos',
      body: 'Hover any video or GIF and a download button appears in the corner. The menu lists every resolution X actually serves, with its bitrate and rough file size, so you can take the big copy or the small one.',
    },
    {
      icon: Music,
      title: 'Pull out just the audio',
      body: 'Same menu, lower down. Save the soundtrack as M4A, MP3, Opus or WAV without downloading a video file you were going to throw away. M4A copies the original track, so it is lossless and nearly instant.',
    },
    {
      icon: Images,
      title: 'Bulk image download, unchanged',
      body: 'The profile download button you already use works exactly as before. Same prompt, same auto-scrolling, same zip. It is faster on large batches now.',
    },
    {
      icon: Flag,
      title: 'See where accounts post from',
      body: 'Country flags next to usernames, with VPN and mismatched-flag accounts marked. You can hide, blur or mute accounts by country, or leave the whole thing switched off.',
    },
    {
      icon: Languages,
      title: 'Translate comics in the timeline',
      body: 'Speech bubbles get detected on your own machine and translated in place. Off by default, and it needs an OpenRouter key.',
    },
    {
      icon: KeyRound,
      title: 'One-click OpenRouter sign-in',
      body: 'If you use the translation or rewriting features, you can connect your OpenRouter account with a button instead of copying an API key. Pasting a key still works.',
    },
  ];

  function openPopup() {
    window.close();
  }
</script>

<main class="min-h-screen bg-background text-foreground">
  <div class="mx-auto max-w-2xl px-6 py-16">
    <!-- Header -->
    <header
      class="transition-all duration-500 ease-out"
      class:opacity-0={!mounted}
      class:translate-y-2={!mounted}
    >
      <p class="text-xs font-medium uppercase tracking-widest text-muted-foreground">
        Version 3.1
      </p>
      <h1 class="mt-3 text-3xl font-bold tracking-tight">
        This extension is now called XSanctuary
      </h1>
      <p class="mt-4 text-[15px] leading-relaxed text-muted-foreground">
        You installed it as xitter&#8209;scraper, for downloading images from X profiles. That
        still works and has not changed. The name is different because it now does more than
        images, and it kept the old name for longer than it should have.
      </p>
    </header>

    <!-- Permissions explanation, first because it is why Chrome interrupted them -->
    <section
      class="mt-10 rounded-xl border border-border bg-card p-5 transition-all duration-500 ease-out"
      class:opacity-0={!mounted}
      class:translate-y-2={!mounted}
      style="transition-delay: 60ms"
    >
      <div class="flex items-start gap-3">
        <ShieldCheck class="mt-0.5 h-5 w-5 shrink-0 text-primary" />
        <div>
          <h2 class="text-sm font-semibold">Why Chrome asked you to approve it again</h2>
          <p class="mt-2 text-[13px] leading-relaxed text-muted-foreground">
            Chrome switches an extension off when it asks for anything new, which is a good
            default. This update needs permission to save files to your computer, since it now
            downloads videos and audio rather than only building a zip in the page. It also asks
            for sign-in permission, used for nothing except the optional OpenRouter button.
          </p>
          <p class="mt-2 text-[13px] leading-relaxed text-muted-foreground">
            Nothing is collected and there is no server behind this. Downloads go straight from X
            to your disk, and any converting happens in your browser. Settings stay on your
            machine.
          </p>
        </div>
      </div>
    </section>

    <!-- Features -->
    <section class="mt-10">
      <h2
        class="text-sm font-semibold uppercase tracking-wide text-muted-foreground transition-all duration-500 ease-out"
        class:opacity-0={!mounted}
        style="transition-delay: 100ms"
      >
        What is new
      </h2>

      <ul class="mt-5 space-y-6">
        {#each features as feature, i}
          {@const Icon = feature.icon}
          <li
            class="flex items-start gap-4 transition-all duration-500 ease-out"
            class:opacity-0={!mounted}
            class:translate-y-2={!mounted}
            style="transition-delay: {140 + i * 50}ms"
          >
            <span
              class="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-secondary"
            >
              <Icon class="h-[18px] w-[18px] text-foreground" />
            </span>
            <div class="min-w-0">
              <h3 class="text-[15px] font-semibold">{feature.title}</h3>
              <p class="mt-1 text-[13px] leading-relaxed text-muted-foreground">
                {feature.body}
              </p>
            </div>
          </li>
        {/each}
      </ul>
    </section>

    <!-- Footer -->
    <footer
      class="mt-12 border-t border-border pt-6 transition-all duration-500 ease-out"
      class:opacity-0={!mounted}
      style="transition-delay: {140 + features.length * 50}ms"
    >
      <p class="text-[13px] leading-relaxed text-muted-foreground">
        Everything new is switched on or off from the toolbar icon. If you only ever wanted the
        image downloader, turn the rest off there and it will stay out of your way.
      </p>

      <div class="mt-5 flex flex-wrap items-center gap-3">
        <button
          type="button"
          onclick={openPopup}
          class="rounded-full bg-primary px-4 py-2 text-[13px] font-semibold text-primary-foreground transition-transform duration-150 ease-out active:scale-[0.97]"
        >
          Close
        </button>
        <a
          href="https://github.com/Bewinxed/xsanctuary"
          target="_blank"
          rel="noreferrer"
          class="text-[13px] text-muted-foreground underline-offset-4 hover:text-foreground hover:underline"
        >
          Source and changelog
        </a>
      </div>

      {#if previousVersion}
        <p class="mt-6 text-[11px] text-muted-foreground/70">
          Updated from {previousVersion}
        </p>
      {/if}
    </footer>
  </div>
</main>

<style>
  /* Respect the system preference rather than animating regardless */
  @media (prefers-reduced-motion: reduce) {
    :global(.duration-500) {
      transition-duration: 1ms !important;
      transition-delay: 0ms !important;
    }
  }
</style>
