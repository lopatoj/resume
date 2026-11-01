import adapter from '@sveltejs/adapter-node';
import { sveltekit } from '@sveltejs/kit/vite';
import tailwindcss from '@tailwindcss/vite';
import { defineConfig } from 'vite';

// Test servers set these so they never share caches or generated files with a running
// dev server (sharing node_modules/.vite once loaded two copies of Svelte in the browser).
const { VITE_CACHE_DIR, SVELTEKIT_OUT_DIR, BUILD_OUT_DIR, BUILD_ORIGIN } = process.env;

export default defineConfig({
	...(VITE_CACHE_DIR ? { cacheDir: VITE_CACHE_DIR } : {}),
	plugins: [
		tailwindcss(),
		sveltekit({
			compilerOptions: {
				// Force runes mode for the project, except for libraries. Can be removed in svelte 6.
				runes: ({ filename }) =>
					filename.split(/[/\\]/).includes('node_modules') ? undefined : true
			},

			adapter: adapter(BUILD_OUT_DIR ? { out: BUILD_OUT_DIR } : {}),
			...(SVELTEKIT_OUT_DIR ? { outDir: SVELTEKIT_OUT_DIR } : {}),
			// The built server's origin; otherwise it assumes https and rejects http form posts.
			...(BUILD_ORIGIN ? { paths: { origin: BUILD_ORIGIN } } : {})
		})
	]
});
