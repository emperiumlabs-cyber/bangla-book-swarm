import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildTranslationChunks,
  parseBookIntoChapters,
  splitChunkInHalf,
  countWords,
} from './chunker';
import { auditBanglaTranslation } from './auditor';
import { generateSkillRepositoryFiles } from './skillGenerator';
import {
  assembleBanglaMarkdown,
  assemblePrintReadyHtml,
  buildEpubFileEntries,
  getAdaptiveTitleScaleEm,
  splitBookTitle,
  toBengaliDigits,
} from './exporters';
import {
  cleanExtractedPdfText,
  parseFb2Book,
  parseHtmlBook,
  parseLatexBook,
  parseRtfBook,
  resolveEpubSpineOrder,
  stripRedundantPdfCoverPageText,
} from './bookFormats';
import {
  buildAntigravityLedgerJson,
  buildSingleChunkAntigravityPrompt,
  extractGlossaryCandidatesOffline,
  parseImportedProjectOrLedger,
} from './antigravityBridge';
import {
  buildSwarmPlan,
  computeAdaptiveWorkerCount,
  computeSwarmSpeedEstimate,
  evaluateBatchCompleteness,
  formatWorkerInputPacket,
  parseWorkerOutputPacket,
} from './swarmPlanner';
import { createSampleBookProject, DEFAULT_PUBLISHER, SAMPLE_GLOSSARY } from './sampleBook';

test('parseBookIntoChapters detects markdown and explicit chapter headings cleanly', () => {
  const text = `# Chapter 1: Dawn\n\nFirst paragraph of dawn.\n\nSecond paragraph of dawn.\n\nCHAPTER 2: DUSK\n\nFirst paragraph of dusk.`;
  const chapters = parseBookIntoChapters(text);
  assert.equal(chapters.length, 2);
  assert.equal(chapters[0].title, 'Chapter 1: Dawn');
  assert.equal(chapters[0].paragraphs.length, 2);
  assert.equal(chapters[1].title, 'CHAPTER 2: DUSK');
  assert.equal(chapters[1].paragraphs.length, 1);
});

test('buildTranslationChunks respects weak-model word budget and carries sliding context tail', () => {
  const longPara = Array.from({ length: 120 }, (_, i) => `word${i}`).join(' ') + '.';
  const text = `# Chapter 1\n\n${longPara}\n\n${longPara}\n\n${longPara}`;
  const chapters = parseBookIntoChapters(text);
  const chunks = buildTranslationChunks(chapters, 150);

  assert.equal(chunks.length, 3);
  assert.equal(chunks[0].contextTail, '');
  assert.ok(chunks[1].contextTail.length > 0, 'Chunk 2 must carry trailing context from Chunk 1');
  assert.ok(chunks.every((c) => countWords(c.sourceText) <= 150));
});

test('splitChunkInHalf deterministically halves a failing chunk for weak-model retry', () => {
  const sample = createSampleBookProject();
  const pair = splitChunkInHalf(sample.chunks[0]);
  assert.ok(pair, 'Multi-paragraph chunk should split cleanly');
  const [left, right] = pair!;
  assert.equal(left.splitDepth, 1);
  assert.equal(right.splitDepth, 1);
  assert.ok(left.sourceText.length > 20 && right.sourceText.length > 20);
  assert.ok(right.contextTail.length > 0);
});

test('auditBanglaTranslation passes 100% pure, meaning-faithful, AI-slop-free Bangla AND preserves [[ASSET:fig-01]]', () => {
  const sample = createSampleBookProject();
  const audit = auditBanglaTranslation(sample.chunks[0].sourceText, sample.chunks[0].banglaText, {
    strictZeroEnglish: true,
    glossary: SAMPLE_GLOSSARY,
  });
  assert.equal(audit.passed, true);
  assert.equal(audit.banglaPurityPct, 100);
  assert.equal(audit.leakedEnglishWords.length, 0);
  assert.equal(audit.missingGlossaryTerms.length, 0);
  assert.equal(audit.missingAssets.length, 0);
  assert.equal(audit.preservedAssetsCount, 1);
  assert.equal(audit.formattingPreserved, true);
  assert.equal(audit.meaningFidelityPassed, true);
  assert.equal(audit.aiSlopSymbolsDetected.length, 0);
});

