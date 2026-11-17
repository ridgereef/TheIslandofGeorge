import { defineConfig } from 'vite';
import vue from '@vitejs/plugin-vue';
import { readdir, stat, unlink } from 'node:fs/promises';
import { join, relative, sep } from 'node:path';

// Cloudflare Workers Static Assets rejects any single file larger than 25 MiB.
// Keep oversized source GLB files in Git/LFS, but omit them from dist until
// lightweight versions or externally hosted (e.g. R2) assets are available.
const MAX_WORKER_ASSET_BYTES = 25 * 1024 * 1024;
function excludeOversizedModels() {
  return {
    name: 'exclude-oversized-worker-models',
    apply: 'build',
    async closeBundle() {
      const dist = join(process.cwd(), 'dist');
      let removed = 0;
      async function scan(directory) {
        for (const entry of await readdir(directory, { withFileTypes: true })) {
          const path = join(directory, entry.name);
          if (entry.isDirectory()) {
            await scan(path);
            continue;
          }
          if (!entry.isFile()) continue;
          const { size } = await stat(path);
          if (size <= MAX_WORKER_ASSET_BYTES) continue;
          const name = relative(dist, path).split(sep).join('/');
          if (!name.startsWith('models/') || !name.toLowerCase().endsWith('.glb')) {
            throw new Error(`Asset ${name} exceeds Cloudflare's 25 MiB limit; cannot deploy safely.`);
          }
          await unlink(path);
          removed++;
          console.warn(`Cloudflare: excluded oversized 3D model ${name} (${(size / 1048576).toFixed(1)} MiB). Optimize or host in R2 before using it.`);
        }
      }
      await scan(dist);
      if (removed) console.warn(`Cloudflare: ${removed} oversized models excluded from dist; original Git LFS files remain unchanged.`);
    }
  };
}

export default defineConfig({ plugins: [vue(), excludeOversizedModels()] });
