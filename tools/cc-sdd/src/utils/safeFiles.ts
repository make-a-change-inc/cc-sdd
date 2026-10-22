import path from 'node:path';
import { constants } from 'node:fs';
import { lstat, realpath, open, mkdir, mkdtemp, rename, rm } from 'node:fs/promises';

// Roots are explicitly selected by the caller. Reject links and non-regular
// entries below them. This is not a sandbox against concurrent directory swaps.
export const assertSafePath = async (
  root: string, candidate: string, kind: 'file' | 'directory' = 'file',
): Promise<string> => {
  const rel = path.relative(path.resolve(root), path.resolve(candidate));
  if (rel === '..' || rel.startsWith(`..${path.sep}`) || path.isAbsolute(rel) || (!rel && kind === 'file')) {
    throw new Error('Path must stay within its selected root');
  }
  const canonicalRoot = await realpath(root);
  let current = canonicalRoot;
  const parts = rel ? rel.split(path.sep) : [];
  for (let i = 0; i < parts.length; i++) {
    current = path.join(current, parts[i]);
    let info;
    try { info = await lstat(current); }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') break;
      throw error;
    }
    if (info.isSymbolicLink()) throw new Error('Linked paths are not supported');
    if (i < parts.length - 1 || kind === 'directory') {
      if (!info.isDirectory()) throw new Error('Expected an ordinary directory');
    } else if (!info.isFile() || info.nlink !== 1) {
      throw new Error('Expected an ordinary unlinked file');
    }
  }
  return path.join(canonicalRoot, rel);
};

export const safeReadFile = async (root: string, target: string): Promise<Buffer> => {
  const file = await assertSafePath(root, target);
  const handle = await open(file, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const info = await handle.stat();
    if (!info.isFile() || info.nlink !== 1) throw new Error('Expected an ordinary unlinked file');
    return await handle.readFile();
  } finally { await handle.close(); }
};

export const safeWriteFile = async (root: string, target: string, content: string | Buffer): Promise<void> => {
  let file = await assertSafePath(root, target);
  await mkdir(path.dirname(file), { recursive: true });
  file = await assertSafePath(root, target);
  let mode = 0o644;
  try { mode = (await lstat(file)).mode & 0o777; }
  catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
  const temporary = await mkdtemp(path.join(path.dirname(file), '.cc-sdd-write-'));
  try {
    const payload = path.join(temporary, 'payload');
    const handle = await open(payload, 'wx', mode);
    try { await handle.writeFile(content); } finally { await handle.close(); }
    await assertSafePath(root, target);
    // Replacement does not truncate a referent if the leaf changes to a link.
    await rename(payload, file);
  } finally { await rm(temporary, { recursive: true, force: true }); }
};
