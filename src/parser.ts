import { readFile, readdir, stat } from 'node:fs/promises';
import { basename, join } from 'node:path';
import matter from 'gray-matter';
import type { SkillDefinition } from './config.js';

const GITHUB_BLOB_RE = /^https?:\/\/github\.com\/([^/]+)\/([^/]+)\/blob\/([^/]+)\/(.+)$/;
const GITHUB_TREE_RE = /^https?:\/\/github\.com\/([^/]+)\/([^/]+)\/tree\/([^/]+)(?:\/(.+))?$/;
const GITHUB_REPO_RE = /^https?:\/\/github\.com\/([^/]+)\/([^/]+)\/?$/;
const GITHUB_SHORTHAND_RE = /^([^/\s]+)\/([^/\s]+)$/;

const SKILL_SEARCH_PATHS = [
  'SKILL.md',
  '.claude/skills',
  'skills',
];

async function fetchText(url: string): Promise<string> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Failed to fetch ${url}: ${res.status} ${res.statusText}`);
  return res.text();
}

function toRawGitHubUrl(owner: string, repo: string, branch: string, path: string): string {
  return `https://raw.githubusercontent.com/${owner}/${repo}/${branch}/${path}`;
}

async function discoverNamedSkill(owner: string, repo: string, skillName: string): Promise<string> {
  const searchPaths = [
    `skills/${skillName}/SKILL.md`,
    `.claude/skills/${skillName}/SKILL.md`,
    `${skillName}/SKILL.md`,
  ];

  for (const path of searchPaths) {
    for (const branch of ['main', 'master']) {
      const url = toRawGitHubUrl(owner, repo, branch, path);
      try {
        const res = await fetch(url, { method: 'HEAD' });
        if (res.ok) return url;
      } catch { /* continue */ }
    }
  }

  throw new Error(
    `Could not find skill "${skillName}" in ${owner}/${repo}. Searched ${searchPaths.join(', ')}.`
  );
}

/**
 * Uses the GitHub recursive tree API to discover all SKILL.md files in a repo.
 * Optionally filters to only files under a given subPath prefix.
 */
async function discoverAllSkillsInRepo(owner: string, repo: string, branch: string, subPath?: string): Promise<string[]> {
  const apiUrl = `https://api.github.com/repos/${owner}/${repo}/git/trees/${branch}?recursive=1`;
  const res = await fetch(apiUrl);
  if (!res.ok) throw new Error(`GitHub API error for ${owner}/${repo}@${branch}: ${res.status}`);
  const data = await res.json() as { tree: Array<{ path: string; type: string }> };

  let skillFiles = data.tree.filter(item =>
    item.type === 'blob' && (item.path === 'SKILL.md' || item.path.endsWith('/SKILL.md')),
  );

  if (subPath) {
    const prefix = subPath.replace(/\/$/, '') + '/';
    skillFiles = skillFiles.filter(item => item.path.startsWith(prefix));
  }

  return skillFiles.map(item => toRawGitHubUrl(owner, repo, branch, item.path));
}

async function resolveSource(source: string, skillName?: string): Promise<{ content: string; sourceName: string }> {
  // Case 1: GitHub blob URL
  const blobMatch = source.match(GITHUB_BLOB_RE);
  if (blobMatch) {
    const [, owner, repo, branch, path] = blobMatch;
    const rawUrl = toRawGitHubUrl(owner, repo, branch, path);
    return { content: await fetchText(rawUrl), sourceName: path };
  }

  // Case 2: GitHub repo URL — resolve to all skills via resolveSkillSources first
  const repoMatch = source.match(GITHUB_REPO_RE);
  if (repoMatch) {
    const [, owner, repo] = repoMatch;
    const rawUrl = await discoverNamedSkill(owner, repo, skillName ?? '');
    return { content: await fetchText(rawUrl), sourceName: skillName ?? `${owner}/${repo}` };
  }

  // Case 3: GitHub shorthand (owner/repo)
  const shorthandMatch = source.match(GITHUB_SHORTHAND_RE);
  if (shorthandMatch && !source.includes('\\') && !source.includes(':')) {
    const [, owner, repo] = shorthandMatch;
    const rawUrl = await discoverNamedSkill(owner, repo, skillName ?? '');
    return { content: await fetchText(rawUrl), sourceName: skillName ?? `${owner}/${repo}` };
  }

  // Case 4: URL — derive sourceName from the parent folder name in the path
  if (source.startsWith('http://') || source.startsWith('https://')) {
    const content = await fetchText(source);
    const pathParts = new URL(source).pathname.split('/').filter(Boolean);
    const idx = pathParts.indexOf('SKILL.md');
    const sourceName = idx > 0 ? pathParts[idx - 1] : source;
    return { content, sourceName };
  }

  // Case 5: Local file path
  const content = await readFile(source, 'utf-8');
  return { content, sourceName: basename(source, '.md') };
}

