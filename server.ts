import 'dotenv/config';
import express from 'express';
import type { Request, Response, NextFunction } from 'express';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath, pathToFileURL } from 'node:url';
import multer from 'multer';
import JSZip from 'jszip';
import mammoth from 'mammoth';
import { extractText } from 'unpdf';
import { GoogleGenAI, Type } from '@google/genai';

const execFileAsync = promisify(execFile);

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const PORT = Number(process.env.PORT || 3000);
const IS_PROD = process.env.NODE_ENV === 'production';

// Server-side Gemini client using official @google/genai SDK with required telemetry header
function getGeminiClient(): GoogleGenAI {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey || apiKey === 'MY_GEMINI_API_KEY') {
    throw new Error('GEMINI_API_KEY_MISSING');
  }
  return new GoogleGenAI({
    apiKey,
    httpOptions: {
      headers: {
        'User-Agent': 'aistudio-build',
      },
    },
  });
}

// Primary model for fast, reliable full-book translation (free-tier compatible per gemini-api guidelines)
const TRANSLATION_MODEL = 'gemini-4-hydrogen';

import {
  CALIBRE_BRIDGE_EXTENSIONS,
  NATIVE_BOOK_EXTENSIONS,
  cleanExtractedPdfText,
  htmlToStructuredText,
  parseEpubBuffer,
  parseFb2Book,
  parseHtmlBook,
  parseLatexBook,
  parseOdtBuffer,
  parseRtfBook,
} from './src/lib/bookFormats.ts';
import type { SupportedBookFormat } from './src/lib/bookFormats.ts';
import type { BookAsset } from './src/types/translator.ts';

const MAX_UPLOAD_BYTES = 25 * 1024 * 1024; // 25 MB book limit

const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: MAX_UPLOAD_BYTES,
    files: 1,
  },
});

async function extractTextFromUploadedBook(
  buffer: Buffer,
  originalName: string
): Promise<{
  text: string;
  format: SupportedBookFormat;
  assets: BookAsset[];
}> {
  const ext = path.extname(originalName).toLowerCase();

  if (CALIBRE_BRIDGE_EXTENSIONS.has(ext)) {
    throw new Error(
      `Format "${ext.toUpperCase()}" is supported via the Open-Source Skill CLI's Calibre bridge (ebook-convert). In this browser preview, upload PDF, EPUB, DOCX, ODT, FB2, RTF, HTML, LaTeX, MD, or TXT — or run "npx tsx scripts/extract-book.ts --input book${ext}" inside Antigravity.`
    );
  }

  if (!NATIVE_BOOK_EXTENSIONS.has(ext)) {
    throw new Error(
      `Unsupported format "${ext || 'unknown'}". Supported formats: PDF, EPUB, DOCX, ODT, FB2, RTF, HTML, XHTML, LaTeX (.tex), Markdown, and TXT.`
    );
  }

  if (ext === '.pdf') {
    const result = await extractText(new Uint8Array(buffer), { mergePages: true });
    const rawText = Array.isArray(result.text) ? result.text.join('\n\n') : String(result.text ?? '');
    return { text: cleanExtractedPdfText(rawText), format: 'pdf', assets: [] };
  }

  if (ext === '.docx') {
    const assets: BookAsset[] = [];
    const htmlResult = await mammoth.convertToHtml({ buffer });
    let imgCounter = 0;
    const htmlWithTokens = (htmlResult.value ?? '').replace(
      /<img\b[^>]*src="(data:image\/([^;"]+);base64,([^"]+))"[^>]*>/gi,
      (_match, dataUrl: string, subtype: string) => {
        if (assets.length >= 80) return '';
        imgCounter += 1;
        const id = `fig-${String(imgCounter).padStart(2, '0')}`;
        const token = `[[ASSET:${id}]]`;
        const safeSub = subtype.toLowerCase().replace(/[^a-z0-9+]/g, '');
        const extOut = safeSub === 'jpeg' ? 'jpg' : safeSub.includes('svg') ? 'svg' : safeSub || 'png';
        assets.push({
          id,
          token,
          kind: safeSub.includes('svg') ? 'graph' : 'image',
          mimeType: `image/${safeSub || 'png'}`,
          dataUrl,
          fileName: `${id}.${extOut}`,
          captionEnglish: `Figure ${imgCounter}`,
          captionBangla: `চিত্র ${imgCounter}`,
        });
        return `\n\n${token}\n\n`;
      }
    );
    return { text: htmlToStructuredText(htmlWithTokens), format: 'docx', assets };
  }

  if (ext === '.epub') {
    const parsed = await parseEpubBuffer(buffer);
    return { text: parsed.text, format: 'epub', assets: parsed.assets };
  }

  if (ext === '.odt') {
    const parsed = await parseOdtBuffer(buffer);
    return { text: parsed.text, format: 'odt', assets: parsed.assets };
  }

  const utf8 = buffer.toString('utf8');

  if (ext === '.fb2') {
    const parsed = parseFb2Book(utf8);
    return { text: parsed.text, format: 'fb2', assets: parsed.assets };
  }

  if (ext === '.rtf') {
    return { text: parseRtfBook(utf8), format: 'rtf', assets: [] };
  }

  if (ext === '.html' || ext === '.htm' || ext === '.xhtml') {
    const parsed = parseHtmlBook(utf8);
    return { text: parsed.text, format: 'html', assets: parsed.assets };
  }

  if (ext === '.tex') {
    return { text: parseLatexBook(utf8), format: 'tex', assets: [] };
  }

  return {
    text: utf8.trim(),
    format: ext === '.md' || ext === '.markdown' ? 'md' : 'txt',
    assets: [],
  };
}

