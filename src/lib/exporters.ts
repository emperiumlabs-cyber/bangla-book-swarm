import type {
  BookAsset,
  BookProject,
  DeviceLayoutProfile,
  TranslationChunk,
} from '../types/translator';

const BENGALI_DIGITS = ['০', '১', '২', '৩', '৪', '৫', '৬', '৭', '৮', '৯'];
const ASSET_TOKEN_SPLIT_REGEX = /(\[\[ASSET:[a-zA-Z0-9_-]+\]\])/g;

export interface LayoutProfileSpec {
  id: DeviceLayoutProfile;
  label: string;
  shortLabel: string;
  pageSizeCss: string;
  marginCss: string;
  bodyFontSizePx: number;
  lineHeight: number;
  maxWidthCh: string;
  previewMaxWidthPx: number;
  description: string;
}

export const LAYOUT_PROFILES: Record<DeviceLayoutProfile, LayoutProfileSpec> = {
  phone: {
    id: 'phone',
    label: 'Phone Reader (6" Portrait)',
    shortLabel: 'Phone (6")',
    pageSizeCss: '108mm 192mm',
    marginCss: '10mm 8.5mm 12mm 8.5mm',
    bodyFontSizePx: 15,
    lineHeight: 1.88,
    maxWidthCh: '42ch',
    previewMaxWidthPx: 410,
    description: 'Zero-zoom smartphone PDF geometry (9:16 portrait, 38–42ch Bangla measure, crisp mobile hierarchy).',
  },
  tablet: {
    id: 'tablet',
    label: 'Tablet / iPad Reader (8"–10")',
    shortLabel: 'Tablet',
    pageSizeCss: '152mm 218mm',
    marginCss: '15mm 14mm 17mm 14mm',
    bodyFontSizePx: 16.5,
    lineHeight: 1.92,
    maxWidthCh: '56ch',
    previewMaxWidthPx: 600,
    description: 'Balanced tablet reading geometry with comfortable 56ch measure and generous figure breathing room.',
  },
  print_a5: {
    id: 'print_a5',
    label: 'Print Book (A5 / Crown Octavo)',
    shortLabel: 'Print A5',
    pageSizeCss: 'A5',
    marginCss: '20mm 16mm 22mm 16mm',
    bodyFontSizePx: 15.5,
    lineHeight: 1.9,
    maxWidthCh: '54ch',
    previewMaxWidthPx: 560,
    description: 'Standard Dhaka/Kolkata paperback book press layout with binding-safe margins and Bengali page numbers.',
  },
  print_a4: {
    id: 'print_a4',
    label: 'Print Book (A4 Standard)',
    shortLabel: 'Print A4',
    pageSizeCss: 'A4',
    marginCss: '24mm 22mm 26mm 22mm',
    bodyFontSizePx: 16.5,
    lineHeight: 1.92,
    maxWidthCh: '64ch',
    previewMaxWidthPx: 680,
    description: 'Full A4 (210mm x 297mm) print edition with generous margins, large chapter headers, and crisp Bangla measure.',
  },
  desktop: {
    id: 'desktop',
    label: 'Desktop PC / Widescreen',
    shortLabel: 'Desktop PC',
    pageSizeCss: '190mm 260mm',
    marginCss: '22mm 24mm 24mm 24mm',
    bodyFontSizePx: 17.5,
    lineHeight: 1.95,
    maxWidthCh: '66ch',
    previewMaxWidthPx: 720,
    description: 'Spacious desktop monitor reading format with editorial callouts and full-width graphs.',
  },
};

export function protectBanglaCompoundHyphens(text: string): string {
  return text.replace(/([\u0980-\u09FF])-([\u0980-\u09FF])/g, '$1\u2011$2');
}

export function splitBookTitle(rawTitle: string): { mainTitle: string; subtitle: string } {
  const cleaned = protectBanglaCompoundHyphens(rawTitle.trim());
  const sepIdx = cleaned.search(/\s*[:：|]\s*/);
  if (sepIdx > 0) {
    const mainTitle = cleaned.slice(0, sepIdx).trim();
    const subtitle = cleaned.slice(sepIdx).replace(/^\s*[:：|]\s*/, '').trim();
    if (mainTitle.length >= 4 && subtitle.length >= 4) {
      return { mainTitle, subtitle };
    }
  }
  return { mainTitle: cleaned, subtitle: '' };
}

