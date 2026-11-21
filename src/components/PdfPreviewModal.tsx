import { Fragment, useState } from 'react';
import {
  BookDown,
  Download,
  FileText,
  Monitor,
  Printer,
  Smartphone,
  Tablet,
  X,
} from 'lucide-react';
import type {
  BookAsset,
  BookProject,
  DeviceLayoutProfile,
} from '../types/translator';
import {
  LAYOUT_PROFILES,
  groupChunksByChapter,
  toBengaliDigits,
} from '../lib/exporters';
import {
  downloadBanglaEpub,
  downloadBanglaMarkdown,
  downloadBanglaPrintHtml,
  downloadRealBanglaPdf,
} from '../utils/downloads';

interface PdfPreviewModalProps {
  project: BookProject;
  isOpen: boolean;
  onClose: () => void;
  onSelectDefaultLayout?: (profile: DeviceLayoutProfile) => void;
}

const ASSET_SPLIT_REGEX = /(\[\[ASSET:[a-zA-Z0-9_-]+\]\])/g;
const INLINE_TOKEN_REGEX = /(==[^=\n]+==|\*\*[^*\n]+\*\*|\*[^*\n]+\*|~[^~\n]+~)/g;

function renderInlineBanglaReact(text: string) {
  const parts = text.split(INLINE_TOKEN_REGEX);
  return parts.map((part, idx) => {
    if (part.startsWith('==') && part.endsWith('==') && part.length > 4) {
      return (
        <mark
          key={idx}
          className="bg-amber-200/80 text-slate-900 px-1 py-0.5 rounded-xs"
        >
          {part.slice(2, -2)}
        </mark>
      );
    }
    if (part.startsWith('**') && part.endsWith('**') && part.length > 4) {
      return (
        <strong key={idx} className="font-bold text-slate-950">
          {part.slice(2, -2)}
        </strong>
      );
    }
    if (part.startsWith('*') && part.endsWith('*') && part.length > 2) {
      return (
        <em key={idx} className="italic">
          {part.slice(1, -1)}
        </em>
      );
    }
    if (part.startsWith('~') && part.endsWith('~') && part.length > 2) {
      return (
        <small key={idx} className="block mt-2 text-[0.82em] text-slate-500 leading-relaxed">
          {part.slice(1, -1)}
        </small>
      );
    }
    return <Fragment key={idx}>{part}</Fragment>;
  });
}

