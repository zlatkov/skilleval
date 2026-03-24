# skilleval

Evaluate how well AI models understand and respond to [Agent Skills](https://agentskills.io/home) (SKILL.md files).

Skill authors write a SKILL.md and have zero idea whether it works on any model besides the one they tested with. `skilleval` fixes that  - it simulates how agents like [OpenClaw](https://openclaw.ai/) and Claude Code inject skills into prompts, following the [OpenSkills](https://github.com/numman-ali/openskills) specification, then tests whether various LLM models correctly trigger and follow the skill's instructions.

### Evaluate a skill across multiple models

```
skilleval v0.1.0
Skill: pdf-processing
Description: Extract text and tables from PDF files
Provider: openrouter
Models: 5

┌───────────────────────────────────────────┬──────────────┬────────────────┬─────────┐
│ Model                                     │ Trigger      │ Compliance     │ Overall │
├───────────────────────────────────────────┼──────────────┼────────────────┼─────────┤
│ qwen/qwen3-235b-a22b:free                 │ 10/10        │ 5/5 (92)       │ 98%     │
│ meta-llama/llama-3.3-70b-instruct:free    │ 9/10         │ 4/5 (85)       │ 82%     │
│ deepseek/deepseek-r1:free                 │ 9/10         │ 4/5 (80)       │ 81%     │
│ google/gemma-3-27b-it:free                │ 8/10         │ 3/5 (70)       │ 72%     │
│ mistralai/mistral-small-3.1-24b:free      │ 7/10         │ 3/5 (65)       │ 66%     │
└───────────────────────────────────────────┴──────────────┴────────────────┴─────────┘

Best model: qwen/qwen3-235b-a22b:free (98%)
Worst model: mistralai/mistral-small-3.1-24b:free (66%)
```

### Visualise dependencies between skills

```
Skill Dependency Graph
════════════════════════════════════════

  ◉ orchestrator
    ├──▶ fetcher (name: "fetcher")
    ├──▶ parser (name: "parser")
    └──▶ formatter (name: "formatter")
  ◉ fetcher
    ├──▶ parser (name: "parser")
    └──▶ formatter (name: "formatter")
  ◉ parser (depended on by 3)
  ◉ formatter
    └──▶ parser (name: "parser")

────────────────────────────────────────
  Nodes: 4 skills
  Edges: 6 dependencies

  Adjacency Matrix:
                    1   2   3   4
  1. orchestrator   ·   ●   ●   ●
  2. fetcher        ·   ·   ●   ●
  3. parser         ·   ·   ·   ·
  4. formatter      ·   ·   ●   ·
  ● = depends on
```

## Prerequisites

You need an [OpenRouter](https://openrouter.ai) account. Create a free API key at [openrouter.ai/keys](https://openrouter.ai/keys).

OpenRouter is used for test prompt generation and evaluation judging, and as the default provider for testing models. Even if you use a different provider (Anthropic, OpenAI, Google) for the models being tested, an OpenRouter key is still required for the generator and judge unless you supply custom prompts via `--prompts`.

**Free model limitations:** OpenRouter's free models (those ending in `:free`) are subject to upstream rate limits and may be temporarily unavailable. If you encounter rate limit errors, you can:
- Wait and retry  - free model availability fluctuates
- Use paid models instead (remove the `:free` suffix, e.g. `meta-llama/llama-3.3-70b-instruct`)
- Provide your own test prompts with `--prompts` to skip the generator model entirely

## Installation

```bash
npm install -g @alexanderzzlatkov/skilleval
```

Or use directly with `npx`:

```bash
npx @alexanderzzlatkov/skilleval ./my-skill/SKILL.md
```

## Quick Start

```bash
# Set your OpenRouter API key
export OPENROUTER_API_KEY=sk-or-...

# Evaluate a local skill
npx @alexanderzzlatkov/skilleval ./my-skill/SKILL.md

# Evaluate a skill from a GitHub repo (like skills.sh)
npx skilleval owner/repo

# Evaluate a specific skill within a repo
npx skilleval owner/repo --skill skill-name

# Evaluate from a GitHub URL
npx skilleval https://github.com/user/repo/blob/main/skills/my-skill/SKILL.md

# Evaluate ALL skills in a folder (local or GitHub)
npx skilleval ./skills/
npx skilleval https://github.com/user/repo/tree/main/skills
```

## How It Works

`skilleval` follows the [OpenSkills](https://github.com/numman-ali/openskills) specification  - a universal skills format based on Anthropic's SKILL.md system. It's compatible with skills built for agents like Claude Code, [OpenClaw](https://openclaw.ai/), and any agent that uses the SKILL.md format. It simulates how these agents inject skills into system prompts using `<available_skills>` XML blocks  - the same format used in production. This means the evaluation reflects real-world skill behavior, not synthetic benchmarks.

1. **Parse**  - Reads the SKILL.md, extracts name, description, and instructions. If the input is a folder (local or GitHub), it recursively scans for all SKILL.md files.
2. **Build context**  - The model is presented as a helpful AI agent with access to multiple skills. The system prompt uses `<available_skills>` XML injection where your skill is mixed in with 3 fake distractor skills (e.g. "git-commit-helper", "api-documentation", "test-generator"). When evaluating a folder of skills, the other real skills found in the folder are also included as distractors alongside the dummy ones  - making the trigger test more realistic.
3. **Generate test prompts**  - A generator model creates 5 positive prompts (should trigger) and 5 negative prompts (should not), per skill.
4. **Run trigger tests**  - Sends each prompt to each target model with the skill-injected system prompt.
5. **Evaluate**  - A judge model assesses trigger accuracy and, for correctly triggered prompts, runs a compliance test against the full skill instructions. If the skill references tools (e.g. `WebFetch`, `BraveSearch`, `Read`, `Write`, `Edit`, `Bash`, `Grep`, `Glob`), `skilleval` automatically provides mock tool definitions so the model can make real structured tool calls instead of fabricating results in text. The judge evaluates whether the model called the right tools with the right parameters, not the quality of the mock results.
6. **Report**  - Prints a compatibility matrix to the terminal. In batch mode, each skill gets its own table plus a combined summary.

See [AGENTS.md](./AGENTS.md) for detailed pipeline internals.

### Batch Mode

When you point `skilleval` at a folder instead of a single file, it automatically discovers all SKILL.md files recursively and evaluates each one. The other skills found in the folder are injected as real distractors alongside the standard dummy skills, making the trigger test harder and more realistic.

```bash
npx skilleval ./skills/
```

```
skilleval v0.1.0 (batch mode)
Skills found: 3
  • ai-news — Fetches the latest AI news from multiple sources
  • code-review — Reviews code for quality and best practices
  • pdf-processor — Extract text and tables from PDF files
Provider: openrouter
Models: 5

─── Skill: ai-news ───
┌───────────────────────────────────────────┬──────────────┬────────────────┬─────────┐
│ Model                                     │ Trigger      │ Compliance     │ Overall │
├───────────────────────────────────────────┼──────────────┼────────────────┼─────────┤
│ qwen/qwen3-235b-a22b:free                 │ 10/10        │ 5/5 (90)       │ 97%     │
│ ...                                       │              │                │         │
└───────────────────────────────────────────┴──────────────┴────────────────┴─────────┘

─── Skill: code-review ───
...

=== Batch Summary ===
┌──────────────────┬───────────────────────────────────┬──────────────┬────────────────┬─────────┐
│ Skill            │ Model                             │ Trigger      │ Compliance     │ Overall │
├──────────────────┼───────────────────────────────────┼──────────────┼────────────────┼─────────┤
│ ai-news          │ qwen/qwen3-235b-a22b:free         │ 10/10        │ 5/5 (90)       │ 97%     │
│                  │ meta-llama/llama-3.3-70b:free      │ 8/10         │ 4/5 (80)       │ 78%     │
├──────────────────┼───────────────────────────────────┼──────────────┼────────────────┼─────────┤
│ code-review      │ qwen/qwen3-235b-a22b:free         │ 9/10         │ 5/5 (85)       │ 92%     │
│                  │ ...                               │              │                │         │
└──────────────────┴───────────────────────────────────┴──────────────┴────────────────┴─────────┘

Average scores per skill:
  ai-news: 85%
  code-review: 78%
  pdf-processor: 91%
```

Supported folder sources:
- Local directories: `./skills/`, `/path/to/skills`
- GitHub tree URLs: `https://github.com/user/repo/tree/main/skills`
- GitHub repos: `user/repo` or `https://github.com/user/repo` (scans entire repo)

Directories like `node_modules`, `.git`, and `dist` are automatically skipped during local scans.

### Dependency Graph

Use `--graph` to visualise how skills reference each other. This works with any folder or repository source and requires no API key. References are detected by scanning each skill's content for mentions of other skill names, path references (e.g. `skills/other-skill/`), and frontmatter dependency fields (e.g. `dependencies: [other-skill]`).

```bash
npx skilleval ./skills/ --graph
npx skilleval https://github.com/user/repo/tree/main/skills --graph
```

The graph also detects and warns about circular dependencies. When running in batch evaluation mode (without `--graph`), the dependency graph is automatically shown if any dependencies are found between the scanned skills.

Use `--graph --json` for machine-readable output.

## Usage

```
skilleval <skill> [options]

Arguments:
  skill                          Path, URL, or GitHub shorthand (owner/repo).
                                 Can also be a folder path or GitHub tree URL
                                 to batch-evaluate all SKILL.md files inside.

Options:
  -p, --provider <provider>      Provider: openrouter, anthropic, openai, google (default: openrouter)
  -m, --models <models>          Comma-separated model IDs
  -s, --skill <name>             Skill name within the repo (looks for skills/<name>/SKILL.md)
  -k, --key <key>                API key (or use provider-specific env var)
  --generator-model <model>      Model for test prompt generation (comma-separated for fallbacks)
  --judge-model <model>          Model for evaluation judging (comma-separated for fallbacks)
  --graph                        Show dependency graph between skills (folder/repo mode only)
  --json                         Output results as JSON
  --verbose                      Show detailed per-prompt results
  -n, --count <number>           Number of positive+negative test prompts (default: 5, so 5+5=10 total)
  --prompts <path>               Path to JSON file with custom test prompts
  -V, --version                  Output the version number
  -h, --help                     Display help
```

### Model Roles

`skilleval` uses three types of models, each with a different role in the pipeline:

| Role | Flag | Default | Description |
|---|---|---|---|
| **Test models** | `-m, --models` | 5 free OpenRouter models | The models being evaluated. These receive the skill-injected prompt and are scored on how well they trigger and follow the skill. |
| **Generator models** | `--generator-model` | 3 free OpenRouter models (with fallback) | Generate test prompts (positive + negative) from the skill definition. Count configurable via `-n`. You can provide comma-separated model IDs for fallback. |
| **Judge models** | `--judge-model` | 3 free OpenRouter models (with fallback) | Evaluate each test model's response  - did it correctly trigger the skill? Did it follow instructions? You can provide comma-separated model IDs for fallback. |

The generator and judge models always run through OpenRouter (even if you set a different `--provider`). Only the test models use your specified provider.

### Providers

All providers use the [Vercel AI SDK](https://ai-sdk.dev) under the hood.

| Provider | Flag | Env Var | Notes |
|---|---|---|---|
| OpenRouter | `--provider openrouter` | `OPENROUTER_API_KEY` | Default. Access 300+ models including free ones. |
| Anthropic | `--provider anthropic` | `ANTHROPIC_API_KEY` | Direct API access to Claude models. |
| OpenAI | `--provider openai` | `OPENAI_API_KEY` | Direct API access to GPT models. |
| Google | `--provider google` | `GOOGLE_GENERATIVE_AI_API_KEY` | Direct API access to Gemini models. |

### Examples

```bash
# Test against default free OpenRouter models
npx skilleval ./SKILL.md

# Test against specific models via OpenRouter
npx skilleval ./SKILL.md --models "anthropic/claude-sonnet-4-20250514,openai/gpt-4o"

# Test directly against Anthropic
npx skilleval ./SKILL.md --provider anthropic --model claude-sonnet-4-20250514

# Use a smarter judge model
npx skilleval ./SKILL.md --judge-model "qwen/qwen3-235b-a22b:free"

# Provide your own test prompts
npx skilleval ./SKILL.md --prompts ./my-test-prompts.json

# Machine-readable output
npx skilleval ./SKILL.md --json

# Quick test with fewer prompts (1 positive + 1 negative)
npx skilleval ./SKILL.md -n 1

# Detailed per-prompt breakdown
npx skilleval ./SKILL.md --verbose

# Batch-evaluate all skills in a local folder
npx skilleval ./skills/

# Batch-evaluate all skills in a GitHub folder
npx skilleval https://github.com/user/repo/tree/main/skills

# Batch-evaluate an entire GitHub repo for SKILL.md files
npx skilleval user/repo

# Visualise the dependency graph between skills (no API key needed)
npx skilleval ./skills/ --graph
npx skilleval https://github.com/user/repo/tree/main/skills --graph --json

# Full example: evaluate Vercel's most popular skill on skills.sh
npx skilleval https://github.com/vercel-labs/skills --skill find-skills \
  --models anthropic/claude-opus-4.6 \
  --generator-model meta-llama/llama-3.3-70b-instruct:free \
  --judge-model anthropic/claude-sonnet-4.6 \
  -n 5 --verbose
```

### Custom Test Prompts

Create a JSON file with your own test prompts:

```json
[
  {"text": "Help me extract text from this PDF", "type": "positive"},
  {"text": "Merge these two PDF files together", "type": "positive"},
  {"text": "Convert this PDF to Word", "type": "positive"},
  {"text": "Fill out this PDF form", "type": "positive"},
  {"text": "Extract tables from the PDF report", "type": "positive"},
  {"text": "What's the weather today?", "type": "negative"},
  {"text": "Write me a Python script", "type": "negative"},
  {"text": "Help me debug this CSS", "type": "negative"},
  {"text": "Create a git commit message", "type": "negative"},
  {"text": "Summarize this article for me", "type": "negative"}
]
```

## Scoring

Each model is scored on two dimensions:

- **Trigger accuracy** (50% of overall): Did the model correctly identify when to use the skill (positive prompts) and when to ignore it (negative prompts)?
- **Compliance** (50% of overall): For positive prompts where the skill was triggered, did the model follow the skill's instructions? Split into pass/fail (30%) and quality score 0-100 (20%).

Exit code is `0` if all models score >= 50%, `1` otherwise  - useful for CI.

## Development

```bash
git clone https://github.com/zlatkov/skilleval.git
cd skilleval
npm install
npm run dev -- ./path/to/SKILL.md
```

## License

MIT
