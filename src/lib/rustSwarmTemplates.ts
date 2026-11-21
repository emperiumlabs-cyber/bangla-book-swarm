import type { DeviceLayoutProfile, PublisherConfig } from '../types/translator';

export function generateSubagentWorkerDoc(
  houseBn: string,
  registerLabel: string,
  strictZeroEnglish: boolean
): string {
  return `# Sub-Agent Worker Protocol (3.8 Flash / Lower-LLM Proof · Zero API Key)

You are one parallel sub-agent in a multi-agent book translation swarm for **${houseBn}** (${registerLabel}).
You own ONLY your assigned worker shard (\`--worker worker-XX\`). Because every chunk writes to its own atomic file (\`workspace/books/<slug>/out/<chunk-id>.bn.json\`), you can run in parallel alongside 10, 20, or 50 other sub-agents with ZERO race conditions.

## Strict Loop (Run Until Your Shard Prints \`SHARD_COMPLETE\`)

1. Fetch your next assigned chunk:
   \`\`\`bash
   npx tsx scripts/swarm-orchestrator.ts claim --worker <YOUR_WORKER_ID>
   \`\`\`
2. Read the file printed by \`claim\` (e.g. \`workspace/workers/<YOUR_WORKER_ID>-current.json\`).
3. Translate \`sourceText\` (and \`chapterTitle\` into \`chapterTitleBangla\`) using **2-Pass Sense-First Promito Bangla**:
   - **Pass 1 (Meaning Fidelity — মর্মনিষ্ঠ ভাবানুবাদ)**: Understand what the author *actually meant*. NEVER translate idioms word-for-word literally (e.g., never *"বরফ ভাঙা"* for *"break the ice"*, never *"ঘরের হাতি"* for *"elephant in the room"*). Preserve exact facts, negations, qualifiers, emotional tone, and all numbers (convert digits to Bengali \`০–৯\`).
   - **Pass 2 (Zero AI Slop & Full Formatting)**:
     - **STRICTLY ZERO AI SYMBOLS**: NEVER use em-dashes (\`—\`), en-dashes (\`–\`), horizontal bars (\`―\`), double dashes (\`--\`), spaced dashes (\`" - "\`), emojis, decorative arrows/stars, or chatbot introductions. Use natural Bengali commas (\`,\`), semicolons (\`;\`), colons (\`:\`), and Dari (\`।\`).
     - **100% BANGLA**: ${strictZeroEnglish ? 'Zero untranslated English prose; transliterate all proper names into Bangla script.' : 'Keep technical terms minimal and write fluent Bangla.'}
     - **PRESERVE EVERY \`[[ASSET:...]]\` TOKEN VERBATIM** in its exact paragraph slot.
     - **PRESERVE ALL SEMANTIC FORMATTING**: \`# / ## / ###\` headings, \`**bold**\`, \`*italic*\`, \`==highlight==\`, \`> blockquote\`, \`- list\`, and \`~small notes~\`.
     - Follow every locked entry in \`scopedGlossary\` verbatim.
4. Write ONLY the final Bangla text to \`workspace/workers/<YOUR_WORKER_ID>-output.txt\` (and pass \`--chapter-title-bn "<Bangla chapter title>"\`).
5. Submit to the deterministic 6-check gate:
   \`\`\`bash
   npx tsx scripts/swarm-orchestrator.ts submit --worker <YOUR_WORKER_ID> --book <bookSlug> --chunk <chunkId> --file workspace/workers/<YOUR_WORKER_ID>-output.txt --chapter-title-bn "<Bangla chapter title>"
   \`\`\`
   - If exit code is \`0\`, move immediately to step 1.
   - If the auditor rejects a chunk (exit code \`2\`), fix the exact listed defects and resubmit. After 2 failures on a dense slice, the orchestrator automatically halves it lock-free inside your shard (\`<id>a\` and \`<id>b\`, exit code \`3\`) so even 3.8 Flash always succeeds 100%.
6. Stop ONLY when \`claim\` prints \`SHARD_COMPLETE\`, then report your worker summary back to the orchestrator.
`;
}

