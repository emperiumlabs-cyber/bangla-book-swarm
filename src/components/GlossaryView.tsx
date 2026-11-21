import { useMemo, useRef, useState } from 'react';
import { Plus, ScanSearch, Search, Trash2 } from 'lucide-react';
import type { GlossaryTerm } from '../types/translator';

interface GlossaryViewProps {
  glossary: GlossaryTerm[];
  onAddTerm: (term: Omit<GlossaryTerm, 'id'>) => void;
  onDeleteTerm: (id: string) => void;
  onScanOffline: () => GlossaryTerm[];
}

const CATEGORIES: Array<{ id: GlossaryTerm['category']; label: string }> = [
  { id: 'person', label: 'Person' },
  { id: 'place', label: 'Place' },
  { id: 'title', label: 'Work / Title' },
  { id: 'term', label: 'Key Term' },
];

export function GlossaryView({
  glossary,
  onAddTerm,
  onDeleteTerm,
  onScanOffline,
}: GlossaryViewProps) {
  const banglaInputRef = useRef<HTMLInputElement>(null);

  const [search, setSearch] = useState('');
  const [categoryFilter, setCategoryFilter] = useState<'all' | GlossaryTerm['category']>('all');
  const [english, setEnglish] = useState('');
  const [bangla, setBangla] = useState('');
  const [category, setCategory] = useState<GlossaryTerm['category']>('person');
  const [notes, setNotes] = useState('');
  const [formError, setFormError] = useState<string | null>(null);
  const [detectedCandidates, setDetectedCandidates] = useState<GlossaryTerm[]>([]);
  const [scanNotice, setScanNotice] = useState<string | null>(null);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return glossary.filter((item) => {
      if (categoryFilter !== 'all' && item.category !== categoryFilter) return false;
      if (!q) return true;
      return (
        item.english.toLowerCase().includes(q) ||
        item.bangla.toLowerCase().includes(q) ||
        (item.notes ?? '').toLowerCase().includes(q)
      );
    });
  }, [glossary, search, categoryFilter]);

  const handleScanOffline = () => {
    const candidates = onScanOffline();
    setDetectedCandidates(candidates);
    if (candidates.length === 0) {
      setScanNotice(
        'Offline scan complete (Zero API Key) — all recurring proper nouns in this manuscript are already locked in your glossary.'
      );
    } else {
      setScanNotice(
        `Detected ${candidates.length} unlocked proper noun(s) offline (Zero API Key). Select any entity below to lock its Bangla spelling.`
      );
    }
  };

  const handleSelectCandidate = (candidate: GlossaryTerm) => {
    setEnglish(candidate.english);
    setCategory(candidate.category);
    setNotes(candidate.notes ?? '');
    setBangla('');
    setFormError(null);
    banglaInputRef.current?.focus();
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!english.trim() || !bangla.trim()) {
      setFormError('Both English source term and locked Bangla rendering are required.');
      return;
    }
    setFormError(null);
    const trimmedEnglish = english.trim();
    onAddTerm({
      english: trimmedEnglish,
      bangla: bangla.trim(),
      category,
      notes: notes.trim(),
    });
    setDetectedCandidates((prev) =>
      prev.filter((c) => c.english.toLowerCase() !== trimmedEnglish.toLowerCase())
    );
    setEnglish('');
    setBangla('');
    setNotes('');
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-4 pb-5 border-b border-slate-200">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-slate-900">
            Book-Wide Style Glossary
          </h1>
          <p className="text-sm text-slate-600 mt-1">
            Lock character names, places, and domain vocabulary once so Chapter 1 and Chapter 40 use identical Bangla spellings even on lower Flash models. Exported directly inside your Antigravity workspace.
          </p>
        </div>

        <button
          type="button"
          onClick={handleScanOffline}
          className="inline-flex items-center gap-2 px-4 py-2 text-sm font-medium text-white bg-slate-900 rounded-lg hover:bg-slate-800 transition-colors whitespace-nowrap shrink-0"
        >
          <ScanSearch className="w-4 h-4" />
          Scan Book Entities (Offline)
        </button>
      </div>

      {scanNotice && (
        <div
          role="status"
          data-testid="offline-scan-status"
          className="p-3.5 text-xs text-slate-800 bg-slate-50 border border-slate-200 rounded-lg space-y-2.5"
        >
          <div className="font-medium">{scanNotice}</div>
          {detectedCandidates.length > 0 && (
            <div className="flex flex-wrap gap-2">
              {detectedCandidates.map((cand) => (
                <button
                  key={cand.id}
                  type="button"
                  onClick={() => handleSelectCandidate(cand)}
                  className="px-2.5 py-1 text-xs font-medium text-blue-800 bg-white border border-blue-200 rounded-md hover:bg-blue-50 transition-colors"
                >
                  + {cand.english}
                </button>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Add new glossary entry form */}
      <form
        onSubmit={handleSubmit}
        className="border border-slate-200 rounded-xl p-5 bg-slate-50/70 space-y-4"
        noValidate
      >
        <div className="text-sm font-semibold text-slate-900">Add Locked Term</div>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-12 gap-3">
          <div className="lg:col-span-3">
            <label htmlFor="glossary-en" className="block text-xs font-medium text-slate-700 mb-1">
              English Term
            </label>
            <input
              id="glossary-en"
              type="text"
              value={english}
              onChange={(e) => setEnglish(e.target.value)}
              placeholder="e.g. Harbor Master"
              className="w-full px-3 py-2 text-sm bg-white border border-slate-300 rounded-lg focus:outline-none focus:border-blue-600"
            />
          </div>

          <div className="lg:col-span-3">
            <label htmlFor="glossary-bn" className="block text-xs font-medium text-slate-700 mb-1">
              Locked Bangla Rendering
            </label>
            <input
              ref={banglaInputRef}
              id="glossary-bn"
              type="text"
              value={bangla}
              onChange={(e) => setBangla(e.target.value)}
              placeholder="যেমন: বন্দর অধ্যক্ষ"
              className="w-full px-3 py-2 text-sm font-bangla bg-white border border-slate-300 rounded-lg focus:outline-none focus:border-blue-600"
            />
          </div>

          <div className="lg:col-span-2">
            <label htmlFor="glossary-cat" className="block text-xs font-medium text-slate-700 mb-1">
              Category
            </label>
            <select
              id="glossary-cat"
              value={category}
              onChange={(e) => setCategory(e.target.value as GlossaryTerm['category'])}
              className="w-full px-3 py-2 text-sm bg-white border border-slate-300 rounded-lg focus:outline-none focus:border-blue-600"
            >
              {CATEGORIES.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.label}
                </option>
              ))}
            </select>
          </div>

          <div className="lg:col-span-3">
            <label
              htmlFor="glossary-notes"
              className="block text-xs font-medium text-slate-700 mb-1"
            >
              Editorial Note (Optional)
            </label>
            <input
              id="glossary-notes"
              type="text"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Usage context"
              className="w-full px-3 py-2 text-sm bg-white border border-slate-300 rounded-lg focus:outline-none focus:border-blue-600"
            />
          </div>

          <div className="lg:col-span-1 flex items-end">
            <button
              type="submit"
              className="w-full inline-flex items-center justify-center gap-1 px-3 py-2 text-sm font-medium text-white bg-blue-700 rounded-lg hover:bg-blue-800 transition-colors whitespace-nowrap"
            >
              <Plus className="w-4 h-4" />
              Add
            </button>
          </div>
        </div>

        {formError && (
          <div role="alert" className="text-xs font-medium text-red-700">
            {formError}
          </div>
        )}
      </form>

      {/* Search & Category segmented filter */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div className="relative max-w-xs w-full">
          <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
          <input
            type="search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search English or Bangla term..."
            aria-label="Search glossary terms"
            className="w-full pl-9 pr-3 py-2 text-sm bg-white border border-slate-300 rounded-lg focus:outline-none focus:border-blue-600"
          />
        </div>

        <div className="flex items-center gap-1 p-1 bg-slate-100 rounded-lg overflow-x-auto">
          {(['all', 'person', 'place', 'title', 'term'] as const).map((cat) => (
            <button
              key={cat}
              type="button"
              onClick={() => setCategoryFilter(cat)}
              className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors whitespace-nowrap ${
                categoryFilter === cat
                  ? 'bg-white text-slate-900 shadow-2xs'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              {cat === 'all'
                ? `All (${glossary.length})`
                : CATEGORIES.find((c) => c.id === cat)?.label}
            </button>
          ))}
        </div>
      </div>

      {/* Glossary Table */}
      <div className="border border-slate-200 rounded-xl overflow-hidden bg-white">
        {filtered.length === 0 ? (
          <div className="p-10 text-center">
            <div className="text-sm font-medium text-slate-900">No glossary entries match</div>
            <p className="text-xs text-slate-500 mt-1">
              Add a locked term above or run Scan Book Entities (Offline) on your manuscript.
            </p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="border-b border-slate-200 bg-slate-50 text-xs font-semibold text-slate-600">
                  <th className="py-2.5 px-4">English Source</th>
                  <th className="py-2.5 px-4">Locked Bangla</th>
                  <th className="py-2.5 px-4">Category</th>
                  <th className="py-2.5 px-4">Editorial Note</th>
                  <th className="py-2.5 px-4 text-right">Action</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 text-sm">
                {filtered.map((item) => (
                  <tr key={item.id} className="hover:bg-slate-50/70 transition-colors">
                    <td className="py-2.5 px-4 font-medium text-slate-900">{item.english}</td>
                    <td className="py-2.5 px-4 font-bangla text-slate-900">{item.bangla}</td>
                    <td className="py-2.5 px-4 text-xs text-slate-600 capitalize">
                      {item.category}
                    </td>
                    <td className="py-2.5 px-4 text-xs text-slate-500">{item.notes || '—'}</td>
                    <td className="py-2.5 px-4 text-right">
                      <button
                        type="button"
                        onClick={() => onDeleteTerm(item.id)}
                        aria-label={`Delete glossary term '${item.english}'`}
                        className="p-1.5 text-slate-400 hover:text-red-600 rounded-md transition-colors focus-visible:outline-2 focus-visible:outline-red-600"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
