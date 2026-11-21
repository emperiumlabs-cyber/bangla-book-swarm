import type { GlossaryTerm, SwarmConcurrencyMode } from '../types/translator';

export interface SwarmBookInput {
  slug: string;
  title: string;
  chunkIds: string[];
}

export interface SwarmAssignment {
  bookSlug: string;
  chunkId: string;
  outputFile: string;
}

export interface SwarmWorkerShard {
  workerId: string;
  workerIndex: number;
  assignments: SwarmAssignment[];
  bookSlugs: string[];
}

export interface SwarmPlan {
  mode: SwarmConcurrencyMode;
  workerCount: number;
  totalBooks: number;
  totalChunks: number;
  shards: SwarmWorkerShard[];
  maxChunksPerWorker: number;
  minChunksPerWorker: number;
}

export interface BatchCompletenessReport {
  complete: boolean;
  totalBooks: number;
  completedBooks: number;
  totalChunks: number;
  passedChunks: number;
  remainingItems: Array<{ bookSlug: string; chunkId: string }>;
}

export interface SwarmSpeedEstimate {
  totalWords: number;
  legacyChunks: number;
  legacyToolCalls: number;
  legacyWorkers: number;
  activeChunks: number;
  activeWorkers: number;
  hyperToolCalls: number;
  toolCallReductionX: number;
  estimatedSpeedupX: number;
  estimatedLegacyMinutes: number;
  estimatedHyperMinutes: number;
}

export interface WorkerPacketBlock {
  bookSlug: string;
  bookTitle: string;
  chunkId: string;
  chapterTitle: string;
  contextTail: string;
  sourceText: string;
}

export interface ParsedWorkerOutputBlock {
  bookSlug: string;
  chunkId: string;
  chapterTitleBangla: string;
  polishVerified: boolean;
  banglaText: string;
}

/**
 * Dynamically scales sub-agent count based on total blocks, book count, and block size.
 * - In Hyper-Swarm v2 Full-Chapter / Macro-Block mode (>= 1,200w), fans out 1-to-1
 *   across up to 20 parallel sub-agents on a single book (1-2 chapters per worker),
 *   and up to 50 parallel sub-agents across multi-book batches.
 * - In Legacy micro-chunk mode (< 1,200w), scales smoothly from 4 to 50 agents.
 */
export function computeAdaptiveWorkerCount(
  totalChunks: number,
  bookCount: number,
  mode: SwarmConcurrencyMode = 'auto',
  maxWordsPerChunk = 3200
): number {
  if (totalChunks <= 0) return 0;

  if (mode !== 'auto') {
    const requested = Number(mode);
    return Math.max(1, Math.min(requested, totalChunks));
  }

  // Hyper-Swarm v2 Full-Chapter 1-to-1 parallel fan-out
  if (maxWordsPerChunk >= 1200) {
    if (bookCount <= 1) {
      if (totalChunks <= 20) return totalChunks;
      return Math.min(30, Math.max(20, Math.ceil(totalChunks / 2)));
    }
    const batchTarget = Math.max(bookCount, Math.min(totalChunks, Math.ceil(totalChunks / 2)));
    return Math.min(50, Math.max(1, Math.min(totalChunks, batchTarget)));
  }

  // Legacy micro-chunk adaptive scaling (< 1,200w)
  if (totalChunks <= 6) {
    return Math.min(totalChunks, Math.max(1, Math.ceil(totalChunks / 2)));
  }
  if (totalChunks <= 120) {
    return Math.min(12, Math.max(4, Math.ceil(totalChunks / 8)));
  }
  if (totalChunks <= 450) {
    return Math.min(20, Math.max(10, Math.ceil(totalChunks / 18)));
  }
  const scaledForBatch = Math.max(20, bookCount, Math.ceil(totalChunks / 25));
  return Math.min(50, Math.min(totalChunks, scaledForBatch));
}

/**
 * Computes deterministic Before vs. After speedup telemetry comparing the legacy
 * 320-word per-chunk tool loop (4 tool calls/chunk + npx cold-starts) against
 * LipiForge Hyper-Swarm v2 (Full-Chapter macro-blocks + Zero-Loop 3-call batch shards).
 */
