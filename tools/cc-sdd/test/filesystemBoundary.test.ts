import { afterEach, describe, expect, it } from 'vitest';
import { mkdtemp, mkdir, writeFile, readFile, symlink, link, rm, access } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { executeProcessedArtifacts } from '../src/plan/executor.js';
import { mergeConfigAndArgs } from '../src/cli/config.js';
import { loadUserConfig, saveUserConfig } from '../src/cli/store.js';
import type { ProcessedArtifact } from '../src/manifest/processor.js';

const roots: string[] = [];
afterEach(async () => { await Promise.all(roots.splice(0).map(p => rm(p, { recursive: true, force: true }))); });
const fixture = async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'ccsdd-boundary-')); roots.push(root);
  const cwd = path.join(root, 'project'); const templatesRoot = path.join(root, 'templates');
  const outside = path.join(root, 'outside');
  for (const p of [cwd, templatesRoot, outside]) await mkdir(p);
  await writeFile(path.join(templatesRoot, 'doc.tpl.md'), 'NEW');
  await writeFile(path.join(outside, 'victim.md'), 'DUMMY-ORIGINAL');
  return { root, cwd, templatesRoot, outside };
};
const item = (toDir = '.', outFile = 'CLAUDE.md', from = 'doc.tpl.md'): ProcessedArtifact =>
  ({ id: 'doc', source: { type: 'templateFile', from, toDir, outFile } });
const config = () => mergeConfigAndArgs({ overwrite: 'force' });
const missing = async (p: string) => { await expect(access(p)).rejects.toThrow(); };

