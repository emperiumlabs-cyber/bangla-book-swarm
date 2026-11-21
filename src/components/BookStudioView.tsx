import { useRef, useState } from 'react';
import {
  CheckCircle2,
  Download,
  FileUp,
  Image as ImageIcon,
  Layers,
  RotateCcw,
  Save,
  Trash2,
  Upload,
} from 'lucide-react';
import type { BookAsset, BookProject } from '../types/translator';
import { countWords } from '../lib/chunker';
import { LAYOUT_PROFILES, toBengaliDigits } from '../lib/exporters';
import { parseImportedProjectOrLedger } from '../lib/antigravityBridge';
import { computeAdaptiveWorkerCount } from '../lib/swarmPlanner';
import { downloadCheckpointJson } from '../utils/downloads';

export interface IngestedBookPayload {
  title: string;
  author: string;
  fileName: string;
  format: BookProject['sourceFormat'];
  rawText: string;
  assets: BookAsset[];
  coverImageDataUrl?: string;
  coverFileName?: string;
}

interface BookStudioViewProps {
  project: BookProject;
  batchBooks: BookProject[];
  onSelectBatchBook: (bookId: string) => void;
  onRemoveBatchBook: (bookId: string) => void;
  onUpdateProjectMeta: (
    patch: Partial<Pick<BookProject, 'title' | 'titleBangla' | 'author' | 'authorBangla'>>
  ) => void;
  onUpdateAssetCaption: (assetId: string, captionBangla: string) => void;
  onIngestBooks: (payloads: IngestedBookPayload[], mode: 'replace' | 'append') => void;
  onRechunkBook: (maxWords: number) => void;
  onExportAntigravityWorkspace: () => Promise<void>;
  onResetSample: () => void;
  onImportCheckpoint: (project: BookProject) => void;
  onOpenManuscript: () => void;
  onOpenPdfPreview: () => void;
}

