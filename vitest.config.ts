import path from 'node:path';
import { defineConfig } from 'vitest/config';

const root = import.meta.dirname;
// Server modules import SvelteKit's env module; under Vitest it reads process.env instead.
const alias = { '$app/env/private': path.join(root, 'tests/support/app-env-private.ts') };

export default defineConfig({
	// Never share node_modules/.vite with a running dev server (see CLAUDE.md).
	cacheDir: 'node_modules/.vitest',
	test: {
		projects: [
			{
				cacheDir: 'node_modules/.vitest/unit',
				resolve: { alias },
				test: {
					name: 'unit',
					include: ['tests/unit/**/*.test.ts'],
					environment: 'node'
				}
			},
			{
				cacheDir: 'node_modules/.vitest/integration',
				resolve: { alias },
				test: {
					name: 'integration',
					include: ['tests/integration/**/*.test.ts'],
					environment: 'node',
					setupFiles: ['tests/support/integration-setup.ts'],
					// Each file gets its own worker, database and module state.
					pool: 'forks',
					isolate: true,
					testTimeout: 60_000,
					hookTimeout: 120_000
				}
			}
		]
	}
});