function getRegisterInstruction(register: string): string {
  switch (register) {
    case 'academic':
      return 'Write in disciplined, precise scholarly Bangla following Bangla Academy spelling standards.';
    case 'modern':
      return 'Write in crisp, contemporary, natural Cholito Bangla suitable for modern non-fiction publishing.';
    default:
      return 'Write in rich, rhythmic Promito Literary Cholito Bangla worthy of flagship Dhaka and Kolkata publishing houses.';
  }
}

async function generateWithRetry<T>(fn: () => Promise<T>, maxAttempts = 3): Promise<T> {
  let lastError: unknown;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastError = err;
      const msg = err instanceof Error ? err.message : String(err);
      if (msg.includes('API_KEY') || msg.includes('PERMISSION_DENIED') || msg.includes('403') || msg.includes('400')) {
        throw err;
      }
      if (attempt < maxAttempts) {
        await new Promise((r) => setTimeout(r, 700 * attempt));
      }
    }
  }
  throw lastError;
}

function mapGeminiError(err: unknown): { status: number; message: string } {
  const raw = err instanceof Error ? err.message : String(err);
  if (raw === 'GEMINI_API_KEY_MISSING') {
    return {
      status: 503,
      message: 'Gemini API key is not configured in Settings > Secrets. You can still inspect, edit, audit, and export the Skill package.',
    };
  }
  if (raw.includes('PERMISSION_DENIED') || raw.includes('API_KEY_INVALID') || raw.includes('403')) {
    return {
      status: 403,
      message: 'Gemini API key was rejected. Please verify your API key in Settings > Secrets.',
    };
  }
  if (raw.includes('RESOURCE_EXHAUSTED') || raw.includes('429')) {
    return {
      status: 429,
      message: 'Rate limit reached on Gemini API. Wait a moment and resume from the saved checkpoint.',
    };
  }
  return {
    status: 500,
    message: 'Translation service encountered an error. Your progress is preserved; retry this chunk.',
  };
}

