import { createOpenAI } from '@ai-sdk/openai';
import { createAnthropic } from '@ai-sdk/anthropic';
import { createGoogleGenerativeAI } from '@ai-sdk/google';
import { createAzure } from '@ai-sdk/azure';
import type { LanguageModel } from 'ai';
import { type ProviderName, PROVIDER_ENV_VARS } from './config.js';

export function resolveApiKey(provider: ProviderName, cliKey?: string): string {
  if (cliKey) return cliKey;

  const envVar = PROVIDER_ENV_VARS[provider];
  const envValue = process.env[envVar];
  if (envValue) return envValue;

  throw new Error(
    `No API key found for ${provider}. Provide --key or set ${envVar} environment variable.`
  );
}

export function createModel(provider: ProviderName, modelId: string, apiKey: string): LanguageModel {
  switch (provider) {
    case 'openrouter':
      return createOpenAI({
        baseURL: 'https://openrouter.ai/api/v1',
        apiKey,
        headers: {
          'HTTP-Referer': 'https://github.com/zlatkov/skilleval',
          'X-Title': 'skilleval',
        },
      })(modelId);

    case 'openai':
      return createOpenAI({ apiKey })(modelId);

    case 'anthropic':
      return createAnthropic({ apiKey })(modelId);

    case 'google':
      return createGoogleGenerativeAI({ apiKey })(modelId);

    case 'azure': {
      const resourceName = process.env.AZURE_RESOURCE_NAME;
      if (!resourceName) {
        throw new Error('AZURE_RESOURCE_NAME environment variable is required for the azure provider.');
      }
      return createAzure({ resourceName, apiKey })(modelId);
    }
  }
}
