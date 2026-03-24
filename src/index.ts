#!/usr/bin/env node

import 'dotenv/config';
import { Command } from 'commander';
import chalk from 'chalk';
import { parseSkill } from './parser.js';
import { scanForSkills } from './scanner.js';
import { createModel, resolveApiKey } from './providers.js';
import { generateTestPrompts } from './test-generator.js';
import { runTests } from './runner.js';
import { evaluateResults, computeReport } from './evaluator.js';
import { printReport, printBatchReport } from './reporter.js';
import { buildDependencyGraph, renderGraph } from './graph.js';
import {
  DEFAULT_FREE_MODELS,
  DEFAULT_GENERATOR_MODELS,
  DEFAULT_JUDGE_MODELS,
  PROVIDER_NAMES,
  type BatchSkillReport,
  type ModelWithId,
  type ProviderName,
  type SkillDefinition,
} from './config.js';

const program = new Command();

async function isDirectorySource(source: string): Promise<boolean> {
  // GitHub tree URL (owner/repo/tree/branch/path)
  if (/^https?:\/\/github\.com\/[^/]+\/[^/]+\/tree\//.test(source)) return true;

  // Local directory check
  try {
    const { stat } = await import('node:fs/promises');
    const stats = await stat(source);
    return stats.isDirectory();
  } catch {
    return false;
  }
}

async function runSingleSkill(
  skill: SkillDefinition,
  opts: {
    provider: ProviderName;
    apiKey: string;
    internalApiKey: string;
    models: ModelWithId[];
    modelIds: string[];
    generatorModelIds: string[];
    judgeModelIds: string[];
    count: number;
    json: boolean;
    verbose: boolean;
    prompts?: string;
  },
  siblingSkills?: SkillDefinition[],
): Promise<BatchSkillReport> {
  const {
    provider, apiKey, internalApiKey, models, modelIds,
    generatorModelIds, judgeModelIds, count, json, verbose,
  } = opts;

  // Generate test prompts
  process.stderr.write(chalk.cyan(`  Generating test prompts for "${skill.name}"...\n`));
  const generatorModels = generatorModelIds.map(id => createModel('openrouter', id, internalApiKey));
  const prompts = await generateTestPrompts(skill, generatorModels, count, opts.prompts, verbose);
  process.stderr.write(chalk.green(`  Generated ${prompts.length} test prompts\n\n`));

  // Run trigger tests
  process.stderr.write(chalk.cyan(`  Running trigger tests for "${skill.name}"...\n`));
  const testResults = await runTests(skill, prompts, models, verbose, siblingSkills);

  // Evaluate results
  process.stderr.write(chalk.cyan(`  Evaluating results for "${skill.name}"...\n`));
  const judgeModels = judgeModelIds.map(id => createModel('openrouter', id, internalApiKey));
  const evalResults = await evaluateResults(skill, testResults, judgeModels, models, verbose);

  // Compute report
  const reports = computeReport(evalResults, modelIds);

  return { skill, reports, evalResults };
}

program
  .name('skilleval')
  .description('Evaluate how well AI models understand Agent Skills (SKILL.md files)')
  .version('0.1.0')
  .argument('<skill>', 'Path, URL, or GitHub shorthand to a SKILL.md file or a folder containing SKILL.md files')
  .option('-p, --provider <provider>', 'Provider: openrouter, anthropic, openai, google, azure', 'openrouter')
  .option('-m, --models <models>', 'Comma-separated model IDs to test')
  .option('-k, --key <key>', 'API key (or use provider-specific env var)')
  .option('--generator-model <model>', 'Model for test prompt generation (comma-separated for fallbacks)')
  .option('--judge-model <model>', 'Model for evaluation judging (comma-separated for fallbacks)')
  .option('--json', 'Output results as JSON', false)
  .option('--verbose', 'Show detailed per-prompt results', false)
  .option('--prompts <path>', 'Path to JSON file with custom test prompts')
  .option('-s, --skill <name>', 'Skill name within the repo (looks for skills/<name>/SKILL.md)')
  .option('-n, --count <number>', 'Number of positive+negative test prompts (default: 5+5)', '5')
  .option('--graph', 'Show dependency graph between skills (folder/repo mode only)', false)
  .action(async (skillSource: string, opts) => {
    try {
      // Detect if source is a directory (local or GitHub tree)
      const isDir = await isDirectorySource(skillSource);

      // --graph mode: only needs skill discovery, no API keys or models
      if (opts.graph) {
        if (!isDir) {
          console.error(chalk.red('The --graph flag requires a folder or repository, not a single skill file.'));
          process.exit(1);
        }

        process.stderr.write(chalk.cyan('Scanning for SKILL.md files...\n'));
        const scanResult = await scanForSkills(skillSource);

        if (scanResult.skills.length === 0) {
          console.error(chalk.red(`No SKILL.md files found in "${skillSource}".`));
          process.exit(1);
        }

        const graph = buildDependencyGraph(scanResult.skills);
        renderGraph(graph, { json: opts.json });
        process.exit(0);
      }

      const provider = opts.provider as ProviderName;
      if (!PROVIDER_NAMES.includes(provider)) {
        console.error(chalk.red(`Invalid provider "${provider}". Must be one of: ${PROVIDER_NAMES.join(', ')}`));
        process.exit(1);
      }

      // Resolve API key for the test models
      let apiKey: string;
      try {
        apiKey = resolveApiKey(provider, opts.key);
      } catch (err) {
        console.error(chalk.red((err as Error).message));
        process.exit(1);
      }

      // Resolve model IDs
      const modelIds = opts.models
        ? (opts.models as string).split(',').map((m: string) => m.trim())
        : (provider === 'openrouter' ? DEFAULT_FREE_MODELS : []);

      if (modelIds.length === 0) {
        console.error(chalk.red('No models specified. Use --models or default to openrouter provider for free models.'));
        process.exit(1);
      }

      // Resolve generator/judge keys (always OpenRouter for internal models)
      let internalApiKey: string;
      try {
        internalApiKey = resolveApiKey('openrouter', provider === 'openrouter' ? apiKey : undefined);
      } catch {
        if (!opts.prompts) {
          console.error(chalk.red(
            'OPENROUTER_API_KEY is required for test generation and evaluation (uses free models).\n' +
            'Set OPENROUTER_API_KEY env var, or provide custom prompts with --prompts.',
          ));
          process.exit(1);
        }
        internalApiKey = '';
      }

      const generatorModelIds = opts.generatorModel
        ? (opts.generatorModel as string).split(',').map((m: string) => m.trim())
        : DEFAULT_GENERATOR_MODELS;

      const judgeModelIds = opts.judgeModel
        ? (opts.judgeModel as string).split(',').map((m: string) => m.trim())
        : DEFAULT_JUDGE_MODELS;

      const count = parseInt(opts.count, 10);

      // Create model instances
      const models: ModelWithId[] = modelIds.map(id => ({
        model: createModel(provider, id, apiKey),
        modelId: id,
      }));

      const commonOpts = {
        provider,
        apiKey,
        internalApiKey,
        models,
        modelIds,
        generatorModelIds,
        judgeModelIds,
        count,
        json: opts.json,
        verbose: opts.verbose,
        prompts: opts.prompts,
      };

      if (isDir) {
        // --- Batch mode: scan folder for all SKILL.md files ---
        process.stderr.write(chalk.cyan('Scanning for SKILL.md files...\n'));
        const scanResult = await scanForSkills(skillSource);

        if (scanResult.skills.length === 0) {
          console.error(chalk.red(`No SKILL.md files found in "${skillSource}".`));
          if (scanResult.errors.length > 0) {
            for (const err of scanResult.errors) {
              console.error(chalk.yellow(`  Parse error: ${err.path} — ${err.error}`));
            }
          }
          process.exit(1);
        }

        if (!opts.json) {
          console.log(`\n${chalk.bold('skilleval')} v0.1.0 ${chalk.dim('(batch mode)')}`);
          console.log(`${chalk.bold('Skills found:')} ${scanResult.skills.length}`);
          for (const skill of scanResult.skills) {
            console.log(`  ${chalk.cyan('•')} ${skill.name} — ${chalk.dim(skill.description.slice(0, 80))}`);
          }
          if (scanResult.errors.length > 0) {
            console.log(chalk.yellow(`\nSkipped ${scanResult.errors.length} file(s) with parse errors:`));
            for (const err of scanResult.errors) {
              console.log(chalk.yellow(`  ${err.path}: ${err.error}`));
            }
          }
          console.log(`${chalk.bold('Provider:')} ${provider}`);
          console.log(`${chalk.bold('Models:')} ${modelIds.length}\n`);
        }

        // Show dependency graph in batch mode
        const graph = buildDependencyGraph(scanResult.skills);
        if (graph.edges.length > 0 && !opts.json) {
          renderGraph(graph, { json: false });
        }

        // Run evaluation for each skill, using other found skills as distractors
        const batchResults: BatchSkillReport[] = [];

        for (let i = 0; i < scanResult.skills.length; i++) {
          const skill = scanResult.skills[i];
          const siblingSkills = scanResult.skills.filter((_, idx) => idx !== i);

          if (!opts.json) {
            console.log(`\n${chalk.bold.magenta(`[${i + 1}/${scanResult.skills.length}]`)} Evaluating "${skill.name}"...`);
          }

          const result = await runSingleSkill(skill, commonOpts, siblingSkills);
          batchResults.push(result);
        }

        // Print combined report
        console.log('');
        printBatchReport(batchResults, { json: opts.json, verbose: opts.verbose });

        // Exit code: fail if any skill has any model scoring < 50%
        const allPassing = batchResults.every(b => b.reports.every(r => r.overall >= 50));
        process.exit(allPassing ? 0 : 1);
      } else {
        // --- Single skill mode (original behavior) ---
        process.stderr.write(chalk.cyan('Parsing skill...\n'));
        const skill = await parseSkill(skillSource, opts.skill);

        if (!opts.json) {
          console.log(`\n${chalk.bold('skilleval')} v0.1.0`);
          console.log(`${chalk.bold('Skill:')} ${skill.name}`);
          console.log(`${chalk.bold('Description:')} ${skill.description}`);
          console.log(`${chalk.bold('Provider:')} ${provider}`);
          console.log(`${chalk.bold('Models:')} ${modelIds.length}\n`);
        }

        const result = await runSingleSkill(skill, commonOpts);

        console.log('');
        printReport(result.reports, result.evalResults, { json: opts.json, verbose: opts.verbose });

        const allPassing = result.reports.every(r => r.overall >= 50);
        process.exit(allPassing ? 0 : 1);
      }
    } catch (err) {
      console.error(chalk.red(`Error: ${(err as Error).message}`));
      process.exit(1);
    }
  });

program.parse();
