import { defineConfig } from 'vite';
import { VitePWA } from 'vite-plugin-pwa';

export default defineConfig({
  base: '/BookSpineScanner/',
  plugins: [
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['resources/app.ico', 'customize/gear.png', 'icons/*.png'],
      manifest: {
        name: 'Libiry BookSpineScanner',
        short_name: 'Libiry',
        description: 'Libiry BookSpineScanner - Scan book spines and extract metadata',
        theme_color: '#2563eb',
        background_color: '#f8fafc',
        display: 'standalone',
        icons: [
          {
            src: 'icons/icon-192.png',
            sizes: '192x192',
            type: 'image/png'
          },
          {
            src: 'icons/icon-512.png',
            sizes: '512x512',
            type: 'image/png'
          }
        ]
      },
      workbox: {
        globPatterns: ['**/*.{js,css,html,ico,png,svg,woff2}'],
        runtimeCaching: [
          {
            urlPattern: /^https:\/\/openlibrary\.org\/search\.json/,
            handler: 'CacheFirst',
            options: {
              cacheName: 'openlibrary-cache',
              expiration: {
                maxEntries: 100,
                maxAgeSeconds: 60 * 60 * 24 * 7 // 1 week
              }
            }
          }
        ]
      }
    })
  ],
  build: {
    outDir: 'dist',
    sourcemap: true
  }
});