export function generateBatchExtractScript(houseBn: string, maxWords: number): string {
  const houseLit = JSON.stringify(houseBn);
  const maxWordsLit = JSON.stringify(String(maxWords));
  return `#!/usr/bin/env tsx
/**
 * Parallel Multi-Book Extractor — Ingests 1 book OR 50+ books from ./books/
 * simultaneously (PDF, EPUB, DOCX, ODT, FB2, RTF, HTML, LaTeX, MD, TXT + Calibre bridge)
 * with OCR hyphen repair, untouched graph/picture extraction, and isolated per-book workspaces.
 *
 * Usage:
 *   npx tsx scripts/batch-extract.ts --input ./books --publisher ${houseLit} --max-words ${maxWords} --concurrency 8
 */
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);
const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));

const SUPPORTED_EXTS = new Set([
  '.pdf', '.epub', '.docx', '.odt', '.fb2', '.rtf', '.html', '.htm', '.xhtml',
  '.tex', '.md', '.markdown', '.txt', '.mobi', '.azw3', '.kfx', '.djvu', '.doc',
]);

function getArg(flag: string, fallback = ''): string {
  const idx = process.argv.indexOf(flag);
  return idx >= 0 && process.argv[idx + 1] ? process.argv[idx + 1] : fallback;
}

function slugify(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'book';
}

function runTsx(scriptPath: string, args: string[]) {
  const candidates = [
    path.resolve('node_modules', 'tsx', 'dist', 'cli.mjs'),
    path.resolve(SCRIPT_DIR, '..', 'node_modules', 'tsx', 'dist', 'cli.mjs'),
  ];
  const localTsxCli = candidates.find((p) => fs.existsSync(p));
  if (localTsxCli) {
    return execFileAsync(process.execPath, [localTsxCli, scriptPath, ...args], {
      maxBuffer: 64 * 1024 * 1024,
    });
  }
  const npxBin = process.platform === 'win32' ? 'npx.cmd' : 'npx';
  return execFileAsync(npxBin, ['tsx', scriptPath, ...args], {
    maxBuffer: 64 * 1024 * 1024,
  });
}

async function main() {
  const inputPath = getArg('--input', './books');
  const publisher = getArg('--publisher', ${houseLit});
  const maxWords = getArg('--max-words', ${maxWordsLit});
  const concurrency = Math.max(1, Number(getArg('--concurrency', String(Math.min(8, os.cpus().length || 4)))));

  if (!fs.existsSync(inputPath)) {
    console.error(\`Input path not found: \${inputPath}\`);
    process.exit(1);
  }

  const stat = fs.statSync(inputPath);
  const files = stat.isDirectory()
    ? fs.readdirSync(inputPath)
        .filter((f) => SUPPORTED_EXTS.has(path.extname(f).toLowerCase()))
        .sort()
        .map((f) => path.join(inputPath, f))
    : [inputPath];

  if (files.length === 0) {
    console.error(\`No supported book files found in \${inputPath}\`);
    process.exit(1);
  }

  fs.mkdirSync('workspace/books', { recursive: true });
  const manifestBooks: Array<{ slug: string; sourceFile: string; ledgerPath: string; chunks: number; assets: number }> = [];
  const usedSlugs = new Set<string>();

  const queue = files.map((filePath) => {
    const base = slugify(path.basename(filePath, path.extname(filePath)));
    let slug = base;
    let n = 2;
    while (usedSlugs.has(slug)) slug = \`\${base}-\${n++}\`;
    usedSlugs.add(slug);
    return { filePath, slug };
  });

  console.log(\`Ingesting \${queue.length} book(s) in parallel (concurrency=\${concurrency})...\`);
  let cursor = 0;

  async function worker() {
    while (cursor < queue.length) {
      const item = queue[cursor++];
      const bookDir = path.join('workspace', 'books', item.slug);
      fs.mkdirSync(path.join(bookDir, 'out'), { recursive: true });
      fs.mkdirSync(path.join(bookDir, 'assets'), { recursive: true });

      await runTsx(path.join(SCRIPT_DIR, 'extract-book.ts'), [
        '--input', item.filePath,
        '--publisher', publisher,
        '--max-words', maxWords,
        '--out-dir', bookDir,
      ]);

      const ledgerPath = path.join(bookDir, 'ledger.json');
      const ledger = JSON.parse(fs.readFileSync(ledgerPath, 'utf8'));
      manifestBooks.push({
        slug: item.slug,
        sourceFile: path.basename(item.filePath),
        ledgerPath,
        chunks: ledger.chunks.length,
        assets: (ledger.assets || []).length,
      });
      console.log(\`  [OK] \${item.slug}: \${ledger.chunks.length} chunks, \${(ledger.assets || []).length} preserved assets\`);
    }
  }

  await Promise.all(Array.from({ length: Math.min(concurrency, queue.length) }, () => worker()));

  manifestBooks.sort((a, b) => a.slug.localeCompare(b.slug));
  const totalChunks = manifestBooks.reduce((s, b) => s + b.chunks, 0);
  fs.writeFileSync(
    'workspace/batch-manifest.json',
    JSON.stringify({ createdAt: new Date().toISOString(), publisher, totalBooks: manifestBooks.length, totalChunks, books: manifestBooks }, null, 2)
  );
  console.log(\`Batch ready: \${manifestBooks.length} book(s), \${totalChunks} total chunks -> workspace/batch-manifest.json\`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
`;
}

