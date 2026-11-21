import path from 'node:path';
import JSZip from 'jszip';
import type { BookAsset } from '../types/translator';

export type SupportedBookFormat =
  | 'pdf'
  | 'epub'
  | 'docx'
  | 'odt'
  | 'fb2'
  | 'rtf'
  | 'html'
  | 'tex'
  | 'md'
  | 'txt';

export const NATIVE_BOOK_EXTENSIONS = new Set([
  '.pdf',
  '.epub',
  '.docx',
  '.odt',
  '.fb2',
  '.rtf',
  '.html',
  '.htm',
  '.xhtml',
  '.md',
  '.markdown',
  '.tex',
  '.txt',
]);

export const CALIBRE_BRIDGE_EXTENSIONS = new Set([
  '.mobi',
  '.azw',
  '.azw3',
  '.kfx',
  '.djvu',
  '.lit',
  '.pdb',
  '.doc',
]);

const MIME_BY_EXT: Record<string, string> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
  '.svg': 'image/svg+xml',
};

const MAX_ARCHIVE_ENTRIES = 600;
const MAX_ARCHIVE_UNCOMPRESSED_BYTES = 60 * 1024 * 1024;
const MAX_ASSETS = 80;

export function decodeHtmlEntities(input: string): string {
  return input
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&#(\d+);/g, (_m, code) => {
      const n = Number(code);
      return Number.isFinite(n) ? String.fromCodePoint(n) : '';
    });
}

/**
 * Repairs common real-world PDF/OCR extraction artifacts:
 * - soft/replacement-char line-wrap hyphens (e.g. "bumper-to\uFFFDbumper", "at-\ntacked")
 * - stray Unicode replacement glyphs (\uFFFD) and trailing spaces
 * - preserves chapter headings, numbered items, and paragraph breaks
 */
