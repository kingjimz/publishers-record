/**
 * OpenRouter settings are injected at build time via `angular.json` → `define`
 * and/or `yarn start` / `yarn build` (see scripts/ng-with-openrouter-env.cjs), which reads root `.env`.
 * No API key is stored in a tracked TypeScript file.
 */
declare const OPENROUTER_API_KEY: string;
declare const OPENROUTER_MODEL: string;

export const openRouterApiKeyFromEnv = OPENROUTER_API_KEY;
export const openRouterModelFromEnv = OPENROUTER_MODEL;
