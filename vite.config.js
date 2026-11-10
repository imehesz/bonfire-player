import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';

// The player reuses BonfireSTACK's own engine straight from the app's source (the sibling folder),
// so a track always sounds the way it does in the app. @strudel packages are forced to resolve from
// THIS project (dedupe): two copies of Strudel would not share sounds or the audio context.
const here = path.dirname(fileURLToPath(import.meta.url));
const bonfire = path.resolve(here, process.env.BONFIRE_SRC || '../bonfirestack/src');
if (!fs.existsSync(path.join(bonfire, 'core/engine.js'))) throw new Error(`BonfireSTACK source not found at ${bonfire} (set BONFIRE_SRC)`);

const pad = (n) => String(n).padStart(2, '0');
function buildVersion() {
  const d = new Date();
  return `v1.0.${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}${pad(d.getHours())}${pad(d.getMinutes())}`;
}

// base './' + relative api/ URLs: the build runs from any sub-path on the server.
export default defineConfig(({ command }) => {
  const version = command === 'build' ? buildVersion() : 'dev';
  return {
    base: './',
    define: { __APP_VERSION__: JSON.stringify(version) },
    resolve: {
      alias: { '@bonfire': bonfire },
      dedupe: ['@strudel/core', '@strudel/mini', '@strudel/soundfonts', '@strudel/tonal', '@strudel/transpiler', '@strudel/webaudio', 'superdough'],
    },
    server: {
      fs: { allow: [here, path.dirname(bonfire)] },
      proxy: { '/api': `http://127.0.0.1:${process.env.PORT || 5065}` },
    },
    build: {
      target: 'es2022',
      chunkSizeWarningLimit: 2500,
      rollupOptions: { input: { index: path.join(here, 'index.html'), admin: path.join(here, 'admin.html') } },
    },
  };
});
