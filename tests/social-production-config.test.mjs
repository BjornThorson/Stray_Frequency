import test from 'node:test';
import assert from 'node:assert/strict';
import { loadEnv } from 'vite';

test('the production build opts in to the deployed Marrow visit feature', () => {
  const production = loadEnv('production', process.cwd(), 'VITE_');
  assert.equal(production.VITE_SOCIAL_ENCOUNTERS_ENABLED, 'true');
});

test('the development build does not turn on the first NPC encounter by default', () => {
  const development = loadEnv('development', process.cwd(), 'VITE_');
  assert.notEqual(development.VITE_SOCIAL_ENCOUNTERS_ENABLED, 'true');
});
