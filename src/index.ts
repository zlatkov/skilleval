#!/usr/bin/env node

import 'dotenv/config';
import { Command } from 'commander';
import chalk from 'chalk';
import { parseSkill, resolveSkillSources } from './parser.js';
import { createModel, resolveApiKey } from './providers.js';
import { generateTestPrompts } from './test-generator.js';
import { runTests } from './runner.js';
import { evaluateResults, computeReport } from './evaluator.js';
import { printReport } from './reporter.js';
import {
  DEFAULT_FREE_MODELS,
  DEFAULT_GENERATOR_MODELS,
  DEFAULT_JUDGE_MODELS,
  PROVIDER_NAMES,
  type ModelWithId,
  type ProviderName,
  type SkillEvalSummary,
} from './config.js';

const program = new Command();

program
  .name('skilleval')
  .description('Evaluate how well AI models understand Agent Skills (SKILL.md files)')
  .version('0.1.0')
  .argument('<skills...>', 'One or more paths, URLs, or GitHub shorthands (owner/repo) to SKILL.md files')
  .option('-p, --provider <provider>', 'Provider: openrouter, anthropic, openai, google', 'openrouter')
  .option('-m, --models <models>', 'Comma-separated model IDs to test')
  .option('-k, --key <key>', 'API key (or use provider-specific env var)')
  .option('--generator-model <model>', 'Model for test prompt generation (comma-separated for fallbacks)')
  .option('--judge-model <model>', 'Model for evaluation judging (comma-separated for fallbacks)')
  .option('--json', 'Output results as JSON', false)
  .option('--verbose', 'Show detailed per-prompt results', false)
  .option('--prompts <path>', 'Path to JSON file with custom test prompts (single-skill only)')
  .option('-s, --skill <name>', 'Skill name within the repo (looks for skills/<name>/SKILL.md)')
  .option('-n, --count <number>', 'Number of positive+negative test prompts (default: 5+5)', '5')
  .action(async (skillSources: string[], opts) => {
    try {
      const provider = opts.provider as ProviderName;
      if (!PROVIDER_NAMES.includes(provider)) {
        console.error(chalk.red(`Invalid provider "${provider}". Must be one of: ${PROVIDER_NAMES.join(', ')}`));
        process.exit(1);
      }

      if (opts.prompts && skillSources.length > 1) {
        console.error(chalk.red('--prompts can only be used when evaluating a single skill.'));
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

      // Expand any directory sources to individual SKILL.md paths
      const expandedSources = (await Promise.all(skillSources.map(resolveSkillSources))).flat();
      // Deduplicate while preserving order
      const uniqueSources = [...new Set(expandedSources)];

      // Parse all skills
      process.stderr.write(chalk.cyan('Parsing skills...\n'));
      const skills = await Promise.all(
        uniqueSources.map(src => parseSkill(src, uniqueSources.length === 1 ? opts.skill : undefined)),
      );

      if (!opts.json) {
        console.log(`\n${chalk.bold('skilleval')} v0.1.0`);
        if (skills.length === 1) {
          console.log(`${chalk.bold('Skill:')} ${skills[0].name}`);
          console.log(`${chalk.bold('Description:')} ${skills[0].description}`);
        } else {
          console.log(`${chalk.bold('Skills:')} ${skills.map(s => s.name).join(', ')}`);
        }
        console.log(`${chalk.bold('Provider:')} ${provider}`);
        console.log(`${chalk.bold('Models:')} ${modelIds.length}\n`);
      }

      // Create model instances
      const models: ModelWithId[] = modelIds.map(id => ({
        model: createModel(provider, id, apiKey),
        modelId: id,
      }));

      // Generator and judge model instances
      const generatorModelIds = opts.generatorModel
        ? (opts.generatorModel as string).split(',').map((m: string) => m.trim())
        : DEFAULT_GENERATOR_MODELS;
      const generatorModels = generatorModelIds.map(id => createModel('openrouter', id, internalApiKey));

      const judgeModelIds = opts.judgeModel
        ? (opts.judgeModel as string).split(',').map((m: string) => m.trim())
        : DEFAULT_JUDGE_MODELS;
      const judgeModels = judgeModelIds.map(id => createModel('openrouter', id, internalApiKey));

      const count = parseInt(opts.count, 10);
      const summaries: SkillEvalSummary[] = [];

      // Evaluate each skill (with all skills in context for realistic multi-skill testing)
      for (const skill of skills) {
        if (skills.length > 1) {
          process.stderr.write(chalk.cyan(`\n── Evaluating: ${skill.name} ──\n`));
        }

        // Generate test prompts for this skill
        process.stderr.write(chalk.cyan('Generating test prompts...\n'));
        const prompts = await generateTestPrompts(
          skill,
          generatorModels,
          count,
          skills.length === 1 ? opts.prompts : undefined,
          opts.verbose,
        );
        process.stderr.write(chalk.green(`  Generated ${prompts.length} test prompts\n\n`));

        // Run trigger tests (all skills visible in context)
        process.stderr.write(chalk.cyan('Running trigger tests...\n'));
        const testResults = await runTests(skill, prompts, models, opts.verbose, skills);

        // Evaluate results
        process.stderr.write(chalk.cyan('Evaluating results...\n'));
        const evalResults = await evaluateResults(skill, testResults, judgeModels, models, opts.verbose, skills);

        // Compute report for this skill
        const reports = computeReport(evalResults, modelIds);
        summaries.push({ skill, reports, evalResults });
      }

      console.log('');
      printReport(summaries, { json: opts.json, verbose: opts.verbose });

      // Exit code: pass if all skills × all models score >= 50%
      const allPassing = summaries.every(s => s.reports.every(r => r.overall >= 50));
      process.exit(allPassing ? 0 : 1);
    } catch (err) {
      console.error(chalk.red(`Error: ${(err as Error).message}`));
      process.exit(1);
    }
  });

program.parse();