test('auditBanglaTranslation fails if a weak model drops an original figure/graph anchor', () => {
  const sample = createSampleBookProject();
  const droppedAssetBangla = sample.chunks[0].banglaText.replace('[[ASSET:fig-01]]', '');
  const audit = auditBanglaTranslation(sample.chunks[0].sourceText, droppedAssetBangla, {
    strictZeroEnglish: true,
    glossary: SAMPLE_GLOSSARY,
  });
  assert.equal(audit.passed, false);
  assert.deepEqual(audit.missingAssets, ['[[ASSET:fig-01]]']);
  assert.equal(audit.retryAction, 'retranslate_strict');
});

test('auditBanglaTranslation catches untranslated English leaks, shortcuts, and silent truncation', () => {
  const source =
    'Every winter before the river froze, Alden Vance walked down the narrow stone quay of Clockwork Harbor with a satchel strapped across his shoulder. Inside rested three hundred unbound pages smelling faintly of linseed ink.';

  const leaky = auditBanglaTranslation(
    source,
    'প্রতি বছর শীতকালে Alden Vance হেঁটে যেতেন Clockwork Harbor ঘাট ধরে এবং three hundred পাতা নিয়ে যেতেন।',
    { strictZeroEnglish: true }
  );
  assert.equal(leaky.passed, false);
  assert.ok(leaky.leakedEnglishWords.includes('Alden'));
  assert.ok(leaky.banglaPurityPct < 99);

  const shortcut = auditBanglaTranslation(
    source,
    'প্রতি বছর শীতকালে নদী জমে যাওয়ার আগে অ্যালডেন ভ্যান্স ঘাটে যেতেন। [rest of paragraph omitted]',
    { strictZeroEnglish: true }
  );
  assert.equal(shortcut.passed, false);
  assert.equal(shortcut.shortcutDetected, true);
  assert.equal(shortcut.retryAction, 'split_and_retry');

  const truncated = auditBanglaTranslation(source, 'শীতে অ্যালডেন ঘাটে গেলেন।', {
    strictZeroEnglish: true,
  });
  assert.equal(truncated.passed, false);
  assert.equal(truncated.retryAction, 'split_and_retry');
});

test('auditBanglaTranslation detects dropped semantic formatting (headings, blockquotes, highlights)', () => {
  const source = `## The Harbor Gate\n\n==Every lantern stayed lit until dawn.==\n\n> "Never abandon the press before sunrise."`;
  const flattened = `হারবার গেট\n\nপ্রতিটি লণ্ঠন ভোর পর্যন্ত জ্বলে থাকত।\n\nসূর্যোদয়ের আগে কখনো ছাপাখানা ছেড়ে যেয়ো না।`;
  const audit = auditBanglaTranslation(source, flattened, { strictZeroEnglish: true });
  assert.equal(audit.passed, false);
  assert.equal(audit.formattingPreserved, false);
  assert.ok(audit.issues.some((i) => i.includes('Section heading')));
  assert.ok(audit.issues.some((i) => i.includes('Blockquote')));
  assert.ok(audit.issues.some((i) => i.includes('Highlighted')));
});

