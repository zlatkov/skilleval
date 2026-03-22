import { describe, it, expect } from 'vitest';
import { buildTriggerSystemPrompt, buildComplianceSystemPrompt, buildMockTools } from '../src/context-builder.js';
import type { SkillDefinition } from '../src/config.js';

const skill: SkillDefinition = {
  name: 'pdf-processor',
  description: 'Extract text and tables from PDF files',
  body: 'Use the Read tool to load the PDF, then extract tables.',
  rawContent: '---\nname: pdf-processor\n---\nUse the Read tool to load the PDF.',
};

describe('buildTriggerSystemPrompt', () => {
  it('includes the target skill', () => {
    const prompt = buildTriggerSystemPrompt(skill);
    expect(prompt).toContain('<name>pdf-processor</name>');
    expect(prompt).toContain('Extract text and tables from PDF files');
  });

  it('includes 3 dummy distractor skills', () => {
    const prompt = buildTriggerSystemPrompt(skill);
    expect(prompt).toContain('git-commit-helper');
    expect(prompt).toContain('api-documentation');
    expect(prompt).toContain('test-generator');
  });

  it('contains exactly 4 skills total', () => {
    const prompt = buildTriggerSystemPrompt(skill);
    const matches = prompt.match(/<skill>/g);
    expect(matches).toHaveLength(4);
  });

  it('wraps skills in available_skills XML', () => {
    const prompt = buildTriggerSystemPrompt(skill);
    expect(prompt).toContain('<available_skills>');
    expect(prompt).toContain('</available_skills>');
  });

  it('does not include skill instructions', () => {
    const prompt = buildTriggerSystemPrompt(skill);
    expect(prompt).not.toContain('<instructions>');
  });
});

describe('buildComplianceSystemPrompt', () => {
  it('includes skill name and description', () => {
    const prompt = buildComplianceSystemPrompt(skill);
    expect(prompt).toContain('<name>pdf-processor</name>');
    expect(prompt).toContain('Extract text and tables from PDF files');
  });

  it('includes skill instructions', () => {
    const prompt = buildComplianceSystemPrompt(skill);
    expect(prompt).toContain('<instructions>');
    expect(prompt).toContain('Use the Read tool to load the PDF, then extract tables.');
    expect(prompt).toContain('</instructions>');
  });

  it('contains only 1 skill (no distractors)', () => {
    const prompt = buildComplianceSystemPrompt(skill);
    const matches = prompt.match(/<skill>/g);
    expect(matches).toHaveLength(1);
  });
});

describe('buildMockTools', () => {
  it('returns all known tools', () => {
    const tools = buildMockTools();
    const names = Object.keys(tools);
    expect(names).toContain('WebFetch');
    expect(names).toContain('WebSearch');
    expect(names).toContain('BraveSearch');
    expect(names).toContain('Read');
    expect(names).toContain('Write');
    expect(names).toContain('Edit');
    expect(names).toContain('Bash');
    expect(names).toContain('Grep');
    expect(names).toContain('Glob');
    expect(names).toContain('NotebookEdit');
    expect(names).toContain('code_interpreter');
    expect(names).toContain('browser');
  });

  it('returns 12 tools', () => {
    const tools = buildMockTools();
    expect(Object.keys(tools)).toHaveLength(12);
  });
});
