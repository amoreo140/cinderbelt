import { test as base, expect } from '@playwright/test';

// The suite asserts the Slovak UI: every page starts as a Slovak first launch. Stored settings with a
// language keep it (language.spec switches and reloads). A describe block that needs an English first
// launch sets `test.use({ firstLaunchLanguage: 'en' })`; a spec that needs the real first launch (no
// preset at all) imports from '@playwright/test' directly.
export const test = base.extend<{ firstLaunchLanguage: 'sk' | 'en' }>({
  firstLaunchLanguage: ['sk', { option: true }],
  context: async ({ context, firstLaunchLanguage }, use) => {
    await context.addInitScript((language) => {
      (globalThis as { __CINDER_FIRST_LANGUAGE__?: string }).__CINDER_FIRST_LANGUAGE__ = language;
    }, firstLaunchLanguage);
    await use(context);
  },
});

export { expect };
