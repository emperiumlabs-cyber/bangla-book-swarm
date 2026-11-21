import { useMemo, useState } from 'react';
import { Check, Copy, Download, FileCode2, FolderGit2 } from 'lucide-react';
import type {
  DeviceLayoutProfile,
  EditorialRegister,
  GlossaryTerm,
  ModelTierProfile,
  PublisherConfig,
  SwarmConcurrencyMode,
} from '../types/translator';
import {
  generateSkillRepositoryFiles,
  getModelTierMeta,
} from '../lib/skillGenerator';
import { downloadSkillRepoZip } from '../utils/downloads';

interface SkillForgeViewProps {
  publisher: PublisherConfig;
  glossary: GlossaryTerm[];
  onUpdatePublisher: (patch: Partial<PublisherConfig>) => void;
  onOpenBookRunner: () => void;
}

const MODEL_TIERS: Array<{ id: ModelTierProfile; label: string; words: number }> = [
  { id: 'weak_local', label: 'Lower Flash / Local LLM (3.5/3.8 Flash · 320w)', words: 320 },
  { id: 'balanced_flash', label: 'Balanced Flash (550 words)', words: 550 },
  { id: 'high_context', label: 'High Context (900 words)', words: 900 },
];

const REGISTERS: Array<{ id: EditorialRegister; label: string }> = [
  { id: 'literary', label: 'Literary Promito Bangla' },
  { id: 'modern', label: 'Modern Non-Fiction Bangla' },
  { id: 'academic', label: 'Academic & Scholarly Bangla' },
];

const LAYOUT_OPTIONS: Array<{ id: DeviceLayoutProfile; label: string }> = [
  { id: 'phone', label: 'Phone (6" Portrait — Default)' },
  { id: 'tablet', label: 'Tablet (8"–10" Reader)' },
  { id: 'print_a5', label: 'Print Book (A5 Paperback)' },
  { id: 'desktop', label: 'Desktop PC (Widescreen)' },
];

const SWARM_OPTIONS: Array<{ id: SwarmConcurrencyMode; label: string }> = [
  { id: 'auto', label: 'Auto-Scale Swarm (10–50 Sub-Agents)' },
  { id: '10', label: '10 Parallel Sub-Agents (Single Book)' },
  { id: '20', label: '20 Parallel Sub-Agents (Large Book)' },
  { id: '50', label: '50 Parallel Sub-Agents (50-Book Batch)' },
];

type EditorTarget = 'antigravity' | 'cursor' | 'gemini_cli' | 'vscode' | 'claude_code';

const EDITOR_INSTALLS: Array<{
  id: EditorTarget;
  label: string;
  hint: string;
  command: string;
}> = [
  {
    id: 'antigravity',
    label: 'Antigravity',
    hint: 'Runs 100% natively on 3.5/3.8 Flash via scripts/chunk-queue.ts with zero extra API key.',
    command:
      'git clone https://github.com/<your-username>/bangla-book-translator-skill.git && cd bangla-book-translator-skill && bash install.sh',
  },
  {
    id: 'cursor',
    label: 'Cursor',
    hint: 'Auto-loads .cursor/rules/bangla-book-translator.mdc when opened in your book workspace.',
    command:
      'git clone https://github.com/<your-username>/bangla-book-translator-skill.git && cd bangla-book-translator-skill && npm install',
  },
  {
    id: 'gemini_cli',
    label: 'Gemini CLI',
    hint: 'Installs SKILL.md into ~/.gemini/skills/bangla-book-translator for immediate CLI activation.',
    command:
      'git clone https://github.com/<your-username>/bangla-book-translator-skill.git ~/.gemini/skills/bangla-book-translator && npm install --prefix ~/.gemini/skills/bangla-book-translator',
  },
  {
    id: 'vscode',
    label: 'VS Code',
    hint: 'Includes .github/copilot-instructions.md plus PowerShell installer (.\\install.ps1) for Windows.',
    command:
      'git clone https://github.com/<your-username>/bangla-book-translator-skill.git; cd bangla-book-translator-skill; .\\install.ps1',
  },
  {
    id: 'claude_code',
    label: 'Claude Code',
    hint: 'Links SKILL.md into ~/.claude/skills/bangla-book-translator via install.sh.',
    command:
      'git clone https://github.com/<your-username>/bangla-book-translator-skill.git && cd bangla-book-translator-skill && bash install.sh',
  },
];

