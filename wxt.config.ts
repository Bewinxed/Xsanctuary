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
    permissions: ['storage'],
    host_permissions: ['*://*.x.com/*', '*://*.twitter.com/*'],
    action: {
      default_popup: 'popup.html',
      default_title: 'XSanctuary',
    },
    web_accessible_resources: [
      {
        resources: ['wasm/*.wasm', 'wasm/*.mjs'],
        matches: ['*://*.x.com/*', '*://*.twitter.com/*'],
      },
    ],
  },
});
