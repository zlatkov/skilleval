import { describe, it, expect } from 'vitest';
import { join } from 'node:path';
import { parseSkill, resolveSkillSources } from '../src/parser.js';

const fixturesDir = join(import.meta.dirname, 'fixtures');

describe('parseSkill', () => {
  it('parses a skill with full frontmatter', async () => {
    const skill = await parseSkill(join(fixturesDir, 'test-skill.md'));
    expect(skill.name).toBe('pdf-processor');
    expect(skill.description).toBe('Extract text and tables from PDF files');
    expect(skill.body).toContain('Use the Read tool');
  });

  it('extracts name from heading when frontmatter is missing', async () => {
    const skill = await parseSkill(join(fixturesDir, 'minimal-skill.md'));
    expect(skill.name).toBe('My Skill');
  });

  it('extracts description from first paragraph when frontmatter is missing', async () => {
    const skill = await parseSkill(join(fixturesDir, 'minimal-skill.md'));
    expect(skill.description).toContain('minimal skill');
  });

  it('preserves raw content', async () => {
    const skill = await parseSkill(join(fixturesDir, 'test-skill.md'));
    expect(skill.rawContent).toContain('---');
    expect(skill.rawContent).toContain('pdf-processor');
  });

  it('throws on non-existent file', async () => {
    await expect(parseSkill(join(fixturesDir, 'nope.md'))).rejects.toThrow();
  });
});

describe('resolveSkillSources', () => {
  it('returns single file path unchanged', async () => {
    const src = join(fixturesDir, 'test-skill.md');
    expect(await resolveSkillSources(src)).toEqual([src]);
  });

  it('discovers all SKILL.md files recursively in a directory', async () => {
    const skillsDir = join(fixturesDir, 'skills');
    const sources = await resolveSkillSources(skillsDir);
    expect(sources).toHaveLength(2);
    expect(sources.every(s => s.endsWith('SKILL.md'))).toBe(true);
    expect(sources.some(s => s.includes('skill-a'))).toBe(true);
    expect(sources.some(s => s.includes('skill-b'))).toBe(true);
  });

  it('throws when directory has no SKILL.md files', async () => {
    await expect(resolveSkillSources(join(fixturesDir, 'empty-dir'))).rejects.toThrow('No SKILL.md');
  });
});
