import type { LanguageModel } from 'ai';

// --- Provider Types ---

export const PROVIDER_NAMES = ['openrouter', 'anthropic', 'openai', 'google'] as const;
export type ProviderName = (typeof PROVIDER_NAMES)[number];

export const PROVIDER_ENV_VARS: Record<ProviderName, string> = {
  openrouter: 'OPENROUTER_API_KEY',
  anthropic: 'ANTHROPIC_API_KEY',
  openai: 'OPENAI_API_KEY',
  google: 'GOOGLE_GENERATIVE_AI_API_KEY',
};

// --- Skill Types ---

export interface SkillDefinition {
  name: string;
  description: string;
  body: string;
  rawContent: string;
}

// --- Test Types ---

export interface TestPrompt {
  text: string;
  type: 'positive' | 'negative';
}

export interface TestResult {
  modelId: string;
  prompt: TestPrompt;
  response: string;
  latencyMs: number;
  error?: string;
}

// --- Evaluation Types ---

export interface TriggerEval {
  triggered: boolean;
  correct: boolean;
  reason: string;
}

export interface ComplianceEval {
  compliant: boolean;
  score: number;
  reason: string;
}

export interface EvalResult {
  modelId: string;
  prompt: TestPrompt;
  response: string;
  trigger: TriggerEval;
  compliance?: ComplianceEval;
}

export interface EvalReport {
  modelId: string;
  triggerScore: { correct: number; total: number };
  complianceScore: { correct: number; total: number; avgScore: number };
  overall: number;
}

// --- Constants ---

export const DEFAULT_FREE_MODELS = [
  'meta-llama/llama-3.3-70b-instruct:free',
  'mistralai/mistral-small-3.1-24b-instruct:free',
  'google/gemma-3-27b-it:free',
  'qwen/qwen3-coder:free',
  'nousresearch/hermes-3-llama-3.1-405b:free',
];

export const DEFAULT_GENERATOR_MODELS = [
  'meta-llama/llama-3.3-70b-instruct:free',
  'google/gemma-3-27b-it:free',
  'mistralai/mistral-small-3.1-24b-instruct:free',
];
export const DEFAULT_JUDGE_MODELS = [
  'meta-llama/llama-3.3-70b-instruct:free',
  'google/gemma-3-27b-it:free',
  'mistralai/mistral-small-3.1-24b-instruct:free',
];

export const REQUEST_TIMEOUT_MS = 30_000;

export const DUMMY_SKILLS = [
  {
    name: 'git-commit-helper',
    description: 'Helps create well-formatted git commits with conventional commit messages.',
  },
  {
    name: 'api-documentation',
    description: 'Generates API documentation from code comments and type definitions.',
  },
  {
    name: 'test-generator',
    description: 'Creates unit tests for functions and classes based on their signatures and behavior.',
  },
];

// --- Model holder for passing around ---

export interface ModelWithId {
  model: LanguageModel;
  modelId: string;
}

// --- Multi-skill evaluation summary ---

export interface SkillEvalSummary {
  skill: SkillDefinition;
  reports: EvalReport[];
  evalResults: EvalResult[];
}
