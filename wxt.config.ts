import { defineConfig } from 'wxt';
import tailwindcss from '@tailwindcss/vite';
import { resolve } from 'path';

export default defineConfig({
  srcDir: 'src',
  modules: ['@wxt-dev/module-svelte', '@wxt-dev/auto-icons'],
  alias: {
    $lib: resolve('src/lib'),
  },
  vite: () => ({
    plugins: [tailwindcss()],
  }),
  manifest: {
    name: 'XSanctuary',
    description: 'Show country flags for Twitter/X users based on their location',
    permissions: ['storage', 'offscreen'],
    host_permissions: ['*://*.x.com/*', '*://*.twitter.com/*', '*://*.twimg.com/*'],
    action: {
      default_popup: 'popup.html',
      default_title: 'XSanctuary',
    },
    content_security_policy: {
      extension_pages: "script-src 'self' 'wasm-unsafe-eval'; object-src 'self'",
    },
    web_accessible_resources: [
      {
        resources: ['wasm/*.wasm', 'wasm/*.mjs', 'fonts/*.ttf'],
        matches: ['*://*.x.com/*', '*://*.twitter.com/*'],
      },
    ],
  },
});
