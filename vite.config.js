import { defineConfig } from 'vite';
import fs from 'fs';
import path from 'path';
import wasm from 'vite-plugin-wasm';
import topLevelAwait from 'vite-plugin-top-level-await';
import basicSsl from '@vitejs/plugin-basic-ssl';
import { VitePWA } from 'vite-plugin-pwa';

const isDev = process.env.NODE_ENV !== 'production';

const staticExtensions = /\.(mp3|wav|ogg|m4a|png|jpg|jpeg|gif|webp|svg|ico|glb|gltf|json|woff2?|ttf|eot|spz|rad|radc)$/i;

function rejectMissingStaticPlugin() {
  return {
    name: 'reject-missing-static',
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        let pathname = req.url?.split('?')[0] ?? '';
        try {
          pathname = decodeURIComponent(pathname);
        } catch (_) {}
        if (req.method !== 'GET' && req.method !== 'HEAD') return next();
        if (!staticExtensions.test(pathname)) return next();
        const base = server.config.base.replace(/\/$/, '') || '';
        const relative = pathname.startsWith(base) ? pathname.slice(base.length) : pathname;
        const clean = path.normalize(relative).replace(/^(\.\.(\/|\\))+/, '');
        if (clean.startsWith('..')) return next();
        const publicDir = path.resolve(server.config.root, server.config.publicDir || 'public');
        const filePath = path.join(publicDir, clean);
        if (!fs.existsSync(filePath) || !fs.statSync(filePath).isFile()) {
          res.statusCode = 404;
          res.end();
          return;
        }
        next();
      });
    },
  };
}

export default defineConfig({
  base: '/',
  build: {
    target: 'esnext',
  },
  plugins: [
    rejectMissingStaticPlugin(),
    wasm(),
    topLevelAwait(),
    ...(isDev ? [basicSsl()] : []),
    VitePWA({
      registerType: 'autoUpdate',
      strategies: 'injectManifest',
      injectManifest: {
        globPatterns: ['**/*.{js,css,html,ico,png,svg,woff2}'],
        maximumFileSizeToCacheInBytes: 10 * 1024 * 1024,
      },
      manifest: {
        name: 'STARSPEED',
        short_name: 'STARSPEED',
        description: 'Zero-G aerial combat multiplayer game',
        theme_color: '#050510',
        background_color: '#050510',
        display: 'standalone',
        orientation: 'any',
        start_url: '/',
        scope: '/',
        icons: [
          { src: 'images/site/pwa-64x64.png', sizes: '64x64', type: 'image/png' },
          { src: 'images/site/pwa-192x192.png', sizes: '192x192', type: 'image/png' },
          { src: 'images/site/pwa-512x512.png', sizes: '512x512', type: 'image/png' },
          { src: 'images/site/maskable-icon-512x512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
    }),
  ],
  optimizeDeps: {
    exclude: ['@sparkjsdev/spark'],
  },
  server: {
    https: true,
    host: true,
  },
});
