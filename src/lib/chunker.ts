import type { TranslationChunk } from '../types/translator';

export interface ParsedChapter {
  index: number;
  title: string;
  paragraphs: string[];
}

export function countWords(text: string): number {
  const trimmed = text.trim();
  if (!trimmed) return 0;
  return trimmed.split(/\s+/).filter(Boolean).length;
}

export function extractTrailingSentences(text: string, maxSentences = 2): string {
  const cleaned = text.replace(/\s+/g, ' ').trim();
  if (!cleaned) return '';
  const sentences = cleaned.split(/(?<=[.!?।])\s+/).filter(Boolean);
  if (sentences.length === 0) return cleaned.slice(-240);
  return sentences.slice(-maxSentences).join(' ').slice(-320);
}

const CHAPTER_HEADING_REGEX =
  /^(?:#{1,3}\s+.+|(?:CHAPTER|PART|BOOK|SECTION|PROLOGUE|EPILOGUE|INTRODUCTION|PREFACE|APPENDIX)\b[\s:.\-–—\dIVXLCDM]*.*)$/i;

/**
 * Splits raw English book text into structured chapters and clean paragraphs.
 * Handles Markdown headings, ALL-CAPS / Chapter N headings, or fallback single-chapter books.
 */
export function parseBookIntoChapters(rawText: string, fallbackTitle = 'Chapter 1'): ParsedChapter[] {
  const normalized = rawText
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n')
    .replace(/\u00a0/g, ' ')
    .trim();

  if (!normalized) {
    return [];
  }

  const rawBlocks = normalized
    .split(/\n{2,}/)
    .map((b) => b.trim())
    .filter(Boolean);

  const chapters: ParsedChapter[] = [];
  let currentChapter: ParsedChapter | null = null;

  for (const block of rawBlocks) {
    const lines = block.split('\n').map((l) => l.trim()).filter(Boolean);
    const firstLine = lines[0] ?? '';

    const isMarkdownHeading = /^#{1,3}\s+/.test(firstLine);
    const isShortChapterLine =
      firstLine.length <= 95 &&
      CHAPTER_HEADING_REGEX.test(firstLine) &&
      !/[.?!]$/.test(firstLine);

    if (isMarkdownHeading || isShortChapterLine) {
      const cleanTitle = firstLine.replace(/^#{1,3}\s+/, '').trim();
      currentChapter = {
        index: chapters.length,
        title: cleanTitle || `Chapter ${chapters.length + 1}`,
        paragraphs: [],
      };
      chapters.push(currentChapter);

      if (lines.length > 1) {
        const rest = lines.slice(1).join(' ').replace(/\s+/g, ' ').trim();
        if (rest) {
          currentChapter.paragraphs.push(rest);
        }
      }
      continue;
    }

    if (!currentChapter) {
      currentChapter = {
        index: 0,
        title: fallbackTitle,
        paragraphs: [],
      };
      chapters.push(currentChapter);
    }

    const joinedParagraph = lines.join(' ').replace(/\s+/g, ' ').trim();
    if (joinedParagraph) {
      currentChapter.paragraphs.push(joinedParagraph);
    }
  }

  return chapters.filter((ch) => ch.paragraphs.length > 0);
}

/**
 * Splits an oversized single paragraph safely on sentence boundaries
 * so even weak models with small output limits never truncate.
 */
function splitOversizedParagraph(paragraph: string, maxWords: number): string[] {
  if (countWords(paragraph) <= maxWords) {
    return [paragraph];
  }

  const sentences = paragraph.split(/(?<=[.!?])\s+/).filter(Boolean);
  if (sentences.length <= 1) {
    const words = paragraph.split(/\s+/);
    const pieces: string[] = [];
    for (let i = 0; i < words.length; i += maxWords) {
      pieces.push(words.slice(i, i + maxWords).join(' '));
    }
    return pieces;
  }

  const pieces: string[] = [];
  let buffer = '';

  for (const sentence of sentences) {
    const candidate = buffer ? `${buffer} ${sentence}` : sentence;
    if (countWords(candidate) > maxWords && buffer) {
      pieces.push(buffer);
      buffer = sentence;
    } else {
      buffer = candidate;
    }
  }

  if (buffer) {
    pieces.push(buffer);
  }
  return pieces;
}

/**
 * Creates deterministic, weak-model-safe chunks from parsed chapters.
 * Every chunk carries the trailing 2 sentences of the previous chunk for literary continuity.
 */
export function buildTranslationChunks(
  chapters: ParsedChapter[],
  maxWordsPerChunk = 3200
): TranslationChunk[] {
  const safeMax = Math.max(80, Math.min(4500, Math.floor(maxWordsPerChunk)));
  const chunks: TranslationChunk[] = [];
  let prevContextTail = '';

  for (const chapter of chapters) {
    const expandedParagraphs = chapter.paragraphs.flatMap((p) =>
      splitOversizedParagraph(p, safeMax)
    );

    let buffer: string[] = [];
    let bufferWords = 0;

    const flush = () => {
      if (buffer.length === 0) return;
      const sourceText = buffer.join('\n\n');
      const chunkIndex = chunks.length;
      chunks.push({
        id: `ch${chapter.index + 1}-ck${chunkIndex + 1}`,
        chapterIndex: chapter.index,
        chapterTitle: chapter.title,
        chapterTitleBangla: '',
        chunkIndex,
        sourceText,
        banglaText: '',
        wordCount: countWords(sourceText),
        contextTail: prevContextTail,
        status: 'pending',
        attempts: 0,
        audit: null,
        splitDepth: 0,
      });
      prevContextTail = extractTrailingSentences(sourceText, 2);
      buffer = [];
      bufferWords = 0;
    };

    for (const para of expandedParagraphs) {
      const words = countWords(para);
      if (bufferWords > 0 && bufferWords + words > safeMax) {
        flush();
      }
      buffer.push(para);
      bufferWords += words;
    }
    flush();
  }

  return chunks;
}

/**
 * Weak-model fallback: deterministically halves a chunk that failed completeness/purity
 * so smaller models translate a smaller slice with zero truncation.
 */
export function splitChunkInHalf(chunk: TranslationChunk): [TranslationChunk, TranslationChunk] | null {
  if (chunk.splitDepth >= 4 || chunk.wordCount < 40) {
    return null;
  }

  const paragraphs = chunk.sourceText.split(/\n{2,}/).filter(Boolean);
  let leftText = '';
  let rightText = '';

  if (paragraphs.length >= 2) {
    const mid = Math.ceil(paragraphs.length / 2);
    leftText = paragraphs.slice(0, mid).join('\n\n');
    rightText = paragraphs.slice(mid).join('\n\n');
  } else {
    const sentences = chunk.sourceText.split(/(?<=[.!?])\s+/).filter(Boolean);
    if (sentences.length >= 2) {
      const mid = Math.ceil(sentences.length / 2);
      leftText = sentences.slice(0, mid).join(' ');
      rightText = sentences.slice(mid).join(' ');
    } else {
      const words = chunk.sourceText.split(/\s+/);
      const mid = Math.ceil(words.length / 2);
      leftText = words.slice(0, mid).join(' ');
      rightText = words.slice(mid).join(' ');
    }
  }

  if (!leftText.trim() || !rightText.trim()) {
    return null;
  }

  const first: TranslationChunk = {
    ...chunk,
    id: `${chunk.id}a`,
    sourceText: leftText,
    banglaText: '',
    wordCount: countWords(leftText),
    status: 'pending',
    attempts: 0,
    audit: null,
    errorMessage: undefined,
    splitDepth: chunk.splitDepth + 1,
  };

  const second: TranslationChunk = {
    ...chunk,
    id: `${chunk.id}b`,
    sourceText: rightText,
    banglaText: '',
    wordCount: countWords(rightText),
    contextTail: extractTrailingSentences(leftText, 2),
    status: 'pending',
    attempts: 0,
    audit: null,
    errorMessage: undefined,
    splitDepth: chunk.splitDepth + 1,
  };

  return [first, second];
}

export function reindexChunks(chunks: TranslationChunk[]): TranslationChunk[] {
  return chunks.map((chunk, idx) => ({
    ...chunk,
    chunkIndex: idx,
  }));
}
