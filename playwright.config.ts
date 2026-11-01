import { defineConfig, devices } from '@playwright/test';

// Override both to run more than one end-to-end session at a time.
const PORT = Number(process.env.E2E_PORT ?? 5199);
const JEV_PORT = Number(process.env.FAKE_JEV_PORT ?? 5198);

export default defineConfig({
	testDir: 'tests/e2e',
	// One app instance and one database: run tests one at a time; specs create their own jobs.
	fullyParallel: false,
	workers: 1,
	retries: 0,
	timeout: 60_000,
	expect: { timeout: 10_000 },
	reporter: [['list'], ['html', { open: 'never' }]],
	use: {
		baseURL: `http://127.0.0.1:${PORT}`,
		trace: 'retain-on-failure',
		screenshot: 'only-on-failure'
	},
	projects: [
		{ name: 'chromium', use: { ...devices['Desktop Chrome'], viewport: { width: 1600, height: 1000 } } },
		{ name: 'firefox', use: { ...devices['Desktop Firefox'], viewport: { width: 1600, height: 1000 } } }
	],
	webServer: [
		{
			command: 'node tests/e2e/fake-jev-server.ts',
			url: `http://127.0.0.1:${JEV_PORT}/health`,
			env: { FAKE_JEV_PORT: String(JEV_PORT) },
			reuseExistingServer: false
		},
		{
			command: 'node tests/e2e/serve.ts',
			url: `http://127.0.0.1:${PORT}`,
			env: { E2E_PORT: String(PORT), FAKE_JEV_URL: `http://127.0.0.1:${JEV_PORT}` },
			timeout: 180_000,
			reuseExistingServer: false
		}
	]
});
