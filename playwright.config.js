// Playwright E2E config for the GP API Drop-In UI samples.
//
// One Playwright "project" per backend framework, each pointed at that
// framework's base URL. The same specs in ./tests run against all five,
// proving endpoint parity across implementations.
//
// URL resolution:
//   - Default: Docker Compose service names on the shared `payments` network
//     (this is how `docker-run.sh test` runs the suite, from the `tests`
//     container alongside the five services).
//   - TEST_TARGET=local: the published host ports, so the suite can also be
//     run from the host with `npx playwright test` against `docker-run.sh start`.
//
// Selecting frameworks:
//   - Default: all five.
//   - IMPLEMENTATION_FILTER=<name>: just that one (used by
//     `docker-run.sh test:single <name>`).

const { defineConfig } = require('@playwright/test');

const local = process.env.TEST_TARGET === 'local';

const FRAMEWORKS = {
  nodejs: local ? 'http://localhost:8001' : 'http://nodejs:8000',
  python: local ? 'http://localhost:8002' : 'http://python:8000',
  php:    local ? 'http://localhost:8003' : 'http://php:8000',
  java:   local ? 'http://localhost:8004' : 'http://java:8000',
  dotnet: local ? 'http://localhost:8006' : 'http://dotnet:8000',
};

const filter = process.env.IMPLEMENTATION_FILTER;
const selected = filter ? [filter] : Object.keys(FRAMEWORKS);

const projects = selected.map((name) => {
  if (!FRAMEWORKS[name]) {
    throw new Error(
      `Unknown IMPLEMENTATION_FILTER "${name}". Valid values: ${Object.keys(FRAMEWORKS).join(', ')}`
    );
  }
  return { name, use: { baseURL: FRAMEWORKS[name] } };
});

module.exports = defineConfig({
  testDir: './tests',
  timeout: 60_000,
  expect: { timeout: 15_000 },
  retries: process.env.CI ? 2 : 0,
  // Serial in CI for stable, readable output; each access-token test hits the
  // live GP sandbox so we keep load low.
  workers: process.env.CI ? 1 : undefined,
  reporter: [
    ['list'],
    ['html', { open: 'never', outputFolder: 'playwright-report' }],
    ['junit', { outputFile: 'test-results/results.xml' }],
  ],
  use: {
    actionTimeout: 15_000,
    trace: 'on-first-retry',
  },
  projects,
});
