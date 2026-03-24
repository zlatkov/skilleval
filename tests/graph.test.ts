import { describe, it, expect } from 'vitest';
import { buildDependencyGraph, renderGraph } from '../src/graph.js';
import type { SkillDefinition } from '../src/config.js';

function makeSkill(name: string, body: string): SkillDefinition {
  return {
    name,
    description: `Description of ${name}`,
    body,
    rawContent: `---\nname: ${name}\n---\n\n${body}`,
  };
}

describe('buildDependencyGraph', () => {
  it('detects name-based references between skills', () => {
    const skills = [
      makeSkill('ai-news', 'Fetch news. You can use the summarizer skill to condense results.'),
      makeSkill('summarizer', 'Summarize text content.'),
    ];

    const graph = buildDependencyGraph(skills);
    expect(graph.nodes).toEqual(['ai-news', 'summarizer']);
    expect(graph.edges).toHaveLength(1);
    expect(graph.edges[0].from).toBe('ai-news');
    expect(graph.edges[0].to).toBe('summarizer');
    expect(graph.edges[0].mentions).toContain('name: "summarizer"');
  });

  it('detects path-based references', () => {
    const skills = [
      makeSkill('orchestrator', 'Load the skill from skills/data-fetcher/ to get data.'),
      makeSkill('data-fetcher', 'Fetch data from APIs.'),
    ];

    const graph = buildDependencyGraph(skills);
    expect(graph.edges).toHaveLength(1);
    expect(graph.edges[0].from).toBe('orchestrator');
    expect(graph.edges[0].to).toBe('data-fetcher');
    expect(graph.edges[0].mentions).toContain('path reference');
  });

  it('detects frontmatter dependency references', () => {
    const depSkill: SkillDefinition = {
      name: 'pipeline',
      description: 'Runs a pipeline',
      body: 'Run the full pipeline.',
      rawContent: '---\nname: pipeline\ndependencies: [validator, formatter]\n---\n\nRun the full pipeline.',
    };
    const skills = [
      depSkill,
      makeSkill('validator', 'Validates input.'),
      makeSkill('formatter', 'Formats output.'),
    ];

    const graph = buildDependencyGraph(skills);
    expect(graph.edges.length).toBeGreaterThanOrEqual(2);
    const targets = graph.edges.filter(e => e.from === 'pipeline').map(e => e.to);
    expect(targets).toContain('validator');
    expect(targets).toContain('formatter');
  });

  it('returns no edges for independent skills', () => {
    const skills = [
      makeSkill('skill-a', 'Does thing A.'),
      makeSkill('skill-b', 'Does thing B.'),
      makeSkill('skill-c', 'Does thing C.'),
    ];

    const graph = buildDependencyGraph(skills);
    expect(graph.nodes).toHaveLength(3);
    expect(graph.edges).toHaveLength(0);
  });

  it('does not create self-referencing edges', () => {
    const skills = [
      makeSkill('my-skill', 'This is my-skill which does my-skill things.'),
    ];

    const graph = buildDependencyGraph(skills);
    expect(graph.edges).toHaveLength(0);
  });

  it('detects bidirectional references', () => {
    const skills = [
      makeSkill('skill-a', 'Works with skill-b to do things.'),
      makeSkill('skill-b', 'Relies on skill-a for input.'),
    ];

    const graph = buildDependencyGraph(skills);
    expect(graph.edges).toHaveLength(2);
    expect(graph.edges.some(e => e.from === 'skill-a' && e.to === 'skill-b')).toBe(true);
    expect(graph.edges.some(e => e.from === 'skill-b' && e.to === 'skill-a')).toBe(true);
  });

  it('handles empty skill list', () => {
    const graph = buildDependencyGraph([]);
    expect(graph.nodes).toHaveLength(0);
    expect(graph.edges).toHaveLength(0);
  });

  it('handles single skill', () => {
    const graph = buildDependencyGraph([makeSkill('solo', 'Just one skill.')]);
    expect(graph.nodes).toEqual(['solo']);
    expect(graph.edges).toHaveLength(0);
  });
});

describe('renderGraph', () => {
  it('renders JSON output without errors', () => {
    const graph = buildDependencyGraph([
      makeSkill('a', 'References b.'),
      makeSkill('b', 'Standalone.'),
    ]);

    // Just verify it doesn't throw
    const originalLog = console.log;
    let output = '';
    console.log = (msg: string) => { output += msg + '\n'; };
    renderGraph(graph, { json: true });
    console.log = originalLog;

    const parsed = JSON.parse(output.trim());
    expect(parsed.nodes).toEqual(['a', 'b']);
    expect(parsed.edges).toHaveLength(1);
  });

  it('renders terminal output without errors', () => {
    const graph = buildDependencyGraph([
      makeSkill('a', 'Uses b for processing.'),
      makeSkill('b', 'Uses c for validation.'),
      makeSkill('c', 'Standalone.'),
    ]);

    const originalLog = console.log;
    const lines: string[] = [];
    console.log = (msg: string) => { lines.push(msg); };
    renderGraph(graph, { json: false });
    console.log = originalLog;

    // Should have rendered something
    expect(lines.length).toBeGreaterThan(0);
  });

  it('handles no-dependency graph gracefully', () => {
    const graph = buildDependencyGraph([
      makeSkill('x', 'Independent.'),
      makeSkill('y', 'Also independent.'),
    ]);

    const originalLog = console.log;
    const lines: string[] = [];
    console.log = (msg: string) => { lines.push(msg); };
    renderGraph(graph, { json: false });
    console.log = originalLog;

    const joined = lines.join('\n');
    expect(joined).toContain('No dependencies detected');
  });
});
