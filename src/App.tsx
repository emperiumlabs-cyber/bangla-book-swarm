import { useEffect, useRef, useState } from 'react';
import { BookDown, Menu } from 'lucide-react';
import type {
  BookProject,
  GlossaryTerm,
  PublisherConfig,
  WorkspaceTab,
} from './types/translator';
import { createSampleBookProject } from './lib/sampleBook';
import { auditBanglaTranslation } from './lib/auditor';
import {
  buildTranslationChunks,
  countWords,
  parseBookIntoChapters,
  reindexChunks,
  splitChunkInHalf,
} from './lib/chunker';
import { extractGlossaryCandidatesOffline } from './lib/antigravityBridge';
import { generateSkillRepositoryFiles } from './lib/skillGenerator';
import { downloadAntigravityWorkspaceZip } from './utils/downloads';
import { Sidebar } from './components/Sidebar';
import { SkillForgeView } from './components/SkillForgeView';
import { BookStudioView, type IngestedBookPayload } from './components/BookStudioView';
import { ManuscriptView } from './components/ManuscriptView';
import { GlossaryView } from './components/GlossaryView';
import { PdfPreviewModal } from './components/PdfPreviewModal';

const STORAGE_KEY = 'lipiforge-project-v2';

function loadInitialProject(): BookProject {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as BookProject;
      if (parsed && Array.isArray(parsed.chunks) && parsed.publisher) {
        return {
          ...parsed,
          assets: Array.isArray(parsed.assets) ? parsed.assets : [],
          publisher: {
            ...createSampleBookProject().publisher,
            ...parsed.publisher,
          },
        };
      }
    }
  } catch {
    // Fall back cleanly to deterministic sample project
  }
  return createSampleBookProject();
}

const TAB_TITLES: Record<WorkspaceTab, string> = {
  skill: 'Open-Source Skill',
  studio: 'Book Runner',
  manuscript: 'Manuscript & Audit',
  glossary: 'Style Glossary',
};