async function startServer() {
  const app = express();
  app.disable('x-powered-by');
  app.use(express.json({ limit: '8mb' }));

  // Health check
  app.get('/api/health', (_req: Request, res: Response) => {
    res.json({ ok: true });
  });

  // Helper: discover local Chromium / Playwright chrome-headless-shell for real HarfBuzz Bangla PDF rendering
  let cachedChromeBin: string | null | undefined;
  async function findLocalChromium(): Promise<string | null> {
    if (cachedChromeBin !== undefined) return cachedChromeBin;
    const candidates: string[] = [
      'chromium',
      'chromium-browser',
      'google-chrome',
      'google-chrome-stable',
      '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    ];
    const pwRoots = [
      process.env.PLAYWRIGHT_BROWSERS_PATH || '',
      '/ms-playwright',
      path.join(os.homedir(), '.cache', 'ms-playwright'),
    ].filter(Boolean);
    const targets = new Set(['chrome', 'chromium', 'chrome-headless-shell']);
    const scan = (dir: string, depth: number) => {
      if (depth > 4 || !fs.existsSync(dir)) return;
      let entries: fs.Dirent[];
      try {
        entries = fs.readdirSync(dir, { withFileTypes: true });
      } catch {
        return;
      }
      for (const e of entries) {
        const full = path.join(dir, e.name);
        if (e.isFile() && targets.has(e.name)) candidates.push(full);
        else if (e.isDirectory() && (depth < 1 || /chrom|headless|linux|mac/i.test(e.name))) scan(full, depth + 1);
      }
    };
    pwRoots.forEach((r) => scan(r, 0));

    for (const bin of candidates) {
      try {
        await execFileAsync(bin, ['--version']);
        cachedChromeBin = bin;
        return bin;
      } catch {
        // try next candidate
      }
    }
    cachedChromeBin = null;
    return null;
  }

  // Strictly sanitize HTML before headless Chromium PDF rendering (blocks scripts, external URLs & file:// SSRF)
  function sanitizePrintHtmlForPdf(rawHtml: string): string {
    return rawHtml
      .replace(/<script[\s\S]*?<\/script>/gi, '')
      .replace(/<(?:iframe|object|embed|applet|base|link)\b[^>]*>[\s\S]*?(?:<\/(?:iframe|object|embed|applet)>)?/gi, '')
      .replace(/<meta\b[^>]*http-equiv\s*=\s*["']?refresh["']?[^>]*>/gi, '')
      .replace(/\son[a-z]+\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+)/gi, '')
      .replace(/\b(src|href)\s*=\s*(["'])(?!data:image\/(?:png|jpeg|jpg|webp|gif|svg\+xml);base64,|#)[^"']*\2/gi, '$1=""')
      .replace(/url\(\s*['"]?\s*(?:https?:|file:|ftp:|\/\/)[^)]*\)/gi, 'none');
  }

  // 0. Render Print-Ready Bangla HTML into a real binary HarfBuzz PDF file
  app.post('/api/render-pdf', async (req: Request, res: Response) => {
      let tmpDir = '';
      try {
        const { html, fileName } = req.body ?? {};
        if (typeof html !== 'string' || !html.trim()) {
          res.status(400).json({ error: 'Print HTML content is required.' });
          return;
        }
        if (html.length > 6 * 1024 * 1024) {
          res.status(400).json({ error: 'Book HTML exceeds 6 MB render limit.' });
          return;
        }

        const chromeBin = await findLocalChromium();
        if (!chromeBin) {
          res.status(503).json({
            error: 'Headless Chromium PDF renderer is unavailable on this server. Use Print / Save PDF or Print HTML.',
          });
          return;
        }

        tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lipiforge-pdf-'));
        const htmlPath = path.join(tmpDir, 'book.html');
        const pdfPath = path.join(tmpDir, 'book.pdf');
        fs.writeFileSync(htmlPath, sanitizePrintHtmlForPdf(html), 'utf8');

        const isHeadlessShell = path.basename(chromeBin).includes('headless-shell');
        const chromeArgs = [
          ...(isHeadlessShell ? [] : ['--headless=new']),
          '--disable-gpu',
          '--no-sandbox',
          `--print-to-pdf=${pdfPath}`,
          '--no-pdf-header-footer',
          '--virtual-time-budget=2000',
          pathToFileURL(htmlPath).href,
        ];
        await execFileAsync(chromeBin, chromeArgs, {
          timeout: 30000,
          maxBuffer: 32 * 1024 * 1024,
        });

        const pdfBytes = fs.readFileSync(pdfPath);
        const safeName =
          (typeof fileName === 'string' ? fileName : 'bangla-book.pdf')
            .replace(/[^a-zA-Z0-9._-]/g, '-')
            .replace(/^-+/, '') || 'bangla-book.pdf';
        const finalName = safeName.endsWith('.pdf') ? safeName : `${safeName}.pdf`;

        res.setHeader('Content-Type', 'application/pdf');
        res.setHeader('Content-Disposition', `attachment; filename="${finalName}"`);
        res.send(pdfBytes);
      } catch (err) {
        const msg = err instanceof Error ? err.message : 'PDF rendering failed.';
        res.status(500).json({ error: msg });
      } finally {
        if (tmpDir) {
          fs.rmSync(tmpDir, { recursive: true, force: true });
        }
      }
    });

  // 1. Parse uploaded book (PDF, EPUB, DOCX, MD, TXT) into clean UTF-8 text + untouched visual assets
  app.post('/api/parse-book', upload.single('book'), async (req: Request, res: Response) => {
    try {
      if (!req.file) {
        res.status(400).json({ error: 'Please upload a book file (PDF, EPUB, DOCX, MD, or TXT).' });
        return;
      }

      const safeFileName = path.basename(req.file.originalname || 'manuscript.txt');
      const extracted = await extractTextFromUploadedBook(req.file.buffer, safeFileName);

      if (!extracted.text || extracted.text.length < 20) {
        res.status(422).json({
          error: 'Could not extract readable text from this file. If this is a scanned image-only PDF, run OCR first.',
        });
        return;
      }

      res.json({
        fileName: safeFileName,
        format: extracted.format,
        text: extracted.text,
        assets: extracted.assets,
        charCount: extracted.text.length,
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Failed to parse book file.';
      res.status(400).json({ error: msg });
    }
  });

  // 2. Translate a single weak-model-safe chunk with optional 2-pass Bangla literary polish
  app.post('/api/translate-chunk', async (req: Request, res: Response) => {
    try {
      const {
        sourceText,
        chapterTitle,
        contextTail,
        publishingHouseBangla,
        register,
        strictZeroEnglish,
        glossary,
        retryHint,
        twoPassPolish,
      } = req.body ?? {};

      if (typeof sourceText !== 'string' || !sourceText.trim()) {
        res.status(400).json({ error: 'sourceText is required.' });
        return;
      }
      if (sourceText.length > 24000) {
        res.status(400).json({ error: 'Chunk exceeds maximum length (24,000 characters).' });
        return;
      }

      const houseName =
        typeof publishingHouseBangla === 'string' && publishingHouseBangla.trim()
          ? publishingHouseBangla.trim().slice(0, 120)
          : 'প্রকাশনা প্রতিষ্ঠান';

      const glossaryLines = Array.isArray(glossary)
        ? glossary
            .filter(
              (g): g is { english: string; bangla: string } =>
                Boolean(g && typeof g.english === 'string' && typeof g.bangla === 'string')
            )
            .slice(0, 40)
            .map((g) => `- "${g.english.trim()}" => "${g.bangla.trim()}"`)
            .join('\n')
        : '';

      const systemInstruction = [
        `You are the chief Bangla literary translator for ${houseName}.`,
        getRegisterInstruction(typeof register === 'string' ? register : 'literary'),
        'MANDATORY PRODUCTION & MEANING-FIDELITY RULES:',
        '1. 100% SENSE-FOR-SENSE MEANING FIDELITY (মর্মনিষ্ঠ ভাবানুবাদ — NEVER WORD-FOR-WORD LITERAL): Translate what the author ACTUALLY MEANT, never robotic word-for-word dictionary calques. Decode English idioms, phrasal verbs, metaphors, irony, and rhetorical turns into natural Bengali equivalents that preserve the EXACT underlying meaning, nuance, causality, negation, and emotional tone. Never add personal commentary, never soften or exaggerate claims, and never drop or alter factual numbers/years.',
        strictZeroEnglish !== false
          ? '2. STRICT ZERO ENGLISH: Do NOT leave any English words, Latin letters, or parenthetical English explanations in the output. Transliterate all proper names into Bangla script.'
          : '2. Translate all prose completely into Bangla script.',
        '3. PRESERVE ALL VISUAL ASSET ANCHORS: If the source contains tokens like [[ASSET:fig-01]], copy those exact [[ASSET:...]] tokens verbatim in their exact paragraph slot. Never remove, rename, or translate asset tokens.',
        '4. PRESERVE RICH SEMANTIC FORMATTING: Intelligently keep all typographic hierarchy — keep ## and ### section headings (large display), **bold** key phrases, *italic* emphasis, ==highlighted text==, > editorial blockquotes, - bullet lists, and ~small footnotes/captions~ intact around the corresponding translated Bangla words.',
        '5. NEVER summarize, skip, shorten, or emit placeholders like "[continued]" or "...". Preserve every single sentence and exact paragraph break (blank line between paragraphs).',
        '6. Use natural Bengali SOV sentence structure, Bengali Dari (।) for sentence endings, and Bengali digits (০-৯) for numbers.',
        '7. STRICT ZERO AI SYMBOLS & ZERO AI SLOP: NEVER use em-dashes (—), en-dashes (–), horizontal bars (―), double/triple dashes (-- / ---), spaced dashes (" - "), emojis, decorative arrows (→, ⇒), stars (✨), checkmarks, or chatbot preambles ("অবশ্যই", "নিচে অনুবাদ দেওয়া হলো"). Use natural Bengali commas (,), semicolons (;), colons (:), or separate sentences with Dari (।) instead of dashes.',
        '8. Return valid JSON matching the requested schema.',
      ].join('\n');

      const userPromptParts = [
        chapterTitle && typeof chapterTitle === 'string'
          ? `Chapter Heading to also translate into Bangla: ${chapterTitle.slice(0, 200)}`
          : '',
        glossaryLines
          ? `Locked Book Glossary (MUST use these exact Bangla renderings when the term appears):\n${glossaryLines}`
          : '',
        contextTail && typeof contextTail === 'string'
          ? `Previous passage ending (READ-ONLY continuity context, DO NOT translate or repeat this):\n"""\n${contextTail.slice(0, 500)}\n"""`
          : '',
        retryHint && typeof retryHint === 'string'
          ? `CORRECTION REQUIRED FROM PREVIOUS ATTEMPT:\n${retryHint.slice(0, 600)}`
          : '',
        `Step 1: Briefly analyze any idioms, metaphors, subtle authorial intent, and tone in this passage so you do NOT translate literally.\nStep 2: Translate 100% of the following English book passage into meaning-faithful, AI-slop-free publication-grade Bangla (no em-dashes, no en-dashes, no double dashes, no emojis):\n\n"""\n${sourceText}\n"""`,
      ].filter(Boolean);

      const ai = getGeminiClient();

      // Pass 1: Intent-First Full-Coverage Translation (forces sense decoding before Bangla output)
      const pass1Response = await generateWithRetry(() =>
        ai.models.generateContent({
          model: TRANSLATION_MODEL,
          contents: userPromptParts.join('\n\n'),
          config: {
            systemInstruction,
            responseMimeType: 'application/json',
            responseSchema: {
              type: Type.OBJECT,
              properties: {
                semanticIntentNotes: {
                  type: Type.STRING,
                  description:
                    'Brief internal note of idioms, metaphors, or subtle authorial intent to preserve without word-for-word literal calques.',
                },
                chapterTitleBangla: {
                  type: Type.STRING,
                  description: 'Natural Bangla translation of the chapter heading.',
                },
                banglaText: {
                  type: Type.STRING,
                  description:
                    'Complete, 100% meaning-faithful, AI-slop-free Bangla translation preserving all paragraphs, formatting markers, and [[ASSET:...]] tokens.',
                },
              },
              required: ['semanticIntentNotes', 'chapterTitleBangla', 'banglaText'],
            },
          },
        })
      );

      const parsedPass1 = JSON.parse((pass1Response.text ?? '{}').trim()) as {
        semanticIntentNotes?: string;
        chapterTitleBangla?: string;
        banglaText?: string;
      };

      let finalBangla = (parsedPass1.banglaText ?? '').trim();
      const finalChapterTitle = (parsedPass1.chapterTitleBangla ?? '').trim();

      // Optional Pass 2: Semantic Meaning-Drift Verification & Anti-Literal / Zero-AI-Slop Polish
      if (twoPassPolish === true && finalBangla.length > 40) {
        const polishPrompt = [
          `Original English:\n"""\n${sourceText}\n"""`,
          `Draft Bangla Translation:\n"""\n${finalBangla}\n"""`,
          glossaryLines ? `Locked Glossary Terms (keep exact spellings):\n${glossaryLines}` : '',
          `Perform a strict Meaning-Fidelity & Zero-AI-Slop Copyedit for ${houseName}:`,
          `1. Check every sentence against the Original English: ensure 100% of what the author ACTUALLY meant is preserved (no dropped qualifiers, no inverted negations, no altered facts/numbers, no invented additions).`,
          `2. Eliminate ANY word-for-word literal English calques or stiff translationese; rewrite them into natural, idiomatic Bengali while keeping the exact intended meaning.`,
          `3. Strip ALL AI symbols and AI slop punctuation: replace every em-dash (—), en-dash (–), double dash (--), spaced dash (" - "), emoji, arrow, or decorative symbol with natural Bengali commas (,), semicolons (;), colons (:), or Dari (।).`,
          `4. Keep EVERY [[ASSET:...]] token verbatim and preserve ALL formatting markers (##, ###, **bold**, *italic*, ==highlight==, > quote, - list, ~small~) and paragraph breaks.`,
          `5. Zero English words and zero chatbot intro/outro text allowed. Output ONLY the final polished Bangla text.`,
        ]
          .filter(Boolean)
          .join('\n\n');

        const pass2Response = await generateWithRetry(() =>
          ai.models.generateContent({
            model: TRANSLATION_MODEL,
            contents: polishPrompt,
            config: {
              systemInstruction: `You are a senior Bangla literary editor and meaning-fidelity auditor at ${houseName}. Fix any literal word-for-word translationese, meaning drift, or AI symbols (em-dashes, en-dashes, double dashes, emojis, arrows) while keeping 100% of facts, tone, formatting markers, and [[ASSET:...]] tokens intact.`,
            },
          })
        );

        const polished = (pass2Response.text ?? '').trim();
        if (polished.length >= finalBangla.length * 0.7) {
          finalBangla = polished;
        }
      }

      res.json({
        chapterTitleBangla: finalChapterTitle,
        banglaText: finalBangla,
        model: TRANSLATION_MODEL,
      });
    } catch (err) {
      const mapped = mapGeminiError(err);
      res.status(mapped.status).json({ error: mapped.message });
    }
  });

  // 3. Auto-extract book-wide Bangla glossary terms & localized book metadata
  app.post('/api/extract-glossary', async (req: Request, res: Response) => {
    try {
      const { sampleText, title, author, publishingHouseBangla } = req.body ?? {};
      if (typeof sampleText !== 'string' || !sampleText.trim()) {
        res.status(400).json({ error: 'sampleText is required.' });
        return;
      }

      const ai = getGeminiClient();
      const excerpt = sampleText.slice(0, 12000);
      const houseName =
        typeof publishingHouseBangla === 'string' && publishingHouseBangla.trim()
          ? publishingHouseBangla.trim().slice(0, 120)
          : 'প্রথমা প্রকাশন';

      const response = await generateWithRetry(() =>
        ai.models.generateContent({
          model: TRANSLATION_MODEL,
          contents: [
            `Book Title: ${typeof title === 'string' ? title.slice(0, 200) : 'Untitled'}`,
            `Author: ${typeof author === 'string' ? author.slice(0, 150) : 'Unknown'}`,
            `Publishing House: ${houseName}`,
            `Extract the 8 to 14 most important recurring proper nouns (people, places, book titles, key domain terms) from this English book excerpt and provide consistent, publication-grade Bangla transliterations/translations, plus a natural Bangla book title and author name.`,
            `Excerpt:\n"""\n${excerpt}\n"""`,
          ].join('\n\n'),
          config: {
            systemInstruction:
              'You are a senior Bengali book editor preparing a Style Bible and entity glossary before full-book translation. Output valid JSON only.',
            responseMimeType: 'application/json',
            responseSchema: {
              type: Type.OBJECT,
              properties: {
                titleBangla: { type: Type.STRING },
                authorBangla: { type: Type.STRING },
                terms: {
                  type: Type.ARRAY,
                  items: {
                    type: Type.OBJECT,
                    properties: {
                      english: { type: Type.STRING },
                      bangla: { type: Type.STRING },
                      category: { type: Type.STRING },
                      notes: { type: Type.STRING },
                    },
                    required: ['english', 'bangla', 'category'],
                  },
                },
              },
              required: ['titleBangla', 'authorBangla', 'terms'],
            },
          },
        })
      );

      const parsed = JSON.parse((response.text ?? '{}').trim()) as {
        titleBangla?: string;
        authorBangla?: string;
        terms?: Array<{ english: string; bangla: string; category: string; notes?: string }>;
      };

      const validCategories = new Set(['person', 'place', 'term', 'title']);
      const terms = (parsed.terms ?? [])
        .filter((t) => t.english?.trim() && t.bangla?.trim())
        .slice(0, 20)
        .map((t, idx) => ({
          id: `ext-${Date.now()}-${idx}`,
          english: t.english.trim(),
          bangla: t.bangla.trim(),
          category: validCategories.has(t.category) ? t.category : 'term',
          notes: t.notes?.trim() || '',
        }));

      res.json({
        titleBangla: parsed.titleBangla?.trim() || '',
        authorBangla: parsed.authorBangla?.trim() || '',
        terms,
      });
    } catch (err) {
      const mapped = mapGeminiError(err);
      res.status(mapped.status).json({ error: mapped.message });
    }
  });

  // Multer & JSON error handler
  app.use((err: unknown, _req: Request, res: Response, next: NextFunction) => {
    if (err instanceof multer.MulterError) {
      res.status(400).json({
        error:
          err.code === 'LIMIT_FILE_SIZE'
            ? 'Book file exceeds the 25 MB upload limit.'
            : err.message,
      });
      return;
    }
    if (err) {
      res.status(400).json({ error: err instanceof Error ? err.message : 'Invalid request.' });
      return;
    }
    next();
  });

  // Frontend serving: Vite middleware in development, static dist in production
  if (!IS_PROD) {
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distDir = path.resolve(__dirname, 'dist');
    app.use(express.static(distDir));
    app.get('*', (_req: Request, res: Response) => {
      const indexHtml = path.join(distDir, 'index.html');
      if (fs.existsSync(indexHtml)) {
        res.sendFile(indexHtml);
      } else {
        res.status(404).send('Build output not found. Run npm run build first.');
      }
    });
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`LipiForge server listening on http://localhost:${PORT}`);
  });
}

startServer();
