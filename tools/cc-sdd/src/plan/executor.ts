import { assertSafePath, safeReadFile, safeWriteFile } from '../utils/safeFiles.js';
import path from 'node:path';
import type { ProcessedArtifact } from '../manifest/processor.js';
import type { ResolvedConfig } from '../cli/config.js';
import { buildFileOperations, type FileOperation, type SourceMode } from './fileOperations.js';
import type { InstallCategory } from './categories.js';
import { fileExists } from '../utils/fs.js';

const backupIfNeeded = async (target: string, cwd: string, resolved: ResolvedConfig): Promise<void> => {
  if (!resolved.backupEnabled) return;
  if (!(await fileExists(target))) return;
  const rel = path.relative(cwd, target);
  const backupPath = path.resolve(cwd, resolved.backupDir, rel);
  await safeWriteFile(cwd, backupPath, await safeReadFile(cwd, target));
};

export type ConflictDecision = 'overwrite' | 'skip' | 'append';

export type ConflictInfo = {
  relTargetPath: string;
  category: InstallCategory;
  sourceMode: SourceMode;
};

export type ExecOptions = {
  cwd?: string;
  templatesRoot?: string;
  log?: (msg: string) => void;
  onConflict?: (info: ConflictInfo) => Promise<ConflictDecision> | ConflictDecision;
  operations?: FileOperation[];
  categoryPolicies?: Partial<Record<InstallCategory, CategoryPolicy>>;
};

export type CategoryPolicy = 'inherit' | 'overwrite' | 'skip' | 'append';

const resolveCategoryPolicy = (
  category: InstallCategory,
  policies: Partial<Record<InstallCategory, CategoryPolicy>> | undefined,
): CategoryPolicy => {
  return policies?.[category] ?? 'inherit';
};

const canAppend = (mode: SourceMode): boolean => {
  return mode !== 'template-json';
};

const ensureString = async (content: string | Buffer): Promise<string> => {
  if (typeof content === 'string') return content;
  return content.toString('utf8');
};

const handleWrite = async (
  op: FileOperation,
  content: string | Buffer,
  cwd: string,
  resolved: ResolvedConfig,
): Promise<void> => {
  await backupIfNeeded(op.destAbs, cwd, resolved);
  await safeWriteFile(cwd, op.destAbs, content);
};

const handleAppend = async (
  op: FileOperation,
  content: string | Buffer,
  cwd: string,
  resolved: ResolvedConfig,
  opts: ExecOptions,
): Promise<boolean> => {
  if (!canAppend(op.sourceMode)) {
    opts.log?.(`Append not supported for ${op.relTarget} (non-text content). Skipping.`);
    return false;
  }
  if (!(await fileExists(op.destAbs))) {
    await handleWrite(op, content, cwd, resolved);
    return true;
  }
  const text = await ensureString(content);
  const normalized = text.endsWith('\n') ? text : `${text}\n`;
  const previous = await safeReadFile(cwd, op.destAbs);
  await backupIfNeeded(op.destAbs, cwd, resolved);
  await safeWriteFile(cwd, op.destAbs, Buffer.concat([previous, Buffer.from(`\n\n${normalized}`)]));
  return true;
};

const resolveAction = async (
  op: FileOperation,
  exists: boolean,
  resolved: ResolvedConfig,
  opts: ExecOptions,
): Promise<'write' | 'skip' | 'append'> => {
  const categoryPolicy = resolveCategoryPolicy(op.category, opts.categoryPolicies);
  const effective = resolved.effectiveOverwrite;

  if (!exists) {
    if (categoryPolicy === 'skip') return 'skip';
    if (categoryPolicy === 'append') return 'write';
    return 'write';
  }

  switch (categoryPolicy) {
    case 'skip':
      return 'skip';
    case 'overwrite':
      return 'write';
    case 'append':
      return 'append';
    default:
  }

  if (effective === 'skip') return 'skip';
  if (effective === 'force') return 'write';

  const decision = await opts.onConflict?.({
    relTargetPath: op.relTarget,
    category: op.category,
    sourceMode: op.sourceMode,
  });
  if (!decision || decision === 'skip') return 'skip';
  if (decision === 'append') return 'append';
  return 'write';
};

export const executeProcessedArtifacts = async (
  items: ProcessedArtifact[],
  resolved: ResolvedConfig,
  opts: ExecOptions = {},
): Promise<{ written: number; skipped: number }> => {
  const cwd = opts.cwd ?? process.cwd();
  const operations = opts.operations ?? (await buildFileOperations(items, resolved, opts));
  const targets = new Set(operations.map(op => path.resolve(op.destAbs)));
  // Validate the complete plan before rendering or mutating any file.
  for (const op of operations) {
    await assertSafePath(cwd, op.destAbs);
    if (resolved.backupEnabled) {
      if (path.resolve(cwd, resolved.backupDir) === path.resolve(cwd)) throw new Error('Backup directory must be a separate project subdirectory');
      const backup = path.resolve(cwd, resolved.backupDir, path.relative(cwd, op.destAbs));
      if (targets.has(backup)) throw new Error('Backup path overlaps an install target');
      await assertSafePath(cwd, path.resolve(cwd, resolved.backupDir), 'directory');
      await assertSafePath(cwd, path.resolve(cwd, resolved.backupDir, path.relative(cwd, op.destAbs)));
    }
  }
  let written = 0;
  let skipped = 0;

  for (const op of operations) {
    const exists = await fileExists(op.destAbs);
    let action = await resolveAction(op, exists, resolved, opts);

    if (action === 'append' && !canAppend(op.sourceMode)) {
      opts.log?.(`Append not supported for ${op.relTarget} (non-text content). Overwriting instead.`);
      action = 'write';
    }

    if (action === 'skip') {
      skipped++;
      continue;
    }

    await assertSafePath(cwd, op.destAbs);
    const rendered = await op.render();

    if (action === 'append') {
      const success = await handleAppend(op, rendered, cwd, resolved, opts);
      if (success) written++; else skipped++;
      continue;
    }

    await handleWrite(op, rendered, cwd, resolved);
    written++;
  }

  return { written, skipped };
};