export function SkillForgeView({
  publisher,
  glossary,
  onUpdatePublisher,
  onOpenBookRunner,
}: SkillForgeViewProps) {
  const repoFiles = useMemo(
    () => generateSkillRepositoryFiles(publisher, glossary),
    [publisher, glossary]
  );

  const [selectedPath, setSelectedPath] = useState<string>('SKILL.md');
  const [selectedEditor, setSelectedEditor] = useState<EditorTarget>('antigravity');
  const [copiedKey, setCopiedKey] = useState<string | null>(null);
  const [isDownloading, setIsDownloading] = useState(false);

  const activeFile = repoFiles.find((f) => f.path === selectedPath) ?? repoFiles[0];
  const activeEditor =
    EDITOR_INSTALLS.find((e) => e.id === selectedEditor) ?? EDITOR_INSTALLS[0];
  const tierMeta = getModelTierMeta(publisher.modelTier);

  const handleCopy = async (key: string, text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopiedKey(key);
      setTimeout(() => setCopiedKey(null), 1800);
    } catch {
      // Clipboard fallback unavailable in restricted frames
    }
  };

  const handleDownloadZip = async () => {
    setIsDownloading(true);
    try {
      await downloadSkillRepoZip(repoFiles, publisher.publishingHouse);
    } finally {
      setIsDownloading(false);
    }
  };

  return (
    <div className="space-y-8">
      {/* Hero Summary & Primary Value Proposition */}
      <section className="flex flex-col lg:flex-row lg:items-end justify-between gap-6 pb-6 border-b border-slate-200">
        <div className="max-w-2xl">
          <div className="text-xs font-medium text-slate-500 mb-2">
            Zero API Key Required · Native for Antigravity (3.5/3.8 Flash), Cursor, VS Code, Gemini CLI &amp; Claude Code
          </div>
          <h1 className="text-2xl sm:text-3xl font-bold tracking-tight text-slate-900">
            One-Shot Multi-Agent Bangla Book Translator Skill
          </h1>
          <p className="mt-2.5 text-sm sm:text-base text-slate-600 leading-relaxed">
            Configure your Publishing House once, then drop <strong>1 book or 50+ books</strong> into Antigravity. Spawns <strong>10, 20, or 50+ lock-free parallel sub-agents</strong> on built-in 3.5/3.8 Flash with <strong>zero Gemini API key</strong>, compiling complete professional Bangla books from proper beginning (Title, Colophon, সূচিপত্র) to ending (সমাপ্ত) with exact meaning, zero AI dashes/slop, and untouched graphs and pictures.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-3 shrink-0">
          <button
            type="button"
            onClick={onOpenBookRunner}
            className="px-4 py-2.5 text-sm font-medium text-slate-700 bg-white border border-slate-300 rounded-lg hover:bg-slate-50 transition-colors whitespace-nowrap shrink-0 focus-visible:outline-2 focus-visible:outline-blue-600"
          >
            Prepare Book for Antigravity
          </button>
          <button
            type="button"
            onClick={handleDownloadZip}
            disabled={isDownloading}
            className="inline-flex items-center gap-2 px-4 py-2.5 text-sm font-semibold text-white bg-blue-700 rounded-lg hover:bg-blue-800 disabled:opacity-60 transition-colors whitespace-nowrap shrink-0 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-700"
          >
            <Download className="w-4 h-4" />
            {isDownloading ? 'Packaging ZIP...' : 'Download GitHub Repo (.zip)'}
          </button>
        </div>
      </section>

      {/* Publisher House & Weak-Model Guardrail Configuration */}
      <section aria-labelledby="publisher-config-heading" className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        <div className="lg:col-span-7 border border-slate-200 rounded-xl p-6 bg-white">
          <div className="flex items-center justify-between gap-4 mb-5">
            <div>
              <h2 id="publisher-config-heading" className="text-base font-semibold text-slate-900">
                Publishing House &amp; Translation Rights Imprint
              </h2>
              <p className="text-xs text-slate-500 mt-0.5">
                Only required input — injected automatically into SKILL.md, colophon pages, and PDF/EPUB metadata.
              </p>
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label
                htmlFor="publisher-en"
                className="block text-xs font-medium text-slate-700 mb-1.5"
              >
                Publishing House (English)
              </label>
              <input
                id="publisher-en"
                type="text"
                value={publisher.publishingHouse}
                onChange={(e) => onUpdatePublisher({ publishingHouse: e.target.value })}
                placeholder="e.g. Prothoma Prokashon"
                className="w-full px-3 py-2 text-sm text-slate-900 bg-white border border-slate-300 rounded-lg focus:outline-none focus:border-blue-600 focus:ring-2 focus:ring-blue-100"
              />
            </div>

            <div>
              <label
                htmlFor="publisher-bn"
                className="block text-xs font-medium text-slate-700 mb-1.5"
              >
                Publishing House (Bangla Imprint)
              </label>
              <input
                id="publisher-bn"
                type="text"
                value={publisher.publishingHouseBangla}
                onChange={(e) =>
                  onUpdatePublisher({
                    publishingHouseBangla: e.target.value,
                    rightsStatement: `অনুমোদিত বাংলা অনুবাদ স্বত্ব সংরক্ষিত: ${e.target.value || publisher.publishingHouse}`,
                  })
                }
                placeholder="যেমন: প্রথমা প্রকাশন"
                className="w-full px-3 py-2 text-sm text-slate-900 font-bangla bg-white border border-slate-300 rounded-lg focus:outline-none focus:border-blue-600 focus:ring-2 focus:ring-blue-100"
              />
            </div>

            <div>
              <label
                htmlFor="imprint-city"
                className="block text-xs font-medium text-slate-700 mb-1.5"
              >
                Imprint City
              </label>
              <input
                id="imprint-city"
                type="text"
                value={publisher.imprintCity}
                onChange={(e) => onUpdatePublisher({ imprintCity: e.target.value })}
                placeholder="ঢাকা, বাংলাদেশ"
                className="w-full px-3 py-2 text-sm text-slate-900 font-bangla bg-white border border-slate-300 rounded-lg focus:outline-none focus:border-blue-600 focus:ring-2 focus:ring-blue-100"
              />
            </div>

            <div>
              <label
                htmlFor="editorial-register"
                className="block text-xs font-medium text-slate-700 mb-1.5"
              >
                Bangla Editorial Register
              </label>
              <select
                id="editorial-register"
                value={publisher.register}
                onChange={(e) =>
                  onUpdatePublisher({ register: e.target.value as EditorialRegister })
                }
                className="w-full px-3 py-2 text-sm text-slate-900 bg-white border border-slate-300 rounded-lg focus:outline-none focus:border-blue-600 focus:ring-2 focus:ring-blue-100"
              >
                {REGISTERS.map((reg) => (
                  <option key={reg.id} value={reg.id}>
                    {reg.label}
                  </option>
                ))}
              </select>
            </div>

            <div className="sm:col-span-2">
              <label
                htmlFor="rights-statement"
                className="block text-xs font-medium text-slate-700 mb-1.5"
              >
                Rights Attribution Line (Colophon)
              </label>
              <input
                id="rights-statement"
                type="text"
                value={publisher.rightsStatement}
                onChange={(e) => onUpdatePublisher({ rightsStatement: e.target.value })}
                className="w-full px-3 py-2 text-sm text-slate-900 font-bangla bg-white border border-slate-300 rounded-lg focus:outline-none focus:border-blue-600 focus:ring-2 focus:ring-blue-100"
              />
            </div>
          </div>
        </div>

        {/* Weak-Model Defense, Reading Device & Meaning Guardrails */}
        <div className="lg:col-span-5 border border-slate-200 rounded-xl p-6 bg-slate-50/70">
          <h2 className="text-base font-semibold text-slate-900 mb-1">
            Lower-LLM, Layout &amp; Quality Rules
          </h2>
          <p className="text-xs text-slate-500 mb-4">{tierMeta.description}</p>

          <div className="space-y-4">
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-1 gap-3">
              <div>
                <label
                  htmlFor="model-tier"
                  className="block text-xs font-medium text-slate-700 mb-1.5"
                >
                  Target Model Guardrail Profile
                </label>
                <select
                  id="model-tier"
                  value={publisher.modelTier}
                  onChange={(e) => {
                    const tier = e.target.value as ModelTierProfile;
                    const found = MODEL_TIERS.find((t) => t.id === tier);
                    onUpdatePublisher({
                      modelTier: tier,
                      maxWordsPerChunk: found?.words ?? 320,
                    });
                  }}
                  className="w-full px-3 py-2 text-sm text-slate-900 bg-white border border-slate-300 rounded-lg focus:outline-none focus:border-blue-600 focus:ring-2 focus:ring-blue-100"
                >
                  {MODEL_TIERS.map((t) => (
                    <option key={t.id} value={t.id}>
                      {t.label}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label
                  htmlFor="default-device-layout"
                  className="block text-xs font-medium text-slate-700 mb-1.5"
                >
                  Default Reading Device Layout
                </label>
                <select
                  id="default-device-layout"
                  value={publisher.defaultLayout ?? 'phone'}
                  onChange={(e) =>
                    onUpdatePublisher({
                      defaultLayout: e.target.value as DeviceLayoutProfile,
                    })
                  }
                  className="w-full px-3 py-2 text-sm text-slate-900 bg-white border border-slate-300 rounded-lg focus:outline-none focus:border-blue-600 focus:ring-2 focus:ring-blue-100"
                >
                  {LAYOUT_OPTIONS.map((opt) => (
                    <option key={opt.id} value={opt.id}>
                      {opt.label}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label
                  htmlFor="swarm-concurrency"
                  className="block text-xs font-medium text-slate-700 mb-1.5"
                >
                  Parallel Sub-Agent Swarm Scaling
                </label>
                <select
                  id="swarm-concurrency"
                  value={publisher.swarmConcurrency ?? 'auto'}
                  onChange={(e) =>
                    onUpdatePublisher({
                      swarmConcurrency: e.target.value as SwarmConcurrencyMode,
                    })
                  }
                  className="w-full px-3 py-2 text-sm text-slate-900 bg-white border border-slate-300 rounded-lg focus:outline-none focus:border-blue-600 focus:ring-2 focus:ring-blue-100"
                >
                  {SWARM_OPTIONS.map((opt) => (
                    <option key={opt.id} value={opt.id}>
                      {opt.label}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            <div className="space-y-2.5 pt-1">
              <label className="flex items-start gap-2.5 cursor-pointer">
                <input
                  type="checkbox"
                  checked={publisher.strictZeroEnglish}
                  onChange={(e) => onUpdatePublisher({ strictZeroEnglish: e.target.checked })}
                  className="mt-0.5 h-4 w-4 rounded border-slate-300 text-blue-700 focus:ring-blue-600"
                />
                <span className="text-xs text-slate-700 leading-relaxed">
                  <strong className="font-semibold text-slate-900">100% Bangla &amp; Zero AI Symbols</strong> — reject English leaks, em-dashes, double dashes, emojis, and literal idiom calques.
                </span>
              </label>

              <label className="flex items-start gap-2.5 cursor-pointer">
                <input
                  type="checkbox"
                  checked={publisher.twoPassPolish}
                  onChange={(e) => onUpdatePublisher({ twoPassPolish: e.target.checked })}
                  className="mt-0.5 h-4 w-4 rounded border-slate-300 text-blue-700 focus:ring-blue-600"
                />
                <span className="text-xs text-slate-700 leading-relaxed">
                  <strong className="font-semibold text-slate-900">2-Pass Sense-First Polish</strong> — Pass 1 decodes authorial intent; Pass 2 eliminates literal translationese and meaning drift.
                </span>
              </label>

              <label className="flex items-start gap-2.5 cursor-pointer">
                <input
                  type="checkbox"
                  checked={publisher.preserveAssets}
                  onChange={(e) => onUpdatePublisher({ preserveAssets: e.target.checked })}
                  className="mt-0.5 h-4 w-4 rounded border-slate-300 text-blue-700 focus:ring-blue-600"
                />
                <span className="text-xs text-slate-700 leading-relaxed">
                  <strong className="font-semibold text-slate-900">Lossless Graph &amp; Picture Preservation</strong> — lock original images/diagrams via <code className="font-mono text-[11px]">[[ASSET:...]]</code> anchors.
                </span>
              </label>
            </div>
          </div>
        </div>
      </section>

      {/* Recommended Framework Breakdown (4-column clean grid) */}
      <section aria-labelledby="framework-heading" className="border-t border-slate-200 pt-6">
        <div className="mb-4">
          <h2 id="framework-heading" className="text-base font-semibold text-slate-900">
            Production Framework Architecture
          </h2>
          <p className="text-xs text-slate-500 mt-0.5">
            Engineered so Antigravity on 3.5/3.8 Flash translates 1,000+ page books from any format with exact meaning, zero AI slop, and device-perfect Bangla pages.
          </p>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-5">
          <div className="border border-slate-200 rounded-lg p-4 bg-white">
            <div className="text-xs font-mono text-slate-500 tabular-nums mb-1">01. 1 Book or 50+ Books</div>
            <div className="text-sm font-semibold text-slate-900">Parallel Multi-Format Batch</div>
            <p className="text-xs text-slate-600 mt-1.5 leading-relaxed">
              <code className="font-mono">scripts/batch-extract.ts</code> ingests 1 or 50+ PDFs, EPUBs, DOCXs, ODTs, FB2s, RTFs, or LaTeX books simultaneously, fixing OCR hyphens and locking graphs behind <code className="font-mono">[[ASSET:...]]</code>.
            </p>
          </div>

          <div className="border border-slate-200 rounded-lg p-4 bg-white">
            <div className="text-xs font-mono text-slate-500 tabular-nums mb-1">02. Dynamic Swarm (10–50)</div>
            <div className="text-sm font-semibold text-slate-900">Lock-Free Parallel Sub-Agents</div>
            <p className="text-xs text-slate-600 mt-1.5 leading-relaxed">
              <code className="font-mono">scripts/swarm-orchestrator.ts</code> splits chunks into disjoint shards with atomic per-chunk files so 10, 20, or 50 Antigravity 3.8 Flash sub-agents finish in one shot with zero collisions.
            </p>
          </div>

          <div className="border border-slate-200 rounded-lg p-4 bg-white">
            <div className="text-xs font-mono text-slate-500 tabular-nums mb-1">03. 6-Check Barrier + Speed</div>
            <div className="text-sm font-semibold text-slate-900">Meaning &amp; Zero AI Slop</div>
            <p className="text-xs text-slate-600 mt-1.5 leading-relaxed">
              Enforces 100% completion across every book before build — rejecting literal calques, dropped numbers, em-dashes/double dashes/emojis, or dropped figures (with optional Rust/Rayon speed-up).
            </p>
          </div>

          <div className="border border-slate-200 rounded-lg p-4 bg-white">
            <div className="text-xs font-mono text-slate-500 tabular-nums mb-1">04. Pro Beginning to End</div>
            <div className="text-sm font-semibold text-slate-900">Phone · Tablet · A5 · PC</div>
            <p className="text-xs text-slate-600 mt-1.5 leading-relaxed">
              Parallel PDF builder renders Title Page, Colophon, <span className="font-bangla">সূচিপত্র</span> TOC, rich typography, untouched figures, and <span className="font-bangla">সমাপ্ত</span> back-matter across all 50 books automatically.
            </p>
          </div>
        </div>
      </section>

      {/* Interactive Open-Source GitHub Repository Explorer */}
      <section aria-labelledby="repo-explorer-heading" className="border border-slate-200 rounded-xl overflow-hidden bg-white">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 px-5 py-3.5 bg-slate-50 border-b border-slate-200">
          <div className="flex items-center gap-2.5 min-w-0">
            <FolderGit2 className="w-4 h-4 text-slate-600 shrink-0" />
            <h2 id="repo-explorer-heading" className="text-sm font-semibold text-slate-900 truncate">
              GitHub Repository Package
            </h2>
            <span className="text-xs text-slate-500 font-mono tabular-nums whitespace-nowrap">
              · {repoFiles.length} files · MIT License
            </span>
          </div>

          <div className="flex items-center gap-2 shrink-0">
            <button
              type="button"
              onClick={() => handleCopy('active-file', activeFile.content)}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-slate-700 bg-white border border-slate-300 rounded-md hover:bg-slate-50 transition-colors whitespace-nowrap"
            >
              {copiedKey === 'active-file' ? (
                <>
                  <Check className="w-3.5 h-3.5 text-emerald-600" />
                  Copied
                </>
              ) : (
                <>
                  <Copy className="w-3.5 h-3.5" />
                  Copy {activeFile.label}
                </>
              )}
            </button>
          </div>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-12">
          {/* File list */}
          <div className="lg:col-span-4 xl:col-span-3 border-b lg:border-b-0 lg:border-r border-slate-200 bg-slate-50/40 p-2 max-h-[520px] overflow-y-auto">
            <div role="tablist" aria-label="Skill repository files" className="space-y-0.5">
              {repoFiles.map((file) => {
                const selected = file.path === activeFile.path;
                return (
                  <button
                    key={file.path}
                    type="button"
                    role="tab"
                    aria-selected={selected}
                    onClick={() => setSelectedPath(file.path)}
                    className={`w-full flex items-center gap-2 px-3 py-2 rounded-md text-left text-xs font-mono transition-colors focus-visible:outline-2 focus-visible:outline-blue-600 ${
                      selected
                        ? 'bg-white text-blue-700 font-semibold border border-slate-200 shadow-2xs'
                        : 'text-slate-700 hover:bg-slate-100 border border-transparent'
                    }`}
                  >
                    <FileCode2 className="w-3.5 h-3.5 shrink-0 text-slate-400" />
                    <span className="truncate">{file.path}</span>
                  </button>
                );
              })}
            </div>
          </div>

          {/* Code preview */}
          <div className="lg:col-span-8 xl:col-span-9 flex flex-col min-w-0">
            <div className="px-4 py-2.5 border-b border-slate-100 flex items-center justify-between gap-4 bg-white">
              <div className="text-xs text-slate-600 truncate">
                <span className="font-mono font-medium text-slate-900">{activeFile.path}</span>
                <span className="mx-2 text-slate-300">·</span>
                <span>{activeFile.description}</span>
              </div>
              <span className="text-xs font-mono text-slate-400 tabular-nums shrink-0">
                {activeFile.content.split('\n').length} lines
              </span>
            </div>
            <pre className="p-4 text-xs font-mono text-slate-800 bg-slate-950/[0.02] overflow-auto max-h-[472px] leading-relaxed">
              <code>{activeFile.content}</code>
            </pre>
          </div>
        </div>
      </section>

      {/* Multi-Editor One-Command Install Switcher */}
      <section className="border border-slate-200 rounded-xl p-5 bg-slate-50/70 space-y-3">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-3">
          <div>
            <h3 className="text-sm font-semibold text-slate-900">
              One-Command Code Editor Installation
            </h3>
            <p className="text-xs text-slate-500 mt-0.5">{activeEditor.hint}</p>
          </div>

          <div
            role="tablist"
            aria-label="Target code editor"
            className="flex flex-wrap items-center gap-1 p-1 bg-slate-200/70 rounded-lg"
          >
            {EDITOR_INSTALLS.map((ed) => {
              const active = ed.id === activeEditor.id;
              return (
                <button
                  key={ed.id}
                  type="button"
                  role="tab"
                  aria-selected={active}
                  onClick={() => setSelectedEditor(ed.id)}
                  className={`px-2.5 py-1 text-xs font-medium rounded-md transition-colors whitespace-nowrap ${
                    active
                      ? 'bg-white text-slate-900 shadow-2xs'
                      : 'text-slate-600 hover:text-slate-900'
                  }`}
                >
                  {ed.label}
                </button>
              );
            })}
          </div>
        </div>

        <div className="flex items-center gap-2">
          <div
            data-testid="editor-install-command"
            className="flex-1 p-3 rounded-lg bg-slate-900 text-slate-100 font-mono text-xs overflow-x-auto"
          >
            {activeEditor.command}
          </div>
          <button
            type="button"
            onClick={() => handleCopy('install-cmd', activeEditor.command)}
            className="inline-flex items-center gap-1.5 px-3 py-2.5 text-xs font-medium text-slate-700 bg-white border border-slate-300 rounded-lg hover:bg-slate-50 transition-colors whitespace-nowrap shrink-0"
          >
            {copiedKey === 'install-cmd' ? (
              <>
                <Check className="w-3.5 h-3.5 text-emerald-600" />
                Copied
              </>
            ) : (
              <>
                <Copy className="w-3.5 h-3.5" />
                Copy
              </>
            )}
          </button>
        </div>
      </section>
    </div>
  );
}