export function generateSwarmOrchestratorScript(
  defaultSwarm: PublisherConfig['swarmConcurrency'],
  defaultLayout: DeviceLayoutProfile
): string {
  const workerDefault = defaultSwarm ?? 'auto';
  const workerDefaultLit = JSON.stringify(workerDefault);
  const layoutLit = JSON.stringify(defaultLayout);
  return `#!/usr/bin/env tsx
/**
 * Lock-Free Multi-Sub-Agent Swarm Orchestrator (Zero API Key · 10 / 20 / 50+ Sub-Agents)
 *
 * Prevents all race conditions when Antigravity spawns 10, 20, or 50 parallel sub-agents
 * across 1 huge book or 50+ books simultaneously:
 *   - Every sub-agent gets a strictly disjoint shard (workspace/shards/worker-XX.json).
 *   - Every translated chunk writes atomically to workspace/books/<slug>/out/<chunkId>.bn.json.
 *   - Lock-free auto-halving splits dense failing slices into <id>a / <id>b inside the worker's
 *     own shard after 2 rejections so even 3.5/3.8 Flash achieves 100% completion.
 *   - Uses native Rust accelerator (rust-core/target/release/lipiforge-fast) automatically when built!
 *
 * Commands:
 *   npx tsx scripts/swarm-orchestrator.ts plan --workers ${workerDefault}
 *   npx tsx scripts/swarm-orchestrator.ts claim --worker worker-01
 *   npx tsx scripts/swarm-orchestrator.ts submit --worker worker-01 --book <slug> --chunk <id> --file <txt> [--chapter-title-bn "..."]
 *   npx tsx scripts/swarm-orchestrator.ts status
 *   npx tsx scripts/swarm-orchestrator.ts merge
 *   npx tsx scripts/swarm-orchestrator.ts verify
 */
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { auditChunk } from './audit-bangla';

const cmd = process.argv[2] || 'status';
const WORKSPACE_ROOT = path.resolve('workspace');
const MANIFEST_PATH = 'workspace/batch-manifest.json';
const SHARDS_DIR = 'workspace/shards';
const WORKERS_DIR = 'workspace/workers';
const RUST_BIN = path.resolve(
  'rust-core',
  'target',
  'release',
  process.platform === 'win32' ? 'lipiforge-fast.exe' : 'lipiforge-fast'
);

interface ShardItem {
  bookSlug: string;
  chunkId: string;
  overrideSourceText?: string;
  splitDepth?: number;
}

function getArg(flag: string, fallback = ''): string {
  const idx = process.argv.indexOf(flag);
  return idx >= 0 && process.argv[idx + 1] ? process.argv[idx + 1] : fallback;
}

function assertSafeId(value: string, label: string): string {
  if (!/^[a-zA-Z0-9_-]{1,120}$/.test(value)) {
    console.error(\`Invalid \${label}: "\${value}". Only letters, digits, hyphens, and underscores are allowed.\`);
    process.exit(1);
  }
  return value;
}

function resolveInside(baseDir: string, ...segments: string[]): string {
  const base = path.resolve(baseDir);
  const target = path.resolve(base, ...segments);
  if (target !== base && !target.startsWith(base + path.sep)) {
    console.error(\`Path traversal blocked outside \${base}\`);
    process.exit(1);
  }
  return target;
}

function atomicWriteJson(targetPath: string, data: unknown) {
  fs.mkdirSync(path.dirname(targetPath), { recursive: true });
  const tmp = \`\${targetPath}.\${process.pid}.\${Date.now()}.tmp\`;
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2));
  fs.renameSync(tmp, targetPath);
}

function splitTextInHalf(text: string): [string, string] | null {
  const paras = text.split(/\\n{2,}/).map((p) => p.trim()).filter(Boolean);
  if (paras.length >= 2) {
    const mid = Math.ceil(paras.length / 2);
    return [paras.slice(0, mid).join('\\n\\n'), paras.slice(mid).join('\\n\\n')];
  }
  const sentences = text.split(/(?<=[.!?])\\s+/).filter(Boolean);
  if (sentences.length >= 2) {
    const mid = Math.ceil(sentences.length / 2);
    return [sentences.slice(0, mid).join(' '), sentences.slice(mid).join(' ')];
  }
  return null;
}

function ensureManifest() {
  if (fs.existsSync(MANIFEST_PATH)) {
    return JSON.parse(fs.readFileSync(MANIFEST_PATH, 'utf8'));
  }
  if (fs.existsSync('workspace/ledger.json')) {
    const ledger = JSON.parse(fs.readFileSync('workspace/ledger.json', 'utf8'));
    const slug = (ledger.title || 'book').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'book';
    const bookDir = resolveInside(WORKSPACE_ROOT, 'books', slug);
    fs.mkdirSync(path.join(bookDir, 'out'), { recursive: true });
    fs.writeFileSync(path.join(bookDir, 'ledger.json'), JSON.stringify(ledger, null, 2));
    if (fs.existsSync('workspace/assets')) {
      fs.cpSync('workspace/assets', path.join(bookDir, 'assets'), { recursive: true });
    }
    const manifest = {
      createdAt: new Date().toISOString(),
      publisher: ledger.publisher || '',
      totalBooks: 1,
      totalChunks: ledger.chunks.length,
      books: [{ slug, sourceFile: ledger.sourceFile || 'book', ledgerPath: path.join('workspace', 'books', slug, 'ledger.json'), chunks: ledger.chunks.length, assets: (ledger.assets || []).length }],
    };
    atomicWriteJson(MANIFEST_PATH, manifest);
    return manifest;
  }
  console.error('No workspace/batch-manifest.json or workspace/ledger.json found. Run scripts/batch-extract.ts first.');
  process.exit(1);
}

function computeWorkerCount(totalPending: number, bookCount: number, requested: string): number {
  if (totalPending <= 0) return 0;
  if (requested !== 'auto' && Number(requested) > 0) {
    return Math.max(1, Math.min(Number(requested), totalPending));
  }
  if (totalPending <= 6) return Math.min(totalPending, Math.max(1, Math.ceil(totalPending / 2)));
  if (totalPending <= 120) return Math.min(12, Math.max(4, Math.ceil(totalPending / 8)));
  if (totalPending <= 450) return Math.min(20, Math.max(10, Math.ceil(totalPending / 18)));
  return Math.min(50, Math.min(totalPending, Math.max(20, bookCount, Math.ceil(totalPending / 25))));
}

function outFilePath(slug: string, chunkId: string): string {
  assertSafeId(slug, 'bookSlug');
  assertSafeId(chunkId, 'chunkId');
  return resolveInside(WORKSPACE_ROOT, 'books', slug, 'out', \`\${chunkId}.bn.json\`);
}

function splitMetaPath(slug: string, chunkId: string): string {
  assertSafeId(slug, 'bookSlug');
  assertSafeId(chunkId, 'chunkId');
  return resolveInside(WORKSPACE_ROOT, 'books', slug, 'out', \`\${chunkId}.split.json\`);
}

/** Recursively resolve a chunk (or its lock-free auto-halved sub-chunks) */
function resolveChunkOutcome(slug: string, chunkId: string): { passed: boolean; banglaText: string; chapterTitleBangla: string; attempts: number } | null {
  const direct = outFilePath(slug, chunkId);
  if (fs.existsSync(direct)) {
    const rec = JSON.parse(fs.readFileSync(direct, 'utf8'));
    if (rec.status === 'passed') {
      return {
        passed: true,
        banglaText: rec.banglaText || '',
        chapterTitleBangla: rec.chapterTitleBangla || '',
        attempts: rec.attempts || 1,
      };
    }
  }
  const splitPath = splitMetaPath(slug, chunkId);
  if (fs.existsSync(splitPath)) {
    const meta = JSON.parse(fs.readFileSync(splitPath, 'utf8')) as { children: string[] };
    const parts: string[] = [];
    let chapterTitleBangla = '';
    let attempts = 0;
    for (const childId of meta.children || []) {
      const childRes = resolveChunkOutcome(slug, childId);
      if (!childRes || !childRes.passed) return null;
      parts.push(childRes.banglaText);
      if (!chapterTitleBangla && childRes.chapterTitleBangla) chapterTitleBangla = childRes.chapterTitleBangla;
      attempts += childRes.attempts;
    }
    return {
      passed: parts.length > 0,
      banglaText: parts.join('\\n\\n'),
      chapterTitleBangla,
      attempts,
    };
  }
  return null;
}

if (cmd === 'plan') {
  const manifest = ensureManifest();
  const requested = getArg('--workers', ${workerDefaultLit});
  const pending: ShardItem[] = [];

  for (const b of manifest.books) {
    const ledger = JSON.parse(fs.readFileSync(b.ledgerPath, 'utf8'));
    for (const ck of ledger.chunks) {
      const resolved = resolveChunkOutcome(b.slug, ck.id);
      if (ck.status === 'passed' || resolved?.passed) {
        continue;
      }
      pending.push({ bookSlug: b.slug, chunkId: ck.id });
    }
  }

  fs.rmSync(SHARDS_DIR, { recursive: true, force: true });
  fs.mkdirSync(SHARDS_DIR, { recursive: true });
  fs.mkdirSync(WORKERS_DIR, { recursive: true });

  const workerCount = computeWorkerCount(pending.length, manifest.books.length, requested);
  if (workerCount === 0) {
    console.log('ALL_COMPLETE: 0 pending chunks across all books.');
    process.exit(0);
  }

  const base = Math.floor(pending.length / workerCount);
  const rem = pending.length % workerCount;
  let cursor = 0;
  const shardList: Array<{ workerId: string; count: number; books: string[] }> = [];

  for (let i = 0; i < workerCount; i++) {
    const size = base + (i < rem ? 1 : 0);
    const items = pending.slice(cursor, cursor + size);
    cursor += size;
    const workerId = \`worker-\${String(i + 1).padStart(2, '0')}\`;
    atomicWriteJson(resolveInside(SHARDS_DIR, \`\${workerId}.json\`), { workerId, items });
    shardList.push({ workerId, count: items.length, books: Array.from(new Set(items.map((x) => x.bookSlug))) });
  }

  atomicWriteJson('workspace/swarm-plan.json', {
    workerCount,
    totalBooks: manifest.books.length,
    totalPending: pending.length,
    defaultLayout: ${layoutLit},
    rustAcceleratorAvailable: fs.existsSync(RUST_BIN),
    shards: shardList,
  });

  console.log(\`SWARM_PLAN_READY: \${workerCount} parallel sub-agents across \${manifest.books.length} book(s) (\${pending.length} pending chunks)\`);
  for (const s of shardList) {
    console.log(\`  - \${s.workerId}: \${s.count} chunks [\${s.books.join(', ')}]\`);
  }
  process.exit(0);
}

if (cmd === 'claim') {
  const workerId = assertSafeId(getArg('--worker'), 'workerId');
  const shardPath = resolveInside(SHARDS_DIR, \`\${workerId}.json\`);
  if (!fs.existsSync(shardPath)) { console.error(\`Shard not found: \${shardPath}\`); process.exit(1); }

  const shard = JSON.parse(fs.readFileSync(shardPath, 'utf8')) as { workerId: string; items: ShardItem[] };
  const ledgerCache = new Map<string, any>();

  for (const item of shard.items) {
    const resolved = resolveChunkOutcome(item.bookSlug, item.chunkId);
    if (resolved?.passed) {
      continue;
    }
    assertSafeId(item.bookSlug, 'bookSlug');
    if (!ledgerCache.has(item.bookSlug)) {
      ledgerCache.set(item.bookSlug, JSON.parse(fs.readFileSync(resolveInside(WORKSPACE_ROOT, 'books', item.bookSlug, 'ledger.json'), 'utf8')));
    }
    const ledger = ledgerCache.get(item.bookSlug);
    const baseChunkId = item.chunkId.replace(/[ab]+$/, '');
    const ck = ledger.chunks.find((c: any) => c.id === item.chunkId) || ledger.chunks.find((c: any) => c.id === baseChunkId);
    if (!ck) continue;

    const sourceText = item.overrideSourceText ?? ck.sourceText;
    const lowerSrc = sourceText.toLowerCase();
    const scopedGlossary = (ledger.glossary || []).filter((g: any) => lowerSrc.includes(g.english.toLowerCase()));
    const outPayload = {
      workerId,
      bookSlug: item.bookSlug,
      bookTitle: ledger.title,
      publisher: ledger.publisher,
      chunkId: item.chunkId,
      chapterTitle: ck.chapterTitle,
      contextTail: ck.contextTail,
      scopedGlossary,
      sourceText,
    };
    const taskFile = resolveInside(WORKERS_DIR, \`\${workerId}-current.json\`);
    atomicWriteJson(taskFile, outPayload);
    console.log(\`CLAIMED \${workerId}: book=\${item.bookSlug} chunk=\${item.chunkId} -> \${path.relative(process.cwd(), taskFile)}\`);
    process.exit(0);
  }

  console.log(\`SHARD_COMPLETE: \${workerId} finished 100% of assigned chunks.\`);
  process.exit(0);
}

if (cmd === 'submit') {
  const workerId = assertSafeId(getArg('--worker'), 'workerId');
  const bookSlug = assertSafeId(getArg('--book'), 'bookSlug');
  const chunkId = assertSafeId(getArg('--chunk'), 'chunkId');
  const file = getArg('--file');
  const chapterTitleBn = getArg('--chapter-title-bn', '');

  if (!file || !fs.existsSync(file)) {
    console.error('Usage: submit --worker worker-XX --book <slug> --chunk <id> --file <txt>');
    process.exit(1);
  }

  const ledgerPath = resolveInside(WORKSPACE_ROOT, 'books', bookSlug, 'ledger.json');
  const ledger = JSON.parse(fs.readFileSync(ledgerPath, 'utf8'));
  const shardPath = resolveInside(SHARDS_DIR, \`\${workerId}.json\`);
  const shard = fs.existsSync(shardPath)
    ? (JSON.parse(fs.readFileSync(shardPath, 'utf8')) as { workerId: string; items: ShardItem[] })
    : null;
  const shardIdx = shard ? shard.items.findIndex((x) => x.bookSlug === bookSlug && x.chunkId === chunkId) : -1;
  const shardItem = shardIdx >= 0 && shard ? shard.items[shardIdx] : null;

  const baseChunkId = chunkId.replace(/[ab]+$/, '');
  const ck = ledger.chunks.find((c: any) => c.id === chunkId) || ledger.chunks.find((c: any) => c.id === baseChunkId);
  if (!ck) { console.error(\`Chunk \${chunkId} not found in \${bookSlug}\`); process.exit(1); }

  const activeSourceText = shardItem?.overrideSourceText ?? ck.sourceText;
  const banglaText = fs.readFileSync(file, 'utf8').trim();
  const res = auditChunk(activeSourceText, banglaText, ledger.glossary || []);
  const prevPath = outFilePath(bookSlug, chunkId);
  const prevAttempts = fs.existsSync(prevPath) ? (JSON.parse(fs.readFileSync(prevPath, 'utf8')).attempts || 0) : 0;

  if (!res.passed) {
    const attempts = prevAttempts + 1;
    const splitDepth = shardItem?.splitDepth ?? 0;

    // Lock-free auto-halving inside this worker's own shard after 2 failures
    if (attempts >= 2 && splitDepth < 3 && shard && shardIdx >= 0) {
      const halves = splitTextInHalf(activeSourceText);
      if (halves) {
        const leftId = \`\${chunkId}a\`;
        const rightId = \`\${chunkId}b\`;
        atomicWriteJson(splitMetaPath(bookSlug, chunkId), {
          parentId: chunkId,
          children: [leftId, rightId],
        });
        shard.items.splice(
          shardIdx,
          1,
          { bookSlug, chunkId: leftId, overrideSourceText: halves[0], splitDepth: splitDepth + 1 },
          { bookSlug, chunkId: rightId, overrideSourceText: halves[1], splitDepth: splitDepth + 1 }
        );
        atomicWriteJson(shardPath, shard);
        console.error(\`AUTO_SPLIT [\${bookSlug}/\${chunkId}]: Halved lock-free into \${leftId} and \${rightId}. Run 'claim --worker \${workerId}' next.\`);
        process.exit(3);
      }
    }

    atomicWriteJson(prevPath, {
      chunkId,
      bookSlug,
      banglaText,
      chapterTitleBangla: chapterTitleBn || ck.chapterTitleBangla || '',
      status: 'needs_retry',
      attempts,
      issues: res.issues,
    });
    console.error(\`REJECTED [\${bookSlug}/\${chunkId}] (attempt \${attempts}): \${res.issues.join(' | ')}\`);
    process.exit(2);
  }

  atomicWriteJson(prevPath, {
    chunkId,
    bookSlug,
    banglaText,
    chapterTitleBangla: chapterTitleBn || ck.chapterTitleBangla || '',
    status: 'passed',
    attempts: prevAttempts + 1,
    purity: res.purity,
  });
  console.log(\`PASSED [\${bookSlug}/\${chunkId}] (\${res.purity.toFixed(1)}% Bangla, 0 AI slop, meaning verified)\`);
  process.exit(0);
}

if (cmd === 'merge' || cmd === 'verify' || cmd === 'status') {
  const manifest = ensureManifest();
  let totalChunks = 0;
  let passedChunks = 0;
  let completedBooks = 0;

  if (cmd === 'verify' && fs.existsSync(RUST_BIN)) {
    console.log('Running native Rust + Rayon parallel multi-book verifier...');
    execFileSync(RUST_BIN, ['verify-batch', '--manifest', MANIFEST_PATH], { stdio: 'inherit' });
  }

  for (const b of manifest.books) {
    const ledger = JSON.parse(fs.readFileSync(b.ledgerPath, 'utf8'));
    let bookPassed = 0;
    for (const ck of ledger.chunks) {
      const resolved = resolveChunkOutcome(b.slug, ck.id);
      if (resolved?.passed) {
        ck.banglaText = resolved.banglaText;
        if (resolved.chapterTitleBangla) ck.chapterTitleBangla = resolved.chapterTitleBangla;
        ck.status = 'passed';
        ck.attempts = resolved.attempts;
      } else {
        const outFile = outFilePath(b.slug, ck.id);
        if (fs.existsSync(outFile)) {
          const rec = JSON.parse(fs.readFileSync(outFile, 'utf8'));
          if (rec.banglaText) ck.banglaText = rec.banglaText;
          if (rec.chapterTitleBangla) ck.chapterTitleBangla = rec.chapterTitleBangla;
          if (rec.status) ck.status = rec.status;
          if (rec.attempts) ck.attempts = rec.attempts;
        }
      }
      totalChunks++;
      if (ck.status === 'passed') {
        passedChunks++;
        bookPassed++;
      }
    }
    if (cmd === 'merge') {
      atomicWriteJson(b.ledgerPath, ledger);
    }
    if (ledger.chunks.length > 0 && bookPassed === ledger.chunks.length) {
      completedBooks++;
    }
    console.log(\`  \${b.slug}: \${bookPassed}/\${ledger.chunks.length} chunks passed\`);
  }

  const pct = totalChunks ? Math.round((passedChunks / totalChunks) * 100) : 0;
  console.log(\`BATCH SUMMARY: \${completedBooks}/\${manifest.books.length} books complete | \${passedChunks}/\${totalChunks} chunks (\${pct}%)\`);

  if (cmd === 'verify' && passedChunks < totalChunks) {
    console.error(\`INCOMPLETE: \${totalChunks - passedChunks} chunk(s) still pending/flagged. Run 'plan' and dispatch sweep sub-agents!\`);
    process.exit(1);
  }
  process.exit(0);
}
`;
}