test('auditBanglaTranslation catches literal word-for-word calques and dropped factual numbers', () => {
  const source =
    'In 1947, the delegates spoke warmly to break the ice and finally address the elephant in the room.';
  const literalCalque = auditBanglaTranslation(
    source,
    'প্রতিনিধিরা বরফ ভাঙা শুরু করলেন এবং শেষ পর্যন্ত ঘরের হাতি নিয়ে কথা বললেন।',
    { strictZeroEnglish: true }
  );
  assert.equal(literalCalque.passed, false);
  assert.equal(literalCalque.meaningFidelityPassed, false);
  assert.ok(literalCalque.literalCalquesDetected.length >= 2);
  assert.ok(literalCalque.missingNumbers.some((n) => n.includes('1947')));

  const faithful = auditBanglaTranslation(
    source,
    '১৯৪৭ সালে প্রতিনিধিরা আন্তরিকভাবে কথা বলে জড়তা কাটালেন এবং শেষ পর্যন্ত এড়িয়ে যাওয়া স্পষ্ট সমস্যাটি নিয়ে আলোচনা করলেন।',
    { strictZeroEnglish: true }
  );
  assert.equal(faithful.passed, true);
  assert.equal(faithful.meaningFidelityPassed, true);
});

test('auditBanglaTranslation bans em-dashes, en-dashes, double dashes, spaced dashes, emojis, and AI preambles while allowing Bengali compound hyphens', () => {
  const source = 'The slate-colored sky cleared at dawn, revealing the harbor.';
  const withEmDash = auditBanglaTranslation(
    source,
    'ভোরবেলা স্লেট-রঙা আকাশ পরিষ্কার হলো — বন্দরটি স্পষ্ট হয়ে উঠল।',
    { strictZeroEnglish: true }
  );
  assert.equal(withEmDash.passed, false);
  assert.ok(withEmDash.aiSlopSymbolsDetected.some((m) => m.includes('Em-dash')));

  const withDoubleDashAndEmoji = auditBanglaTranslation(
    source,
    'ভোরবেলা আকাশ পরিষ্কার হলো -- বন্দরটি স্পষ্ট হলো ✨',
    { strictZeroEnglish: true }
  );
  assert.equal(withDoubleDashAndEmoji.passed, false);
  assert.ok(withDoubleDashAndEmoji.aiSlopSymbolsDetected.length >= 2);

  const cleanBangla = auditBanglaTranslation(
    source,
    'ভোরবেলা স্লেট-রঙা আকাশ পরিষ্কার হলো; দূর থেকে বন্দরটি স্পষ্ট হয়ে উঠল।',
    { strictZeroEnglish: true }
  );
  assert.equal(cleanBangla.passed, true);
  assert.equal(cleanBangla.aiSlopSymbolsDetected.length, 0);
});

test('universal book parsers and cleanExtractedPdfText repair OCR hyphens and handle FB2, RTF, LaTeX, HTML, and EPUB spine order', () => {
  const repaired = cleanExtractedPdfText('They at-\ntacked in bumper-to\uFFFDbumper traffic with com- fort.');
  assert.ok(repaired.includes('attacked'));
  assert.ok(repaired.includes('bumper-to-bumper'));
  assert.ok(repaired.includes('comfort'));
  assert.ok(!repaired.includes('\uFFFD'));

  const fakeSvgB64 = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"></svg>').toString('base64');
  const fb2 = `<FictionBook><body><section><title><p>Chapter One</p></title><p>Hello <strong>world</strong>.</p><image l:href="#pic1.svg"/><p>Second paragraph.</p></section></body><binary id="pic1.svg" content-type="image/svg+xml">${fakeSvgB64}</binary></FictionBook>`;
  const parsedFb2 = parseFb2Book(fb2);
  assert.ok(parsedFb2.text.includes('# Chapter One'));
  assert.ok(parsedFb2.text.includes('[[ASSET:fig-01]]'));
  assert.equal(parsedFb2.assets.length, 1);
  assert.equal(parsedFb2.assets[0].token, '[[ASSET:fig-01]]');

  const rtf = `{\\rtf1\\ansi{\\fonttbl\\f0 Times;}First paragraph here.\\par Second paragraph after break.}`;
  const parsedRtf = parseRtfBook(rtf);
  assert.ok(parsedRtf.includes('First paragraph here.'));
  assert.ok(parsedRtf.includes('Second paragraph after break.'));

  const tex = `\\chapter{The River}\\section{Dawn}The **water** rose gently. % comment line\nNext sentence.`;
  const parsedTex = parseLatexBook(tex);
  assert.ok(parsedTex.includes('# The River'));
  assert.ok(parsedTex.includes('## Dawn'));
  assert.ok(!parsedTex.includes('comment line'));

  const html = `<html><body><h1>Intro</h1><p>This has <strong>bold</strong> and <mark>highlighted</mark> text.</p><blockquote>Wise saying here.</blockquote></body></html>`;
  const parsedHtml = parseHtmlBook(html);
  assert.ok(parsedHtml.text.includes('**bold**'));
  assert.ok(parsedHtml.text.includes('==highlighted=='));
  assert.ok(parsedHtml.text.includes('> Wise saying here.'));

  const opf = `<package><manifest><item id="c10" href="text/ch10.xhtml"/><item id="c2" href="text/ch2.xhtml"/></manifest><spine><itemref idref="c2"/><itemref idref="c10"/></spine></package>`;
  const spine = resolveEpubSpineOrder(
    ['OEBPS/text/ch10.xhtml', 'OEBPS/text/ch2.xhtml'],
    opf,
    'OEBPS'
  );
  assert.deepEqual(spine, ['OEBPS/text/ch2.xhtml', 'OEBPS/text/ch10.xhtml']);
});

