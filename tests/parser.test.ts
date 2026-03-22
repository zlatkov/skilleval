import { describe, it, expect } from 'vitest';
import { join } from 'node:path';
import { parseSkill } from '../src/parser.js';

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