export function getAdaptiveTitleScaleEm(mainTitle: string): number {
  const len = Array.from(mainTitle.trim()).length;
  if (len <= 24) return 1.92;
  if (len <= 40) return 1.62;
  if (len <= 58) return 1.42;
  return 1.26;
}

export function stripLeadingChapterPrefix(rawTitle: string): string {
  const cleaned = rawTitle.replace(/^(?:অধ্যায়|অধ্যায়|Chapter)\s*[০-৯0-9]+\s*[:.\-–—]?\s*/i, '').trim();
  return protectBanglaCompoundHyphens(cleaned || rawTitle.trim());
}

export function toBengaliDigits(input: number | string): string {
  return String(input).replace(/\d/g, (d) => BENGALI_DIGITS[Number(d)] ?? d);
}

export function escapeHtml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export function isSafeAssetDataUrl(url: string): boolean {
  return /^data:image\/(?:png|jpeg|jpg|webp|gif|svg\+xml);base64,[A-Za-z0-9+/=\s]+$/i.test(url.trim());
}

/**
 * Safely renders inline semantic Bangla formatting (bold, italic, highlight, small note)
 * strictly AFTER HTML escaping so zero unsafe HTML can ever be injected.
 */
export function renderSafeInlineFormattingHtml(rawText: string): string {
  let escaped = escapeHtml(rawText);
  escaped = escaped.replace(/==([^=\n]+)==/g, '<mark class="bn-highlight">$1</mark>');
  escaped = escaped.replace(/\*\*([^*\n]+)\*\*/g, '<strong>$1</strong>');
  escaped = escaped.replace(/\*([^*\n]+)\*/g, '<em>$1</em>');
  escaped = escaped.replace(/~([^~\n]+)~/g, '<small class="bn-small">$1</small>');
  return escaped;
}

export interface GroupedChapter {
  chapterIndex: number;
  titleEnglish: string;
  titleBangla: string;
  chunks: TranslationChunk[];
}

export function groupChunksByChapter(chunks: TranslationChunk[]): GroupedChapter[] {
  const map = new Map<number, GroupedChapter>();
  for (const chunk of chunks) {
    let entry = map.get(chunk.chapterIndex);
    if (!entry) {
      entry = {
        chapterIndex: chunk.chapterIndex,
        titleEnglish: chunk.chapterTitle,
        titleBangla: chunk.chapterTitleBangla || `অধ্যায় ${toBengaliDigits(chunk.chapterIndex + 1)}`,
        chunks: [],
      };
      map.set(chunk.chapterIndex, entry);
    } else if (!entry.titleBangla && chunk.chapterTitleBangla) {
      entry.titleBangla = chunk.chapterTitleBangla;
    }
    entry.chunks.push(chunk);
  }
  return Array.from(map.values()).sort((a, b) => a.chapterIndex - b.chapterIndex);
}

function renderBlocksWithAssetsHtml(
  text: string,
  assetMap: Map<string, BookAsset>,
  mode: 'html' | 'epub'
): string {
  const blocks = text
    .split(/\n{2,}/)
    .map((b) => b.trim())
    .filter(Boolean);

  const htmlParts: string[] = [];

  for (const block of blocks) {
    const segments = block.split(ASSET_TOKEN_SPLIT_REGEX).filter((s) => s.trim().length > 0);
    for (const seg of segments) {
      const trimmed = seg.trim();
      const asset = assetMap.get(trimmed);
      if (asset) {
        const caption = escapeHtml(asset.captionBangla || asset.captionEnglish || asset.fileName);
        if (mode === 'epub') {
          htmlParts.push(
            `<figure class="book-figure"><img src="assets/${escapeHtml(asset.fileName)}" alt="${caption}" /><figcaption>${caption}</figcaption></figure>`
          );
        } else if (isSafeAssetDataUrl(asset.dataUrl)) {
          htmlParts.push(
            `<figure class="book-figure"><img src="${asset.dataUrl}" alt="${caption}" /><figcaption>${caption}</figcaption></figure>`
          );
        }
        continue;
      }

      // Structured semantic block rendering (big headings, quotes, lists, small notes, paragraphs)
      if (/^###\s+/.test(trimmed)) {
        htmlParts.push(`<h4 class="bn-h3">${renderSafeInlineFormattingHtml(trimmed.replace(/^###\s+/, ''))}</h4>`);
      } else if (/^##\s+/.test(trimmed)) {
        htmlParts.push(`<h3 class="bn-h2">${renderSafeInlineFormattingHtml(trimmed.replace(/^##\s+/, ''))}</h3>`);
      } else if (/^#\s+/.test(trimmed)) {
        htmlParts.push(`<h2 class="bn-h1">${renderSafeInlineFormattingHtml(trimmed.replace(/^#\s+/, ''))}</h2>`);
      } else if (/^>\s+/.test(trimmed)) {
        const quoteText = trimmed
          .split('\n')
          .map((l) => l.replace(/^>\s?/, ''))
          .join(' ');
        htmlParts.push(`<blockquote class="bn-quote">${renderSafeInlineFormattingHtml(quoteText)}</blockquote>`);
      } else if (trimmed.split('\n').every((l) => /^[-*•]\s+/.test(l.trim()))) {
        const items = trimmed
          .split('\n')
          .map((l) => `<li>${renderSafeInlineFormattingHtml(l.trim().replace(/^[-*•]\s+/, ''))}</li>`)
          .join('');
        htmlParts.push(`<ul class="bn-list">${items}</ul>`);
      } else {
        htmlParts.push(`<p>${renderSafeInlineFormattingHtml(trimmed)}</p>`);
      }
    }
  }

  return htmlParts.join('\n      ');
}