describe('project filesystem boundary', () => {
  for (const kind of ['file symlink', 'dangling symlink', 'hardlink', 'parent symlink'] as const) {
    it(`rejects a destination ${kind} without touching its referent`, async () => {
      const f = await fixture(); const victim = path.join(f.outside, 'victim.md');
      let artifact = item();
      if (kind === 'parent symlink') {
        await symlink(f.outside, path.join(f.cwd, '.claude'), 'dir'); artifact = item('.claude', 'victim.md');
      } else if (kind === 'hardlink') await link(victim, path.join(f.cwd, 'CLAUDE.md'));
      else await symlink(kind === 'dangling symlink' ? path.join(f.outside, 'missing.md') : victim, path.join(f.cwd, 'CLAUDE.md'));
      await expect(executeProcessedArtifacts([artifact], config(), f)).rejects.toThrow();
      expect(await readFile(victim, 'utf8')).toBe('DUMMY-ORIGINAL');
      await missing(path.join(f.outside, 'missing.md'));
    });
  }
  for (const absolute of [false, true]) {
    it(`rejects ${absolute ? 'absolute' : 'relative'} destination escape before any write`, async () => {
      const f = await fixture();
      const bad = item(absolute ? f.outside : '../outside', 'victim.md');
      await expect(executeProcessedArtifacts([item('.', 'AAA.md'), bad], config(), f)).rejects.toThrow();
      await missing(path.join(f.cwd, 'AAA.md'));
      expect(await readFile(path.join(f.outside, 'victim.md'), 'utf8')).toBe('DUMMY-ORIGINAL');
    });
  }
  for (const source of ['../outside/victim.md', 'linked.md', 'linked/victim.md', 'hardlink.md']) {
    it(`rejects source escape (${source})`, async () => {
      const f = await fixture();
      await symlink(path.join(f.outside, 'victim.md'), path.join(f.templatesRoot, 'linked.md'));
      await symlink(f.outside, path.join(f.templatesRoot, 'linked'), 'dir');
      await link(path.join(f.outside, 'victim.md'), path.join(f.templatesRoot, 'hardlink.md'));
      await expect(executeProcessedArtifacts([item('.', 'CLAUDE.md', source)], config(), f)).rejects.toThrow();
      await missing(path.join(f.cwd, 'CLAUDE.md'));
    });
  }
  for (const mode of ['escape', 'parent symlink', 'file symlink'] as const) {
    it(`rejects backup ${mode} before overwriting`, async () => {
      const f = await fixture(); await writeFile(path.join(f.cwd, 'CLAUDE.md'), 'OLD');
      const cfg = { ...config(), backupEnabled: true, backupDir: mode === 'escape' ? '../outside' : 'backup' };
      if (mode === 'parent symlink') await symlink(f.outside, path.join(f.cwd, 'backup'), 'dir');
      if (mode === 'file symlink') {
        await mkdir(path.join(f.cwd, 'backup'));
        await symlink(path.join(f.outside, 'victim.md'), path.join(f.cwd, 'backup/CLAUDE.md'));
      }
      await expect(executeProcessedArtifacts([item()], cfg, f)).rejects.toThrow();
      expect(await readFile(path.join(f.cwd, 'CLAUDE.md'), 'utf8')).toBe('OLD');
      expect(await readFile(path.join(f.outside, 'victim.md'), 'utf8')).toBe('DUMMY-ORIGINAL');
      await missing(path.join(f.outside, 'CLAUDE.md'));
    });
  }
  for (const kind of ['symlink', 'hardlink']) {
    it(`rejects a config ${kind}`, async () => {
      const f = await fixture(); const victim = path.join(f.outside, 'victim.md');
      if (kind === 'symlink') await symlink(victim, path.join(f.cwd, '.cc-sdd.json'));
      else await link(victim, path.join(f.cwd, '.cc-sdd.json'));
      await expect(saveUserConfig(f.cwd, { lang: 'ja' })).rejects.toThrow();
      await expect(loadUserConfig(f.cwd)).rejects.toThrow();
      expect(await readFile(victim, 'utf8')).toBe('DUMMY-ORIGINAL');
    });
  }
  it('validates injected operations before invoking their renderer', async () => {
    const f = await fixture(); let invoked = false;
    const op = { artifactId: 'injected', srcAbs: '', destAbs: path.join(f.outside, 'victim.md'), relTarget: '../outside/victim.md', sourceMode: 'static' as const, category: 'other' as any, render: async () => { invoked = true; return 'NEW'; } };
    await expect(executeProcessedArtifacts([], config(), { ...f, operations: [op] })).rejects.toThrow();
    expect(invoked).toBe(false);
    expect(await readFile(path.join(f.outside, 'victim.md'), 'utf8')).toBe('DUMMY-ORIGINAL');
  });
  it('revalidates after a conflict callback changes a path', async () => {
    const f = await fixture(); await writeFile(path.join(f.cwd, 'CLAUDE.md'), 'OLD');
    const cfg = { ...config(), effectiveOverwrite: 'prompt' as const };
    const onConflict = async () => { await rm(path.join(f.cwd, 'CLAUDE.md')); await symlink(path.join(f.outside, 'victim.md'), path.join(f.cwd, 'CLAUDE.md')); return 'overwrite' as const; };
    await expect(executeProcessedArtifacts([item()], cfg, { ...f, onConflict })).rejects.toThrow();
    expect(await readFile(path.join(f.outside, 'victim.md'), 'utf8')).toBe('DUMMY-ORIGINAL');
  });
  for (const type of ['staticDir', 'templateDir'] as const) {
    it(`rejects a ${type} with linked entries before copying any file`, async () => {
      const f = await fixture();
      await symlink(path.join(f.outside, 'victim.md'), path.join(f.templatesRoot, 'linked.md'));
      const artifact: ProcessedArtifact = type === 'staticDir'
        ? { id: 'dir', source: { type, from: '.', toDir: 'out' } }
        : { id: 'dir', source: { type, fromDir: '.', toDir: 'out' } };
      await expect(executeProcessedArtifacts([artifact], config(), f)).rejects.toThrow();
      await missing(path.join(f.cwd, 'out'));
    });
  }
  for (const backupDir of ['.', 'sub/..']) {
    it(`rejects backup root alias ${backupDir}`, async () => {
      const f = await fixture(); await writeFile(path.join(f.cwd, 'CLAUDE.md'), 'OLD');
      await expect(executeProcessedArtifacts([item()], { ...config(), backupEnabled: true, backupDir }, f)).rejects.toThrow();
      expect(await readFile(path.join(f.cwd, 'CLAUDE.md'), 'utf8')).toBe('OLD');
    });
  }
  it('preserves ordinary append and backup behavior', async () => {
    const f = await fixture(); await writeFile(path.join(f.cwd, 'CLAUDE.md'), 'OLD');
    const cfg = { ...config(), backupEnabled: true, backupDir: 'backup' };
    const result = await executeProcessedArtifacts([item()], cfg, { ...f, categoryPolicies: { 'project-memory': 'append' } });
    expect(result.written).toBe(1);
    expect(await readFile(path.join(f.cwd, 'CLAUDE.md'), 'utf8')).toBe('OLD\n\nNEW\n');
    expect(await readFile(path.join(f.cwd, 'backup/CLAUDE.md'), 'utf8')).toBe('OLD');
  });
});