export function computeSwarmSpeedEstimate(params: {
  totalWords: number;
  activeChunks?: number;
  bookCount?: number;
  mode?: SwarmConcurrencyMode;
  maxWordsPerChunk: number;
  twoPassPolish: boolean;
}): SwarmSpeedEstimate {
  const words = Math.max(320, Math.round(params.totalWords));
  const bookCount = Math.max(1, params.bookCount ?? 1);
  const mode = params.mode ?? 'auto';
  const maxWords = Math.max(80, params.maxWordsPerChunk);

  // Active Hyper-Swarm v2 plan: 1 read packet + 1 write bundle + 1 submit-batch per worker
  const activeChunks =
    params.activeChunks && params.activeChunks > 0
      ? params.activeChunks
      : Math.max(1, Math.ceil(words / maxWords));
  const activeWorkers = computeAdaptiveWorkerCount(activeChunks, bookCount, mode, maxWords);
  const hyperToolCalls = activeWorkers * 3;
  const hyperChunksPerWorker = Math.ceil(activeChunks / Math.max(1, activeWorkers));
  const wordsPerWorker = Math.ceil(words / Math.max(1, activeWorkers));

  // Legacy baseline: 320w micro-chunks × 4 tool turns/chunk + repeated npx tsx cold starts
  const legacyChunks = Math.max(activeChunks, Math.ceil(words / 320));
  const legacyWorkers = computeAdaptiveWorkerCount(legacyChunks, bookCount, 'auto', 320);
  const legacyToolCalls = legacyChunks * 4;
  // Legacy single-book queue/throttled loop averaged ~38s/chunk across <=4 effective slots
  const legacyEffectiveSlots =
    bookCount <= 1 ? Math.min(4, Math.max(1, legacyWorkers)) : Math.min(10, Math.max(1, legacyWorkers));
  const legacyChunksPerSlot = Math.ceil(legacyChunks / legacyEffectiveSlots);
  const legacySeconds = legacyChunksPerSlot * 38;

  // Hyper-Swarm v2: 3 tool calls (~4s each) + streaming generation (~45 words/sec, 1.35x for Strict 2-Pass Polish)
  const genFactor = params.twoPassPolish ? 1.35 : 1.0;
  const hyperSeconds = Math.max(
    18,
    3 * 4 + (wordsPerWorker / 45) * genFactor + hyperChunksPerWorker * 3
  );

  const toolCallReductionX = Math.max(
    1,
    Number((legacyToolCalls / Math.max(1, hyperToolCalls)).toFixed(1))
  );
  const estimatedSpeedupX = Math.max(
    1,
    Number((legacySeconds / Math.max(1, hyperSeconds)).toFixed(1))
  );

  return {
    totalWords: words,
    legacyChunks,
    legacyToolCalls,
    legacyWorkers,
    activeChunks,
    activeWorkers,
    hyperToolCalls,
    toolCallReductionX,
    estimatedSpeedupX,
    estimatedLegacyMinutes: Math.max(1, Math.round(legacySeconds / 60)),
    estimatedHyperMinutes: Math.max(0.3, Number((hyperSeconds / 60).toFixed(1))),
  };
}

/**
 * Builds a strictly disjoint, lock-free multi-sub-agent shard plan across 1 or N books
 * (e.g., 1 book across 10/20 sub-agents OR 50 PDF books across 50 sub-agents).
 * Every chunk maps to its own atomic output file (`out/<chunkId>.bn.json`), so
 * parallel sub-agents NEVER race or overwrite each other's files.
 */
export function buildSwarmPlan(
  books: SwarmBookInput[],
  mode: SwarmConcurrencyMode = 'auto',
  maxWordsPerChunk = 3200
): SwarmPlan {
  const flatItems: SwarmAssignment[] = [];
  for (const book of books) {
    for (const chunkId of book.chunkIds) {
      flatItems.push({
        bookSlug: book.slug,
        chunkId,
        outputFile: `workspace/books/${book.slug}/out/${chunkId}.bn.json`,
      });
    }
  }

  const totalChunks = flatItems.length;
  const workerCount = computeAdaptiveWorkerCount(totalChunks, books.length, mode, maxWordsPerChunk);

  if (workerCount === 0) {
    return {
      mode,
      workerCount: 0,
      totalBooks: books.length,
      totalChunks: 0,
      shards: [],
      maxChunksPerWorker: 0,
      minChunksPerWorker: 0,
    };
  }

  const shards: SwarmWorkerShard[] = Array.from({ length: workerCount }, (_, idx) => ({
    workerId: `worker-${String(idx + 1).padStart(2, '0')}`,
    workerIndex: idx + 1,
    assignments: [],
    bookSlugs: [],
  }));

  // Balanced contiguous chunk slicing keeps adjacent narrative chapters on the same
  // worker when possible, minimizing context switches while keeping worker load equal.
  const baseSize = Math.floor(totalChunks / workerCount);
  const remainder = totalChunks % workerCount;
  let cursor = 0;

  for (let w = 0; w < workerCount; w++) {
    const count = baseSize + (w < remainder ? 1 : 0);
    const slice = flatItems.slice(cursor, cursor + count);
    cursor += count;
    shards[w].assignments = slice;
    shards[w].bookSlugs = Array.from(new Set(slice.map((item) => item.bookSlug)));
  }

  const sizes = shards.map((s) => s.assignments.length);
  return {
    mode,
    workerCount,
    totalBooks: books.length,
    totalChunks,
    shards,
    maxChunksPerWorker: Math.max(...sizes),
    minChunksPerWorker: Math.min(...sizes),
  };
}