async function findSkillFilesInDir(dir: string): Promise<string[]> {
  const results: string[] = [];
  const entries = await readdir(dir, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = join(dir, entry.name);
    if (entry.isDirectory()) {
      results.push(...await findSkillFilesInDir(fullPath));
    } else if (entry.isFile() && entry.name === 'SKILL.md') {
      results.push(fullPath);
    }
  }
  return results.sort();
}

/**
 * Expands a source to one or more resolved file/URL paths containing SKILL.md content.
 * - GitHub blob URL      → [that URL] (single file)
 * - GitHub tree URL      → all SKILL.md raw URLs under that folder
 * - GitHub repo URL      → all SKILL.md raw URLs in the repo (or named skill if skillName given)
 * - GitHub shorthand     → same as GitHub repo URL
 * - Local directory      → all SKILL.md paths found recursively
 * - Anything else        → [source] unchanged (local file or direct URL)
 */
export async function resolveSkillSources(source: string, skillName?: string): Promise<string[]> {
  // GitHub blob — single file, already a direct path
  if (GITHUB_BLOB_RE.test(source)) return [source];

  // GitHub tree URL — discover all SKILL.md under that folder/branch
  const treeMatch = source.match(GITHUB_TREE_RE);
  if (treeMatch) {
    const [, owner, repo, branch, subPath] = treeMatch;
    const urls = await discoverAllSkillsInRepo(owner, repo, branch, subPath);
    if (urls.length === 0) throw new Error(`No SKILL.md files found under ${source}`);
    return urls;
  }

  // GitHub repo URL or owner/repo shorthand
  const repoMatch = source.match(GITHUB_REPO_RE)
    ?? (GITHUB_SHORTHAND_RE.test(source) && !source.includes('\\') && !source.includes(':')
      ? source.match(GITHUB_SHORTHAND_RE)
      : null);
  if (repoMatch) {
    const [, owner, repo] = repoMatch;
    if (skillName) {
      // Named skill requested — return a single raw URL
      return [await discoverNamedSkill(owner, repo, skillName)];
    }
    // Discover all skills, trying main then master
    for (const branch of ['main', 'master']) {
      try {
        const urls = await discoverAllSkillsInRepo(owner, repo, branch);
        if (urls.length > 0) return urls;
      } catch { /* try next branch */ }
    }
    throw new Error(`No SKILL.md files found in ${owner}/${repo}`);
  }

  // Local directory — scan recursively
  if (!source.startsWith('http://') && !source.startsWith('https://')) {
    try {
      const s = await stat(source);
      if (s.isDirectory()) {
        const files = await findSkillFilesInDir(source);
        if (files.length === 0) throw new Error(`No SKILL.md files found in directory: ${source}`);
        return files;
      }
    } catch (err) {
      if ((err as Error).message.startsWith('No SKILL.md')) throw err;
      // Not a directory — fall through
    }
  }

  return [source];
}

export async function parseSkill(source: string, skillName?: string): Promise<SkillDefinition> {
  const { content: rawContent, sourceName } = await resolveSource(source, skillName);

  const { data, content: body } = matter(rawContent);

  if (!body || !body.trim()) {
    throw new Error('SKILL.md has no content body');
  }

  // Resolve name
  let name = data.name as string | undefined;
  if (!name) {
    const headingMatch = body.match(/^#\s+(.+)$/m);
    name = headingMatch ? headingMatch[1].trim() : sourceName;
  }

  // Resolve description
  let description = data.description as string | undefined;
  if (!description) {
    const firstParagraph = body
      .split('\n\n')
      .find(p => p.trim() && !p.trim().startsWith('#'));
    description = firstParagraph
      ? firstParagraph.trim().slice(0, 200)
      : 'No description available';
  }

  return { name, description, body: body.trim(), rawContent };
}