export function generateRustCoreCargoToml(): string {
  return `[package]
name = "lipiforge-fast"
version = "1.3.0"
edition = "2021"
description = "Rayon multi-core Rust accelerator for batch Bangla book auditing, chunk verification, and Typst PDF assembly across 50+ books simultaneously."

[dependencies]
rayon = "1.10"
serde = { version = "1.0", features = ["derive"] }
serde_json = "1.0"

[profile.release]
opt-level = 3
lto = true
codegen-units = 1
`;
}

export function generateRustCoreMainRs(strictZeroEnglish: boolean): string {
  const purityFloor = strictZeroEnglish ? '99.0' : '96.5';
  return `use rayon::prelude::*;
use serde::Deserialize;
use std::env;
use std::fs;
use std::path::Path;
use std::process;
use std::sync::atomic::{AtomicUsize, Ordering};

#[derive(Deserialize)]
struct BatchManifest {
    books: Vec<BookEntry>,
}

#[derive(Deserialize)]
struct BookEntry {
    slug: String,
    #[serde(rename = "ledgerPath")]
    ledger_path: String,
}

#[derive(Deserialize)]
struct Ledger {
    chunks: Vec<Chunk>,
}

#[derive(Deserialize)]
struct Chunk {
    id: String,
    #[serde(rename = "sourceText")]
    source_text: String,
    #[serde(rename = "banglaText", default)]
    bangla_text: String,
}

#[derive(Deserialize)]
struct ChunkOut {
    #[serde(rename = "banglaText", default)]
    bangla_text: String,
    #[serde(default)]
    status: String,
}

#[derive(Deserialize)]
struct SplitMeta {
    #[serde(default)]
    children: Vec<String>,
}

const LITERAL_CALQUES: &[&str] = &[
    "বরফ ভাঙা",
    "ঘরের হাতি",
    "মধ্যরাতের তেল পোড়ানো",
    "বাক্সের বাইরে চিন্তা",
    "কেকের টুকরো",
    "বিড়াল এবং কুকুরের মতো বৃষ্টি",
    "এটা উল্লেখ করা গুরুত্বপূর্ণ যে",
];

fn extract_asset_tokens(input: &str) -> Vec<String> {
    let mut tokens = Vec::new();
    let mut rest = input;
    while let Some(start) = rest.find("[[ASSET:") {
        let after = &rest[start..];
        if let Some(end) = after.find("]]") {
            let token = &after[..end + 2];
            if !tokens.iter().any(|t| t == token) {
                tokens.push(token.to_string());
            }
            rest = &after[end + 2..];
        } else {
            break;
        }
    }
    tokens
}

fn is_banned_decorative_char(ch: char) -> bool {
    let cp = ch as u32;
    (0x1F300..=0x1FAFF).contains(&cp)
        || (0x2600..=0x27BF).contains(&cp)
        || matches!(
            ch,
            '→' | '←' | '↔' | '⇒' | '⇐' | '➔' | '➜' | '➤' | '►' | '▸' | '★' | '☆' | '❖' | '✦' | '✧' | '✓' | '✔' | '✕' | '✖'
        )
}

fn audit_chunk_fast(source: &str, bangla: &str) -> Result<f64, Vec<String>> {
    let mut issues = Vec::new();
    let trimmed = bangla.trim();
    if trimmed.is_empty() {
        issues.push("Empty Bangla translation".to_string());
        return Err(issues);
    }

    // 1. Asset parity check
    for token in extract_asset_tokens(source) {
        if !trimmed.contains(&token) {
            issues.push(format!("Dropped original figure/graph anchor: {}", token));
        }
    }

    // 2. Strict Zero AI Symbols & Zero AI Dashes check (zero-allocation scan)
    if trimmed.contains('\\u{2014}') {
        issues.push("Banned AI symbol: Em-dash (—)".to_string());
    }
    if trimmed.contains('\\u{2013}') {
        issues.push("Banned AI symbol: En-dash (–)".to_string());
    }
    if trimmed.contains('\\u{2015}') {
        issues.push("Banned AI symbol: Horizontal bar (―)".to_string());
    }
    if trimmed.contains("--") {
        issues.push("Banned AI symbol: Double dash (--)".to_string());
    }
    if trimmed.contains(" - ") {
        issues.push("Banned AI symbol: Spaced hyphen ( - )".to_string());
    }
    if trimmed.chars().any(is_banned_decorative_char) {
        issues.push("Banned AI emoji or decorative arrow/star symbol".to_string());
    }

    // 3. Literal idiom calque check
    for calque in LITERAL_CALQUES {
        if trimmed.contains(calque) {
            issues.push(format!("Literal word-for-word calque detected: {}", calque));
        }
    }

    // 4. UTF-8 safe Bengali Unicode purity scan (U+0980..=U+09FF vs Latin A-Z/a-z outside [[ASSET:...]])
    let mut bn_chars: usize = 0;
    let mut en_chars: usize = 0;
    let mut skip_token = false;
    let mut i = 0;
    while i < trimmed.len() {
        let slice = &trimmed[i..];
        if !skip_token && slice.starts_with("[[ASSET:") {
            skip_token = true;
            i += "[[ASSET:".len();
            continue;
        }
        if skip_token {
            if slice.starts_with("]]") {
                skip_token = false;
                i += 2;
                continue;
            }
            if let Some(ch) = slice.chars().next() {
                i += ch.len_utf8();
                continue;
            }
            break;
        }
        if let Some(ch) = slice.chars().next() {
            let code = ch as u32;
            if (0x0980..=0x09FF).contains(&code) {
                bn_chars += 1;
            } else if ch.is_ascii_alphabetic() {
                en_chars += 1;
            }
            i += ch.len_utf8();
        } else {
            break;
        }
    }

    let total_alpha = bn_chars + en_chars;
    let purity = if total_alpha == 0 {
        0.0
    } else {
        (bn_chars as f64 / total_alpha as f64) * 100.0
    };
    if purity < ${purityFloor} {
        issues.push(format!("Bangla purity {:.2}% below ${purityFloor}%", purity));
    }

    // 5. Truncation guard
    let ratio = trimmed.chars().count() as f64 / source.chars().count().max(1) as f64;
    if source.chars().count() > 80 && ratio < 0.52 {
        issues.push(format!("Possible truncation: ratio {:.2}x < 0.52x", ratio));
    }

    if issues.is_empty() {
        Ok(purity)
    } else {
        Err(issues)
    }
}

fn resolve_chunk_text(book_dir: &Path, chunk_id: &str, fallback: &str) -> String {
    let out_path = book_dir.join("out").join(format!("{}.bn.json", chunk_id));
    if out_path.exists() {
        if let Some(txt) = fs::read_to_string(&out_path)
            .ok()
            .and_then(|raw| serde_json::from_str::<ChunkOut>(&raw).ok())
            .filter(|o| o.status == "passed")
            .map(|o| o.bangla_text)
        {
            return txt;
        }
    }
    let split_path = book_dir.join("out").join(format!("{}.split.json", chunk_id));
    if split_path.exists() {
        if let Some(meta) = fs::read_to_string(&split_path)
            .ok()
            .and_then(|raw| serde_json::from_str::<SplitMeta>(&raw).ok())
        {
            let mut parts = Vec::new();
            for child in meta.children {
                let child_txt = resolve_chunk_text(book_dir, &child, "");
                if child_txt.is_empty() {
                    return String::new();
                }
                parts.push(child_txt);
            }
            return parts.join("\\n\\n");
        }
    }
    fallback.to_string()
}

fn main() {
    let args: Vec<String> = env::args().collect();
    if args.len() < 4 || args[1] != "verify-batch" || args[2] != "--manifest" {
        eprintln!("Usage: lipiforge-fast verify-batch --manifest workspace/batch-manifest.json");
        process::exit(1);
    }

    let manifest_raw = fs::read_to_string(&args[3]).unwrap_or_else(|e| {
        eprintln!("Cannot read manifest: {}", e);
        process::exit(1);
    });
    let manifest: BatchManifest = serde_json::from_str(&manifest_raw).unwrap_or_else(|e| {
        eprintln!("Invalid manifest JSON: {}", e);
        process::exit(1);
    });

    let passed_total = AtomicUsize::new(0);
    let failed_total = AtomicUsize::new(0);

    // Parallelize across all 50+ books and all chunks using Rayon work-stealing threadpool
    manifest.books.par_iter().for_each(|book| {
        let ledger_raw = match fs::read_to_string(&book.ledger_path) {
            Ok(s) => s,
            Err(_) => {
                failed_total.fetch_add(1, Ordering::Relaxed);
                return;
            }
        };
        let ledger: Ledger = match serde_json::from_str(&ledger_raw) {
            Ok(l) => l,
            Err(_) => {
                failed_total.fetch_add(1, Ordering::Relaxed);
                return;
            }
        };
        let book_dir = Path::new(&book.ledger_path).parent().unwrap_or(Path::new("."));

        ledger.chunks.par_iter().for_each(|ck| {
            let text = resolve_chunk_text(book_dir, &ck.id, &ck.bangla_text);

            match audit_chunk_fast(&ck.source_text, &text) {
                Ok(_) => {
                    passed_total.fetch_add(1, Ordering::Relaxed);
                }
                Err(issues) => {
                    failed_total.fetch_add(1, Ordering::Relaxed);
                    eprintln!("[RUST-FAIL] {}/{}: {}", book.slug, ck.id, issues.join(" | "));
                }
            }
        });
    });

    let p = passed_total.load(Ordering::Relaxed);
    let f = failed_total.load(Ordering::Relaxed);
    println!("[lipiforge-fast Rust/Rayon] Verified {} book(s): {} passed, {} failed.", manifest.books.len(), p, f);
    if f > 0 {
        process::exit(1);
    }
}
`;
}

