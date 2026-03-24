import chalk from 'chalk';
import type { SkillDefinition, SkillEdge, SkillGraph } from './config.js';

/**
 * Detects references between skills by scanning each skill's body and raw content
 * for mentions of other skill names or paths.
 */
export function buildDependencyGraph(skills: SkillDefinition[]): SkillGraph {
  const nodes = skills.map(s => s.name);
  const edges: SkillEdge[] = [];

  for (const skill of skills) {
    const searchText = skill.rawContent;

    for (const other of skills) {
      if (other.name === skill.name) continue;

      const mentions: string[] = [];

      // Check for name mentions (case-insensitive, word boundary)
      const namePattern = new RegExp(`\\b${escapeRegex(other.name)}\\b`, 'gi');
      if (namePattern.test(searchText)) {
        mentions.push(`name: "${other.name}"`);
      }

      // Check for path-style references (skills/name/SKILL.md, .claude/skills/name/)
      const slugified = slugify(other.name);
      const pathPatterns = [
        new RegExp(`skills/${escapeRegex(slugified)}/`, 'gi'),
        new RegExp(`skills/${escapeRegex(other.name)}/`, 'gi'),
        new RegExp(`\\.claude/skills/${escapeRegex(slugified)}`, 'gi'),
      ];
      for (const pattern of pathPatterns) {
        if (pattern.test(searchText)) {
          mentions.push(`path reference`);
          break;
        }
      }

      // Check for frontmatter references (dependencies, requires, uses fields)
      const depsPattern = new RegExp(
        `(?:dependencies|requires|uses|depends_on|related)\\s*:.*${escapeRegex(other.name)}`,
        'gim',
      );
      if (depsPattern.test(searchText)) {
        mentions.push(`frontmatter dependency`);
      }

      if (mentions.length > 0) {
        edges.push({ from: skill.name, to: other.name, mentions });
      }
    }
  }

  return { nodes, edges };
}

function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function slugify(name: string): string {
  return name.toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '');
}

/**
 * Renders the dependency graph to the terminal using box-drawing characters.
 */
export function renderGraph(graph: SkillGraph, options: { json: boolean }): void {
  if (options.json) {
    console.log(JSON.stringify(graph, null, 2));
    return;
  }

  const { nodes, edges } = graph;

  if (nodes.length === 0) {
    console.log(chalk.yellow('No skills found.'));
    return;
  }

  console.log(`\n${chalk.bold('Skill Dependency Graph')}`);
  console.log(chalk.dim('═'.repeat(40)));

  if (edges.length === 0) {
    console.log(chalk.dim('\nNo dependencies detected between skills.\n'));
    console.log(chalk.bold('Skills:'));
    for (const node of nodes) {
      console.log(`  ${chalk.cyan('◉')} ${node}`);
    }
    console.log('');
    return;
  }

  // Build adjacency list (outgoing edges)
  const outgoing = new Map<string, SkillEdge[]>();
  const incoming = new Map<string, SkillEdge[]>();
  for (const node of nodes) {
    outgoing.set(node, []);
    incoming.set(node, []);
  }
  for (const edge of edges) {
    outgoing.get(edge.from)!.push(edge);
    incoming.get(edge.to)!.push(edge);
  }

  // Print each skill with its dependencies
  console.log('');
  for (const node of nodes) {
    const deps = outgoing.get(node)!;
    const depBy = incoming.get(node)!;

    const depCount = deps.length;
    const depByCount = depBy.length;

    let badge = '';
    if (depCount === 0 && depByCount === 0) {
      badge = chalk.dim(' (isolated)');
    } else if (depByCount > 0 && depCount === 0) {
      badge = chalk.green(` (depended on by ${depByCount})`);
    }

    console.log(`  ${chalk.cyan('◉')} ${chalk.bold(node)}${badge}`);

    if (deps.length > 0) {
      for (let i = 0; i < deps.length; i++) {
        const edge = deps[i];
        const isLast = i === deps.length - 1;
        const prefix = isLast ? '└' : '├';
        const reason = chalk.dim(`(${edge.mentions.join(', ')})`);
        console.log(`    ${prefix}──▶ ${edge.to} ${reason}`);
      }
    }
  }

  // Print summary
  console.log('');
  console.log(chalk.dim('─'.repeat(40)));
  console.log(`  ${chalk.bold('Nodes:')} ${nodes.length} skills`);
  console.log(`  ${chalk.bold('Edges:')} ${edges.length} dependencies`);

  // Detect cycles
  const cycles = detectCycles(nodes, outgoing);
  if (cycles.length > 0) {
    console.log(`\n  ${chalk.yellow('⚠ Circular dependencies detected:')}`);
    for (const cycle of cycles) {
      console.log(`    ${chalk.yellow(cycle.join(' → ') + ' → ' + cycle[0])}`);
    }
  }

  // Show isolated skills
  const isolated = nodes.filter(n => outgoing.get(n)!.length === 0 && incoming.get(n)!.length === 0);
  if (isolated.length > 0 && isolated.length < nodes.length) {
    console.log(`\n  ${chalk.dim('Isolated skills (no dependencies):')} ${isolated.join(', ')}`);
  }

  // Render adjacency matrix for graphs with many edges
  if (edges.length > 3 && nodes.length > 2) {
    renderMatrix(nodes, edges);
  }

  console.log('');
}

