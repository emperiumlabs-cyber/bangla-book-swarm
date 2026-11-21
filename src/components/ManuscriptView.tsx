import { useMemo, useState } from 'react';
import {
  AlertTriangle,
  Check,
  CheckCircle2,
  Copy,
  Scissors,
  Search,
} from 'lucide-react';
import type { BookAsset, BookProject, ChunkStatus, TranslationChunk } from '../types/translator';
import { buildSingleChunkAntigravityPrompt } from '../lib/antigravityBridge';

interface ManuscriptViewProps {
  project: BookProject;
  activeChunkId: string;
  onSelectChunk: (id: string) => void;
  onEditBangla: (chunkId: string, banglaText: string) => void;
  onEditChapterTitleBangla: (chunkId: string, titleBangla: string) => void;
  onSplitChunk: (chunkId: string) => void;
}

const ASSET_SPLIT_REGEX = /(\[\[ASSET:[a-zA-Z0-9_-]+\]\])/g;

function renderSourceWithInlineAssets(text: string, assets: BookAsset[]) {
  const assetMap = new Map(assets.map((a) => [a.token, a]));
  const parts = text.split(ASSET_SPLIT_REGEX);
  return parts.map((part, idx) => {
    const asset = assetMap.get(part);
    if (asset) {
      return (
        <figure
          key={`${asset.id}-${idx}`}
          className="my-3 p-3 border border-slate-200 rounded-lg bg-white text-center"
        >
          <div className="text-[11px] font-mono text-blue-700 mb-1.5 text-left">
            Locked Original Component · {asset.token}
          </div>
          <img
            src={asset.dataUrl}
            alt={asset.captionEnglish}
            referrerPolicy="no-referrer"
            className="max-h-40 mx-auto object-contain"
          />
          <figcaption className="text-xs text-slate-500 mt-1.5">
            {asset.captionEnglish}
          </figcaption>
        </figure>
      );
    }
    return (
      <span key={idx} className="whitespace-pre-wrap">
        {part}
      </span>
    );
  });
}

function formatStatusLabel(status: ChunkStatus): { text: string; toneClass: string } {
  switch (status) {
    case 'passed':
      return { text: 'Passed', toneClass: 'text-emerald-700' };
    case 'needs_retry':
      return { text: 'Audit Flagged', toneClass: 'text-amber-700' };
    case 'error':
      return { text: 'Error', toneClass: 'text-red-700' };
    case 'translating':
      return { text: 'Translating', toneClass: 'text-blue-700' };
    default:
      return { text: 'Pending', toneClass: 'text-slate-500' };
  }
}