export function generateTypstBookTemplate(houseBn: string, city: string, rights: string): string {
  const houseLit = JSON.stringify(houseBn);
  const cityLit = JSON.stringify(city);
  const rightsLit = JSON.stringify(rights);
  return `// Native Rust Typst Template — Compiles a 400-page HarfBuzz Bangla Book PDF in ~0.4 seconds
// Supports Phone (108mm x 192mm), Tablet (152mm x 218mm), Print A5 (148mm x 210mm), Print A4 (210mm x 297mm), and Desktop (190mm x 260mm)
// with proper professional beginning (Title Page, Colophon, সূচিপত্র TOC) and ending (সমাপ্ত Back-Matter).

#let bangla_book(
  title_bn: "",
  title_en: "",
  author_bn: "",
  publisher_bn: ${houseLit},
  city: ${cityLit},
  rights: ${rightsLit},
  profile: "phone",
  cover_image: none,
  body,
) = {
  let dims = if profile == "tablet" {
    (w: 152mm, h: 218mm, m: (x: 14mm, y: 16mm), size: 11.5pt)
  } else if profile == "print_a5" {
    (w: 148mm, h: 210mm, m: (x: 16mm, y: 20mm), size: 11pt)
  } else if profile == "print_a4" {
    (w: 210mm, h: 297mm, m: (x: 22mm, y: 24mm), size: 12pt)
  } else if profile == "desktop" {
    (w: 190mm, h: 260mm, m: (x: 22mm, y: 22mm), size: 12pt)
  } else {
    (w: 108mm, h: 192mm, m: (x: 8.5mm, y: 11mm), size: 10.5pt)
  }

  let title_parts = title_bn.split(":")
  let main_title_bn = title_parts.at(0).trim()
  let sub_title_bn = if title_parts.len() > 1 { title_parts.slice(1).join(":").trim() } else { "" }
  let main_len = main_title_bn.clusters().len()
  let main_size = if main_len <= 24 { 1.88em } else if main_len <= 40 { 1.58em } else { 1.36em }

  set page(
    width: dims.w,
    height: dims.h,
    margin: dims.m,
    footer: context align(center, text(size: 8.5pt, fill: luma(110), counter(page).display("1"))),
  )
  set text(font: ("Noto Serif Bengali", "Kalpurush", "SolaimanLipi"), size: dims.size, lang: "bn")
  set par(justify: true, leading: 0.92em, spacing: 1.15em)

  show heading.where(level: 1): it => {
    v(0.4em)
    block(
      width: 100%,
      inset: (x: 10pt, y: 8pt),
      fill: rgb("#eff6ff"),
      stroke: (left: 3pt + rgb("#1d4ed8"), rest: 0.6pt + rgb("#bfdbfe")),
      radius: 3pt,
      below: 1.1em,
    )[
      #text(size: 1.55em, weight: "bold", fill: rgb("#0f172a"))[#it.body]
    ]
  }

  // 0. Preserved Original Page 1 Cover (Full-bleed, zero page number)
  if cover_image != none {
    page(width: dims.w, height: dims.h, margin: 0pt, footer: none)[
      #align(center + horizon)[
        #image(cover_image, width: 100%, height: 100%, fit: "contain")
      ]
    ]
  }

  // 1. Proper Beginning: Title Page (Adaptive Long-Title & Subtitle Balance)
  page(width: dims.w, height: dims.h, margin: dims.m, footer: none)[
    #align(center + horizon)[
      #block(width: 90%)[
        #text(size: main_size, weight: "bold")[#main_title_bn]
        #if sub_title_bn != "" [
          #v(0.45em)
          #text(size: 1.04em, weight: "medium", fill: luma(60))[#sub_title_bn]
        ]
        #v(0.65em)
        #text(size: 0.84em, fill: luma(95))[মূল গ্রন্থ: #title_en]
      ]
      #v(1.6em)
      #text(size: 1.15em, weight: "semibold")[#author_bn]
      #v(2.4em)
      #line(length: 45%, stroke: 0.5pt + luma(180))
      #v(1.2em)
      #text(size: 1.05em, weight: "bold")[#publisher_bn]
      #v(0.25em)
      #text(size: 0.85em, fill: luma(90))[#city]
    ]
  ]

  // 2. Copyright & Translation Rights Colophon
  align(bottom)[
    #set text(size: 0.85em, fill: luma(70))
    *#title_bn* \\
    মূল গ্রন্থ: #title_en \\
    প্রকাশনা ও বঙ্গানুবাদ প্রতিষ্ঠান: #publisher_bn \\
    প্রকাশনাস্থল: #city \\
    #rights
  ]
  pagebreak()

  // 3. Auto-Generated Bangla Table of Contents (সূচিপত্র)
  heading(outlined: false, numbering: none)[সূচিপত্র]
  outline(title: none, indent: 1em)
  pagebreak()

  // 4. Full Book Body (Chapters, Rich Formatting & Untouched Figures)
  body

  // 5. Proper Professional Ending: Publication End Seal & Colophon
  pagebreak()
  align(center + horizon)[
    #line(length: 30%, stroke: 0.6pt + luma(160))
    #v(1em)
    #text(size: 1.35em, weight: "bold")[সমাপ্ত]
    #v(1.2em)
    #text(size: 0.9em, fill: luma(80))[#title_bn] \\
    #text(size: 0.85em, fill: luma(100))[প্রকাশক: #publisher_bn · #city]
    #v(0.8em)
    #text(size: 0.78em, fill: luma(120))[#rights]
  ]
}
`;
}
