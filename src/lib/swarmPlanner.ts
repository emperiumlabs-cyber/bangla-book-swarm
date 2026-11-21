import type { SwarmConcurrencyMode } from '../types/translator';

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

/**
 * Dynamically scales sub-agent count based on total chunks and book count,
 * or honors an explicit worker target (10, 20, 50) without spawning idle agents.
 */
export function computeAdaptiveWorkerCount(
  totalChunks: number,
  bookCount: number,
  mode: SwarmConcurrencyMode = 'auto'
): number {
  if (totalChunks <= 0) return 0;

  if (mode !== 'auto') {
    const requested = Number(mode);
    return Math.max(1, Math.min(requested, totalChunks));
  }

  // Adaptive scaling:
  // - Small sample/short book (<= 6 chunks): 1–4 agents
  // - Standard book (7–120 chunks): scales smoothly up to 10–12 agents
  // - Large book (121–450 chunks, e.g. 400-page PDF): scales to 15–20 agents
  // - Multi-book batch (e.g. 10–50+ PDFs): scales cleanly up to 50 parallel agents
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
 * Builds a strictly disjoint, lock-free multi-sub-agent shard plan across 1 or N books
 * (e.g., 1 book across 10/20 sub-agents OR 50 PDF books across 50 sub-agents).
 * Every chunk maps to its own atomic output file (`out/<chunkId>.bn.json`), so
 * parallel sub-agents NEVER race or overwrite each other's files.
 */
export function buildSwarmPlan(
  books: SwarmBookInput[],
  mode: SwarmConcurrencyMode = 'auto'
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
  const workerCount = computeAdaptiveWorkerCount(totalChunks, books.length, mode);

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

  // Balanced contiguous chunk slicing keeps adjacent narrative chunks on the same
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