export function ManuscriptView({
  project,
  activeChunkId,
  onSelectChunk,
  onEditBangla,
  onEditChapterTitleBangla,
  onSplitChunk,
}: ManuscriptViewProps) {
  const [filter, setFilter] = useState<'all' | 'passed' | 'flagged' | 'pending'>('all');
  const [query, setQuery] = useState('');
  const [copiedChunkId, setCopiedChunkId] = useState<string | null>(null);

  const filteredChunks = useMemo(() => {
    const q = query.trim().toLowerCase();
    return project.chunks.filter((chunk) => {
      if (filter === 'passed' && chunk.status !== 'passed') return false;
      if (filter === 'flagged' && chunk.status !== 'needs_retry' && chunk.status !== 'error') {
        return false;
      }
      if (filter === 'pending' && chunk.status !== 'pending') return false;
      if (!q) return true;
      return (
        chunk.chapterTitle.toLowerCase().includes(q) ||
        chunk.sourceText.toLowerCase().includes(q) ||
        chunk.banglaText.toLowerCase().includes(q)
      );
    });
  }, [project.chunks, filter, query]);

  const activeChunk: TranslationChunk | undefined =
    project.chunks.find((c) => c.id === activeChunkId) ?? filteredChunks[0] ?? project.chunks[0];

  const handleCopyPrompt = async () => {
    if (!activeChunk) return;
    const prompt = buildSingleChunkAntigravityPrompt(activeChunk, project);
    try {
      await navigator.clipboard.writeText(prompt);
    } catch {
      // Clipboard may be restricted in headless contexts; still acknowledge generation
    }
    setCopiedChunkId(activeChunk.id);
    setTimeout(() => {
      setCopiedChunkId((curr) => (curr === activeChunk.id ? null : curr));
    }, 1800);
  };

  if (!activeChunk) {
    return (
      <div className="p-10 text-center border border-slate-200 rounded-xl">
        <div className="text-base font-semibold text-slate-900">No manuscript loaded</div>
        <p className="text-sm text-slate-500 mt-1">
          Upload an English book or load the sample manuscript in Book Runner first.
        </p>
      </div>
    );
  }

  const audit = activeChunk.audit;
  const isCopied = copiedChunkId === activeChunk.id;

  return (
    <div className="space-y-5">
      {/* Header & Filter Bar */}
      <div className="flex flex-col md:flex-row md:items-end justify-between gap-4 pb-4 border-b border-slate-200">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-slate-900">
            Bilingual Manuscript &amp; Deterministic Audit
          </h1>
          <p className="text-sm text-slate-600 mt-1">
            Inspect every micro-chunk side by side. Copy a Zero-API-Key Antigravity prompt for any chunk or paste completed Bangla directly — every keystroke runs the 6-check purity, meaning-fidelity, zero-AI-symbol, and figure-anchor gate live.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <div className="relative w-56">
            <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
            <input
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search chunks..."
              aria-label="Search manuscript chunks"
              className="w-full pl-9 pr-3 py-1.5 text-xs bg-white border border-slate-300 rounded-lg focus:outline-none focus:border-blue-600"
            />
          </div>

          <div className="flex items-center gap-1 p-1 bg-slate-100 rounded-lg">
            {(
              [
                ['all', `All (${project.chunks.length})`],
                ['passed', 'Passed'],
                ['flagged', 'Flagged'],
                ['pending', 'Pending'],
              ] as const
            ).map(([key, label]) => (
              <button
                key={key}
                type="button"
                onClick={() => setFilter(key)}
                className={`px-2.5 py-1 text-xs font-medium rounded-md transition-colors whitespace-nowrap ${
                  filter === key
                    ? 'bg-white text-slate-900 shadow-2xs'
                    : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                {label}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Main Split: Left Chunk Index + Right Side-by-Side Editor */}
      <div className="grid grid-cols-1 xl:grid-cols-12 gap-5 items-start">
        {/* Chunk Navigation Column */}
        <div className="xl:col-span-3 border border-slate-200 rounded-xl bg-white overflow-hidden">
          <div className="px-4 py-2.5 bg-slate-50 border-b border-slate-200 text-xs font-semibold text-slate-700 flex items-center justify-between">
            <span>Chunks</span>
            <span className="font-mono tabular-nums text-slate-500">
              {filteredChunks.length} shown
            </span>
          </div>

          <div className="divide-y divide-slate-100 max-h-[640px] overflow-y-auto">
            {filteredChunks.map((chunk) => {
              const isSelected = chunk.id === activeChunk.id;
              const statusMeta = formatStatusLabel(chunk.status);
              return (
                <button
                  key={chunk.id}
                  type="button"
                  onClick={() => onSelectChunk(chunk.id)}
                  className={`w-full text-left px-4 py-3 transition-colors focus-visible:outline-2 focus-visible:outline-blue-600 ${
                    isSelected ? 'bg-blue-50/70' : 'hover:bg-slate-50'
                  }`}
                >
                  <div className="flex items-center justify-between gap-2 text-xs">
                    <span className="font-mono font-semibold text-slate-900">
                      #{chunk.chunkIndex + 1} · {chunk.id}
                    </span>
                    <span className={`font-medium ${statusMeta.toneClass}`}>
                      {statusMeta.text}
                    </span>
                  </div>
                  <div className="text-xs text-slate-700 font-medium truncate mt-1">
                    {chunk.chapterTitle}
                  </div>
                  <div className="text-[11px] text-slate-500 font-mono tabular-nums mt-1">
                    {chunk.wordCount}w
                    {chunk.audit ? ` · ${chunk.audit.banglaPurityPct}% Bangla` : ''}
                    {chunk.splitDepth > 0 ? ` · split×${chunk.splitDepth}` : ''}
                  </div>
                </button>
              );
            })}
          </div>
        </div>

        {/* Side-by-Side Proofing & Audit Column */}
        <div className="xl:col-span-9 space-y-4">
          {/* Deterministic Audit Status Strip */}
          <div className="border border-slate-200 rounded-xl p-4 bg-white space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="flex items-center gap-2.5">
                {audit?.passed ? (
                  <CheckCircle2 className="w-5 h-5 text-emerald-600 shrink-0" />
                ) : (
                  <AlertTriangle
                    className={`w-5 h-5 shrink-0 ${
                      activeChunk.status === 'pending' ? 'text-slate-400' : 'text-amber-600'
                    }`}
                  />
                )}
                <div>
                  <div className="text-sm font-semibold text-slate-900">
                    {audit?.passed
                      ? 'Deterministic Gate Passed — 100% Production Bangla'
                      : activeChunk.status === 'pending'
                        ? 'Awaiting Antigravity Translation'
                        : 'Deterministic Audit Flagged — Action Needed'}
                  </div>
                  <div className="text-xs text-slate-500 font-mono tabular-nums mt-0.5">
                    Purity: {audit ? `${audit.banglaPurityPct}%` : '—'} · Length:{' '}
                    {audit ? `${audit.lengthRatio}x` : '—'} · Meaning:{' '}
                    {audit ? (audit.meaningFidelityPassed !== false ? 'Faithful' : 'Flagged') : '—'}{' '}
                    · AI Symbols: {audit ? (audit.aiSlopSymbolsDetected?.length ?? 0) : 0} · Assets:{' '}
                    {audit ? audit.preservedAssetsCount : 0}
                  </div>
                </div>
              </div>

              <div className="flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  onClick={handleCopyPrompt}
                  className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-semibold text-white bg-blue-700 rounded-lg hover:bg-blue-800 transition-colors whitespace-nowrap"
                >
                  {isCopied ? (
                    <>
                      <Check className="w-3.5 h-3.5" />
                      Copied for Antigravity
                    </>
                  ) : (
                    <>
                      <Copy className="w-3.5 h-3.5" />
                      Copy Antigravity Prompt
                    </>
                  )}
                </button>

                <button
                  type="button"
                  onClick={() => onSplitChunk(activeChunk.id)}
                  disabled={activeChunk.splitDepth >= 3 || activeChunk.wordCount < 40}
                  title="Split this chunk into two smaller halves for lower-model recovery"
                  className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-medium text-slate-700 bg-white border border-slate-300 rounded-lg hover:bg-slate-50 disabled:opacity-40 transition-colors whitespace-nowrap"
                >
                  <Scissors className="w-3.5 h-3.5" />
                  Halve Chunk
                </button>
              </div>
            </div>

            {activeChunk.errorMessage && (
              <div
                role="alert"
                className="p-2.5 text-xs text-red-800 bg-red-50 border border-red-200 rounded-md"
              >
                {activeChunk.errorMessage}
              </div>
            )}

            {audit && !audit.passed && audit.issues.length > 0 && (
              <div
                role="status"
                data-testid="audit-issues-banner"
                className="p-3 text-xs text-amber-900 bg-amber-50 border border-amber-200 rounded-md space-y-1"
              >
                <div className="font-semibold">
                  Auditor Diagnostics (Recommended action: {audit.retryAction.replace('_', ' ')}):
                </div>
                <ul className="list-disc pl-4 space-y-0.5">
                  {audit.issues.map((issue, i) => (
                    <li key={i}>{issue}</li>
                  ))}
                </ul>
                {audit.leakedEnglishWords.length > 0 && (
                  <div className="pt-1 font-mono text-[11px] text-amber-800">
                    Leaked tokens: {audit.leakedEnglishWords.join(', ')}
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Chapter Heading Localization Input */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 border border-slate-200 rounded-xl p-4 bg-slate-50/50">
            <div>
              <div className="text-xs font-medium text-slate-500 mb-1">English Chapter Heading</div>
              <div className="text-sm font-semibold text-slate-900">{activeChunk.chapterTitle}</div>
            </div>
            <div>
              <label
                htmlFor="chapter-title-bn"
                className="block text-xs font-medium text-slate-700 mb-1"
              >
                Bangla Chapter Heading
              </label>
              <input
                id="chapter-title-bn"
                type="text"
                value={activeChunk.chapterTitleBangla}
                onChange={(e) => onEditChapterTitleBangla(activeChunk.id, e.target.value)}
                placeholder="অধ্যায় শিরোনাম"
                className="w-full px-3 py-1.5 text-sm font-bangla bg-white border border-slate-300 rounded-lg focus:outline-none focus:border-blue-600"
              />
            </div>
          </div>

          {/* Bilingual Panes */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            {/* Source English */}
            <div className="border border-slate-200 rounded-xl bg-white overflow-hidden flex flex-col">
              <div className="px-4 py-2.5 bg-slate-50 border-b border-slate-200 flex items-center justify-between text-xs">
                <span className="font-semibold text-slate-800">English Source Passage</span>
                <span className="font-mono text-slate-500 tabular-nums">
                  {activeChunk.wordCount} words
                </span>
              </div>
              <div className="p-5 text-sm text-slate-800 leading-relaxed max-h-[500px] overflow-y-auto">
                {renderSourceWithInlineAssets(activeChunk.sourceText, project.assets)}
              </div>
              {activeChunk.contextTail && (
                <div className="px-4 py-2.5 bg-slate-50 border-t border-slate-200 text-xs text-slate-500">
                  <span className="font-semibold text-slate-700">
                    Continuity anchor from previous chunk:
                  </span>{' '}
                  {activeChunk.contextTail}
                </div>
              )}
            </div>

            {/* Editable Bangla Output */}
            <div className="border border-slate-200 rounded-xl bg-white overflow-hidden flex flex-col">
              <div className="px-4 py-2.5 bg-slate-50 border-b border-slate-200 flex items-center justify-between text-xs">
                <label htmlFor="bangla-editor" className="font-semibold text-slate-800">
                  Production Bangla Output (Editable)
                </label>
                <span className="font-mono text-slate-500 tabular-nums">
                  {activeChunk.banglaText.length} chars
                </span>
              </div>
              <textarea
                id="bangla-editor"
                value={activeChunk.banglaText}
                onChange={(e) => onEditBangla(activeChunk.id, e.target.value)}
                rows={16}
                placeholder="Click 'Copy Antigravity Prompt' above, run inside Antigravity (Zero API Key), and paste the Bangla translation here — or import workspace/ledger.json in Book Runner..."
                className="w-full flex-1 p-5 text-[15px] font-bangla text-slate-900 bg-white resize-y focus:outline-none focus:ring-2 focus:ring-inset focus:ring-blue-100"
              />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