export function cleanExtractedPdfText(raw: string): string {
  return raw
    .replace(/\r\n/g, '\n')
    .replace(/([a-zA-Z]{2,})-(?:\s*\n\s*|[ \t]+)([a-z]{2,})/g, '$1$2')
    .replace(/([a-zA-Z])\uFFFD([a-zA-Z])/g, '$1-$2')
    .replace(/\uFFFD+/g, '')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

export function htmlToStructuredText(html: string): string {
  return decodeHtmlEntities(
    html
      .replace(/<script[\s\S]*?<\/script>/gi, '')
      .replace(/<style[\s\S]*?<\/style>/gi, '')
      .replace(/<head[\s\S]*?<\/head>/gi, '')
      .replace(/<h1[^>]*>([\s\S]*?)<\/h1>/gi, '\n\n# $1\n\n')
      .replace(/<h2[^>]*>([\s\S]*?)<\/h2>/gi, '\n\n## $1\n\n')
      .replace(/<h3[^>]*>([\s\S]*?)<\/h3>/gi, '\n\n### $1\n\n')
      .replace(/<(?:strong|b)\b[^>]*>([\s\S]*?)<\/(?:strong|b)>/gi, '**$1**')
      .replace(/<(?:em|i)\b[^>]*>([\s\S]*?)<\/(?:em|i)>/gi, '*$1*')
      .replace(/<mark\b[^>]*>([\s\S]*?)<\/mark>/gi, '==$1==')
      .replace(/<small\b[^>]*>([\s\S]*?)<\/small>/gi, '~$1~')
      .replace(/<blockquote\b[^>]*>([\s\S]*?)<\/blockquote>/gi, (_m, inner: string) => {
        const clean = inner.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
        return clean ? `\n\n> ${clean}\n\n` : '';
      })
      .replace(/<li\b[^>]*>([\s\S]*?)<\/li>/gi, (_m, inner: string) => {
        const clean = inner.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
        return clean ? `\n- ${clean}` : '';
      })
      .replace(/<\/(p|div|h4|h5|h6|ul|ol|tr|figure|section)>/gi, '\n\n')
      .replace(/<br\s*\/?>/gi, '\n')
      .replace(/<[^>]+>/g, ' ')
  )
    .replace(/\*\*\s+\*\*/g, ' ')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n[ \t]+/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/**
 * Parses HTML/XHTML books (e.g. Project Gutenberg HTML editions) while lifting
 * embedded data-URI images/graphs into untouched BookAsset anchors.
 */
export function parseHtmlBook(rawHtml: string): { text: string; assets: BookAsset[] } {
  const assets: BookAsset[] = [];
  let imgCounter = 0;

  const htmlWithTokens = rawHtml.replace(
    /<img\b[^>]*src=["'](data:image\/([^;"']+);base64,([^"']+))["'][^>]*>/gi,
    (_match, dataUrl: string, subtype: string) => {
      if (assets.length >= MAX_ASSETS) return '';
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

  return {
    text: htmlToStructuredText(htmlWithTokens),
    assets,
  };
}

/**
 * Parses FictionBook (.fb2) XML e-books — extracts structured sections/chapters
 * AND all embedded <binary> base64 images/graphs verbatim.
 */
export function parseFb2Book(xml: string): { text: string; assets: BookAsset[] } {
  const assets: BookAsset[] = [];
  const binaryLookup = new Map<string, { mimeType: string; base64: string; fileName: string }>();

  const binaryRegex = /<binary\b([^>]*)>([\s\S]*?)<\/binary>/gi;
  let bMatch: RegExpExecArray | null;
  while ((bMatch = binaryRegex.exec(xml)) !== null) {
    const attrs = bMatch[1] ?? '';
    const idMatch = attrs.match(/id=["']([^"']+)["']/i);
    const typeMatch = attrs.match(/content-type=["']([^"']+)["']/i);
    if (!idMatch) continue;
    const rawId = idMatch[1].trim();
    const mimeType = (typeMatch?.[1] ?? 'image/jpeg').trim().toLowerCase();
    if (!mimeType.startsWith('image/')) continue;
    const base64 = bMatch[2].replace(/\s+/g, '');
    if (!base64 || base64.length > 5_000_000) continue;
    binaryLookup.set(rawId, {
      mimeType,
      base64,
      fileName: rawId.replace(/[^a-zA-Z0-9._-]/g, '_'),
    });
  }

  // Focus on <body> content so <description> metadata doesn't clutter chapters
  const bodyMatches = xml.match(/<body\b[^>]*>[\s\S]*?<\/body>/gi);
  let bodyContent = bodyMatches ? bodyMatches.join('\n\n') : xml;

  let imgCounter = 0;
  bodyContent = bodyContent.replace(
    /<image\b[^>]*href=["']#?([^"']+)["'][^>]*\/?>/gi,
    (_match, refId: string) => {
      const found = binaryLookup.get(refId.trim());
      if (!found || assets.length >= MAX_ASSETS) return '';
      imgCounter += 1;
      const id = `fig-${String(imgCounter).padStart(2, '0')}`;
      const token = `[[ASSET:${id}]]`;
      assets.push({
        id,
        token,
        kind: found.mimeType.includes('svg') ? 'graph' : 'image',
        mimeType: found.mimeType,
        dataUrl: `data:${found.mimeType};base64,${found.base64}`,
        fileName: `${id}-${found.fileName}`,
        captionEnglish: `Figure ${imgCounter}`,
        captionBangla: `চিত্র ${imgCounter}`,
      });
      return `\n\n${token}\n\n`;
    }
  );

  // Convert FB2 <title> inside <section> into Markdown chapter headings
  bodyContent = bodyContent
    .replace(/<title>([\s\S]*?)<\/title>/gi, (_m, inner: string) => {
      const cleanTitle = decodeHtmlEntities(inner.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim());
      return cleanTitle ? `\n\n# ${cleanTitle}\n\n` : '';
    })
    .replace(/<subtitle>([\s\S]*?)<\/subtitle>/gi, (_m, inner: string) => {
      const cleanSub = decodeHtmlEntities(inner.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim());
      return cleanSub ? `\n\n## ${cleanSub}\n\n` : '';
    });

  return {
    text: htmlToStructuredText(bodyContent),
    assets,
  };
}

/**
 * Pure TypeScript RTF book parser: strips font/color/stylesheet groups,
 * decodes Unicode (\uN) and hex (\'xx) escapes, and preserves paragraph breaks.
 */
export function parseRtfBook(rtf: string): string {
  let cleaned = rtf
    .replace(/\{\\\*(?:[^{}]|\{[^{}]*\})*\}/g, ' ')
    .replace(/\{\\(?:fonttbl|colortbl|stylesheet|info|pict|header|footer)(?:[^{}]|\{[^{}]*\})*\}/gi, ' ');

  // Decode Unicode \uNNNN? escapes
  cleaned = cleaned.replace(/\\u(-?\d+)\??/g, (_m, numStr: string) => {
    let code = Number(numStr);
    if (code < 0) code += 65536;
    return Number.isFinite(code) ? String.fromCharCode(code) : '';
  });

  // Decode Windows-1252 hex escapes \'xx
  cleaned = cleaned.replace(/\\'([0-9a-fA-F]{2})/g, (_m, hex: string) =>
    String.fromCharCode(parseInt(hex, 16))
  );

  cleaned = cleaned
    .replace(/\\(?:par|line)\b/gi, '\n\n')
    .replace(/\\tab\b/gi, ' ')
    .replace(/\\~|\\_/g, ' ')
    .replace(/\\([{}])/g, '$1')
    .replace(/\\[a-zA-Z]+-?\d* ?/g, '')
    .replace(/[{}]/g, '')
    .replace(/\r\n/g, '\n')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();

  return cleaned;
}

/**
 * Pure TypeScript LaTeX (.tex) book parser: preserves \chapter, \section,
 * \subsection structure as Markdown headings and removes macro noise.
 */
export function parseLatexBook(tex: string): string {
  const withoutComments = tex.replace(/(^|[^\\])%.*$/gm, '$1');
  const bodyMatch = withoutComments.match(/\\begin\{document\}([\s\S]*?)\\end\{document\}/i);
  const body = bodyMatch ? bodyMatch[1] : withoutComments;

  return body
    .replace(/\\chapter\*?\{([^}]+)\}/g, '\n\n# $1\n\n')
    .replace(/\\section\*?\{([^}]+)\}/g, '\n\n## $1\n\n')
    .replace(/\\subsection\*?\{([^}]+)\}/g, '\n\n### $1\n\n')
    .replace(/\\(?:textbf|textit|emph|underline)\{([^}]+)\}/g, '$1')
    .replace(/\\begin\{(?:itemize|enumerate|quote|quotation)\}/g, '\n\n')
    .replace(/\\end\{(?:itemize|enumerate|quote|quotation)\}/g, '\n\n')
    .replace(/\\item\s+/g, '\n- ')
    .replace(/\\[a-zA-Z]+\*?(?:\[[^\]]*\])?(?:\{[^}]*\})?/g, ' ')
    .replace(/[{}]/g, '')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/**
 * Resolves exact author reading order from an EPUB's OPF <manifest> + <spine>.
 * Falls back cleanly to natural numeric sort when OPF is missing.
 */