export function assembleBanglaMarkdown(project: BookProject): string {
  const chapters = groupChunksByChapter(project.chunks);
  const assetMap = new Map(project.assets.map((a) => [a.token, a]));
  const titleBn = project.titleBangla.trim() || project.title;
  const authorBn = project.authorBangla.trim() || project.author;
  const houseBn = project.publisher.publishingHouseBangla.trim() || project.publisher.publishingHouse;
  const city = project.publisher.imprintCity.trim() || 'ঢাকা';
  const rights = project.publisher.rightsStatement.trim() || `অনুবাদ স্বত্ব: ${houseBn}`;
  const yearBn = toBengaliDigits(new Date().getFullYear());

  const lines: string[] = [
    `# ${titleBn}`,
    '',
    `**মূল লেখক:** ${authorBn} (${project.author})`,
    `**বাংলা প্রকাশক:** ${houseBn}`,
    `**প্রকাশনাস্থল:** ${city}`,
    `**প্রকাশকাল:** ${yearBn}`,
    `**স্বত্ব বিবৃতি:** ${rights}`,
    '',
    '---',
    '',
  ];

  for (const ch of chapters) {
    lines.push(`## ${ch.titleBangla}`);
    lines.push('');
    for (const chunk of ch.chunks) {
      if (chunk.banglaText.trim()) {
        const replaced = chunk.banglaText.trim().replace(ASSET_TOKEN_SPLIT_REGEX, (token) => {
          const asset = assetMap.get(token);
          if (!asset) return token;
          const caption = asset.captionBangla || asset.captionEnglish || asset.fileName;
          return `![${caption}](./assets/${asset.fileName})`;
        });
        lines.push(replaced);
        lines.push('');
      }
    }
  }

  lines.push(
    '---',
    '',
    '## সমাপ্ত',
    '',
    `**গ্রন্থ:** ${titleBn} (${project.title})`,
    `**প্রকাশক:** ${houseBn} · ${city} · ${yearBn}`,
    `**স্বত্ব:** ${rights}`,
    ''
  );

  return lines.join('\n');
}

