import { generateText, type LanguageModel } from 'ai';
import { buildComplianceSystemPrompt, buildMockTools } from './context-builder.js';
import type {
  ComplianceEval,
  EvalReport,
  EvalResult,
  ModelWithId,
  SkillDefinition,
  TestResult,
  TriggerEval,
} from './config.js';

const RETRY_DELAY_MS = 2000;
const MAX_RETRIES = 3;

async function generateWithRetry(
  models: LanguageModel[],
  options: { system: string; prompt: string; temperature: number },
): Promise<string> {
  for (let modelIdx = 0; modelIdx < models.length; modelIdx++) {
    for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
      try {
        const { text } = await generateText({
          model: models[modelIdx],
          system: options.system,
          prompt: options.prompt,
          temperature: options.temperature,
        });
        return text;
      } catch {
        if (attempt < MAX_RETRIES - 1) {
          await new Promise(resolve => setTimeout(resolve, RETRY_DELAY_MS));
        }
      }
    }
  }
  throw new Error('All judge models failed');
}

function stripCodeFences(text: string): string {
  return text.replace(/^```(?:json)?\s*\n?/gm, '').replace(/\n?```\s*$/gm, '').trim();
}

function safeParseTriggerEval(text: string): TriggerEval {
  try {
    const parsed = JSON.parse(stripCodeFences(text));
    return {
      triggered: Boolean(parsed.triggered),
      correct: Boolean(parsed.correct),
      reason: String(parsed.reason ?? ''),
    };
  } catch {
    return { triggered: false, correct: false, reason: 'Failed to parse judge response' };
  }
}

function safeParseComplianceEval(text: string): ComplianceEval {
  try {
    const parsed = JSON.parse(stripCodeFences(text));
    return {
      compliant: Boolean(parsed.compliant),
      score: Math.max(0, Math.min(100, Number(parsed.score) || 0)),
      reason: String(parsed.reason ?? ''),
    };
  } catch {
    return { compliant: false, score: 0, reason: 'Failed to parse judge response' };
  }
}

const TRIGGER_JUDGE_SYSTEM = `You are an evaluation judge. You assess whether an AI model correctly identified when to use a specific skill.
Respond ONLY with valid JSON, no other text.`;

function triggerJudgePrompt(
  skill: SkillDefinition,
  promptText: string,
  promptType: 'positive' | 'negative',
  response: string,
): string {
  return `## Skill Being Tested
Name: ${skill.name}
Description: ${skill.description}

## User Prompt
"${promptText}"

## Expected Behavior
This is a ${promptType} test case.
${promptType === 'positive'
    ? 'The model SHOULD have recognized this skill as relevant and indicated it would use it.'
    : 'The model should NOT have mentioned or tried to use this skill.'}

## Model Response
${response}

## Your Task
Did the model behave correctly? Evaluate whether it correctly identified (or correctly ignored) the "${skill.name}" skill.

Respond ONLY with JSON:
{"triggered": true/false, "correct": true/false, "reason": "brief explanation"}`;
}

const COMPLIANCE_JUDGE_SYSTEM = `You are an evaluation judge. You assess whether an AI model correctly followed a skill's instructions by calling the right tools and following the right workflow.
Respond ONLY with valid JSON, no other text.`;

function complianceJudgePrompt(
  skill: SkillDefinition,
  promptText: string,
  response: string,
): string {
  return `## Skill Instructions
${skill.body}

## User Prompt
"${promptText}"

## Model Response and Tool Calls
${response}

## Your Task
Did the model correctly follow the skill's instructions? Evaluate:
1. Did it call the correct tools as described in the skill?
2. Did it pass reasonable arguments to those tools?
3. Did it follow the stated workflow/steps in the right order?
4. Did it stay within the scope of the skill?

Note: Tools returned mock results. Do not penalize for the quality of returned data — focus on whether the model called the right tools with the right parameters.

Respond ONLY with JSON:
{"compliant": true/false, "score": 0-100, "reason": "brief explanation"}`;
}