export function BookStudioView({
  project,
  batchBooks,
  onSelectBatchBook,
  onRemoveBatchBook,
  onUpdateProjectMeta,
  onUpdateAssetCaption,
  onIngestBooks,
  onRechunkBook,
  onExportAntigravityWorkspace,
  onResetSample,
  onImportCheckpoint,
  onOpenManuscript,
  onOpenPdfPreview,
}: BookStudioViewProps) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const checkpointInputRef = useRef<HTMLInputElement>(null);

  const [isUploading, setIsUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState('');
  const [isExportingWorkspace, setIsExportingWorkspace] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [statusNotice, setStatusNotice] = useState<string | null>(null);
  const [showPasteBox, setShowPasteBox] = useState(false);
  const [pasteTitle, setPasteTitle] = useState('');
  const [pasteAuthor, setPasteAuthor] = useState('');
  const [pasteText, setPasteText] = useState('');
  const [pasteError, setPasteError] = useState<string | null>(null);

  const passedChunks = project.chunks.filter((c) => c.status === 'passed').length;
  const retryChunks = project.chunks.filter(
    (c) => c.status === 'needs_retry' || c.status === 'error'
  ).length;
  const pendingChunks = project.chunks.filter((c) => c.status === 'pending').length;
  const chapterCount = new Set(project.chunks.map((c) => c.chapterIndex)).size;
  const progressPct =
    project.chunks.length === 0 ? 0 : Math.round((passedChunks / project.chunks.length) * 100);
  const activeLayoutSpec = LAYOUT_PROFILES[project.publisher.defaultLayout ?? 'phone'];

  const totalBatchChunks = batchBooks.reduce((sum, b) => sum + b.chunks.length, 0);
  const pendingBatchChunks = batchBooks.reduce(
    (sum, b) => sum + b.chunks.filter((c) => c.status !== 'passed').length,
    0
  );
  const plannedSubAgents = computeAdaptiveWorkerCount(
    pendingBatchChunks > 0 ? pendingBatchChunks : totalBatchChunks,
    batchBooks.length,
    project.publisher.swarmConcurrency ?? 'auto'
  );

  const handleExportWorkspace = async () => {
    setIsExportingWorkspace(true);
    setUploadError(null);
    try {
      await onExportAntigravityWorkspace();
      setStatusNotice(
        `Exported One-Shot Antigravity Swarm Workspace (.zip): ${batchBooks.length} book(s), ${totalBatchChunks} chunks pre-sharded across ${plannedSubAgents} parallel sub-agent(s) with zero API keys. Unzip, open in Antigravity, and paste ANTIGRAVITY_PROMPT.md.`
      );
    } catch (err) {
      setUploadError(err instanceof Error ? err.message : 'Workspace ZIP export failed.');
    } finally {
      setIsExportingWorkspace(false);
    }
  };

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const fileList = Array.from(e.target.files ?? []);
    if (fileList.length === 0) return;
    setUploadError(null);
    setStatusNotice(null);
    setIsUploading(true);

    try {
      const parsedPayloads: IngestedBookPayload[] = [];
      for (let i = 0; i < fileList.length; i++) {
        const file = fileList[i];
        setUploadProgress(`Extracting ${i + 1}/${fileList.length}: ${file.name}`);
        const formData = new FormData();
        formData.append('book', file);

        const response = await fetch('/api/parse-book', {
          method: 'POST',
          body: formData,
        });
        const data = await response.json();
        if (!response.ok) {
          throw new Error(`${file.name}: ${data.error || 'Could not parse uploaded book.'}`);
        }

        const inferredTitle = file.name.replace(/\.[^.]+$/, '').replace(/[_-]+/g, ' ').trim();
        parsedPayloads.push({
          title: inferredTitle || 'Untitled Book',
          author: 'Unknown Author',
          fileName: data.fileName || file.name,
          format: data.format || 'txt',
          rawText: data.text,
          assets: Array.isArray(data.assets) ? data.assets : [],
          coverImageDataUrl:
            typeof data.coverImageDataUrl === 'string' ? data.coverImageDataUrl : undefined,
          coverFileName:
            typeof data.coverFileName === 'string' ? data.coverFileName : undefined,
        });
      }

      const appendMode = batchBooks.length > 1 || (fileList.length > 1);
      onIngestBooks(parsedPayloads, appendMode ? 'append' : 'replace');
      setStatusNotice(
        `Parsed ${parsedPayloads.length} book(s) locally (Zero API Key). Click "Export Antigravity Swarm (.zip)" to translate 100% in parallel inside Antigravity.`
      );
    } catch (err) {
      setUploadError(err instanceof Error ? err.message : 'Book upload failed.');
    } finally {
      setIsUploading(false);
      setUploadProgress('');
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  const handlePasteSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!pasteTitle.trim()) {
      setPasteError('Please enter the English book title.');
      return;
    }
    if (countWords(pasteText) < 20) {
      setPasteError('Please paste at least 20 words of English book text.');
      return;
    }
    setPasteError(null);
    setUploadError(null);
    onIngestBooks(
      [
        {
          title: pasteTitle.trim(),
          author: pasteAuthor.trim() || 'Unknown Author',
          fileName: `${pasteTitle.trim().toLowerCase().replace(/\s+/g, '-')}.txt`,
          format: 'txt',
          rawText: pasteText.trim(),
          assets: [],
        },
      ],
      'replace'
    );
    setStatusNotice(
      `Segmented "${pasteTitle.trim()}" into lower-model chunks locally. Export the Antigravity Swarm Workspace (.zip) or copy single-chunk prompts in Manuscript & Audit.`
    );
    setShowPasteBox(false);
    setPasteTitle('');
    setPasteAuthor('');
    setPasteText('');
  };

  const handleLedgerOrCheckpointUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploadError(null);
    try {
      const text = await file.text();
      const raw = JSON.parse(text) as unknown;
      const loaded = parseImportedProjectOrLedger(raw, project);
      const passed = loaded.chunks.filter((c) => c.status === 'passed').length;
      onImportCheckpoint(loaded);
      setStatusNotice(
        `Imported "${file.name}" and ran the 6-check deterministic Bangla audit: ${passed} of ${loaded.chunks.length} chunks passed.`
      );
    } catch (err) {
      setUploadError(
        err instanceof Error ? err.message : 'Failed to load Antigravity ledger.json or checkpoint.'
      );
    } finally {
      if (checkpointInputRef.current) checkpointInputRef.current.value = '';
    }
  };

  return (
    <div className="space-y-8">
      {/* Header & Primary Zero-API-Key Antigravity Swarm Controls */}
      <section className="flex flex-col lg:flex-row lg:items-end justify-between gap-5 pb-6 border-b border-slate-200">
        <div>
          <div className="text-xs font-medium text-slate-500 mb-1.5">
            Zero-API-Key Swarm Bridge · {batchBooks.length} book{batchBooks.length === 1 ? '' : 's'} staged · {totalBatchChunks} chunks · {plannedSubAgents} parallel sub-agent{plannedSubAgents === 1 ? '' : 's'}
          </div>
          <h1 className="text-2xl sm:text-3xl font-bold tracking-tight text-slate-900">
            Book Batch &amp; Antigravity Swarm Runner
          </h1>
          <p className="text-sm text-slate-600 mt-1.5 max-w-2xl">
            Upload <strong>1 book or 50+ books at once</strong> locally with zero Gemini API key. Export a pre-sharded Antigravity Swarm Workspace (.zip) for 10, 20, or 50 parallel 3.8 Flash sub-agents, then import your completed <code className="font-mono text-xs text-slate-800">ledger.json</code> to proof and build Phone, Tablet, Print A5, or Desktop Bangla PDFs.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-3 shrink-0">
          <button
            type="button"
            onClick={handleExportWorkspace}
            disabled={isExportingWorkspace || totalBatchChunks === 0}
            className="inline-flex items-center gap-2 px-4 py-2.5 text-sm font-semibold text-white bg-blue-700 rounded-lg hover:bg-blue-800 disabled:opacity-50 transition-colors whitespace-nowrap"
          >
            <Download className="w-4 h-4" />
            {isExportingWorkspace
              ? 'Packaging Swarm...'
              : batchBooks.length > 1
                ? `Export ${batchBooks.length}-Book Swarm (.zip)`
                : 'Export Antigravity Swarm (.zip)'}
          </button>
          <button
            type="button"
            onClick={onOpenManuscript}
            className="px-4 py-2.5 text-sm font-medium text-slate-700 bg-white border border-slate-300 rounded-lg hover:bg-slate-50 transition-colors whitespace-nowrap"
          >
            Inspect Manuscript
          </button>
        </div>
      </section>

      {statusNotice && (
        <div
          role="status"
          data-testid="workspace-status-notice"
          className="flex items-start gap-2.5 p-4 text-sm text-emerald-900 bg-emerald-50 border border-emerald-200 rounded-lg"
        >
          <CheckCircle2 className="w-4 h-4 text-emerald-700 shrink-0 mt-0.5" />
          <span>{statusNotice}</span>
        </div>
      )}

      {/* 4-column Numeric Progress Metrics (Tabular numerals) */}
      <section
        aria-label="Translation progress metrics"
        className="grid grid-cols-2 lg:grid-cols-4 gap-4"
      >
        <div className="border border-slate-200 rounded-lg p-4 bg-white">
          <div className="text-xs text-slate-500">Verified Bangla Coverage</div>
          <div className="mt-1 text-2xl font-bold font-mono tabular-nums text-slate-900">
            {progressPct}%
          </div>
          <div className="mt-1 text-xs text-slate-500 font-mono tabular-nums">
            {passedChunks} of {project.chunks.length} chunks passed
          </div>
        </div>

        <div className="border border-slate-200 rounded-lg p-4 bg-white">
          <div className="text-xs text-slate-500">Manuscript Length</div>
          <div className="mt-1 text-2xl font-bold font-mono tabular-nums text-slate-900">
            {project.totalWords.toLocaleString()}
          </div>
          <div className="mt-1 text-xs text-slate-500 font-mono tabular-nums">
            English words · {chapterCount} chapters
          </div>
        </div>

        <div className="border border-slate-200 rounded-lg p-4 bg-white">
          <div className="text-xs text-slate-500">Preserved Book Components</div>
          <div className="mt-1 text-2xl font-bold font-mono tabular-nums text-slate-900">
            {project.assets.length}
          </div>
          <div className="mt-1 text-xs text-slate-500">Graphs &amp; pictures locked intact</div>
        </div>

        <div className="border border-slate-200 rounded-lg p-4 bg-white">
          <div className="text-xs text-slate-500">Chunk Budget / Queue</div>
          <div className="mt-1 text-2xl font-bold font-mono tabular-nums text-slate-900">
            {project.publisher.maxWordsPerChunk}w
          </div>
          <div className="mt-1 text-xs text-slate-500 font-mono tabular-nums">
            {retryChunks} flagged · {pendingChunks} queued
          </div>
        </div>
      </section>

      {/* Book Upload & Metadata Split */}
      <section className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        {/* Left: Ingestion & Antigravity Ledger Sync */}
        <div className="lg:col-span-7 border border-slate-200 rounded-xl p-6 bg-white space-y-5">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h2 className="text-base font-semibold text-slate-900">
                Source Book Ingestion (100% Local)
              </h2>
              <p className="text-xs text-slate-500 mt-0.5">
                Upload PDF (with OCR hyphen repair), EPUB, DOCX, ODT, FB2, RTF, HTML, LaTeX (.tex), Markdown, or TXT. Kindle (.mobi/.azw3) &amp; .djvu are handled by the CLI Calibre bridge.
              </p>
            </div>
            <button
              type="button"
              onClick={() => {
                onResetSample();
                setStatusNotice(null);
                setUploadError(null);
              }}
              className="inline-flex items-center gap-1.5 text-xs font-medium text-slate-600 hover:text-slate-900"
            >
              <RotateCcw className="w-3.5 h-3.5" />
              Load Sample Book
            </button>
          </div>

          <div className="flex flex-wrap items-center gap-3 p-4 rounded-lg border border-dashed border-slate-300 bg-slate-50/60">
            <input
              ref={fileInputRef}
              type="file"
              multiple
              accept=".pdf,.epub,.docx,.odt,.fb2,.rtf,.html,.htm,.xhtml,.md,.markdown,.tex,.txt"
              onChange={handleFileUpload}
              className="sr-only"
              id="book-file-upload"
            />
            <label
              htmlFor="book-file-upload"
              className="inline-flex items-center gap-2 px-4 py-2 text-sm font-medium text-white bg-slate-900 rounded-lg hover:bg-slate-800 cursor-pointer transition-colors whitespace-nowrap"
            >
              <FileUp className="w-4 h-4" />
              {isUploading ? uploadProgress || 'Extracting Books...' : 'Upload 1 or 50+ Books'}
            </label>

            <button
              type="button"
              onClick={() => setShowPasteBox((v) => !v)}
              className="px-3.5 py-2 text-sm font-medium text-slate-700 bg-white border border-slate-300 rounded-lg hover:bg-slate-50 transition-colors whitespace-nowrap"
            >
              {showPasteBox ? 'Cancel Paste' : 'Paste English Text'}
            </button>

            <span className="text-xs text-slate-500">
              Active book: <span className="font-mono text-slate-700">{project.fileName}</span>
            </span>
          </div>

          {batchBooks.length > 1 && (
            <div className="border border-slate-200 rounded-lg overflow-hidden bg-slate-50/40">
              <div className="px-3.5 py-2 bg-slate-100/80 border-b border-slate-200 flex items-center justify-between text-xs">
                <span className="inline-flex items-center gap-1.5 font-semibold text-slate-800">
                  <Layers className="w-3.5 h-3.5 text-blue-700" />
                  Multi-Book Swarm Batch ({batchBooks.length} books · {totalBatchChunks} chunks · {plannedSubAgents} sub-agents)
                </span>
                <span className="text-slate-500">Click any book to inspect</span>
              </div>
              <div className="divide-y divide-slate-100 max-h-48 overflow-y-auto">
                {batchBooks.map((b) => {
                  const isActive = b.id === project.id;
                  return (
                    <div
                      key={b.id}
                      className={`flex items-center justify-between gap-2 px-3.5 py-2 text-xs ${
                        isActive ? 'bg-blue-50/70' : 'bg-white'
                      }`}
                    >
                      <button
                        type="button"
                        onClick={() => onSelectBatchBook(b.id)}
                        className="flex-1 text-left truncate font-medium text-slate-800 hover:text-blue-700"
                      >
                        {b.title}{' '}
                        <span className="font-mono text-[11px] text-slate-500">
                          ({b.chunks.length} chunks · {b.assets.length} assets)
                        </span>
                      </button>
                      <button
                        type="button"
                        onClick={() => onRemoveBatchBook(b.id)}
                        aria-label={`Remove ${b.title} from batch`}
                        className="p-1 text-slate-400 hover:text-red-600 rounded"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {uploadError && (
            <div
              role="alert"
              className="p-3 text-xs text-red-800 bg-red-50 border border-red-200 rounded-lg"
            >
              {uploadError}
            </div>
          )}

          {showPasteBox && (
            <form
              onSubmit={handlePasteSubmit}
              className="space-y-3 pt-2 border-t border-slate-100"
              noValidate
            >
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label
                    htmlFor="paste-title"
                    className="block text-xs font-medium text-slate-700 mb-1"
                  >
                    Book Title (English)
                  </label>
                  <input
                    id="paste-title"
                    type="text"
                    value={pasteTitle}
                    onChange={(e) => setPasteTitle(e.target.value)}
                    placeholder="e.g. Meditations"
                    className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg focus:outline-none focus:border-blue-600"
                  />
                </div>
                <div>
                  <label
                    htmlFor="paste-author"
                    className="block text-xs font-medium text-slate-700 mb-1"
                  >
                    Author
                  </label>
                  <input
                    id="paste-author"
                    type="text"
                    value={pasteAuthor}
                    onChange={(e) => setPasteAuthor(e.target.value)}
                    placeholder="e.g. Marcus Aurelius"
                    className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg focus:outline-none focus:border-blue-600"
                  />
                </div>
              </div>
              <div>
                <label
                  htmlFor="paste-body"
                  className="block text-xs font-medium text-slate-700 mb-1"
                >
                  English Book Content (Use # Chapter 1 headings for automatic chapter detection)
                </label>
                <textarea
                  id="paste-body"
                  rows={6}
                  value={pasteText}
                  onChange={(e) => setPasteText(e.target.value)}
                  placeholder="# Chapter 1: Beginning&#10;&#10;Paste your English book chapters here..."
                  className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg focus:outline-none focus:border-blue-600 font-mono"
                />
              </div>
              {pasteError && (
                <div role="alert" className="text-xs font-medium text-red-700">
                  {pasteError}
                </div>
              )}
              <button
                type="submit"
                className="px-4 py-2 text-sm font-semibold text-white bg-blue-700 rounded-lg hover:bg-blue-800 transition-colors"
              >
                Segment Into Lower-Model Chunks
              </button>
            </form>
          )}

          {/* Book title/author localization fields */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 pt-2 border-t border-slate-100">
            <div>
              <label
                htmlFor="book-title-en"
                className="block text-xs font-medium text-slate-700 mb-1"
              >
                Original Title
              </label>
              <input
                id="book-title-en"
                type="text"
                value={project.title}
                onChange={(e) => onUpdateProjectMeta({ title: e.target.value })}
                className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg focus:outline-none focus:border-blue-600"
              />
            </div>
            <div>
              <label
                htmlFor="book-title-bn"
                className="block text-xs font-medium text-slate-700 mb-1"
              >
                Bangla Book Title (PDF Cover)
              </label>
              <input
                id="book-title-bn"
                type="text"
                value={project.titleBangla}
                onChange={(e) => onUpdateProjectMeta({ titleBangla: e.target.value })}
                placeholder="বাংলা শিরোনাম"
                className="w-full px-3 py-2 text-sm font-bangla border border-slate-300 rounded-lg focus:outline-none focus:border-blue-600"
              />
            </div>
            <div>
              <label
                htmlFor="book-author-en"
                className="block text-xs font-medium text-slate-700 mb-1"
              >
                Original Author
              </label>
              <input
                id="book-author-en"
                type="text"
                value={project.author}
                onChange={(e) => onUpdateProjectMeta({ author: e.target.value })}
                className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg focus:outline-none focus:border-blue-600"
              />
            </div>
            <div>
              <label
                htmlFor="book-author-bn"
                className="block text-xs font-medium text-slate-700 mb-1"
              >
                Bangla Author Name
              </label>
              <input
                id="book-author-bn"
                type="text"
                value={project.authorBangla}
                onChange={(e) => onUpdateProjectMeta({ authorBangla: e.target.value })}
                placeholder="লেখকের বাংলা নাম"
                className="w-full px-3 py-2 text-sm font-bangla border border-slate-300 rounded-lg focus:outline-none focus:border-blue-600"
              />
            </div>
          </div>

          {/* Chunk size & Antigravity ledger sync controls */}
          <div className="flex flex-wrap items-center justify-between gap-3 pt-3 border-t border-slate-100">
            <div className="flex items-center gap-2">
              <label htmlFor="rechunk-words" className="text-xs font-medium text-slate-700">
                Max Words / Chunk:
              </label>
              <select
                id="rechunk-words"
                value={project.publisher.maxWordsPerChunk}
                onChange={(e) => onRechunkBook(Number(e.target.value))}
                className="px-2.5 py-1.5 text-xs font-mono border border-slate-300 rounded-md bg-white"
              >
                <option value={220}>220w (Ultra-Low 4B)</option>
                <option value={320}>320w (3.5/3.8 Flash · Safe)</option>
                <option value={550}>550w (Standard Flash)</option>
                <option value={900}>900w (High Context)</option>
              </select>
            </div>

            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => downloadCheckpointJson(project)}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-slate-700 bg-white border border-slate-300 rounded-md hover:bg-slate-50"
              >
                <Save className="w-3.5 h-3.5" />
                Save Checkpoint
              </button>
              <input
                ref={checkpointInputRef}
                type="file"
                accept=".json"
                onChange={handleLedgerOrCheckpointUpload}
                className="sr-only"
                id="checkpoint-import"
              />
              <label
                htmlFor="checkpoint-import"
                className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-slate-700 bg-white border border-slate-300 rounded-md hover:bg-slate-50 cursor-pointer"
              >
                <Upload className="w-3.5 h-3.5" />
                Import Antigravity ledger.json
              </label>
            </div>
          </div>
        </div>

        {/* Right: Live Bangla Print Colophon & Title Page Preview */}
        <div className="lg:col-span-5 border border-slate-200 rounded-xl p-6 bg-slate-50/60 space-y-5 self-start">
          <div className="flex items-center justify-between gap-3">
            <h2 className="text-base font-semibold text-slate-900">
              Bangla Edition Imprint Preview
            </h2>
            <button
              type="button"
              onClick={onOpenPdfPreview}
              className="text-xs font-semibold text-blue-700 hover:text-blue-800 whitespace-nowrap"
            >
              Full Book PDF Preview →
            </button>
          </div>

          {project.coverImageDataUrl && (
            <div
              data-testid="studio-cover-preserved"
              className="bg-white border border-slate-200 rounded-lg p-3 flex items-center gap-3.5"
            >
              <img
                src={project.coverImageDataUrl}
                alt={`Original cover of ${project.title}`}
                className="w-16 h-22 object-contain rounded-xs border border-slate-200 bg-slate-50 shrink-0"
              />
              <div className="min-w-0">
                <div className="text-xs font-semibold text-emerald-800">
                  Original Page 1 Cover Preserved
                </div>
                <p className="text-[11px] text-slate-600 mt-0.5 leading-relaxed">
                  Kept untouched as Page 1 of your Bangla PDF &amp; EPUB, followed by the Bangla title page on Page 2.
                </p>
              </div>
            </div>
          )}

          <div className="bg-white border border-slate-200 rounded-lg p-6 text-center font-bangla">
            <div className="text-xs text-slate-400 mb-3">
              বাংলা সংস্করণ · {activeLayoutSpec.label}
            </div>
            <div className="text-xl font-bold text-slate-900 leading-snug">
              {project.titleBangla || project.title}
            </div>
            <div className="text-xs text-slate-500 font-sans mt-1">Original: {project.title}</div>
            <div className="text-sm font-medium text-slate-800 mt-4">
              {project.authorBangla || project.author}
            </div>

            <div className="my-5 border-t border-slate-200" />

            <div className="text-sm font-semibold text-slate-900">
              {project.publisher.publishingHouseBangla || project.publisher.publishingHouse}
            </div>
            <div className="text-xs text-slate-600 mt-0.5">
              {project.publisher.imprintCity} · {toBengaliDigits(new Date().getFullYear())}
            </div>
            <div className="text-xs text-slate-500 mt-3 leading-relaxed">
              {project.publisher.rightsStatement}
            </div>
          </div>

          <div className="pt-3 border-t border-slate-200/80 space-y-1.5 text-xs text-slate-600">
            <div className="flex items-center justify-between">
              <span className="text-slate-500">Execution Mode</span>
              <span className="font-medium text-slate-800">Antigravity Native (Zero API Key)</span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-slate-500">Active Device Geometry</span>
              <span className="font-mono text-slate-800">
                {activeLayoutSpec.pageSizeCss} · {activeLayoutSpec.maxWidthCh}
              </span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-slate-500">Output Editions</span>
              <span className="font-medium text-slate-800">PDF · EPUB 3.0 · HTML · MD</span>
            </div>
          </div>
        </div>
      </section>

      {/* Preserved Original Graphs, Figures & Pictures Section */}
      <section
        aria-labelledby="preserved-assets-heading"
        className="border border-slate-200 rounded-xl p-6 bg-white"
      >
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 mb-4">
          <div>
            <h2 id="preserved-assets-heading" className="text-base font-semibold text-slate-900">
              Preserved Book Components (Graphs, Figures &amp; Pictures)
            </h2>
            <p className="text-xs text-slate-500 mt-0.5">
              Every visual element extracted from the English book stays 100% untouched behind its{' '}
              <code className="font-mono">[[ASSET:...]]</code> anchor and re-inserts automatically into the final Bangla PDF and EPUB.
            </p>
          </div>
          <div className="text-xs font-mono text-slate-500 tabular-nums">
            {project.assets.length} locked asset{project.assets.length === 1 ? '' : 's'}
          </div>
        </div>

        {project.assets.length === 0 ? (
          <div className="p-8 text-center border border-dashed border-slate-200 rounded-lg bg-slate-50/40">
            <ImageIcon className="w-6 h-6 text-slate-400 mx-auto mb-2" />
            <div className="text-sm font-medium text-slate-700">
              No embedded figures detected in this text
            </div>
            <p className="text-xs text-slate-500 mt-1">
              Upload an illustrated EPUB or DOCX book (or load the Sample Book) to see untouched graphs and images preserved inline.
            </p>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
            {project.assets.map((asset) => (
              <div
                key={asset.id}
                className="border border-slate-200 rounded-lg p-4 bg-slate-50/40 space-y-3"
              >
                <div className="flex items-center justify-between gap-2 text-xs">
                  <span className="font-mono font-semibold text-blue-700">{asset.token}</span>
                  <span className="text-slate-500 font-mono truncate">
                    {asset.kind} · {asset.fileName}
                  </span>
                </div>
                <div className="bg-white border border-slate-200 rounded-md p-2 flex items-center justify-center overflow-hidden">
                  <img
                    src={asset.dataUrl}
                    alt={asset.captionBangla || asset.captionEnglish}
                    referrerPolicy="no-referrer"
                    className="max-h-44 w-auto object-contain"
                  />
                </div>
                <div>
                  <label
                    htmlFor={`caption-${asset.id}`}
                    className="block text-xs font-medium text-slate-700 mb-1"
                  >
                    Bangla Figure Caption
                  </label>
                  <input
                    id={`caption-${asset.id}`}
                    type="text"
                    value={asset.captionBangla}
                    onChange={(e) => onUpdateAssetCaption(asset.id, e.target.value)}
                    className="w-full px-2.5 py-1.5 text-xs font-bangla bg-white border border-slate-300 rounded-md focus:outline-none focus:border-blue-600"
                  />
                </div>
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
