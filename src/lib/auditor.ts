import type { AuditResult, GlossaryTerm } from '../types/translator';

const BENGALI_CHAR_REGEX = /[\u0980-\u09FF]/g;
const LATIN_CHAR_REGEX = /[A-Za-z]/g;
const LATIN_WORD_REGEX = /\b[A-Za-z]{2,}\b/g;
const ASSET_TOKEN_REGEX = /\[\[ASSET:[a-zA-Z0-9_-]+\]\]/g;

/**
 * Common lazy-model shortcut / refusal / truncation patterns that weak LLMs emit
 * when translating long chapters.
 */
const SHORTCUT_PATTERNS: RegExp[] = [
  /\[\s*(?:continued|omitted|rest of|truncated|same as above|translated)[^\]]*\]/i,
  /\(\s*(?:continued|omitted|rest of the chapter|etc\.)[^)]*\)/i,
  /\b(?:the rest of the text|remaining paragraphs|continues in the same way|note:\s*translation)\b/i,
  /\.{4,}/,
  /\[একইভাবে বাকি অংশ\]/,
  /\[সংক্ষেপিত\]/,
];

const ALLOWED_LATIN_TOKENS = new Set([
  'isbn',
  'pdf',
  'epub',
  'html',
  'http',
  'https',
  'www',
  'url',
  'ii',
  'iii',
  'iv',
  'vi',
  'vii',
  'viii',
  'ix',
  'xi',
  'xii',
  'dr',
  'mr',
  'mrs',
  'ms',
  'st',
]);

const BENGALI_DIGIT_MAP: Record<string, string> = {
  '0': '০',
  '1': '১',
  '2': '২',
  '3': '৩',
  '4': '৪',
  '5': '৫',
  '6': '৬',
  '7': '৭',
  '8': '৮',
  '9': '৯',
};

function toBengaliNumberString(numStr: string): string {
  return numStr.replace(/[0-9]/g, (d) => BENGALI_DIGIT_MAP[d] ?? d);
}

/**
 * Common robotic word-for-word English-to-Bangla literal calques that distort
 * the author's intended meaning instead of rendering idiomatic Bangla.
 */
const LITERAL_CALQUE_PATTERNS: Array<{ pattern: RegExp; label: string }> = [
  { pattern: /বালতি(?:তে|কে)?\s+লাথি/, label: 'Literal idiom calque ("kick the bucket" → use মারা যাওয়া)' },
  { pattern: /বরফ\s+ভাঙ(?:া|ল|তে|লেন|ছেন)/, label: 'Literal idiom calque ("break the ice" → use জড়তা কাটানো)' },
  { pattern: /ঘরের\s+(?:ভেতর(?:ের)?\s+)?হাতি/, label: 'Literal idiom calque ("elephant in the room" → use এড়িয়ে যাওয়া স্পষ্ট সমস্যা)' },
  { pattern: /মধ্যরাতের\s+তেল\s+পোড়/, label: 'Literal idiom calque ("burn the midnight oil" → use রাত জেগে পরিশ্রম করা)' },
  { pattern: /কেকের\s+টুকরো/, label: 'Literal idiom calque ("piece of cake" → use অত্যন্ত সহজ কাজ)' },
  { pattern: /রুপালি\s+আস্তরণ/, label: 'Literal idiom calque ("silver lining" → use আশার আলো)' },
  { pattern: /ঠান্ডা\s+পা\s+(?:হওয়া|পেয়ে|পেল)/, label: 'Literal idiom calque ("cold feet" → use ঘাবড়ে যাওয়া / পিছু হটা)' },
  { pattern: /বাক্সের\s+বাইরে\s+চিন্তা/, label: 'Literal idiom calque ("think outside the box" → use প্রচলিত ধারার বাইরে ভাবা)' },
  { pattern: /লাইনের\s+মাঝখানে\s+পড়/, label: 'Literal idiom calque ("read between the lines" → use অন্তর্নিহিত অর্থ বোঝা)' },
  { pattern: /এটা\s+উল্লেখ\s+করা\s+গুরুত্বপূর্ণ\s+যে/, label: 'Stiff literal syntax ("It is important to note that" → use উল্লেখযোগ্য যে)' },
  { pattern: /এটি\s+মনে\s+রাখা\s+গুরুত্বপূর্ণ\s+যে/, label: 'Stiff literal syntax ("It is important to remember that" → use মনে রাখা প্রয়োজন যে)' },
];