export function assemblePrintReadyHtml(
  project: BookProject,
  layoutProfile?: DeviceLayoutProfile
): string {
  const profile = LAYOUT_PROFILES[layoutProfile ?? project.publisher.defaultLayout ?? 'phone'];
  const chapters = groupChunksByChapter(project.chunks);
  const assetMap = new Map(project.assets.map((a) => [a.token, a]));
  const titleBn = escapeHtml(project.titleBangla.trim() || project.title);
  const titleEn = escapeHtml(project.title);
  const authorBn = escapeHtml(project.authorBangla.trim() || project.author);
  const houseBn = escapeHtml(
    project.publisher.publishingHouseBangla.trim() || project.publisher.publishingHouse
  );
  const houseEn = escapeHtml(project.publisher.publishingHouse);
  const city = escapeHtml(project.publisher.imprintCity.trim() || 'ঢাকা, বাংলাদেশ');
  const rights = escapeHtml(
    project.publisher.rightsStatement.trim() || `অনুবাদ স্বত্ব সংরক্ষিত: ${houseBn}`
  );
  const yearBn = toBengaliDigits(new Date().getFullYear());

  const rawTitleBn = project.titleBangla.trim() || project.title;
  const { mainTitle: mainTitleBnRaw, subtitle: subTitleBnRaw } = splitBookTitle(rawTitleBn);
  const titleFontEm = getAdaptiveTitleScaleEm(mainTitleBnRaw);
  const mainTitleBn = escapeHtml(mainTitleBnRaw);
  const subTitleBn = escapeHtml(subTitleBnRaw);
  const safeCoverUrl =
    project.coverImageDataUrl && isSafeAssetDataUrl(project.coverImageDataUrl)
      ? project.coverImageDataUrl.trim()
      : '';

  const tocHtml = chapters
    .map(
      (ch, idx) =>
        `<li><a href="#chapter-${idx + 1}"><span class="toc-num">${toBengaliDigits(idx + 1)}.</span> ${escapeHtml(stripLeadingChapterPrefix(ch.titleBangla))}</a></li>`
    )
    .join('\n        ');

  const chaptersHtml = chapters
    .map((ch, idx) => {
      const mergedText = ch.chunks
        .map((ck) => ck.banglaText.trim())
        .filter(Boolean)
        .join('\n\n');

      const bodyHtml = mergedText
        ? renderBlocksWithAssetsHtml(mergedText, assetMap, 'html')
        : '<p class="pending-note">[এই অধ্যায়টি এখনো অনূদিত হয়নি]</p>';

      const cleanChTitle = stripLeadingChapterPrefix(ch.titleBangla);
      const chTitleSize = Array.from(cleanChTitle).length > 42 ? '1.55em' : '1.82em';

      return `
    <section id="chapter-${idx + 1}" class="chapter">
      <header class="chapter-header">
        <div class="chapter-kicker">অধ্যায় ${toBengaliDigits(idx + 1)}</div>
        <h2 class="chapter-title" style="font-size: ${chTitleSize};">${escapeHtml(cleanChTitle)}</h2>
      </header>
      ${bodyHtml}
    </section>`;
    })
    .join('\n');

  return `<!doctype html>
<html lang="bn">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>${titleBn} · ${houseBn} (${escapeHtml(profile.label)})</title>
  <link rel="preconnect" href="https://fonts.googleapis.com" />
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
  <link href="https://fonts.googleapis.com/css2?family=Noto+Serif+Bengali:wght@400;500;600;700&display=swap" rel="stylesheet" />
  <style>
    @page {
      size: ${profile.pageSizeCss};
      margin: ${profile.marginCss};
      @bottom-center {
        content: counter(page, bengali);
        font-family: "Noto Serif Bengali", "Noto Sans Bengali", serif;
        font-size: 9pt;
        color: #64748b;
      }
    }
    @page :first {
      @bottom-center { content: none; }
    }
    @page cover {
      size: ${profile.pageSizeCss};
      margin: 0;
      @bottom-center { content: none; }
    }
    @page titlepage {
      @bottom-center { content: none; }
    }
    * { box-sizing: border-box; }
    body {
      font-family: "Noto Serif Bengali", "Noto Sans Bengali", "Kalpurush", "SolaimanLipi", Georgia, serif;
      color: #0f172a;
      background: #ffffff;
      max-width: ${profile.maxWidthCh};
      margin: 0 auto;
      padding: 28px 18px 56px;
      line-height: ${profile.lineHeight};
      font-size: ${profile.bodyFontSizePx}px;
      text-rendering: optimizeLegibility;
      orphans: 3;
      widows: 3;
    }
    .cover-page {
      page: cover;
      width: 100%;
      height: 100vh;
      margin: 0;
      padding: 0;
      display: flex;
      align-items: center;
      justify-content: center;
      background: #ffffff;
      break-after: page;
    }
    .cover-page img {
      width: 100%;
      height: 100%;
      object-fit: contain;
      display: block;
    }
    .title-page {
      page: titlepage;
      text-align: center;
      padding: 60px 14px 44px;
      break-after: page;
    }
    .title-page .edition-tag { font-size: 0.8em; color: #64748b; margin-bottom: 20px; }
    .title-page h1 {
      font-size: ${titleFontEm}em;
      max-width: 92%;
      margin: 0 auto 12px;
      line-height: 1.44;
      font-weight: 700;
      color: #0f172a;
      text-wrap: balance;
      overflow-wrap: break-word;
    }
    .title-page .title-bn-sub {
      font-size: 1.04em;
      font-weight: 500;
      color: #334155;
      max-width: 88%;
      margin: 0 auto 18px;
      line-height: 1.62;
      text-wrap: balance;
    }
    .title-page .subtitle {
      font-size: 0.82em;
      color: #64748b;
      max-width: 86%;
      margin: 0 auto 28px;
      line-height: 1.55;
      text-wrap: balance;
    }
    .title-page .author { font-size: 1.15em; font-weight: 600; color: #1e293b; margin-bottom: 42px; }
    .title-page .rule { width: 52px; height: 1px; background: #cbd5e1; margin: 0 auto 24px; }
    .title-page .imprint { font-size: 1.02em; font-weight: 700; color: #0f172a; max-width: 90%; margin: 0 auto; text-wrap: balance; }
    .title-page .city { font-size: 0.84em; color: #475569; margin-top: 4px; }
    .colophon {
      margin: 24px 0;
      padding: 24px 0;
      font-size: 0.84em;
      color: #334155;
      break-after: page;
    }
    .colophon h2 { font-size: 1.12em; color: #0f172a; margin: 0 0 14px; padding-bottom: 8px; border-bottom: 1px solid #e2e8f0; }
    .colophon p { margin: 0 0 8px; text-align: left; }
    .toc { margin: 20px 0 36px; break-after: page; }
    .toc h2 { font-size: 1.38em; margin: 0 0 16px; padding-bottom: 8px; border-bottom: 2px solid #e2e8f0; break-after: avoid; }
    .toc ol { list-style: none; padding: 0; margin: 0; }
    .toc li { padding: 8px 0; border-bottom: 1px solid #f1f5f9; }
    .toc a { color: #0f172a; text-decoration: none; }
    .toc-num { color: #1e3a8a; margin-right: 8px; font-weight: 700; }
    .chapter { margin-top: 24px; break-before: page; }
    .chapter-header {
      margin: 0 0 22px;
      padding-bottom: 14px;
      border-bottom: 2px solid #e2e8f0;
      break-after: avoid;
    }
    .chapter-kicker {
      display: inline-block;
      font-size: 0.98em;
      font-weight: 700;
      color: #1e3a8a;
      background: #eff6ff;
      border: 1px solid #bfdbfe;
      border-left: 3.5px solid #1d4ed8;
      padding: 4px 12px;
      border-radius: 4px;
      margin-bottom: 12px;
      break-after: avoid;
    }
    .chapter-title {
      font-size: 1.82em;
      margin: 0;
      line-height: 1.42;
      font-weight: 700;
      color: #0f172a;
      text-wrap: balance;
      break-after: avoid;
    }
    .bn-h1 { font-size: 1.4em; margin: 1.35em 0 0.55em; font-weight: 700; break-after: avoid; }
    .bn-h2 { font-size: 1.18em; margin: 1.3em 0 0.5em; font-weight: 700; color: #1e293b; break-after: avoid; }
    .bn-h3 { font-size: 1.04em; margin: 1.1em 0 0.4em; font-weight: 600; color: #334155; break-after: avoid; }
    .chapter p { margin: 0 0 1.05em; text-align: justify; hyphens: none; overflow-wrap: break-word; }
    .bn-highlight { background: #fef08a; color: #0f172a; padding: 0.04em 0.22em; border-radius: 3px; -webkit-box-decoration-break: clone; box-decoration-break: clone; }
    .bn-small { font-size: 0.82em; color: #475569; display: block; margin-top: 0.55em; line-height: 1.65; }
    .bn-quote {
      margin: 1.15em 0;
      padding: 0.8em 1em;
      background: #f8fafc;
      border: 1px solid #e2e8f0;
      border-left: 3px solid #334155;
      border-radius: 4px;
      color: #1e293b;
      break-inside: avoid;
    }
    .bn-list { margin: 0.85em 0 1.15em; padding-left: 1.4em; }
    .bn-list li { margin-bottom: 0.45em; }
    .book-figure {
      margin: 18px 0;
      padding: 10px;
      border: 1px solid #e2e8f0;
      border-radius: 6px;
      text-align: center;
      break-inside: avoid;
      background: #ffffff;
    }
    .book-figure img {
      max-width: 100%;
      height: auto;
      display: block;
      margin: 0 auto 8px;
    }
    .book-figure figcaption { font-size: 0.8em; color: #475569; line-height: 1.55; }
    .book-endmatter {
      padding: 64px 12px 32px;
      text-align: center;
      break-before: page;
    }
    .book-endmatter .end-seal {
      font-size: 1.48em;
      font-weight: 700;
      color: #0f172a;
      margin-bottom: 14px;
    }
    .book-endmatter .rule { width: 48px; height: 1px; background: #cbd5e1; margin: 0 auto 18px; }
    .book-endmatter p {
      margin: 0 0 8px;
      font-size: 0.84em;
      color: #475569;
      text-align: center;
    }
    .pending-note { color: #94a3b8; font-style: italic; }
    @media print { body { padding: 0; max-width: none; } }
  </style>
</head>
<body>
  ${safeCoverUrl ? `<section class="cover-page" aria-label="Original Book Cover"><img src="${safeCoverUrl}" alt="${titleEn}" /></section>\n  ` : ''}<header class="title-page">
    <div class="edition-tag">প্রথম বাংলা সংস্করণ · ${yearBn}</div>
    <h1>${mainTitleBn}</h1>
    ${subTitleBn ? `<div class="title-bn-sub">${subTitleBn}</div>` : ''}
    <div class="subtitle">মূল গ্রন্থ: ${titleEn}</div>
    <div class="author">${authorBn}</div>
    <div class="rule"></div>
    <div class="imprint">${houseBn}</div>
    <div class="city">${city}</div>
  </header>

  <section class="colophon">
    <h2>প্রকাশনা ও স্বত্ব পরিচিতি</h2>
    <p><strong>গ্রন্থের নাম:</strong> ${titleBn}</p>
    <p><strong>মূল গ্রন্থ:</strong> ${titleEn} (${escapeHtml(project.author)})</p>
    <p><strong>প্রকাশনা ও বঙ্গানুবাদ প্রতিষ্ঠান:</strong> ${houseBn} (${houseEn})</p>
    <p><strong>প্রকাশনাস্থল:</strong> ${city}</p>
    <p><strong>প্রথম বাংলা সংস্করণ:</strong> ${yearBn} · লেআউট: ${escapeHtml(profile.label)}</p>
    <p style="margin-top: 14px; font-weight: 600; color: #0f172a;">${rights}</p>
  </section>

  <nav class="toc">
    <h2>সূচিপত্র</h2>
    <ol>
        ${tocHtml}
    </ol>
  </nav>

  <main>
    ${chaptersHtml}
  </main>

  <footer class="book-endmatter">
    <div class="end-seal">সমাপ্ত</div>
    <div class="rule"></div>
    <p><strong>${titleBn}</strong> · ${authorBn}</p>
    <p>মোট অধ্যায়: ${toBengaliDigits(chapters.length)}টি · সংরক্ষিত মূল চিত্র ও গ্রাফ: ${toBengaliDigits(project.assets.length)}টি</p>
    <p>প্রকাশনা প্রতিষ্ঠান: ${houseBn} · ${city} · ${yearBn}</p>
    <p>${rights}</p>
  </footer>
</body>
</html>`;
}