/**
 * Generates ONE self-contained Zero-Loop worker input packet (`worker-XX-input.md`)
 * so each parallel sub-agent reads once, translates + polishes all assigned full-chapter
 * blocks into `worker-XX-output.md`, and runs ONE `submit-batch` command (3 total tool calls!).
 */
export function formatWorkerInputPacket(params: {
  workerId: string;
  publisherBangla: string;
  registerLabel: string;
  strictZeroEnglish: boolean;
  twoPassPolish: boolean;
  glossary: Array<Pick<GlossaryTerm, 'english' | 'bangla'>>;
  blocks: WorkerPacketBlock[];
  retryIssuesByKey?: Record<string, string[]>;
}): string {
  const combinedLower = params.blocks.map((b) => b.sourceText).join('\n').toLowerCase();
  const scopedGlossary = params.glossary.filter(
    (g) => g.english && g.bangla && combinedLower.includes(g.english.toLowerCase())
  );

  const lines: string[] = [
    `# LipiForge Hyper-Swarm v2 Worker Packet — ${params.workerId}`,
    ``,
    `- **Publishing House**: ${params.publisherBangla}`,
    `- **Editorial Register**: ${params.registerLabel}`,
    `- **Assigned Blocks**: ${params.blocks.length}`,
    `- **Quality Gate**: ${params.twoPassPolish ? 'STRICT 2-PASS LITERARY POLISH ON EVERY BLOCK' : 'Single-Pass Meaning-First + Deterministic Audit'}`,
    `- **Output File**: \`workspace/shards/${params.workerId}-output.md\``,
    `- **Submit Command**: \`node scripts/fast-run.mjs scripts/swarm-orchestrator.ts submit-batch --worker ${params.workerId} --file workspace/shards/${params.workerId}-output.md\``,
    ``,
    `## Mandatory Rules (Read Once, Write All Blocks Once)`,
    `1. **Pass 1 (Meaning-First Natural Bangla Draft)**: Translate 100% of authorial intent into idiomatic Bangla — NEVER word-for-word literal idiom calques. Keep exact facts, negations, tone, and numbers (Bengali digits ০-৯).`,
    ...(params.twoPassPolish
      ? [
          `2. **Pass 2 (Strict Editorial Polish & Purity Audit)**: Before writing each block, review the entire chapter draft line by line to refine literary cadence, lock every glossary term, verify 0 English leaks, 0 AI dashes/slop, and stamp \`POLISH_VERIFIED: YES\`.`,
        ]
      : []),
    `3. **Strict Zero AI Symbols**: NEVER use em-dashes (\`—\`), en-dashes (\`–\`), horizontal bars (\`―\`), double dashes (\`--\`), spaced dashes (\`" - "\`), emojis, arrows, or chatbot intros. Use natural Bengali commas (\`,\`), semicolons (\`;\`), colons (\`:\`), and Dari (\`।\`).`,
    `4. **100% Bangla & Untouched Assets**: ${params.strictZeroEnglish ? 'Zero untranslated English prose; transliterate all proper names.' : 'Write fluent Bangla.'} Keep every \`[[ASSET:...]]\` token verbatim and keep all \`##/###\`, \`**bold**\`, \`*italic*\`, \`==highlight==\`, \`> quote\`, \`- list\`, and \`~small~\` markers.`,
    `5. **Exact Output Format**: Write every block in \`workspace/shards/${params.workerId}-output.md\` using:`,
    ``,
    '```text',
    '<<<BLOCK:bookSlug:chunkId>>>',
    'CHAPTER_TITLE_BN: <Translated Bangla chapter heading>',
    ...(params.twoPassPolish ? ['POLISH_VERIFIED: YES'] : []),
    '---BANGLA---',
    '<Final publication-grade Bangla text here>',
    '<<<END_BLOCK>>>',
    '```',
  ];

  if (scopedGlossary.length > 0) {
    lines.push(``, `## Locked Glossary For This Shard`);
    for (const g of scopedGlossary) {
      lines.push(`- "${g.english}" -> "${g.bangla}"`);
    }
  }

  lines.push(``, `---`, ``, `## Assigned Chapter Blocks`);

  for (const b of params.blocks) {
    const key = `${b.bookSlug}:${b.chunkId}`;
    const issues = params.retryIssuesByKey?.[key];
    lines.push(`<<<BLOCK:${b.bookSlug}:${b.chunkId}>>>`);
    lines.push(`BOOK_TITLE: ${b.bookTitle}`);
    lines.push(`CHAPTER_TITLE_EN: ${b.chapterTitle}`);
    if (b.contextTail) {
      lines.push(`CONTEXT_TAIL_READ_ONLY: ${b.contextTail}`);
    }
    if (issues && issues.length > 0) {
      lines.push(`FIX_THESE_DEFECTS: ${issues.join(' | ')}`);
    }
    lines.push(`---SOURCE---`);
    lines.push(b.sourceText);
    lines.push(`<<<END_BLOCK>>>`, ``);
  }

  return lines.join('\n');
}

