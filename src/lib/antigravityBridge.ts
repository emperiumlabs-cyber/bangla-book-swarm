import type { BookProject, GlossaryTerm, TranslationChunk } from '../types/translator';
import { auditBanglaTranslation } from './auditor';
import { countWords } from './chunker';
import { getRegisterMeta } from './skillGenerator';

export interface AntigravityLedgerPayload {
  sourceFile: string;
  title: string;
  titleBangla: string;
  author: string;
  authorBangla: string;
  publisher: string;
  publisherEnglish: string;
  rights: string;
  city: string;
  register: BookProject['publisher']['register'];
  defaultLayout: BookProject['publisher']['defaultLayout'];
  maxWordsPerChunk: number;
  strictZeroEnglish: boolean;
  glossary: Array<{ english: string; bangla: string; category: string }>;
  assets: Array<{
    id: string;
    token: string;
    kind: string;
    fileName: string;
    captionEnglish: string;
    captionBangla: string;
  }>;
  chunks: Array<{
    id: string;
    chapterIndex: number;
    chapterTitle: string;
    chapterTitleBangla: string;
    sourceText: string;
    banglaText: string;
    contextTail: string;
    status: string;
    attempts: number;
    splitDepth: number;
  }>;
}

/**
 * Serializes a LipiForge project into the exact workspace/ledger.json format
 * consumed by Antigravity's scripts/chunk-queue.ts, scripts/audit-bangla.ts,
 * scripts/assemble-book.ts, and scripts/build-pdf.ts (Zero API Key required).
 */
export function buildAntigravityLedgerJson(project: BookProject): AntigravityLedgerPayload {
  const houseBn =
    project.publisher.publishingHouseBangla.trim() ||
    project.publisher.publishingHouse.trim() ||
    'প্রথমা প্রকাশন';

  return {
    sourceFile: project.fileName,
    title: project.title,
    titleBangla: project.titleBangla,
    author: project.author,
    authorBangla: project.authorBangla,
    publisher: houseBn,
    publisherEnglish: project.publisher.publishingHouse,
    rights: project.publisher.rightsStatement,
    city: project.publisher.imprintCity,
    register: project.publisher.register,
    defaultLayout: project.publisher.defaultLayout ?? 'phone',
    maxWordsPerChunk: project.publisher.maxWordsPerChunk,
    strictZeroEnglish: project.publisher.strictZeroEnglish,
    glossary: project.glossary.map((g) => ({
      english: g.english,
      bangla: g.bangla,
      category: g.category,
    })),
    assets: project.assets.map((a) => ({
      id: a.id,
      token: a.token,
      kind: a.kind,
      fileName: a.fileName,
      captionEnglish: a.captionEnglish,
      captionBangla: a.captionBangla,
    })),
    chunks: project.chunks.map((c) => ({
      id: c.id,
      chapterIndex: c.chapterIndex,
      chapterTitle: c.chapterTitle,
      chapterTitleBangla: c.chapterTitleBangla,
      sourceText: c.sourceText,
      banglaText: c.banglaText,
      contextTail: c.contextTail,
      status: c.status,
      attempts: c.attempts,
      splitDepth: c.splitDepth,
    })),
  };
}

/**
 * Imports either a full LipiForge checkpoint JSON OR a completed Antigravity
 * workspace/ledger.json back into LipiForge for visual proofing & PDF/EPUB export.
 */
