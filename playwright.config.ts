import { defineConfig } from '@playwright/test';
const baseURL = process.env.PDF_BASE_URL ?? 'http://127.0.0.1:4173/pdf/';
export default defineConfig({
    testDir: 'tests/browser', timeout: 180000, expect: { timeout: 10000 },
    fullyParallel: false, workers: 1,
    use: { baseURL, trace: 'retain-on-failure', screenshot: 'only-on-failure' },
    webServer: process.env.PDF_BASE_URL ? undefined : {
        command: 'node node_modules/vite/bin/vite.js preview --port 4173',
        url: baseURL, reuseExistingServer: !process.env.CI
    },
    projects: [
        { name: 'chromium', use: { browserName: 'chromium' } },
        { name: 'webkit', use: { browserName: 'webkit' } }
    ]
});