/**
 * Parses a worker's single multi-block output file (`worker-XX-output.md`)
 * into structured chapter translations in milliseconds.
 */
export function parseWorkerOutputPacket(raw: string): ParsedWorkerOutputBlock[] {
  const normalized = raw.replace(/\r\n/g, '\n');
  const results: ParsedWorkerOutputBlock[] = [];
  const blockRegex =
    /<<<BLOCK:([a-zA-Z0-9_-]+):([a-zA-Z0-9_-]+)>>>\s*\n([\s\S]*?)<<<END_BLOCK>>>/g;

  let match: RegExpExecArray | null;
  while ((match = blockRegex.exec(normalized)) !== null) {
    const bookSlug = match[1].trim();
    const chunkId = match[2].trim();
    const inner = match[3];

    let headerPart = '';
    let bodyPart = inner;
    const sepIdx = inner.indexOf('---BANGLA---');
    if (sepIdx >= 0) {
      headerPart = inner.slice(0, sepIdx);
      bodyPart = inner.slice(sepIdx + '---BANGLA---'.length);
    }

    const titleMatch = headerPart.match(/^CHAPTER_TITLE_BN:\s*(.+)$/m);
    const chapterTitleBangla = titleMatch ? titleMatch[1].trim() : '';

    const polishVerified =
      /^POLISH_VERIFIED:\s*(?:YES|TRUE|PASS(?:ED)?|2-PASS)/im.test(headerPart) ||
      new RegExp(`<<<POLISH_VERIFIED:${chunkId}>>>`, 'i').test(inner);

    const banglaText = bodyPart
      .replace(/<<<POLISH_VERIFIED:[a-zA-Z0-9_-]+>>>/gi, '')
      .trim();

    results.push({
      bookSlug,
      chunkId,
      chapterTitleBangla,
      polishVerified,
      banglaText,
    });
  }

  return results;
}

/**
 * Deterministic 100% completeness barrier across 1 or 50+ books.
 * Final book compilation only runs once `complete === true` (0 remaining items).
 */
export function evaluateBatchCompleteness(
  books: Array<{
    slug: string;
    chunks: Array<{ id: string; status: string }>;
  }>
): BatchCompletenessReport {
  let totalChunks = 0;
  let passedChunks = 0;
  let completedBooks = 0;
  const remainingItems: Array<{ bookSlug: string; chunkId: string }> = [];

  for (const book of books) {
    let bookPassed = 0;
    for (const chunk of book.chunks) {
      totalChunks++;
      if (chunk.status === 'passed') {
        passedChunks++;
        bookPassed++;
      } else {
        remainingItems.push({ bookSlug: book.slug, chunkId: chunk.id });
      }
    }
    if (book.chunks.length > 0 && bookPassed === book.chunks.length) {
      completedBooks++;
    }
  }

  return {
    complete: totalChunks > 0 && remainingItems.length === 0,
    totalBooks: books.length,
    completedBooks,
    totalChunks,
    passedChunks,
    remainingItems,
  };
}