export function parseImportedProjectOrLedger(
  raw: unknown,
  currentProject: BookProject
): BookProject {
  if (!raw || typeof raw !== 'object') {
    throw new Error('Invalid JSON file. Expected a LipiForge checkpoint or Antigravity workspace/ledger.json.');
  }

  const obj = raw as Record<string, unknown>;
  if (!Array.isArray(obj.chunks) || obj.chunks.length === 0) {
    throw new Error('JSON file does not contain any book chunks.');
  }

  // Case 1: Native LipiForge BookProject checkpoint
  if (obj.publisher && typeof obj.publisher === 'object') {
    const proj = obj as unknown as BookProject;
    const mergedPublisher = {
      ...currentProject.publisher,
      ...proj.publisher,
    };
    const glossary = Array.isArray(proj.glossary) ? proj.glossary : currentProject.glossary;
    const reauditedChunks: TranslationChunk[] = proj.chunks.map((ck, idx) => {
      const banglaText = typeof ck.banglaText === 'string' ? ck.banglaText : '';
      const audit = banglaText.trim()
        ? auditBanglaTranslation(ck.sourceText, banglaText, {
            strictZeroEnglish: mergedPublisher.strictZeroEnglish,
            glossary,
          })
        : null;
      return {
        ...ck,
        chunkIndex: idx,
        banglaText,
        audit,
        status: banglaText.trim() ? (audit?.passed ? 'passed' : 'needs_retry') : 'pending',
      };
    });

    return {
      ...proj,
      assets: Array.isArray(proj.assets) ? proj.assets : currentProject.assets,
      publisher: mergedPublisher,
      glossary,
      chunks: reauditedChunks,
      updatedAt: new Date().toISOString(),
    };
  }

  // Case 2: Antigravity CLI workspace/ledger.json
  const ledgerPublisherBn =
    typeof obj.publisher === 'string' && obj.publisher.trim()
      ? obj.publisher.trim()
      : currentProject.publisher.publishingHouseBangla;
  const ledgerPublisherEn =
    typeof obj.publisherEnglish === 'string' && obj.publisherEnglish.trim()
      ? obj.publisherEnglish.trim()
      : currentProject.publisher.publishingHouse;

  const mergedPublisher = {
    ...currentProject.publisher,
    publishingHouse: ledgerPublisherEn,
    publishingHouseBangla: ledgerPublisherBn,
    rightsStatement:
      typeof obj.rights === 'string' && obj.rights.trim()
        ? obj.rights.trim()
        : currentProject.publisher.rightsStatement,
    imprintCity:
      typeof obj.city === 'string' && obj.city.trim()
        ? obj.city.trim()
        : currentProject.publisher.imprintCity,
    maxWordsPerChunk:
      typeof obj.maxWordsPerChunk === 'number' && obj.maxWordsPerChunk > 50
        ? obj.maxWordsPerChunk
        : currentProject.publisher.maxWordsPerChunk,
  };

  const importedGlossary: GlossaryTerm[] = Array.isArray(obj.glossary) && obj.glossary.length > 0
    ? (obj.glossary as Array<Record<string, unknown>>)
        .filter((g) => typeof g.english === 'string' && typeof g.bangla === 'string')
        .map((g, i) => ({
          id: `ledger-g-${i}`,
          english: String(g.english),
          bangla: String(g.bangla),
          category:
            g.category === 'person' || g.category === 'place' || g.category === 'title'
              ? g.category
              : 'term',
        }))
    : currentProject.glossary;

  const rawChunks = obj.chunks as Array<Record<string, unknown>>;
  const importedChunks: TranslationChunk[] = rawChunks.map((ck, idx) => {
    const sourceText = String(ck.sourceText ?? '');
    const banglaText = String(ck.banglaText ?? '');
    const audit = banglaText.trim()
      ? auditBanglaTranslation(sourceText, banglaText, {
          strictZeroEnglish: mergedPublisher.strictZeroEnglish,
          glossary: importedGlossary,
        })
      : null;

    return {
      id: String(ck.id ?? `ch1-ck${idx + 1}`),
      chapterIndex: typeof ck.chapterIndex === 'number' ? ck.chapterIndex : 0,
      chapterTitle: String(ck.chapterTitle ?? 'Chapter 1'),
      chapterTitleBangla: String(ck.chapterTitleBangla ?? ''),
      chunkIndex: idx,
      sourceText,
      banglaText,
      wordCount: countWords(sourceText),
      contextTail: String(ck.contextTail ?? ''),
      status: banglaText.trim() ? (audit?.passed ? 'passed' : 'needs_retry') : 'pending',
      attempts: typeof ck.attempts === 'number' ? ck.attempts : banglaText.trim() ? 1 : 0,
      audit,
      splitDepth: typeof ck.splitDepth === 'number' ? ck.splitDepth : 0,
    };
  });

  const totalWords = importedChunks.reduce((acc, c) => acc + c.wordCount, 0);

  return {
    ...currentProject,
    id: `antigravity-import-${Date.now()}`,
    title: typeof obj.title === 'string' && obj.title.trim() ? obj.title.trim() : currentProject.title,
    titleBangla:
      typeof obj.titleBangla === 'string' ? obj.titleBangla.trim() : currentProject.titleBangla,
    author: typeof obj.author === 'string' && obj.author.trim() ? obj.author.trim() : currentProject.author,
    authorBangla:
      typeof obj.authorBangla === 'string' ? obj.authorBangla.trim() : currentProject.authorBangla,
    fileName:
      typeof obj.sourceFile === 'string' && obj.sourceFile.trim()
        ? obj.sourceFile.trim()
        : currentProject.fileName,
    totalWords,
    updatedAt: new Date().toISOString(),
    publisher: mergedPublisher,
    glossary: importedGlossary,
    chunks: importedChunks,
  };
}

/**
 * Generates a self-contained, Zero-API-Key Antigravity prompt for a single micro-chunk
 * with full meaning-fidelity, anti-calque, zero-AI-symbol, and [[ASSET:...]] rules.
 */
