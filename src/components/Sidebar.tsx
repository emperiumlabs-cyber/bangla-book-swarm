import {
  BookOpen,
  FileCode2,
  FileText,
  BookMarked,
  X,
} from 'lucide-react';
import type { BookProject, WorkspaceTab } from '../types/translator';

interface SidebarProps {
  activeTab: WorkspaceTab;
  onSelectTab: (tab: WorkspaceTab) => void;
  project: BookProject;
  isOpenMobile: boolean;
  onCloseMobile: () => void;
}

const NAV_ITEMS: Array<{
  id: WorkspaceTab;
  label: string;
  sublabel: string;
  icon: typeof FileCode2;
}> = [
  {
    id: 'skill',
    label: 'Open-Source Skill',
    sublabel: 'SKILL.md & GitHub ZIP',
    icon: FileCode2,
  },
  {
    id: 'studio',
    label: 'Book Runner',
    sublabel: 'Ingest, assets & pipeline',
    icon: BookOpen,
  },
  {
    id: 'manuscript',
    label: 'Manuscript & Audit',
    sublabel: 'Bilingual proof & purity',
    icon: FileText,
  },
  {
    id: 'glossary',
    label: 'Style Glossary',
    sublabel: 'Locked Bangla terms',
    icon: BookMarked,
  },
];

export function Sidebar({
  activeTab,
  onSelectTab,
  project,
  isOpenMobile,
  onCloseMobile,
}: SidebarProps) {
  const passedCount = project.chunks.filter((c) => c.status === 'passed').length;
  const totalCount = project.chunks.length;
  const pct = totalCount === 0 ? 0 : Math.round((passedCount / totalCount) * 100);

  const navContent = (
    <div className="flex h-full flex-col bg-slate-50 border-r border-slate-200">
      <div className="flex items-center justify-between px-5 h-16 border-b border-slate-200">
        <a
          href="#top"
          onClick={(e) => {
            e.preventDefault();
            onSelectTab('skill');
            onCloseMobile();
          }}
          className="text-lg font-bold tracking-tight text-slate-900 whitespace-nowrap shrink-0"
          style={{ fontFamily: 'var(--font-display)' }}
        >
          LipiForge
        </a>
        <button
          type="button"
          onClick={onCloseMobile}
          aria-label="Close navigation menu"
          className="lg:hidden p-2 text-slate-500 hover:text-slate-900 rounded-md focus-visible:outline-2 focus-visible:outline-blue-600"
        >
          <X className="w-4 h-4" />
        </button>
      </div>

      <nav aria-label="Workspace navigation" className="flex-1 px-3 py-5 space-y-1 overflow-y-auto">
        {NAV_ITEMS.map((item) => {
          const Icon = item.icon;
          const isActive = activeTab === item.id;
          return (
            <button
              key={item.id}
              type="button"
              onClick={() => {
                onSelectTab(item.id);
                onCloseMobile();
              }}
              aria-current={isActive ? 'page' : undefined}
              className={`w-full flex items-start gap-3 px-3 py-2.5 rounded-lg text-left transition-colors focus-visible:outline-2 focus-visible:outline-blue-600 ${
                isActive
                  ? 'bg-white text-slate-900 border border-slate-200 shadow-xs'
                  : 'text-slate-600 hover:text-slate-900 hover:bg-slate-100/80 border border-transparent'
              }`}
            >
              <Icon
                className={`w-4 h-4 mt-0.5 shrink-0 ${
                  isActive ? 'text-blue-700' : 'text-slate-400'
                }`}
              />
              <span className="min-w-0">
                <span className="block text-sm font-semibold leading-tight whitespace-nowrap truncate">
                  {item.label}
                </span>
                <span className="block text-xs text-slate-500 mt-0.5 truncate">
                  {item.sublabel}
                </span>
              </span>
            </button>
          );
        })}
      </nav>

      <div className="p-4 border-t border-slate-200 bg-white">
        <div className="text-xs font-medium text-slate-500 mb-1">Active Manuscript</div>
        <div className="text-sm font-semibold text-slate-900 truncate" title={project.title}>
          {project.title}
        </div>
        <div className="text-xs text-slate-600 font-bangla truncate mt-0.5">
          {project.publisher.publishingHouseBangla || project.publisher.publishingHouse}
        </div>

        <div className="mt-3 pt-3 border-t border-slate-100">
          <div className="flex items-center justify-between text-xs text-slate-600 mb-1.5">
            <span>Verified Bangla</span>
            <span className="font-mono tabular-nums font-medium text-slate-900">
              {passedCount}/{totalCount} ({pct}%)
            </span>
          </div>
          <div className="h-1.5 w-full bg-slate-100 rounded-full overflow-hidden">
            <div
              className="h-full bg-blue-700 transition-transform duration-300 origin-left"
              style={{ width: `${pct}%` }}
            />
          </div>
          <div className="mt-2.5 text-xs text-slate-500 font-mono tabular-nums">
            {project.totalWords.toLocaleString()} words · {project.assets.length} asset{project.assets.length === 1 ? '' : 's'}
          </div>
        </div>
      </div>
    </div>
  );

  return (
    <>
      <aside className="hidden lg:block w-64 shrink-0 h-screen sticky top-0 print:hidden">
        {navContent}
      </aside>

      {isOpenMobile && (
        <div className="fixed inset-0 z-50 lg:hidden flex print:hidden">
          <div
            className="fixed inset-0 bg-slate-900/40"
            onClick={onCloseMobile}
            aria-hidden="true"
          />
          <aside className="relative w-72 max-w-[85vw] h-full z-10">{navContent}</aside>
        </div>
      )}
    </>
  );
}
