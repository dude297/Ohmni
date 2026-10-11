import { fileURLToPath } from 'node:url';
import { configDefaults, defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: { alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) } },
  // Agent worktrees live under .claude/worktrees; never run their tests from the main checkout.
  test: { exclude: [...configDefaults.exclude, '.claude/**'] },
});