test('generateSkillRepositoryFiles builds complete 24-file Hyper-Swarm v2 Zero-API-Key skill repo with zero @google/genai or GEMINI_API_KEY', () => {
  const customPublisher = {
    ...DEFAULT_PUBLISHER,
    publishingHouse: "O'Reilly Batighar Press",
    publishingHouseBangla: "বাতিঘর'স প্রকাশনী",
    maxWordsPerChunk: 3200,
    swarmConcurrency: '20' as const,
  };
  const files = generateSkillRepositoryFiles(customPublisher, SAMPLE_GLOSSARY);
  assert.equal(files.length, 24);

  const skillFile = files.find((f) => f.path === 'SKILL.md');
  assert.ok(skillFile);
  assert.ok(skillFile!.content.includes("বাতিঘর'স প্রকাশনী"));
  assert.ok(skillFile!.content.includes('max_words_per_chunk: 3200'));
  assert.ok(skillFile!.content.includes('swarm_concurrency: "20"'));
  assert.ok(skillFile!.content.includes('two_pass_polish: true'));

  assert.ok(files.some((f) => f.path === 'ANTIGRAVITY_PROMPT.md'));
  assert.ok(files.some((f) => f.path === 'SUBAGENT_WORKER.md'));
  assert.ok(files.some((f) => f.path === 'scripts/fast-run.mjs'));
  assert.ok(files.some((f) => f.path === 'scripts/swarm-orchestrator.ts'));
  assert.ok(files.some((f) => f.path === 'scripts/batch-extract.ts'));
  assert.ok(files.some((f) => f.path === 'scripts/chunk-queue.ts'));
  assert.ok(files.some((f) => f.path === 'templates/book.typ'));
  assert.ok(files.some((f) => f.path === 'rust-core/Cargo.toml'));
  assert.ok(files.some((f) => f.path === 'rust-core/src/main.rs'));
  assert.ok(files.some((f) => f.path === '.cursor/rules/bangla-book-translator.mdc'));
  assert.ok(files.some((f) => f.path === '.github/copilot-instructions.md'));
  assert.ok(files.some((f) => f.path === 'install.sh'));
  assert.ok(files.some((f) => f.path === 'install.ps1'));
  assert.ok(files.some((f) => f.path === '.gitignore'));

  const orchFile = files.find((f) => f.path === 'scripts/swarm-orchestrator.ts');
  assert.ok(orchFile);
  assert.ok(orchFile!.content.includes("cmd === 'submit-batch'"));
  assert.ok(orchFile!.content.includes('POLISH_VERIFIED'));

  const queueFile = files.find((f) => f.path === 'scripts/chunk-queue.ts');
  assert.ok(queueFile);
  assert.ok(queueFile!.content.includes('ledger.glossary || []'), 'chunk-queue.ts must pass glossary array to auditChunk');

  const pkgFile = files.find((f) => f.path === 'package.json');
  assert.ok(pkgFile);
  assert.doesNotThrow(() => JSON.parse(pkgFile!.content), 'Generated package.json must be valid JSON');
  assert.ok(!pkgFile!.content.includes('@google/genai'), 'Exported skill must not depend on @google/genai');

  for (const file of files) {
    assert.ok(
      !file.content.includes('GEMINI_API_KEY'),
      `${file.path} must not reference GEMINI_API_KEY`
    );
  }

  const auditCli = files.find((f) => f.path === 'scripts/audit-bangla.ts');
  assert.ok(auditCli);
  assert.ok(auditCli!.content.includes('AI_SLOP_SYMBOLS'));
  assert.ok(auditCli!.content.includes('LITERAL_CALQUES'));
});