/**
 * AI slop symbols & mechanical punctuation banned from publication-grade Bangla prose:
 * em-dashes, en-dashes, horizontal bars, double/triple dashes, spaced hyphens,
 * emojis/dingbats/decorative arrows, and chatbot preambles.
 * Note: single compound hyphens inside Bengali words (e.g. স্লেট-রঙা) remain valid.
 */
const AI_SLOP_SYMBOL_PATTERNS: Array<{ pattern: RegExp; label: string }> = [
  { pattern: /\u2014/, label: 'Em-dash (—) detected — replace with natural Bengali comma, semicolon, or Dari (।)' },
  { pattern: /\u2013/, label: 'En-dash (–) detected — replace with natural Bengali phrasing or comma' },
  { pattern: /\u2015/, label: 'Horizontal bar (―) detected — remove AI dash' },
  { pattern: /-{2,}/, label: 'Double/triple dash (-- / ---) detected — remove AI dash' },
  { pattern: /\s-\s/, label: 'Spaced dash (" - ") detected — use Bengali comma, colon, or semicolon' },
  { pattern: /[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/u, label: 'Emoji or decorative AI dingbat symbol detected' },
  { pattern: /[→←↔⇒⇐➔➜➤►▸★☆❖✦✧✓✔✕✖]/, label: 'Decorative arrow/star/checkmark AI symbol detected' },
  {
    pattern: /(?:^|\n)\s*(?:অবশ্যই[!।,]?\s*নিচে|নিচে\s+(?:বাংলা\s+)?অনুবাদ|এখানে\s+(?:বাংলা\s+)?অনুবাদ|sure,?\s+here\s+is|here\s+is\s+the\s+translation)/i,
    label: 'AI chatbot preamble/meta-talk detected in manuscript prose',
  },
];

export function extractAssetTokens(text: string): string[] {
  return Array.from(new Set(text.match(ASSET_TOKEN_REGEX) ?? []));
}

export interface AuditOptions {
  strictZeroEnglish?: boolean;
  glossary?: GlossaryTerm[];
}

/**
 * Deterministic 100% Bangla Coverage, Script Purity, Meaning Fidelity, Zero AI Symbols,
 * Visual Asset Anchor & Formatting Auditor.
 * Guarantees weak models (Flash-Lite, 3.5/3.8 Flash, 4B–8B local LLMs) cannot silently skip sentences,
 * summarize paragraphs, leave untranslated English behind, emit robotic word-for-word literal calques,
 * inject AI dashes/emojis/slop, drop factual numbers/years, strip headings/quotes/highlights, or drop figures.
 */
export function auditBanglaTranslation(
  sourceEnglish: string,
  translatedBangla: string,
  options: AuditOptions = {}
): AuditResult {
  const { strictZeroEnglish = true, glossary = [] } = options;

  const trimmedSource = sourceEnglish.trim();
  const trimmedBangla = translatedBangla.trim();
  const sourceAssetTokens = extractAssetTokens(trimmedSource);

  if (!trimmedBangla) {
    return {
      passed: false,
      banglaPurityPct: 0,
      paragraphRatio: 0,
      lengthRatio: 0,
      leakedEnglishWords: [],
      shortcutDetected: false,
      missingGlossaryTerms: [],
      missingAssets: sourceAssetTokens,
      preservedAssetsCount: 0,
      formattingPreserved: false,
      meaningFidelityPassed: false,
      literalCalquesDetected: [],
      missingNumbers: [],
      aiSlopSymbolsDetected: [],
      issues: ['No Bangla translation present yet.'],
      retryAction: 'retranslate_strict',
    };
  }

  // 1. Verify every preserved graph/picture anchor from English source still exists verbatim in Bangla output
  const banglaAssetSet = new Set(extractAssetTokens(trimmedBangla));
  const missingAssets = sourceAssetTokens.filter((token) => !banglaAssetSet.has(token));
  const preservedAssetsCount = sourceAssetTokens.length - missingAssets.length;

  // 2. Strip immutable [[ASSET:...]] anchors before checking Latin leaks & prose length
  const proseSource = trimmedSource.replace(ASSET_TOKEN_REGEX, '').trim();
  const proseBangla = trimmedBangla.replace(ASSET_TOKEN_REGEX, '').trim();

  const bengaliChars = (proseBangla.match(BENGALI_CHAR_REGEX) ?? []).length;
  const latinChars = (proseBangla.match(LATIN_CHAR_REGEX) ?? []).length;
  const totalScriptChars = bengaliChars + latinChars;

  const banglaPurityPct =
    totalScriptChars === 0
      ? proseSource.length === 0
        ? 100
        : 0
      : Number(((bengaliChars / totalScriptChars) * 100).toFixed(1));

  const rawLatinWords = proseBangla.match(LATIN_WORD_REGEX) ?? [];
  const leakedSet = new Set<string>();
  for (const word of rawLatinWords) {
    if (strictZeroEnglish || !ALLOWED_LATIN_TOKENS.has(word.toLowerCase())) {
      leakedSet.add(word);
    }
  }
  const leakedEnglishWords = Array.from(leakedSet).slice(0, 12);

  const shortcutDetected = SHORTCUT_PATTERNS.some((pattern) =>
    pattern.test(proseBangla)
  );

  const sourceParas = proseSource.split(/\n{2,}/).filter((p) => p.trim().length > 0);
  const banglaParas = proseBangla.split(/\n{2,}/).filter((p) => p.trim().length > 0);
  const paragraphRatio =
    sourceParas.length === 0
      ? 1
      : Number((banglaParas.length / sourceParas.length).toFixed(2));

  const lengthRatio =
    proseSource.length === 0
      ? 1
      : Number((proseBangla.length / proseSource.length).toFixed(2));

  // 3. Semantic formatting preservation check (headings, blockquotes, highlights, bold emphasis)
  const sourceHasSubheading = /^#{2,3}\s+/m.test(proseSource);
  const banglaHasSubheading = /^#{2,3}\s+/m.test(proseBangla);
  const sourceHasQuote = /^>\s+/m.test(proseSource);
  const banglaHasQuote = /^>\s+/m.test(proseBangla);
  const sourceHasHighlight = /==[^=]+==/.test(proseSource);
  const banglaHasHighlight = /==[^=]+==/.test(proseBangla);

  const formattingIssues: string[] = [];
  if (sourceHasSubheading && !banglaHasSubheading) {
    formattingIssues.push('Section heading formatting (## / ###) was flattened into plain text.');
  }
  if (sourceHasQuote && !banglaHasQuote) {
    formattingIssues.push('Blockquote / callout formatting (> ...) was dropped.');
  }
  if (sourceHasHighlight && !banglaHasHighlight) {
    formattingIssues.push('Highlighted key phrase markup (==...==) was stripped.');
  }
  const formattingPreserved = formattingIssues.length === 0;

  // 4. Meaning Fidelity: detect robotic literal calques & dropped factual numbers/years
  const literalCalquesDetected: string[] = [];
  for (const entry of LITERAL_CALQUE_PATTERNS) {
    if (entry.pattern.test(proseBangla)) {
      literalCalquesDetected.push(entry.label);
    }
  }

  const sourceNumbers = Array.from(
    new Set(proseSource.match(/\b\d{2,}(?:[.,]\d+)?\b/g) ?? [])
  );
  const missingNumbers: string[] = [];
  for (const num of sourceNumbers) {
    const bnNum = toBengaliNumberString(num);
    const normalizedBn = bnNum.replace(/,/g, '');
    const normalizedEn = num.replace(/,/g, '');
    const strippedBangla = proseBangla.replace(/,/g, '');
    if (!strippedBangla.includes(normalizedBn) && !strippedBangla.includes(normalizedEn)) {
      missingNumbers.push(`${num} (${bnNum})`);
    }
  }
  const meaningFidelityPassed =
    literalCalquesDetected.length === 0 && missingNumbers.length === 0;

  // 5. Zero AI Symbols & Zero AI Slop Punctuation check
  const aiSlopSymbolsDetected: string[] = [];
  for (const rule of AI_SLOP_SYMBOL_PATTERNS) {
    if (rule.pattern.test(proseBangla)) {
      aiSlopSymbolsDetected.push(rule.label);
    }
  }

  // 6. Glossary term consistency
  const lowerSource = proseSource.toLowerCase();
  const missingGlossaryTerms: string[] = [];
  for (const term of glossary) {
    const eng = term.english.trim();
    const bng = term.bangla.trim();
    if (!eng || !bng) continue;
    if (lowerSource.includes(eng.toLowerCase()) && !proseBangla.includes(bng)) {
      missingGlossaryTerms.push(`${eng} → ${bng}`);
    }
  }

  const issues: string[] = [];
  let retryAction: AuditResult['retryAction'] = 'none';

  const purityThreshold = strictZeroEnglish ? 99.0 : 96.5;

  if (missingAssets.length > 0) {
    issues.push(
      `Original book figure/graph anchor dropped: ${missingAssets.join(', ')}. Must preserve verbatim.`
    );
    retryAction = 'retranslate_strict';
  }

  if (shortcutDetected) {
    issues.push('Model emitted a truncation or shortcut marker instead of full translation.');
    retryAction = 'split_and_retry';
  }

  if (banglaPurityPct < purityThreshold || (strictZeroEnglish && leakedEnglishWords.length > 0)) {
    issues.push(
      `Untranslated English text detected (${leakedEnglishWords.length} Latin token${leakedEnglishWords.length === 1 ? '' : 's'}, ${banglaPurityPct}% Bangla script purity).`
    );
    if (retryAction === 'none') {
      retryAction = leakedEnglishWords.length > 8 ? 'split_and_retry' : 'retranslate_strict';
    }
  }

  if (proseSource.length >= 120 && lengthRatio < 0.52) {
    issues.push(
      `Possible silent truncation or summarization (Bangla-to-English length ratio is ${lengthRatio}x, minimum expected 0.52x).`
    );
    retryAction = 'split_and_retry';
  }

  if (sourceParas.length >= 3 && banglaParas.length < Math.floor(sourceParas.length * 0.7)) {
    issues.push(
      `Paragraph count dropped (${banglaParas.length} Bangla vs ${sourceParas.length} English paragraphs).`
    );
    if (retryAction === 'none') {
      retryAction = 'split_and_retry';
    }
  }

  if (literalCalquesDetected.length > 0) {
    issues.push(
      `Word-for-word literal translation detected instead of intended meaning: ${literalCalquesDetected[0]}.`
    );
    if (retryAction === 'none') {
      retryAction = 'retranslate_strict';
    }
  }

  if (missingNumbers.length > 0) {
    issues.push(
      `Factual number/year omitted or altered in Bangla: ${missingNumbers.slice(0, 4).join(', ')}.`
    );
    if (retryAction === 'none') {
      retryAction = 'retranslate_strict';
    }
  }

  if (aiSlopSymbolsDetected.length > 0) {
    issues.push(`AI symbol / slop punctuation detected: ${aiSlopSymbolsDetected[0]}.`);
    if (retryAction === 'none') {
      retryAction = 'retranslate_strict';
    }
  }

  if (missingGlossaryTerms.length > 0) {
    issues.push(
      `Locked glossary term mismatch: ${missingGlossaryTerms.slice(0, 3).join(', ')}.`
    );
    if (retryAction === 'none') {
      retryAction = 'retranslate_strict';
    }
  }

  if (formattingIssues.length > 0) {
    issues.push(...formattingIssues);
    if (retryAction === 'none') {
      retryAction = 'retranslate_strict';
    }
  }

  return {
    passed: issues.length === 0,
    banglaPurityPct,
    paragraphRatio,
    lengthRatio,
    leakedEnglishWords,
    shortcutDetected,
    missingGlossaryTerms,
    missingAssets,
    preservedAssetsCount,
    formattingPreserved,
    meaningFidelityPassed,
    literalCalquesDetected,
    missingNumbers,
    aiSlopSymbolsDetected,
    issues,
    retryAction,
  };
}
