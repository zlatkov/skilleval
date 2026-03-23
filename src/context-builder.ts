import { z } from 'zod';
import { tool, type CoreTool } from 'ai';
import { DUMMY_SKILLS, type SkillDefinition } from './config.js';

// Tools provided to the model during compliance testing, matching what real agent hosts offer
const KNOWN_TOOLS: Record<string, { description: string; parameters: z.ZodType }> = {
  WebFetch: {
    description: 'Fetch content from a URL',
    parameters: z.object({ url: z.string().describe('The URL to fetch') }),
  },
  WebSearch: {
    description: 'Search the web for information',
    parameters: z.object({ query: z.string().describe('The search query') }),
  },
  BraveSearch: {
    description: 'Search the web using Brave Search',
    parameters: z.object({ query: z.string().describe('The search query') }),
  },
  Read: {
    description: 'Read a file from the filesystem',
    parameters: z.object({ file_path: z.string().describe('The file path to read') }),
  },
  Write: {
    description: 'Write content to a file',
    parameters: z.object({
      file_path: z.string().describe('The file path to write'),
      content: z.string().describe('The content to write'),
    }),
  },
  Edit: {
    description: 'Edit a file by replacing text',
    parameters: z.object({
      file_path: z.string().describe('The file path to edit'),
      old_string: z.string().describe('The text to replace'),
      new_string: z.string().describe('The replacement text'),
    }),
  },
  Bash: {
    description: 'Execute a shell command',
    parameters: z.object({ command: z.string().describe('The command to execute') }),
  },
  Grep: {
    description: 'Search file contents using regex',
    parameters: z.object({
      pattern: z.string().describe('The regex pattern to search for'),
      path: z.string().optional().describe('The directory to search in'),
    }),
  },
  Glob: {
    description: 'Find files matching a pattern',
    parameters: z.object({ pattern: z.string().describe('The glob pattern') }),
  },
  NotebookEdit: {
    description: 'Edit a Jupyter notebook cell',
    parameters: z.object({
      notebook: z.string().describe('The notebook file path'),
      cell: z.number().describe('The cell index'),
      new_source: z.string().describe('The new cell content'),
    }),
  },
  code_interpreter: {
    description: 'Execute Python code in a sandbox',
    parameters: z.object({ code: z.string().describe('The Python code to execute') }),
  },
  browser: {
    description: 'Browse a web page',
    parameters: z.object({ url: z.string().describe('The URL to browse') }),
  },
};

const BASE_SYSTEM_PROMPT = `You are a helpful AI agent. You have access to various skills that can help you complete tasks. When a user's request matches a skill's description, you should use that skill by following its instructions.

When you determine a skill is relevant to the user's request:
1. Announce that you are using the skill
2. Follow the skill's instructions carefully

When no skill matches the user's request, respond normally without mentioning any skills.`;

function buildSkillXml(name: string, description: string, location?: string): string {
  const loc = location ?? `skills/${name}/SKILL.md`;
  return `<skill>
  <name>${name}</name>
  <description>${description}</description>
  <location>${loc}</location>
</skill>`;
}

/**
 * Finds skills from allSkills that are explicitly referenced in skill's body.
 * Matches on skill name as a whole word (hyphens treated as optional whitespace).
 */
export function detectCrossReferences(skill: SkillDefinition, allSkills: SkillDefinition[]): SkillDefinition[] {
  const body = skill.body.toLowerCase();
  return allSkills.filter(other => {
    if (other.name === skill.name) return false;
    const escapedName = other.name.toLowerCase().replace(/[-]/g, '[\\s\\-]');
    const nameRegex = new RegExp(`\\b${escapedName}\\b`);
    return nameRegex.test(body) || body.includes(`skills/${other.name.toLowerCase()}/`);
  });
}

export function buildTriggerSystemPrompt(skill: SkillDefinition, allSkills: SkillDefinition[] = []): string {
  const others = allSkills.filter(s => s.name !== skill.name);
  // Supplement with dummy skills if we don't have enough real skills as distractors
  const neededDummies = Math.max(0, 3 - others.length);

  const skillXmls = [
    ...DUMMY_SKILLS.slice(0, neededDummies).map(d => buildSkillXml(d.name, d.description)),
    ...others.map(s => buildSkillXml(s.name, s.description)),
    buildSkillXml(skill.name, skill.description),
  ];

  return `${BASE_SYSTEM_PROMPT}

<available_skills>
${skillXmls.join('\n')}
</available_skills>`;
}

export function buildMockTools(): Record<string, CoreTool> {
  const tools: Record<string, CoreTool> = {};

  for (const [name, def] of Object.entries(KNOWN_TOOLS)) {
    tools[name] = tool({
      description: def.description,
      parameters: def.parameters as z.ZodObject<z.ZodRawShape>,
      execute: async () => `[Mock result from ${name}]`,
    });
  }

  return tools;
}

export function buildComplianceSystemPrompt(skill: SkillDefinition, allSkills: SkillDefinition[] = []): string {
  const others = allSkills.filter(s => s.name !== skill.name);
  const crossRefNames = new Set(detectCrossReferences(skill, allSkills).map(s => s.name));

  // Cross-referenced skills get full instructions so the model can follow through on them
  const otherSkillsXml = others.map(s => {
    if (crossRefNames.has(s.name)) {
      return `<skill>\n  <name>${s.name}</name>\n  <description>${s.description}</description>\n  <instructions>\n${s.body}\n  </instructions>\n</skill>`;
    }
    return `<skill>\n  <name>${s.name}</name>\n  <description>${s.description}</description>\n</skill>`;
  }).join('\n');

  return `${BASE_SYSTEM_PROMPT}

<available_skills>
${otherSkillsXml ? otherSkillsXml + '\n' : ''}<skill>
  <name>${skill.name}</name>
  <description>${skill.description}</description>
  <instructions>
${skill.body}
  </instructions>
</skill>
</available_skills>`;
}