test('swarmPlanner scales adaptively across 10/20/50 sub-agents and guarantees 100% disjoint lock-free shards for 50 PDF books', () => {
  assert.equal(computeAdaptiveWorkerCount(300, 1, '10'), 10);
  assert.equal(computeAdaptiveWorkerCount(300, 1, '20'), 20);
  assert.equal(computeAdaptiveWorkerCount(2500, 50, 'auto'), 50);

  // Simulate 50 books × 20 chunks each = 1,000 chunks across 50 parallel sub-agents
  const fiftyBooks = Array.from({ length: 50 }, (_, b) => ({
    slug: `book-${String(b + 1).padStart(2, '0')}`,
    title: `Book ${b + 1}`,
    chunkIds: Array.from({ length: 20 }, (_, c) => `ch1-ck${c + 1}`),
  }));

  const plan = buildSwarmPlan(fiftyBooks, 'auto');
  assert.equal(plan.totalBooks, 50);
  assert.equal(plan.totalChunks, 1000);
  assert.equal(plan.workerCount, 50);
  assert.equal(plan.minChunksPerWorker, 20);
  assert.equal(plan.maxChunksPerWorker, 20);

  // Verify 100% disjoint lock-free atomic output files (zero race conditions!)
  const seenOutputFiles = new Set<string>();
  for (const shard of plan.shards) {
    for (const assignment of shard.assignments) {
      assert.ok(!seenOutputFiles.has(assignment.outputFile), `Duplicate output file ${assignment.outputFile}`);
      seenOutputFiles.add(assignment.outputFile);
    }
  }
  assert.equal(seenOutputFiles.size, 1000);

  // Verify strict 100% completeness barrier
  const partialReport = evaluateBatchCompleteness([
    { slug: 'book-01', chunks: [{ id: 'ck1', status: 'passed' }, { id: 'ck2', status: 'pending' }] },
    { slug: 'book-02', chunks: [{ id: 'ck1', status: 'passed' }] },
  ]);
  assert.equal(partialReport.complete, false);
  assert.equal(partialReport.completedBooks, 1);
  assert.equal(partialReport.remainingItems.length, 1);

  const completeReport = evaluateBatchCompleteness([
    { slug: 'book-01', chunks: [{ id: 'ck1', status: 'passed' }, { id: 'ck2', status: 'passed' }] },
    { slug: 'book-02', chunks: [{ id: 'ck1', status: 'passed' }] },
  ]);
  assert.equal(completeReport.complete, true);
  assert.equal(completeReport.completedBooks, 2);
});