export default function App() {
  const [batchBooks, setBatchBooks] = useState<BookProject[]>(() => [loadInitialProject()]);
  const [activeBookId, setActiveBookId] = useState<string>(() => batchBooks[0]?.id ?? '');
  const [activeTab, setActiveTab] = useState<WorkspaceTab>('skill');

  const project = batchBooks.find((b) => b.id === activeBookId) ?? batchBooks[0];

  const [activeChunkId, setActiveChunkId] = useState<string>(() => project.chunks[0]?.id ?? '');
  const [isMobileNavOpen, setIsMobileNavOpen] = useState(false);
  const [isPdfPreviewOpen, setIsPdfPreviewOpen] = useState(false);

  const projectRef = useRef(project);
  projectRef.current = project;
  const batchBooksRef = useRef(batchBooks);
  batchBooksRef.current = batchBooks;

  const updateActiveProject = (updater: (prev: BookProject) => BookProject) => {
    setBatchBooks((books) =>
      books.map((b) => (b.id === projectRef.current.id ? updater(b) : b))
    );
  };

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(project));
    } catch {
      // Ignore storage quota overflow for very large books with heavy images
    }
  }, [project]);

  const updatePublisher = (patch: Partial<PublisherConfig>) => {
    const now = new Date().toISOString();
    setBatchBooks((books) =>
      books.map((b) => ({
        ...b,
        updatedAt: now,
        publisher: { ...b.publisher, ...patch },
      }))
    );
  };

  const updateProjectMeta = (
    patch: Partial<Pick<BookProject, 'title' | 'titleBangla' | 'author' | 'authorBangla'>>
  ) => {
    updateActiveProject((prev) => ({
      ...prev,
      ...patch,
      updatedAt: new Date().toISOString(),
    }));
  };

  const updateAssetCaption = (assetId: string, captionBangla: string) => {
    updateActiveProject((prev) => ({
      ...prev,
      updatedAt: new Date().toISOString(),
      assets: prev.assets.map((a) => (a.id === assetId ? { ...a, captionBangla } : a)),
    }));
  };

  const handleIngestBooks = (payloads: IngestedBookPayload[], mode: 'replace' | 'append') => {
    const current = projectRef.current;
    const now = Date.now();
    const created: BookProject[] = payloads.map((payload, idx) => {
      const chapters = parseBookIntoChapters(payload.rawText);
      const chunks = buildTranslationChunks(chapters, current.publisher.maxWordsPerChunk);
      return {
        id: `book-${now}-${idx}`,
        title: payload.title,
        titleBangla: '',
        author: payload.author,
        authorBangla: '',
        sourceFormat: payload.format,
        fileName: payload.fileName,
        totalWords: countWords(payload.rawText),
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        publisher: current.publisher,
        glossary: current.glossary,
        assets: payload.assets,
        chunks,
      };
    });

    if (mode === 'append') {
      setBatchBooks((prev) => {
        // Drop the default demo sample book automatically when real books are batch-uploaded
        const base = prev.filter((b) => !b.id.startsWith('sample-'));
        return [...base, ...created];
      });
    } else {
      setBatchBooks(created);
    }

    if (created[0]) {
      setActiveBookId(created[0].id);
      setActiveChunkId(created[0].chunks[0]?.id ?? '');
    }
  };

  const handleSelectBatchBook = (bookId: string) => {
    setActiveBookId(bookId);
    const found = batchBooksRef.current.find((b) => b.id === bookId);
    setActiveChunkId(found?.chunks[0]?.id ?? '');
  };

  const handleRemoveBatchBook = (bookId: string) => {
    setBatchBooks((prev) => {
      if (prev.length <= 1) return prev;
      const next = prev.filter((b) => b.id !== bookId);
      if (activeBookId === bookId && next[0]) {
        setActiveBookId(next[0].id);
        setActiveChunkId(next[0].chunks[0]?.id ?? '');
      }
      return next;
    });
  };

  const rechunkBook = (maxWords: number) => {
    const current = projectRef.current;
    const chapterMap = new Map<number, { title: string; texts: string[] }>();
    for (const ck of current.chunks) {
      const existing = chapterMap.get(ck.chapterIndex);
      if (existing) {
        existing.texts.push(ck.sourceText);
      } else {
        chapterMap.set(ck.chapterIndex, { title: ck.chapterTitle, texts: [ck.sourceText] });
      }
    }
    const rebuiltRaw = Array.from(chapterMap.entries())
      .sort((a, b) => a[0] - b[0])
      .map(([, ch]) => `# ${ch.title}\n\n${ch.texts.join('\n\n')}`)
      .join('\n\n');

    const chapters = parseBookIntoChapters(rebuiltRaw);
    const newChunks = buildTranslationChunks(chapters, maxWords);

    updateActiveProject((prev) => ({
      ...prev,
      updatedAt: new Date().toISOString(),
      publisher: { ...prev.publisher, maxWordsPerChunk: maxWords },
      chunks: newChunks,
    }));
    setActiveChunkId(newChunks[0]?.id ?? '');
  };

  const handleEditBangla = (chunkId: string, banglaText: string) => {
    updateActiveProject((prev) => ({
      ...prev,
      updatedAt: new Date().toISOString(),
      chunks: prev.chunks.map((chunk) => {
        if (chunk.id !== chunkId) return chunk;
        const audit = auditBanglaTranslation(chunk.sourceText, banglaText, {
          strictZeroEnglish: prev.publisher.strictZeroEnglish,
          glossary: prev.glossary,
        });
        return {
          ...chunk,
          banglaText,
          audit,
          status: banglaText.trim() ? (audit.passed ? 'passed' : 'needs_retry') : 'pending',
          errorMessage: undefined,
        };
      }),
    }));
  };

  const handleEditChapterTitleBangla = (chunkId: string, chapterTitleBangla: string) => {
    updateActiveProject((prev) => {
      const target = prev.chunks.find((c) => c.id === chunkId);
      if (!target) return prev;
      return {
        ...prev,
        updatedAt: new Date().toISOString(),
        chunks: prev.chunks.map((c) =>
          c.chapterIndex === target.chapterIndex ? { ...c, chapterTitleBangla } : c
        ),
      };
    });
  };

  const handleSplitChunk = (chunkId: string) => {
    updateActiveProject((prev) => {
      const idx = prev.chunks.findIndex((c) => c.id === chunkId);
      if (idx === -1) return prev;
      const pair = splitChunkInHalf(prev.chunks[idx]);
      if (!pair) return prev;
      const nextChunks = [...prev.chunks];
      nextChunks.splice(idx, 1, pair[0], pair[1]);
      setActiveChunkId(pair[0].id);
      return {
        ...prev,
        updatedAt: new Date().toISOString(),
        chunks: reindexChunks(nextChunks),
      };
    });
  };

  const handleExportAntigravityWorkspace = async () => {
    const books = batchBooksRef.current;
    const current = projectRef.current;
    const skillFiles = generateSkillRepositoryFiles(current.publisher, current.glossary);
    await downloadAntigravityWorkspaceZip(books, skillFiles);
  };

  const handleAddGlossaryTerm = (term: Omit<GlossaryTerm, 'id'>) => {
    const newTerm: GlossaryTerm = { ...term, id: `term-${Date.now()}` };
    const now = new Date().toISOString();
    setBatchBooks((books) =>
      books.map((b) => ({
        ...b,
        updatedAt: now,
        glossary: [newTerm, ...b.glossary],
      }))
    );
  };

  const handleDeleteGlossaryTerm = (id: string) => {
    const now = new Date().toISOString();
    setBatchBooks((books) =>
      books.map((b) => ({
        ...b,
        updatedAt: now,
        glossary: b.glossary.filter((g) => g.id !== id),
      }))
    );
  };

  const handleScanGlossaryOffline = (): GlossaryTerm[] => {
    return extractGlossaryCandidatesOffline(projectRef.current);
  };

  return (
    <div className="min-h-screen flex bg-white text-slate-900">
      <Sidebar
        activeTab={activeTab}
        onSelectTab={setActiveTab}
        project={project}
        isOpenMobile={isMobileNavOpen}
        onCloseMobile={() => setIsMobileNavOpen(false)}
      />

      <div className="flex-1 flex flex-col min-w-0">
        {/* Top Bar Contract: Breadcrumb on left, 1 primary action button on right */}
        <header className="sticky top-0 z-30 h-16 bg-white/95 backdrop-blur-xs border-b border-slate-200 px-4 sm:px-6 lg:px-8 flex items-center justify-between gap-4 print:hidden">
          <div className="flex items-center gap-3 min-w-0">
            <button
              type="button"
              onClick={() => setIsMobileNavOpen(true)}
              aria-label="Open navigation menu"
              className="lg:hidden p-2 -ml-2 text-slate-600 hover:text-slate-900 rounded-md"
            >
              <Menu className="w-5 h-5" />
            </button>

            <div className="flex items-center gap-2 text-sm min-w-0">
              <span className="text-slate-500 hidden sm:inline whitespace-nowrap font-bangla">
                {project.publisher.publishingHouseBangla || project.publisher.publishingHouse}
              </span>
              <span className="text-slate-300 hidden sm:inline">/</span>
              <span className="font-semibold text-slate-900 truncate">
                {TAB_TITLES[activeTab]}
              </span>
            </div>
          </div>

          <div className="shrink-0">
            <button
              type="button"
              onClick={() => setIsPdfPreviewOpen(true)}
              className="inline-flex items-center gap-2 px-4 py-2 text-xs sm:text-sm font-semibold text-white bg-slate-900 rounded-lg hover:bg-slate-800 transition-colors whitespace-nowrap shrink-0 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-slate-900"
            >
              <BookDown className="w-4 h-4" />
              Export Bangla PDF
            </button>
          </div>
        </header>

        {/* Main Content Canvas */}
        <main className="flex-1 px-4 sm:px-6 lg:px-8 py-7 max-w-[1280px] w-full mx-auto print:hidden">
          {activeTab === 'skill' && (
            <SkillForgeView
              publisher={project.publisher}
              glossary={project.glossary}
              onUpdatePublisher={updatePublisher}
              onOpenBookRunner={() => setActiveTab('studio')}
            />
          )}

          {activeTab === 'studio' && (
            <BookStudioView
              project={project}
              batchBooks={batchBooks}
              onSelectBatchBook={handleSelectBatchBook}
              onRemoveBatchBook={handleRemoveBatchBook}
              onUpdateProjectMeta={updateProjectMeta}
              onUpdateAssetCaption={updateAssetCaption}
              onIngestBooks={handleIngestBooks}
              onRechunkBook={rechunkBook}
              onExportAntigravityWorkspace={handleExportAntigravityWorkspace}
              onResetSample={() => {
                const sample = createSampleBookProject();
                setBatchBooks([sample]);
                setActiveBookId(sample.id);
                setActiveChunkId(sample.chunks[0]?.id ?? '');
              }}
              onImportCheckpoint={(loaded) => {
                setBatchBooks([loaded]);
                setActiveBookId(loaded.id);
                setActiveChunkId(loaded.chunks[0]?.id ?? '');
              }}
              onOpenManuscript={() => setActiveTab('manuscript')}
              onOpenPdfPreview={() => setIsPdfPreviewOpen(true)}
            />
          )}

          {activeTab === 'manuscript' && (
            <ManuscriptView
              project={project}
              activeChunkId={activeChunkId}
              onSelectChunk={setActiveChunkId}
              onEditBangla={handleEditBangla}
              onEditChapterTitleBangla={handleEditChapterTitleBangla}
              onSplitChunk={handleSplitChunk}
            />
          )}

          {activeTab === 'glossary' && (
            <GlossaryView
              glossary={project.glossary}
              onAddTerm={handleAddGlossaryTerm}
              onDeleteTerm={handleDeleteGlossaryTerm}
              onScanOffline={handleScanGlossaryOffline}
            />
          )}
        </main>
      </div>

      <PdfPreviewModal
        project={project}
        isOpen={isPdfPreviewOpen}
        onClose={() => setIsPdfPreviewOpen(false)}
        onSelectDefaultLayout={(defaultLayout) => updatePublisher({ defaultLayout })}
      />
    </div>
  );
}