export interface EpubFileEntry {
  path: string;
  content: string;
  base64?: boolean;
  compress?: boolean;
}

/**
 * Generates all valid EPUB 3.0 container files (mimetype, container.xml, OPF, Nav, Colophon, Chapters,
 * rich Bangla typography CSS, and untouched original book images/graphs under OEBPS/assets/).
 */
export function buildEpubFileEntries(project: BookProject): EpubFileEntry[] {
  const chapters = groupChunksByChapter(project.chunks);
  const assetMap = new Map(project.assets.map((a) => [a.token, a]));
  const titleBn = escapeHtml(project.titleBangla.trim() || project.title);
  const authorBn = escapeHtml(project.authorBangla.trim() || project.author);
  const houseBn = escapeHtml(
    project.publisher.publishingHouseBangla.trim() || project.publisher.publishingHouse
  );
  const rights = escapeHtml(
    project.publisher.rightsStatement.trim() || `অনুবাদ স্বত্ব: ${houseBn}`
  );
  const city = escapeHtml(project.publisher.imprintCity.trim() || 'ঢাকা');
  const bookId = `urn:uuid:lipiforge-${project.id}`;
  const modified = new Date().toISOString().replace(/\.\d{3}Z$/, 'Z');

  const entries: EpubFileEntry[] = [
    { path: 'mimetype', content: 'application/epub+zip', compress: false },
    {
      path: 'META-INF/container.xml',
      content: `<?xml version="1.0" encoding="UTF-8"?>
<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">
  <rootfiles>
    <rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/>
  </rootfiles>
</container>`,
    },
    {
      path: 'OEBPS/styles.css',
      content: `body { font-family: "Noto Serif Bengali", serif; line-height: 1.88; color: #0f172a; margin: 1.2em; }
h1, h2, h3, h4 { line-height: 1.38; page-break-after: avoid; }
.bn-h2 { font-size: 1.2em; margin: 1.3em 0 0.5em; font-weight: 700; }
.bn-h3 { font-size: 1.05em; margin: 1.1em 0 0.4em; font-weight: 600; }
p { margin: 0 0 1em; text-align: justify; }
.bn-highlight { background: #fef08a; padding: 0.05em 0.25em; }
.bn-small { font-size: 0.84em; color: #475569; }
.bn-quote { margin: 1.2em 0; padding: 0.8em 1em; background: #f8fafc; border: 1px solid #e2e8f0; font-style: italic; page-break-inside: avoid; }
.bn-list { margin: 0.8em 0 1.2em; padding-left: 1.4em; }
.book-figure { margin: 1.5em 0; text-align: center; page-break-inside: avoid; }
.book-figure img { max-width: 100%; height: auto; }
.book-figure figcaption { font-size: 0.85em; color: #475569; margin-top: 0.5em; }
.colophon { border-top: 1px solid #cbd5e1; padding-top: 1em; font-size: 0.9em; color: #334155; }`,
    },
    {
      path: 'OEBPS/colophon.xhtml',
      content: `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE html>
<html xmlns="http://www.w3.org/1999/xhtml" xml:lang="bn" lang="bn">
<head>
  <title>${titleBn}</title>
  <link rel="stylesheet" type="text/css" href="styles.css"/>
</head>
<body>
  <h1>${titleBn}</h1>
  <p><strong>লেখক:</strong> ${authorBn}</p>
  <div class="colophon">
    <p><strong>প্রকাশনা প্রতিষ্ঠান:</strong> ${houseBn}</p>
    <p><strong>স্থান:</strong> ${city}</p>
    <p><strong>স্বত্ব:</strong> ${rights}</p>
  </div>
</body>
</html>`,
    },
  ];

  const manifestItems: string[] = [
    `<item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/>`,
    `<item id="css" href="styles.css" media-type="text/css"/>`,
    `<item id="colophon" href="colophon.xhtml" media-type="application/xhtml+xml"/>`,
  ];

  const spineItems: string[] = [];
  const navLinks: string[] = [];

  if (project.coverImageDataUrl && isSafeAssetDataUrl(project.coverImageDataUrl)) {
    const coverMatch = project.coverImageDataUrl
      .trim()
      .match(/^data:(image\/(?:png|jpeg|jpg|webp|gif|svg\+xml));base64,(.+)$/i);
    if (coverMatch) {
      const coverMime = coverMatch[1].toLowerCase() === 'image/jpg' ? 'image/jpeg' : coverMatch[1].toLowerCase();
      const fallbackExt =
        coverMime === 'image/jpeg' ? '.jpg' : coverMime === 'image/svg+xml' ? '.svg' : `.${coverMime.split('/')[1] || 'png'}`;
      const rawCoverName = (project.coverFileName || `cover${fallbackExt}`).replace(/[^a-zA-Z0-9._-]/g, '_');
      const coverFileName = rawCoverName || `cover${fallbackExt}`;
      entries.push({
        path: `OEBPS/assets/${coverFileName}`,
        content: coverMatch[2].replace(/\s+/g, ''),
        base64: true,
      });
      entries.push({
        path: 'OEBPS/cover.xhtml',
        content: `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE html>
<html xmlns="http://www.w3.org/1999/xhtml" xml:lang="bn" lang="bn">
<head>
  <title>${titleBn}</title>
  <style>html, body { margin: 0; padding: 0; height: 100%; background: #ffffff; } .cover-wrap { width: 100%; height: 100%; text-align: center; } .cover-wrap img { max-width: 100%; max-height: 100%; object-fit: contain; }</style>
</head>
<body>
  <div class="cover-wrap"><img src="assets/${escapeHtml(coverFileName)}" alt="${titleBn}"/></div>
</body>
</html>`,
      });
      manifestItems.unshift(
        `<item id="cover-image" href="assets/${escapeHtml(coverFileName)}" media-type="${coverMime}" properties="cover-image"/>`,
        `<item id="cover" href="cover.xhtml" media-type="application/xhtml+xml"/>`
      );
      spineItems.push(`<itemref idref="cover"/>`);
      navLinks.push(`<li><a href="cover.xhtml">মূল প্রচ্ছদ (Original Cover)</a></li>`);
    }
  }

  project.assets.forEach((asset, idx) => {
    if (!isSafeAssetDataUrl(asset.dataUrl)) return;
    const base64Body = asset.dataUrl.split(',')[1] ?? '';
    if (!base64Body) return;
    entries.push({
      path: `OEBPS/assets/${asset.fileName}`,
      content: base64Body,
      base64: true,
    });
    manifestItems.push(
      `<item id="asset-${idx + 1}" href="assets/${escapeHtml(asset.fileName)}" media-type="${escapeHtml(asset.mimeType)}"/>`
    );
  });

  spineItems.push(`<itemref idref="colophon"/>`);
  navLinks.push(`<li><a href="colophon.xhtml">স্বত্ব ও প্রকাশনা পরিচিতি</a></li>`);

  chapters.forEach((ch, idx) => {
    const fileId = `chapter-${idx + 1}`;
    const fileName = `${fileId}.xhtml`;
    manifestItems.push(`<item id="${fileId}" href="${fileName}" media-type="application/xhtml+xml"/>`);
    spineItems.push(`<itemref idref="${fileId}"/>`);
    navLinks.push(`<li><a href="${fileName}">${escapeHtml(ch.titleBangla)}</a></li>`);

    const mergedText = ch.chunks
      .map((ck) => ck.banglaText.trim())
      .filter(Boolean)
      .join('\n\n');

    const bodyHtml = mergedText
      ? renderBlocksWithAssetsHtml(mergedText, assetMap, 'epub')
      : '    <p>[অনুবাদ অপেক্ষমাণ]</p>';

    entries.push({
      path: `OEBPS/${fileName}`,
      content: `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE html>
<html xmlns="http://www.w3.org/1999/xhtml" xml:lang="bn" lang="bn">
<head>
  <title>${escapeHtml(ch.titleBangla)}</title>
  <link rel="stylesheet" type="text/css" href="styles.css"/>
</head>
<body>
  <h2>${escapeHtml(ch.titleBangla)}</h2>
  ${bodyHtml}
</body>
</html>`,
    });
  });

  manifestItems.push(`<item id="endmatter" href="endmatter.xhtml" media-type="application/xhtml+xml"/>`);
  spineItems.push(`<itemref idref="endmatter"/>`);
  navLinks.push(`<li><a href="endmatter.xhtml">সমাপ্ত ও প্রকাশনা তথ্য</a></li>`);

  entries.push({
    path: 'OEBPS/endmatter.xhtml',
    content: `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE html>
<html xmlns="http://www.w3.org/1999/xhtml" xml:lang="bn" lang="bn">
<head>
  <title>সমাপ্ত · ${titleBn}</title>
  <link rel="stylesheet" type="text/css" href="styles.css"/>
</head>
<body>
  <div class="colophon" style="text-align:center; margin-top: 2em;">
    <h2>সমাপ্ত</h2>
    <p><strong>${titleBn}</strong></p>
    <p>লেখক: ${authorBn}</p>
    <p>প্রকাশনা প্রতিষ্ঠান: ${houseBn} · ${city}</p>
    <p>${rights}</p>
  </div>
</body>
</html>`,
  });

  entries.push({
    path: 'OEBPS/nav.xhtml',
    content: `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE html>
<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops" xml:lang="bn" lang="bn">
<head>
  <title>সূচিপত্র</title>
  <link rel="stylesheet" type="text/css" href="styles.css"/>
</head>
<body>
  <nav epub:type="toc" id="toc">
    <h1>সূচিপত্র</h1>
    <ol>
      ${navLinks.join('\n      ')}
    </ol>
  </nav>
</body>
</html>`,
  });

  entries.push({
    path: 'OEBPS/content.opf',
    content: `<?xml version="1.0" encoding="UTF-8"?>
<package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="BookId" xml:lang="bn">
  <metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
    <dc:identifier id="BookId">${bookId}</dc:identifier>
    <dc:title>${titleBn}</dc:title>
    <dc:creator>${authorBn}</dc:creator>
    <dc:publisher>${houseBn}</dc:publisher>
    <dc:rights>${rights}</dc:rights>
    <dc:language>bn</dc:language>
    <meta property="dcterms:modified">${modified}</meta>
  </metadata>
  <manifest>
    ${manifestItems.join('\n    ')}
  </manifest>
  <spine>
    ${spineItems.join('\n    ')}
  </spine>
</package>`,
  });

  return entries;
}