test('antigravityBridge round-trips workspace/ledger.json, builds Zero-API-Key chunk prompts, and scans entities offline', () => {
  const sample = createSampleBookProject();
  const ledger = buildAntigravityLedgerJson(sample);
  assert.equal(ledger.chunks.length, sample.chunks.length);
  assert.equal(ledger.publisher, sample.publisher.publishingHouseBangla);

  const reimported = parseImportedProjectOrLedger(ledger, sample);
  assert.equal(reimported.chunks.length, sample.chunks.length);
  assert.equal(reimported.chunks[0].status, 'passed');
  assert.equal(reimported.chunks[0].audit?.passed, true);

  const prompt = buildSingleChunkAntigravityPrompt(sample.chunks[0], sample);
  assert.ok(prompt.includes('Zero API Key'));
  assert.ok(prompt.includes('STRICT ZERO AI SYMBOLS'));
  assert.ok(prompt.includes('SENSE-FOR-SENSE MEANING FIDELITY'));
  assert.ok(prompt.includes('[[ASSET:...]]'));
  assert.ok(prompt.includes('অ্যালডেন ভ্যান্স'));

  const emptyGlossaryProject = { ...sample, glossary: [] };
  const detected = extractGlossaryCandidatesOffline(emptyGlossaryProject);
  assert.ok(detected.length > 0, 'Offline entity scanner should detect proper nouns without an API key');
  assert.ok(detected.some((d) => d.english.includes('Alden Vance') || d.english.includes('Clockwork Harbor')));
});

test('exporters render multi-device Phone/Tablet page geometry, proper beginning & ending (সমাপ্ত), rich formatting HTML, and untouched graphs', () => {
  const sample = createSampleBookProject();
  assert.equal(toBengaliDigits(2026), '২০২৬');

  const md = assembleBanglaMarkdown(sample);
  assert.ok(md.includes('প্রথমা প্রকাশন'));
  assert.ok(md.includes('./assets/fig-01-estuary-tide-graph.svg'));
  assert.ok(md.includes('## সমাপ্ত'));

  const phoneHtml = assemblePrintReadyHtml(sample, 'phone');
  assert.ok(phoneHtml.includes('size: 108mm 192mm'));
  assert.ok(phoneHtml.includes('lang="bn"'));
  assert.ok(phoneHtml.includes('সূচিপত্র'));
  assert.ok(phoneHtml.includes('class="book-endmatter"'));
  assert.ok(phoneHtml.includes('সমাপ্ত'));
  assert.ok(phoneHtml.includes('class="book-figure"'));
  assert.ok(phoneHtml.includes('<mark class="bn-highlight">'));
  assert.ok(phoneHtml.includes('<blockquote class="bn-quote">'));
  assert.ok(phoneHtml.includes('data:image/svg+xml;base64,'));

  const tabletHtml = assemblePrintReadyHtml(sample, 'tablet');
  assert.ok(tabletHtml.includes('size: 152mm 218mm'));

  const a4Html = assemblePrintReadyHtml(sample, 'print_a4');
  assert.ok(a4Html.includes('size: A4'));
  assert.ok(a4Html.includes('class="chapter-header"'));
  assert.ok(a4Html.includes('class="chapter-kicker"'));

  const longTitle = 'নেভার স্প্লিট দ্য ডিফারেন্স: জীবন-মরণ পরিস্থিতিতে আপস না করে দরকষাকষির মোক্ষম কৌশল';
  const split = splitBookTitle(longTitle);
  assert.equal(split.mainTitle, 'নেভার স্প্লিট দ্য ডিফারেন্স');
  assert.ok(split.subtitle.includes('জীবন\u2011মরণ'), 'Compound Bengali hyphen must become non-breaking inside headings');
  assert.ok(getAdaptiveTitleScaleEm(split.mainTitle) < 1.92, 'Longer main titles should scale gracefully');

  const longBookHtml = assemblePrintReadyHtml({ ...sample, titleBangla: longTitle }, 'print_a4');
  assert.ok(longBookHtml.includes('class="title-bn-sub"'));

  const epubEntries = buildEpubFileEntries(sample);
  assert.ok(epubEntries.some((e) => e.path === 'mimetype' && e.content === 'application/epub+zip'));
  assert.ok(epubEntries.some((e) => e.path === 'OEBPS/assets/fig-01-estuary-tide-graph.svg' && e.base64));
  assert.ok(epubEntries.some((e) => e.path === 'OEBPS/chapter-1.xhtml' && e.content.includes('assets/fig-01-estuary-tide-graph.svg')));
  assert.ok(epubEntries.some((e) => e.path === 'OEBPS/endmatter.xhtml' && e.content.includes('সমাপ্ত')));
});