export function resolveEpubSpineOrder(
  allEntryNames: string[],
  opfXml: string | null,
  opfDir: string
): string[] {
  const htmlFiles = allEntryNames.filter((n) => /\.(xhtml|html|htm)$/i.test(n));
  if (!opfXml) {
    return htmlFiles.sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
  }

  const idToHref = new Map<string, string>();
  const itemRegex = /<item\b([^>]+)\/?>/gi;
  let match: RegExpExecArray | null;
  while ((match = itemRegex.exec(opfXml)) !== null) {
    const attrs = match[1];
    const idM = attrs.match(/id=["']([^"']+)["']/i);
    const hrefM = attrs.match(/href=["']([^"']+)["']/i);
    if (idM && hrefM) {
      const normalizedPath = path.posix
        .normalize(opfDir ? `${opfDir}/${hrefM[1]}` : hrefM[1])
        .replace(/^\.\//, '');
      idToHref.set(idM[1], normalizedPath);
    }
  }

  const ordered: string[] = [];
  const seen = new Set<string>();
  const spineRegex = /<itemref\b[^>]*idref=["']([^"']+)["'][^>]*\/?>/gi;
  while ((match = spineRegex.exec(opfXml)) !== null) {
    const href = idToHref.get(match[1]);
    if (href && allEntryNames.includes(href) && !seen.has(href)) {
      ordered.push(href);
      seen.add(href);
    }
  }

  if (ordered.length > 0) {
    return ordered;
  }
  return htmlFiles.sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
}

/**
 * Full-book EPUB parser using exact OPF <spine> reading order and
 * lossless embedded image/graph/SVG extraction.
 */
export async function parseEpubBuffer(
  buffer: Buffer
): Promise<{ text: string; assets: BookAsset[] }> {
  const zip = await JSZip.loadAsync(buffer);
  const entryNames = Object.keys(zip.files).filter((n) => !zip.files[n].dir);

  if (entryNames.length > MAX_ARCHIVE_ENTRIES) {
    throw new Error('EPUB archive exceeds maximum allowed entry count.');
  }

  // Locate OPF via META-INF/container.xml
  let opfPath: string | null = null;
  const containerFile = zip.files['META-INF/container.xml'];
  if (containerFile) {
    const containerXml = await containerFile.async('string');
    const rootfileMatch = containerXml.match(/full-path=["']([^"']+)["']/i);
    if (rootfileMatch && zip.files[rootfileMatch[1]]) {
      opfPath = rootfileMatch[1];
    }
  }
  if (!opfPath) {
    opfPath = entryNames.find((n) => /\.opf$/i.test(n)) ?? null;
  }

  const opfXml = opfPath && zip.files[opfPath] ? await zip.files[opfPath].async('string') : null;
  const opfDir = opfPath ? path.posix.dirname(opfPath).replace(/^\.$/, '') : '';
  const orderedHtmlEntries = resolveEpubSpineOrder(entryNames, opfXml, opfDir);

  // Build image lookup map across all EPUB media folders
  const imageMap = new Map<string, { mimeType: string; dataUrl: string; fileName: string }>();
  for (const name of entryNames) {
    const imgExt = path.extname(name).toLowerCase();
    const mimeType = MIME_BY_EXT[imgExt];
    if (!mimeType || imageMap.size >= MAX_ASSETS) continue;
    const b64 = await zip.files[name].async('base64');
    if (b64.length > 5_000_000) continue;
    const baseName = path.basename(name);
    imageMap.set(baseName.toLowerCase(), {
      mimeType,
      dataUrl: `data:${mimeType};base64,${b64}`,
      fileName: baseName,
    });
  }

  const assets: BookAsset[] = [];
  const sections: string[] = [];
  let totalBytes = 0;
  let imgCounter = 0;

  for (const name of orderedHtmlEntries) {
    const file = zip.files[name];
    if (!file) continue;
    const content = await file.async('string');
    totalBytes += Buffer.byteLength(content, 'utf8');
    if (totalBytes > MAX_ARCHIVE_UNCOMPRESSED_BYTES) {
      throw new Error('EPUB uncompressed content exceeds safety size limit.');
    }

    const contentWithTokens = content.replace(
      /<(?:img|image)\b[^>]*(?:src|href)=["']([^"']+)["'][^>]*\/?>/gi,
      (_match, src: string) => {
        const base = path.basename(src.split('?')[0]).toLowerCase();
        const found = imageMap.get(base);
        if (!found || assets.length >= MAX_ASSETS) return '';
        imgCounter += 1;
        const id = `fig-${String(imgCounter).padStart(2, '0')}`;
        const token = `[[ASSET:${id}]]`;
        assets.push({
          id,
          token,
          kind: found.mimeType === 'image/svg+xml' ? 'graph' : 'image',
          mimeType: found.mimeType,
          dataUrl: found.dataUrl,
          fileName: `${id}-${found.fileName.replace(/[^a-zA-Z0-9._-]/g, '_')}`,
          captionEnglish: `Figure ${imgCounter}`,
          captionBangla: `চিত্র ${imgCounter}`,
        });
        return `\n\n${token}\n\n`;
      }
    );

    const cleaned = htmlToStructuredText(contentWithTokens);
    if (cleaned.length > 20) {
      sections.push(cleaned);
    }
  }

  return { text: sections.join('\n\n'), assets };
}

/**
 * Parses OpenDocument Text (.odt) books — extracts content.xml paragraphs/headings
 * AND all embedded Pictures/* graphs & illustrations untouched.
 */
export async function parseOdtBuffer(
  buffer: Buffer
): Promise<{ text: string; assets: BookAsset[] }> {
  const zip = await JSZip.loadAsync(buffer);
  const entryNames = Object.keys(zip.files).filter((n) => !zip.files[n].dir);

  if (entryNames.length > MAX_ARCHIVE_ENTRIES) {
    throw new Error('ODT archive exceeds maximum allowed entry count.');
  }

  const contentFile = zip.files['content.xml'];
  if (!contentFile) {
    throw new Error('Invalid ODT file: missing content.xml.');
  }

  const contentXml = await contentFile.async('string');
  if (Buffer.byteLength(contentXml, 'utf8') > MAX_ARCHIVE_UNCOMPRESSED_BYTES) {
    throw new Error('ODT content exceeds safety size limit.');
  }

  const imageMap = new Map<string, { mimeType: string; dataUrl: string; fileName: string }>();
  for (const name of entryNames) {
    if (!name.startsWith('Pictures/')) continue;
    const ext = path.extname(name).toLowerCase();
    const mimeType = MIME_BY_EXT[ext];
    if (!mimeType || imageMap.size >= MAX_ASSETS) continue;
    const b64 = await zip.files[name].async('base64');
    if (b64.length > 5_000_000) continue;
    imageMap.set(name, {
      mimeType,
      dataUrl: `data:${mimeType};base64,${b64}`,
      fileName: path.basename(name),
    });
  }

  const assets: BookAsset[] = [];
  let imgCounter = 0;

  const xmlWithTokens = contentXml
    .replace(/<draw:image\b[^>]*xlink:href=["']([^"']+)["'][^>]*\/?>/gi, (_m, href: string) => {
      const found = imageMap.get(href);
      if (!found || assets.length >= MAX_ASSETS) return '';
      imgCounter += 1;
      const id = `fig-${String(imgCounter).padStart(2, '0')}`;
      const token = `[[ASSET:${id}]]`;
      assets.push({
        id,
        token,
        kind: found.mimeType === 'image/svg+xml' ? 'graph' : 'image',
        mimeType: found.mimeType,
        dataUrl: found.dataUrl,
        fileName: `${id}-${found.fileName.replace(/[^a-zA-Z0-9._-]/g, '_')}`,
        captionEnglish: `Figure ${imgCounter}`,
        captionBangla: `চিত্র ${imgCounter}`,
      });
      return `\n\n${token}\n\n`;
    })
    .replace(/<text:h\b[^>]*>([\s\S]*?)<\/text:h>/gi, '\n\n# $1\n\n')
    .replace(/<\/text:p>/gi, '\n\n');

  return {
    text: htmlToStructuredText(xmlWithTokens),
    assets,
  };
}