export function buildSingleChunkAntigravityPrompt(
  chunk: TranslationChunk,
  project: BookProject
): string {
  const houseBn =
    project.publisher.publishingHouseBangla.trim() || project.publisher.publishingHouse.trim();
  const registerMeta = getRegisterMeta(project.publisher.register);
  const lowerSrc = chunk.sourceText.toLowerCase();
  const scopedGlossary = project.glossary.filter((g) =>
    lowerSrc.includes(g.english.toLowerCase())
  );

  const lines = [
    `You are the chief Bangla literary translator for ${houseBn} (${registerMeta.label}).`,
    `Translate 100% of the English passage below into publication-grade Bangla (Zero API Key — direct Antigravity translation):`,
    ``,
    `MANDATORY RULES:`,
    `1. SENSE-FOR-SENSE MEANING FIDELITY (মর্মনিষ্ঠ ভাবানুবাদ): Translate what the author ACTUALLY meant — never word-for-word literal idiom calques. Keep exact facts, nuances, negations, tone, and numbers (convert digits to Bengali ০-৯).`,
    `2. STRICT ZERO AI SYMBOLS & ZERO AI SLOP: NEVER use em-dashes (—), en-dashes (–), horizontal bars (―), double dashes (--), spaced dashes (" - "), emojis, decorative arrows, or chatbot intros. Use natural Bengali commas (,), semicolons (;), colons (:), or Dari (।).`,
    `3. ZERO UNTRANSLATED ENGLISH: Transliterate all proper names into Bangla script.`,
    `4. PRESERVE EVERY [[ASSET:...]] TOKEN VERBATIM in its exact paragraph position.`,
    `5. PRESERVE ALL FORMATTING MARKERS: ## / ### headings, **bold**, *italic*, ==highlight==, > blockquote, - list, and ~small notes~.`,
    `6. Output ONLY the final Bangla text — no explanation or wrapper.`,
  ];

  if (scopedGlossary.length > 0) {
    lines.push(
      ``,
      `LOCKED GLOSSARY FOR THIS CHUNK:`,
      ...scopedGlossary.map((g) => `- "${g.english}" -> "${g.bangla}"`)
    );
  }

  if (chunk.contextTail) {
    lines.push(
      ``,
      `PREVIOUS CONTEXT (READ-ONLY, DO NOT TRANSLATE):`,
      chunk.contextTail
    );
  }

  lines.push(
    ``,
    `ENGLISH SOURCE (${chunk.id} · ${chunk.chapterTitle}):`,
    `"""`,
    chunk.sourceText,
    `"""`
  );

  return lines.join('\n');
}

const STOP_ENTITIES = new Set([
  'Chapter',
  'Part',
  'Prologue',
  'Epilogue',
  'Introduction',
  'Section',
  'Figure',
  'Table',
  'Every',
  'Inside',
  'Neither',
  'When',
  'Before',
  'After',
  'While',
  'Through',
  'Because',
  'However',
  'Therefore',
  'Although',
  'Original',
  'Archival',
  'Note',
  'Winter',
  'Summer',
  'Spring',
  'Autumn',
  'Monday',
  'Tuesday',
  'Wednesday',
  'Thursday',
  'Friday',
  'Saturday',
  'Sunday',
  'January',
  'February',
  'March',
  'April',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
]);

/**
 * Pure deterministic offline proper-noun scanner (Zero API Key required).
 * Scans the book manuscript for recurring capitalized names, places, and titles
 * not yet locked in the project's glossary.
 */
export function extractGlossaryCandidatesOffline(project: BookProject): GlossaryTerm[] {
  const fullText = project.chunks
    .map((c) => c.sourceText.replace(/\[\[ASSET:[a-zA-Z0-9_-]+\]\]/g, ' '))
    .join('\n\n');

  const existingLower = new Set(project.glossary.map((g) => g.english.trim().toLowerCase()));
  const counts = new Map<string, number>();

  // 1. Multi-word Title Case entities (e.g. "Clockwork Harbor", "Alden Vance", "Harbor Press Ledger")
  const multiWordRegex = /\b([A-Z][a-z]+(?:\s+(?:of|the|and|in|at)?\s*[A-Z][a-z]+){1,3})\b/g;
  let match: RegExpExecArray | null;
  while ((match = multiWordRegex.exec(fullText)) !== null) {
    const phrase = match[1].replace(/\s+/g, ' ').trim();
    const firstWord = phrase.split(' ')[0];
    if (STOP_ENTITIES.has(firstWord)) continue;
    if (existingLower.has(phrase.toLowerCase())) continue;
    counts.set(phrase, (counts.get(phrase) ?? 0) + 1);
  }

  // 2. Recurring mid-sentence capitalized single proper nouns
  const singleWordRegex = /(?<=[a-z,]\s)([A-Z][a-z]{3,})\b/g;
  while ((match = singleWordRegex.exec(fullText)) !== null) {
    const word = match[1].trim();
    if (STOP_ENTITIES.has(word)) continue;
    if (existingLower.has(word.toLowerCase())) continue;
    // Skip if already part of a detected multi-word entity
    const coveredByMulti = Array.from(counts.keys()).some((k) => k.includes(word));
    if (coveredByMulti) continue;
    counts.set(word, (counts.get(word) ?? 0) + 1);
  }

  return Array.from(counts.entries())
    .sort((a, b) => b[1] - a[1] || b[0].length - a[0].length)
    .slice(0, 12)
    .map(([phrase, freq], idx) => ({
      id: `offline-${Date.now()}-${idx}`,
      english: phrase,
      bangla: '',
      category: phrase.includes(' ') ? 'term' : 'person',
      notes: `Detected ${freq}× offline — enter locked Bangla spelling before running Antigravity`,
    }));
}