test('original Page 1 cover page is preserved verbatim in HTML/PDF, EPUB 3.0, ledger, and exported CLI scripts without duplicating cover text', () => {
  // Cover-only Page 1 text is skipped when Page 1 is preserved visually
  const stripped = stripRedundantPdfCoverPageText([
    'NEVER SPLIT THE DIFFERENCE\nChris Voss',
    'Chapter 1: The New Rules\n\nNegotiation starts with listening carefully to every word.',
  ]);
  assert.ok(!stripped.includes('Chris Voss'));
  assert.ok(stripped.includes('Chapter 1: The New Rules'));

  // Substantive Page 1 chapter prose is NOT dropped
  const kept = stripRedundantPdfCoverPageText([
    'Chapter 1: Opening\n\n' + Array.from({ length: 70 }, (_, i) => `word${i}`).join(' '),
    'Page two continues the narrative cleanly.',
  ]);
  assert.ok(kept.includes('Chapter 1: Opening'));

  const sample = createSampleBookProject();
  const fakeCoverSvg = 'data:image/svg+xml;base64,' + Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="100" height="140"></svg>').toString('base64');
  const withCover = { ...sample, coverImageDataUrl: fakeCoverSvg, coverFileName: 'cover.svg' };

  const html = assemblePrintReadyHtml(withCover, 'print_a4');
  assert.ok(html.includes('@page cover'));
  assert.ok(html.includes('class="cover-page"'));
  assert.ok(html.indexOf('class="cover-page"') < html.indexOf('class="title-page"'), 'Original cover must appear on Page 1 before the Bangla title page');

  const epub = buildEpubFileEntries(withCover);
  assert.ok(epub.some((e) => e.path === 'OEBPS/cover.xhtml'));
  assert.ok(epub.some((e) => e.path === 'OEBPS/assets/cover.svg' && e.base64));
  const opf = epub.find((e) => e.path === 'OEBPS/content.opf');
  assert.ok(opf?.content.includes('properties="cover-image"'));
  assert.ok(opf!.content.indexOf('<itemref idref="cover"/>') < opf!.content.indexOf('<itemref idref="colophon"/>'));

  const ledger = buildAntigravityLedgerJson(withCover);
  assert.equal(ledger.coverFileName, 'cover.svg');

  const files = generateSkillRepositoryFiles(DEFAULT_PUBLISHER, SAMPLE_GLOSSARY);
  assert.ok(files.find((f) => f.path === 'scripts/extract-book.ts')?.content.includes('-dFirstPage=1'));
  assert.ok(files.find((f) => f.path === 'scripts/assemble-book.ts')?.content.includes('class="cover-page"'));
  assert.ok(files.find((f) => f.path === 'templates/book.typ')?.content.includes('cover_image: none'));
});