export async function evaluateResults(
  skill: SkillDefinition,
  testResults: TestResult[],
  judgeModels: LanguageModel[],
  models: ModelWithId[],
  verbose: boolean,
  allSkills: SkillDefinition[] = [],
): Promise<EvalResult[]> {
  const evalResults: EvalResult[] = [];
  const total = testResults.length;
  let completed = 0;

  const mockTools = buildMockTools();
  const toolNames = Object.keys(mockTools);
  const complianceSystemPrompt = buildComplianceSystemPrompt(skill, allSkills);

  if (verbose) {
    process.stderr.write(`\n  Compliance system prompt:\n  ---\n${complianceSystemPrompt}\n  ---\n`);
    if (toolNames.length > 0) {
      process.stderr.write(`  Mock tools provided: ${toolNames.join(', ')}\n`);
    }
    process.stderr.write('\n');
  }

  for (const result of testResults) {
    completed++;
    const prefix = `  [${completed}/${total}] ${result.modelId} — ${result.prompt.type}: "${result.prompt.text.slice(0, 40)}..."`;

    if (result.error) {
      process.stderr.write(`\n${prefix} — skipped (error)\n`);
      evalResults.push({
        modelId: result.modelId,
        prompt: result.prompt,
        response: result.response,
        trigger: { triggered: false, correct: false, reason: `Error: ${result.error}` },
      });
      continue;
    }

    // Trigger evaluation
    process.stderr.write(`\n${prefix}\n    Judging trigger...`);
    let trigger: TriggerEval;
    try {
      const text = await generateWithRetry(judgeModels, {
        system: TRIGGER_JUDGE_SYSTEM,
        prompt: triggerJudgePrompt(skill, result.prompt.text, result.prompt.type, result.response),
        temperature: 0.1,
      });
      trigger = safeParseTriggerEval(text);
      process.stderr.write(` ${trigger.correct ? 'PASS' : 'FAIL'} (triggered: ${trigger.triggered})\n`);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      trigger = { triggered: false, correct: false, reason: `Judge call failed: ${message}` };
      process.stderr.write(` FAILED: ${message}\n`);
    }

    // Compliance evaluation (only for positive prompts where skill was triggered)
    let compliance: ComplianceEval | undefined;
    if (result.prompt.type === 'positive' && trigger.triggered) {
      // Run compliance test: send the same prompt with full skill content and mock tools
      const modelEntry = models.find(m => m.modelId === result.modelId);
      if (modelEntry) {
        try {
          process.stderr.write(`    Running compliance test...`);
          if (toolNames.length > 0) {
            process.stderr.write(` (mock tools: ${toolNames.join(', ')})`);
          }
          const { text: complianceResponse, toolCalls, steps } = await generateText({
            model: modelEntry.model,
            messages: [
              { role: 'system', content: complianceSystemPrompt },
              { role: 'user', content: result.prompt.text },
            ],
            tools: mockTools,
            maxSteps: 10,
            temperature: 0.3,
          });

          // Collect all tool calls across all steps
          const allToolCalls = steps.flatMap(step => step.toolCalls ?? []);
          const toolCallSummary = allToolCalls.length > 0
            ? `\n\nTool calls made:\n${allToolCalls.map(tc => `- ${tc.toolName}(${JSON.stringify(tc.args)})`).join('\n')}`
            : '\n\nNo tool calls were made.';
          const fullResponse = complianceResponse + toolCallSummary;
          process.stderr.write(` done (${allToolCalls.length} tool calls, ${steps.length} steps)\n`);

          if (verbose) {
            if (allToolCalls.length > 0) {
              process.stderr.write(`    Tool calls:\n`);
              for (const tc of allToolCalls) {
                process.stderr.write(`      - ${tc.toolName}(${JSON.stringify(tc.args).slice(0, 100)})\n`);
              }
            }
          }

          process.stderr.write(`    Judging compliance...`);
          const judgeText = await generateWithRetry(judgeModels, {
            system: COMPLIANCE_JUDGE_SYSTEM,
            prompt: complianceJudgePrompt(skill, result.prompt.text, fullResponse),
            temperature: 0.1,
          });
          compliance = safeParseComplianceEval(judgeText);
          process.stderr.write(` ${compliance.compliant ? 'PASS' : 'FAIL'} (${compliance.score}/100)\n`);
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          compliance = { compliant: false, score: 0, reason: `Compliance evaluation failed: ${message}` };
          process.stderr.write(` FAILED: ${message}\n`);
        }
      }
    }

    evalResults.push({
      modelId: result.modelId,
      prompt: result.prompt,
      response: result.response,
      trigger,
      compliance,
    });

    if (verbose) {
      process.stderr.write(`    Reason: ${trigger.reason}\n`);
      if (compliance) {
        process.stderr.write(`    Compliance reason: ${compliance.reason}\n`);
      }
    }
  }

  process.stderr.write('\n');
  return evalResults;
}

export function computeReport(evalResults: EvalResult[], modelIds: string[]): EvalReport[] {
  return modelIds.map(modelId => {
    const modelResults = evalResults.filter(r => r.modelId === modelId);

    const triggerTotal = modelResults.length;
    const triggerCorrect = modelResults.filter(r => r.trigger.correct).length;

    const complianceResults = modelResults.filter(r => r.compliance != null);
    const complianceCorrect = complianceResults.filter(r => r.compliance!.compliant).length;
    const complianceTotal = complianceResults.length;
    const avgScore = complianceTotal > 0
      ? complianceResults.reduce((sum, r) => sum + r.compliance!.score, 0) / complianceTotal
      : 0;

    const triggerAcc = triggerTotal > 0 ? triggerCorrect / triggerTotal : 0;
    const complianceAcc = complianceTotal > 0 ? complianceCorrect / complianceTotal : 0;
    const overall = Math.round(triggerAcc * 50 + complianceAcc * 30 + (avgScore / 100) * 20);

    return {
      modelId,
      triggerScore: { correct: triggerCorrect, total: triggerTotal },
      complianceScore: { correct: complianceCorrect, total: complianceTotal, avgScore: Math.round(avgScore) },
      overall,
    };
  }).sort((a, b) => b.overall - a.overall);
}