function renderMatrix(nodes: string[], edges: SkillEdge[]): void {
  console.log(`\n  ${chalk.bold('Adjacency Matrix:')}`);

  // Row labels are "N. name", figure out max width
  const rowLabels = nodes.map((n, i) => `${i + 1}. ${n}`);
  const labelWidth = Math.max(...rowLabels.map(l => l.length)) + 2;
  const cellWidth = 3;

  // Header row: column numbers
  const header = ' '.repeat(labelWidth) + nodes.map((_, i) => padCenter(String(i + 1), cellWidth)).join(' ');
  console.log(`  ${chalk.dim(header)}`);

  // Edge lookup
  const edgeSet = new Set(edges.map(e => `${e.from}→${e.to}`));

  for (let row = 0; row < nodes.length; row++) {
    const label = padRight(rowLabels[row], labelWidth);
    const cells = nodes.map((_, col) => {
      if (row === col) return chalk.dim(' · ');
      const hasEdge = edgeSet.has(`${nodes[row]}→${nodes[col]}`);
      return hasEdge ? chalk.white(' ● ') : chalk.dim(' · ');
    });
    console.log(`  ${label}${cells.join(' ')}`);
  }

  console.log(`  ${chalk.dim('● = depends on')}`);
}

function padRight(str: string, len: number): string {
  return str.length >= len ? str.slice(0, len) : str + ' '.repeat(len - str.length);
}

function padCenter(str: string, len: number): string {
  const pad = Math.max(0, len - str.length);
  const left = Math.floor(pad / 2);
  return ' '.repeat(left) + str + ' '.repeat(pad - left);
}

/**
 * Detects cycles using DFS with coloring.
 */
function detectCycles(nodes: string[], outgoing: Map<string, SkillEdge[]>): string[][] {
  const WHITE = 0, GRAY = 1, BLACK = 2;
  const color = new Map<string, number>();
  const parent = new Map<string, string | null>();
  const cycles: string[][] = [];

  for (const node of nodes) color.set(node, WHITE);

  function dfs(u: string): void {
    color.set(u, GRAY);
    for (const edge of outgoing.get(u)!) {
      const v = edge.to;
      if (color.get(v) === GRAY) {
        // Found a cycle — trace it back
        const cycle = [v];
        let curr = u;
        while (curr !== v) {
          cycle.unshift(curr);
          curr = parent.get(curr) ?? v;
        }
        cycles.push(cycle);
      } else if (color.get(v) === WHITE) {
        parent.set(v, u);
        dfs(v);
      }
    }
    color.set(u, BLACK);
  }

  for (const node of nodes) {
    if (color.get(node) === WHITE) {
      parent.set(node, null);
      dfs(node);
    }
  }

  return cycles;
}