test('Hyper-Swarm v2 supports 3,200-4,000w full-chapter blocks, 1-to-1 fan-out, >=10x speedup, and Zero-Loop worker packets with Strict 2-Pass Polish', () => {
  // 1. Full-chapter chunking up to 4,000 words without artificial 2,000w cap
  const para500 = Array.from({ length: 500 }, (_, i) => `word${i}`).join(' ') + '.';
  const bigChapterBook = `# Chapter 1: Full Length\n\n${Array.from({ length: 6 }, () => para500).join('\n\n')}\n\n# Chapter 2: Second\n\n${Array.from({ length: 6 }, () => para500).join('\n\n')}`;
  const chapters = parseBookIntoChapters(bigChapterBook);
  const fullChapterBlocks = buildTranslationChunks(chapters, 3200);
  assert.equal(fullChapterBlocks.length, 2, 'Two 3,000-word chapters should stay intact as 2 full-chapter blocks');

  // 2. 1-to-1 Full-Chapter parallel fan-out on a single 20-chapter book
  assert.equal(computeAdaptiveWorkerCount(20, 1, 'auto', 3200), 20);
  assert.equal(computeAdaptiveWorkerCount(20, 1, 'auto', 320), 4, 'Legacy 320w mode preserves original chunk curve');

  // 3. Speed telemetry guarantees >= 10x (1,000%+) speedup on a 60,000-word book even with Strict 2-Pass Polish
  const speed = computeSwarmSpeedEstimate({
    totalWords: 60000,
    bookCount: 1,
    mode: 'auto',
    maxWordsPerChunk: 3200,
    twoPassPolish: true,
  });
  assert.equal(speed.activeWorkers, 19);
  assert.ok(speed.toolCallReductionX >= 10, `Expected >=10x turn reduction, got ${speed.toolCallReductionX}x`);
  assert.ok(speed.estimatedSpeedupX >= 10, `Expected >=10x wall-clock speedup, got ${speed.estimatedSpeedupX}x`);

  // 4. Zero-Loop worker input packet & batch output parser round-trip
  const inputMd = formatWorkerInputPacket({
    workerId: 'worker-01',
    publisherBangla: 'প্রথমা প্রকাশন',
    registerLabel: 'Promito Literary Bangla',
    strictZeroEnglish: true,
    twoPassPolish: true,
    glossary: SAMPLE_GLOSSARY,
    blocks: [
      {
        bookSlug: 'folio',
        bookTitle: 'The Folio of Tides',
        chunkId: 'ch1-ck1',
        chapterTitle: 'Chapter 1: Dawn',
        contextTail: '',
        sourceText: 'Alden Vance walked through Clockwork Harbor at sunrise.',
      },
      {
        bookSlug: 'folio',
        bookTitle: 'The Folio of Tides',
        chunkId: 'ch2-ck2',
        chapterTitle: 'Chapter 2: Press',
        contextTail: 'Alden Vance walked through Clockwork Harbor at sunrise.',
        sourceText: 'The Lead Typesetter opened The Folio of Tides.',
      },
    ],
  });
  assert.ok(inputMd.includes('STRICT 2-PASS LITERARY POLISH'));
  assert.ok(inputMd.includes('<<<BLOCK:folio:ch1-ck1>>>'));
  assert.ok(inputMd.includes('"Alden Vance" -> "অ্যালডেন ভ্যান্স"'));

  const outputMd = [
    '<<<BLOCK:folio:ch1-ck1>>>',
    'CHAPTER_TITLE_BN: অধ্যায় ১: ভোর',
    'POLISH_VERIFIED: YES',
    '---BANGLA---',
    'সূর্যোদয়ের সময় অ্যালডেন ভ্যান্স ক্লকওয়ার্ক হারবারের ভেতর দিয়ে হাঁটলেন।',
    '<<<END_BLOCK>>>',
    '',
    '<<<BLOCK:folio:ch2-ck2>>>',
    'CHAPTER_TITLE_BN: অধ্যায় ২: ছাপাখানা',
    'POLISH_VERIFIED: YES',
    '---BANGLA---',
    'সিসার অক্ষর-বিন্যাসক জোয়ারের ফোলিও খুললেন।',
    '<<<END_BLOCK>>>',
  ].join('\n');

  const parsed = parseWorkerOutputPacket(outputMd);
  assert.equal(parsed.length, 2);
  assert.equal(parsed[0].bookSlug, 'folio');
  assert.equal(parsed[0].chunkId, 'ch1-ck1');
  assert.equal(parsed[0].chapterTitleBangla, 'অধ্যায় ১: ভোর');
  assert.equal(parsed[0].polishVerified, true);
  assert.ok(parsed[0].banglaText.includes('অ্যালডেন ভ্যান্স'));
  assert.equal(parsed[1].chunkId, 'ch2-ck2');
  assert.equal(parsed[1].polishVerified, true);
});