function renderBanglaBodyWithAssets(text: string, assets: BookAsset[]) {
  const assetMap = new Map(assets.map((a) => [a.token, a]));
  const paragraphs = text
    .split(/\n{2,}/)
    .map((p) => p.trim())
    .filter(Boolean);

  return paragraphs.map((para, pIdx) => {
    const pieces = para.split(ASSET_SPLIT_REGEX).filter((s) => s.trim().length > 0);
    return pieces.map((piece, sIdx) => {
      const trimmed = piece.trim();
      const asset = assetMap.get(trimmed);
      if (asset) {
        return (
          <figure
            key={`${pIdx}-${sIdx}`}
            className="my-5 p-3.5 border border-slate-200 rounded-md bg-white text-center break-inside-avoid"
          >
            <img
              src={asset.dataUrl}
              alt={asset.captionBangla || asset.captionEnglish}
              referrerPolicy="no-referrer"
              className="max-h-56 mx-auto object-contain"
            />
            <figcaption className="text-[0.82em] text-slate-600 mt-2 font-bangla">
              {asset.captionBangla || asset.captionEnglish}
            </figcaption>
          </figure>
        );
      }

      if (/^###\s+/.test(trimmed)) {
        return (
          <h4
            key={`${pIdx}-${sIdx}`}
            className="text-[1.06em] font-semibold text-slate-800 mt-5 mb-2 break-after-avoid"
          >
            {renderInlineBanglaReact(trimmed.replace(/^###\s+/, ''))}
          </h4>
        );
      }

      if (/^##\s+/.test(trimmed)) {
        return (
          <h3
            key={`${pIdx}-${sIdx}`}
            className="text-[1.22em] font-bold text-slate-900 mt-6 mb-2.5 break-after-avoid"
          >
            {renderInlineBanglaReact(trimmed.replace(/^##\s+/, ''))}
          </h3>
        );
      }

      if (/^>\s+/.test(trimmed)) {
        const quote = trimmed
          .split('\n')
          .map((l) => l.replace(/^>\s?/, ''))
          .join(' ');
        return (
          <blockquote
            key={`${pIdx}-${sIdx}`}
            className="my-5 px-4 py-3 bg-slate-50 border border-slate-200 rounded-md italic text-slate-800 break-inside-avoid"
          >
            {renderInlineBanglaReact(quote)}
          </blockquote>
        );
      }

      if (trimmed.split('\n').every((l) => /^[-*•]\s+/.test(l.trim()))) {
        return (
          <ul key={`${pIdx}-${sIdx}`} className="my-4 pl-5 list-disc space-y-1.5">
            {trimmed.split('\n').map((line, lIdx) => (
              <li key={lIdx}>{renderInlineBanglaReact(line.trim().replace(/^[-*•]\s+/, ''))}</li>
            ))}
          </ul>
        );
      }

      return (
        <p key={`${pIdx}-${sIdx}`} className="mb-4 text-justify">
          {renderInlineBanglaReact(trimmed)}
        </p>
      );
    });
  });
}

const PROFILE_BUTTONS: Array<{
  id: DeviceLayoutProfile;
  label: string;
  icon: typeof Smartphone;
}> = [
  { id: 'phone', label: 'Phone (6")', icon: Smartphone },
  { id: 'tablet', label: 'Tablet', icon: Tablet },
  { id: 'print_a5', label: 'Print A5', icon: Printer },
  { id: 'desktop', label: 'Desktop PC', icon: Monitor },
];

export function PdfPreviewModal({
  project,
  isOpen,
  onClose,
  onSelectDefaultLayout,
}: PdfPreviewModalProps) {
  const [isExportingPdf, setIsExportingPdf] = useState(false);
  const [isExportingEpub, setIsExportingEpub] = useState(false);
  const [activeProfile, setActiveProfile] = useState<DeviceLayoutProfile>(
    project.publisher.defaultLayout ?? 'phone'
  );

  if (!isOpen) return null;

  const spec = LAYOUT_PROFILES[activeProfile];
  const chapters = groupChunksByChapter(project.chunks);
  const yearBn = toBengaliDigits(new Date().getFullYear());
  const houseBn =
    project.publisher.publishingHouseBangla || project.publisher.publishingHouse;

  const handleSelectProfile = (profile: DeviceLayoutProfile) => {
    setActiveProfile(profile);
    onSelectDefaultLayout?.(profile);
  };

  const handleDownloadRealPdf = async () => {
    setIsExportingPdf(true);
    try {
      const ok = await downloadRealBanglaPdf(project, activeProfile);
      if (!ok) {
        window.print();
      }
    } catch {
      window.print();
    } finally {
      setIsExportingPdf(false);
    }
  };

  const handleDownloadEpub = async () => {
    setIsExportingEpub(true);
    try {
      await downloadBanglaEpub(project);
    } finally {
      setIsExportingEpub(false);
    }
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="pdf-preview-title"
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 p-4 print:static print:bg-white print:p-0"
    >
      <div className="w-full max-w-4xl max-h-[92vh] bg-white rounded-xl border border-slate-200 shadow-xl flex flex-col overflow-hidden print:max-w-none print:max-h-none print:border-0 print:shadow-none">
        {/* Modal Toolbar (hidden when printing to PDF) */}
        <div className="px-5 py-4 border-b border-slate-200 bg-slate-50 space-y-3 print:hidden">
          <div className="flex items-start justify-between gap-4">
            <div className="min-w-0">
              <h2 id="pdf-preview-title" className="text-sm font-semibold text-slate-900">
                Production Bangla Book — {spec.label} Preview
              </h2>
              <p className="text-xs text-slate-500 mt-0.5">
                {spec.description} · {project.assets.length} untouched figure{project.assets.length === 1 ? '' : 's'} locked inline.
              </p>
            </div>
            <button
              type="button"
              onClick={onClose}
              aria-label="Close Bangla PDF preview"
              className="p-1.5 -mr-1 text-slate-500 hover:text-slate-900 hover:bg-slate-200/70 rounded-md transition-colors shrink-0"
            >
              <X className="w-4 h-4" />
            </button>
          </div>

          <div className="flex flex-wrap items-center justify-between gap-3">
            {/* Device Page Geometry Switcher */}
            <div
              role="group"
              aria-label="Reading device layout profile"
              className="flex items-center gap-1 p-1 bg-slate-200/70 rounded-lg overflow-x-auto"
            >
              {PROFILE_BUTTONS.map((btn) => {
                const Icon = btn.icon;
                const active = activeProfile === btn.id;
                return (
                  <button
                    key={btn.id}
                    type="button"
                    onClick={() => handleSelectProfile(btn.id)}
                    aria-pressed={active}
                    className={`inline-flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-medium rounded-md transition-colors whitespace-nowrap ${
                      active
                        ? 'bg-white text-slate-900 shadow-2xs'
                        : 'text-slate-600 hover:text-slate-900'
                    }`}
                  >
                    <Icon className="w-3.5 h-3.5" />
                    {btn.label}
                  </button>
                );
              })}
            </div>

            {/* Export Actions */}
            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={handleDownloadRealPdf}
                disabled={isExportingPdf}
                className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-semibold text-white bg-blue-700 rounded-lg hover:bg-blue-800 disabled:opacity-60 transition-colors whitespace-nowrap"
              >
                <Download className="w-3.5 h-3.5" />
                {isExportingPdf ? 'Rendering Bangla PDF...' : 'Download Bangla PDF'}
              </button>
              <button
                type="button"
                onClick={() => window.print()}
                className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-medium text-slate-700 bg-white border border-slate-300 rounded-lg hover:bg-slate-50 transition-colors whitespace-nowrap"
              >
                <Printer className="w-3.5 h-3.5" />
                Print
              </button>
              <button
                type="button"
                onClick={handleDownloadEpub}
                disabled={isExportingEpub}
                className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-medium text-slate-700 bg-white border border-slate-300 rounded-lg hover:bg-slate-50 transition-colors whitespace-nowrap"
              >
                <BookDown className="w-3.5 h-3.5" />
                {isExportingEpub ? 'Building EPUB...' : 'EPUB 3.0'}
              </button>
              <button
                type="button"
                onClick={() => downloadBanglaPrintHtml(project, activeProfile)}
                className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-medium text-slate-700 bg-white border border-slate-300 rounded-lg hover:bg-slate-50 transition-colors whitespace-nowrap"
              >
                <FileText className="w-3.5 h-3.5" />
                HTML
              </button>
              <button
                type="button"
                onClick={() => downloadBanglaMarkdown(project)}
                className="px-3 py-2 text-xs font-medium text-slate-700 bg-white border border-slate-300 rounded-lg hover:bg-slate-50 transition-colors whitespace-nowrap"
              >
                MD
              </button>
            </div>
          </div>
        </div>

        {/* Rendered Bangla Book Pages (Dynamically sized to Phone / Tablet / A5 / Desktop geometry) */}
        <div className="flex-1 overflow-y-auto bg-slate-100/80 p-5 sm:p-8 print:bg-white print:p-0 print:overflow-visible">
          <div className="text-center text-xs font-mono text-slate-500 mb-3 print:hidden">
            Page Geometry: {spec.pageSizeCss} · Margins: {spec.marginCss} · Measure: {spec.maxWidthCh}
          </div>

          <article
            data-testid="pdf-preview-sheet"
            data-layout-profile={activeProfile}
            style={{
              maxWidth: `${spec.previewMaxWidthPx}px`,
              fontSize: `${spec.bodyFontSizePx}px`,
              lineHeight: spec.lineHeight,
            }}
            className="mx-auto bg-white border border-slate-200 px-6 py-9 sm:px-10 sm:py-12 font-bangla text-slate-900 shadow-2xs transition-all duration-200 print:max-w-none print:border-0 print:shadow-none print:px-0 print:py-0"
          >
            {/* Title Page */}
            <header className="text-center pb-10 mb-10 border-b border-slate-200 break-after-page">
              <div className="text-[0.78em] text-slate-500 mb-4">
                প্রথম বাংলা সংস্করণ · {yearBn}
              </div>
              <h1 className="text-[1.85em] font-bold text-slate-900 leading-snug">
                {project.titleBangla || project.title}
              </h1>
              <div className="text-[0.84em] text-slate-500 mt-2 font-sans">
                Original English Edition: {project.title}
              </div>
              <div className="text-[1.1em] font-medium text-slate-800 mt-6">
                {project.authorBangla || project.author}
              </div>

              <div className="mt-10 pt-6 border-t border-slate-100">
                <div className="text-[1em] font-bold text-slate-900">{houseBn}</div>
                <div className="text-[0.8em] text-slate-600 mt-1">
                  {project.publisher.imprintCity}
                </div>
              </div>
            </header>

            {/* Colophon / Rights Page */}
            <section className="pb-8 mb-8 border-b border-slate-200 text-[0.82em] text-slate-700 space-y-1.5 break-after-page">
              <div className="text-[1.08em] font-semibold text-slate-900 mb-2">
                প্রকাশনা ও স্বত্ব পরিচিতি
              </div>
              <p>গ্রন্থের নাম: {project.titleBangla || project.title}</p>
              <p>মূল গ্রন্থ: {project.title} ({project.author})</p>
              <p>প্রকাশক ও অনুবাদ প্রতিষ্ঠান: {houseBn} ({project.publisher.publishingHouse})</p>
              <p>প্রকাশনাস্থল: {project.publisher.imprintCity}</p>
              <p>সংস্করণ লেআউট: {spec.label}</p>
              <p className="pt-2 font-medium text-slate-900">
                {project.publisher.rightsStatement}
              </p>
            </section>

            {/* Table of Contents */}
            <nav className="pb-8 mb-8 border-b border-slate-200 break-after-page">
              <h2 className="text-[1.25em] font-bold text-slate-900 mb-3">সূচিপত্র</h2>
              <ol className="space-y-2 text-[0.92em]">
                {chapters.map((ch, idx) => (
                  <li
                    key={ch.chapterIndex}
                    className="flex items-baseline justify-between gap-3 border-b border-slate-100 pb-1.5"
                  >
                    <span>
                      <span className="text-slate-500 mr-2">
                        {toBengaliDigits(idx + 1)}.
                      </span>
                      {ch.titleBangla}
                    </span>
                  </li>
                ))}
              </ol>
            </nav>

            {/* Chapters with rich typography & untouched figures */}
            <div className="space-y-12">
              {chapters.map((ch, idx) => {
                const combinedBangla = ch.chunks
                  .map((ck) => ck.banglaText.trim())
                  .filter(Boolean)
                  .join('\n\n');
                return (
                  <section key={ch.chapterIndex} className="break-before-page">
                    <div className="text-[0.8em] text-slate-500 mb-1 break-after-avoid">
                      অধ্যায় {toBengaliDigits(idx + 1)}
                    </div>
                    <h2 className="text-[1.45em] font-bold text-slate-900 mb-5 leading-snug break-after-avoid">
                      {ch.titleBangla}
                    </h2>
                    {combinedBangla ? (
                      <div className="text-slate-900">
                        {renderBanglaBodyWithAssets(combinedBangla, project.assets)}
                      </div>
                    ) : (
                      <p className="text-[0.9em] text-slate-400 italic">
                        [এই অধ্যায়টি এখনো অনূদিত হয়নি। Book Runner থেকে Export Antigravity Swarm (.zip) নিয়ে Antigravity তে অনুবাদ চালান অথবা সম্পন্ন ledger.json ইমপোর্ট করুন।]
                      </p>
                    )}
                  </section>
                );
              })}
            </div>

            {/* Book Back-Matter / Professional Ending */}
            <footer className="mt-12 pt-10 border-t border-slate-200 text-center break-before-page">
              <div className="text-[1.45em] font-bold text-slate-900">
                সমাপ্ত
              </div>
              <div className="w-12 h-px bg-slate-300 mx-auto my-5" />
              <div className="text-[1em] font-semibold text-slate-900">
                {project.titleBangla || project.title}
              </div>
              <div className="text-[0.86em] text-slate-600 mt-1">
                {project.authorBangla || project.author}
              </div>
              <p className="text-[0.8em] text-slate-500 mt-4">
                মোট অধ্যায়: {toBengaliDigits(chapters.length)}টি · সংরক্ষিত মূল চিত্র ও গ্রাফ: {toBengaliDigits(project.assets.length)}টি
              </p>
              <div className="mt-6 text-[0.82em] text-slate-700 font-medium">
                {houseBn} · {project.publisher.imprintCity} · {yearBn}
              </div>
              <p className="text-[0.76em] text-slate-500 mt-2 max-w-md mx-auto">
                {project.publisher.rightsStatement}
              </p>
            </footer>
          </article>
        </div>
      </div>
    </div>
  );
}
