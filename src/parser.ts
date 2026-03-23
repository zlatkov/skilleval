import { readFile, readdir, stat } from 'node:fs/promises';
import { basename, join } from 'node:path';
import matter from 'gray-matter';
import type { SkillDefinition } from './config.js';

const GITHUB_BLOB_RE = /^https?:\/\/github\.com\/([^/]+)\/([^/]+)\/blob\/([^/]+)\/(.+)$/;
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

async function discoverSkillInRepo(owner: string, repo: string): Promise<string> {
  // Try root SKILL.md first
  const rootUrl = toRawGitHubUrl(owner, repo, 'main', 'SKILL.md');
  try {
    const res = await fetch(rootUrl, { method: 'HEAD' });
    if (res.ok) return rootUrl;
  } catch { /* continue */ }

  // Try 'master' branch
  const masterUrl = toRawGitHubUrl(owner, repo, 'master', 'SKILL.md');
  try {
    const res = await fetch(masterUrl, { method: 'HEAD' });
    if (res.ok) return masterUrl;
  } catch { /* continue */ }

  // Search via GitHub API for SKILL.md files in common directories
  for (const searchPath of SKILL_SEARCH_PATHS.slice(1)) {
    for (const branch of ['main', 'master']) {
      const apiUrl = `https://api.github.com/repos/${owner}/${repo}/contents/${searchPath}?ref=${branch}`;
      try {
        const res = await fetch(apiUrl);
        if (!res.ok) continue;
        const items = await res.json() as Array<{ name: string; path: string }>;
        if (!Array.isArray(items)) continue;

        for (const item of items) {
          if (item.name === 'SKILL.md') {
            return toRawGitHubUrl(owner, repo, branch, item.path);
          }
          // Check subdirectories (e.g., .claude/skills/my-skill/SKILL.md)
          const subApiUrl = `https://api.github.com/repos/${owner}/${repo}/contents/${item.path}?ref=${branch}`;
          try {
            const subRes = await fetch(subApiUrl);
            if (!subRes.ok) continue;
            const subItems = await subRes.json() as Array<{ name: string; path: string }>;
            if (!Array.isArray(subItems)) continue;
            const skillFile = subItems.find(s => s.name === 'SKILL.md');
            if (skillFile) {
              return toRawGitHubUrl(owner, repo, branch, skillFile.path);
            }
          } catch { /* continue */ }
        }
      } catch { /* continue */ }
    }
  }

  throw new Error(
    `Could not find SKILL.md in ${owner}/${repo}. Searched root, .claude/skills/, and skills/ directories.`
  );
}

async function resolveSource(source: string, skillName?: string): Promise<{ content: string; sourceName: string }> {
  // Case 1: GitHub blob URL
  const blobMatch = source.match(GITHUB_BLOB_RE);
  if (blobMatch) {
    const [, owner, repo, branch, path] = blobMatch;
    const rawUrl = toRawGitHubUrl(owner, repo, branch, path);
    return { content: await fetchText(rawUrl), sourceName: path };
  }

  // Case 2: GitHub repo URL
  const repoMatch = source.match(GITHUB_REPO_RE);
  if (repoMatch) {
    const [, owner, repo] = repoMatch;
    const rawUrl = skillName
      ? await discoverNamedSkill(owner, repo, skillName)
      : await discoverSkillInRepo(owner, repo);
    return { content: await fetchText(rawUrl), sourceName: skillName ?? `${owner}/${repo}` };
  }

  // Case 3: GitHub shorthand (owner/repo)
  const shorthandMatch = source.match(GITHUB_SHORTHAND_RE);
  if (shorthandMatch && !source.includes('\\') && !source.includes(':')) {
    const [, owner, repo] = shorthandMatch;
    const rawUrl = skillName
      ? await discoverNamedSkill(owner, repo, skillName)
      : await discoverSkillInRepo(owner, repo);
    return { content: await fetchText(rawUrl), sourceName: skillName ?? `${owner}/${repo}` };
  }

  // Case 4: URL
  if (source.startsWith('http://') || source.startsWith('https://')) {
    return { content: await fetchText(source), sourceName: source };
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
 * Expands a source to one or more file/URL paths.
 * If the source is a local directory, returns paths to all SKILL.md files found recursively.
 * Otherwise returns the source unchanged (single file, URL, or GitHub shorthand).
 */
export async function resolveSkillSources(source: string): Promise<string[]> {
  // Only attempt directory expansion for local paths (not URLs or GitHub shorthands)
  if (source.startsWith('http://') || source.startsWith('https://') || GITHUB_SHORTHAND_RE.test(source)) {
    return [source];
  }
  try {
    const s = await stat(source);
    if (s.isDirectory()) {
      const files = await findSkillFilesInDir(source);
      if (files.length === 0) {
        throw new Error(`No SKILL.md files found in directory: ${source}`);
      }
      return files;
    }
  } catch (err) {
    // Not a directory (or stat failed because it's not a local path) — fall through
    if ((err as NodeJS.ErrnoException).code !== 'ENOENT' && (err as Error).message.startsWith('No SKILL.md')) {
      throw err;
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
