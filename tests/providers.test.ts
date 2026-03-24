import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { resolveApiKey } from '../src/providers.js';

describe('resolveApiKey', () => {
  const originalEnv = { ...process.env };

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  it('returns CLI key when provided', () => {
    expect(resolveApiKey('openrouter', 'my-key')).toBe('my-key');
  });

  it('returns env var when no CLI key', () => {
    process.env.OPENROUTER_API_KEY = 'env-key';
    expect(resolveApiKey('openrouter')).toBe('env-key');
  });

  it('prefers CLI key over env var', () => {
    process.env.OPENROUTER_API_KEY = 'env-key';
    expect(resolveApiKey('openrouter', 'cli-key')).toBe('cli-key');
  });

  it('throws when no key is available', () => {
    delete process.env.OPENROUTER_API_KEY;
    expect(() => resolveApiKey('openrouter')).toThrow('No API key found for openrouter');
  });

  it('checks correct env var per provider', () => {
    process.env.ANTHROPIC_API_KEY = 'anthropic-key';
    expect(resolveApiKey('anthropic')).toBe('anthropic-key');

    process.env.OPENAI_API_KEY = 'openai-key';
    expect(resolveApiKey('openai')).toBe('openai-key');

    process.env.GOOGLE_GENERATIVE_AI_API_KEY = 'google-key';
    expect(resolveApiKey('google')).toBe('google-key');

    process.env.AZURE_API_KEY = 'azure-key';
    expect(resolveApiKey('azure')).toBe('azure-key');
  });
});
