import { generateText } from 'ai';
import { buildTriggerSystemPrompt } from './context-builder.js';
import type { ModelWithId, SkillDefinition, TestPrompt, TestResult } from './config.js';

export async function runTests(
  skill: SkillDefinition,
  prompts: TestPrompt[],
  models: ModelWithId[],
  verbose: boolean,
  allSkills: SkillDefinition[] = [],
): Promise<TestResult[]> {
  const systemPrompt = buildTriggerSystemPrompt(skill, allSkills);
  const results: TestResult[] = [];
  const totalTests = models.length * prompts.length;
  let completed = 0;

  if (verbose) {
    process.stderr.write(`\n  Trigger system prompt:\n  ---\n${systemPrompt}\n  ---\n\n`);
  }

  for (const { model, modelId } of models) {
    for (const prompt of prompts) {
      completed++;
      process.stderr.write(`\r  [${completed}/${totalTests}] Testing ${modelId}...`);

      const start = performance.now();
      try {
        const { text } = await generateText({
          model,
          messages: [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: prompt.text },
          ],
          temperature: 0.3,
        });

        results.push({
          modelId,
          prompt,
          response: text,
          latencyMs: Math.round(performance.now() - start),
        });

        if (verbose) {
          process.stderr.write(`\n    ${prompt.type}: "${prompt.text.slice(0, 60)}..." → ${text.slice(0, 80)}...\n`);
        }
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        results.push({
          modelId,
          prompt,
          response: '',
          latencyMs: Math.round(performance.now() - start),
          error: message,
        });

        if (verbose) {
          process.stderr.write(`\n    ERROR: ${message}\n`);
        }
      }
    }
  }

  process.stderr.write('\n');
  return results;
}
