export type EditorialRegister = 'literary' | 'modern' | 'academic';

export type ModelTierProfile =
  | 'full_chapter_swarm'
  | 'smart_block_swarm'
  | 'weak_local'
  | 'balanced_flash'
  | 'high_context';

export type DeviceLayoutProfile = 'phone' | 'tablet' | 'print_a5' | 'print_a4' | 'desktop';

export type SwarmConcurrencyMode = 'auto' | '10' | '20' | '50';

export type FastEngineMode = 'rust_typst_auto' | 'node_chromium';

export type ChunkStatus = 'pending' | 'translating' | 'passed' | 'needs_retry' | 'error';

export type RetryAction = 'none' | 'retranslate_strict' | 'split_and_retry';

export interface BookAsset {
  id: string;
  token: string;
  kind: 'image' | 'graph' | 'diagram' | 'table';
  mimeType: string;
  dataUrl: string;
  fileName: string;
  captionEnglish: string;
  captionBangla: string;
}

export interface PublisherConfig {
  publishingHouse: string;
  publishingHouseBangla: string;
  imprintCity: string;
  rightsStatement: string;
  register: EditorialRegister;
  modelTier: ModelTierProfile;
  defaultLayout: DeviceLayoutProfile;
  swarmConcurrency?: SwarmConcurrencyMode;
  fastEngine?: FastEngineMode;
  maxWordsPerChunk: number;
  maxAutoRetries: number;
  strictZeroEnglish: boolean;
  twoPassPolish: boolean;
  preserveAssets: boolean;
}

export interface GlossaryTerm {
  id: string;
  english: string;
  bangla: string;
  category: 'person' | 'place' | 'term' | 'title';
  notes?: string;
}

export interface AuditResult {
  passed: boolean;
  banglaPurityPct: number;
  paragraphRatio: number;
  lengthRatio: number;
  leakedEnglishWords: string[];
  shortcutDetected: boolean;
  missingGlossaryTerms: string[];
  missingAssets: string[];
  preservedAssetsCount: number;
  formattingPreserved: boolean;
  meaningFidelityPassed: boolean;
  literalCalquesDetected: string[];
  missingNumbers: string[];
  aiSlopSymbolsDetected: string[];
  issues: string[];
  retryAction: RetryAction;
}

export interface TranslationChunk {
  id: string;
  chapterIndex: number;
  chapterTitle: string;
  chapterTitleBangla: string;
  chunkIndex: number;
  sourceText: string;
  banglaText: string;
  wordCount: number;
  contextTail: string;
  status: ChunkStatus;
  attempts: number;
  audit: AuditResult | null;
  errorMessage?: string;
  splitDepth: number;
}

export interface BookProject {
  id: string;
  title: string;
  titleBangla: string;
  author: string;
  authorBangla: string;
  sourceFormat: 'pdf' | 'epub' | 'docx' | 'odt' | 'fb2' | 'rtf' | 'html' | 'tex' | 'md' | 'txt';
  fileName: string;
  totalWords: number;
  createdAt: string;
  updatedAt: string;
  publisher: PublisherConfig;
  glossary: GlossaryTerm[];
  assets: BookAsset[];
  coverImageDataUrl?: string;
  coverFileName?: string;
  chunks: TranslationChunk[];
}

export interface SkillRepoFile {
  path: string;
  label: string;
  language: 'markdown' | 'typescript' | 'json' | 'text' | 'rust' | 'toml';
  description: string;
  content: string;
}

export type WorkspaceTab = 'skill' | 'studio' | 'manuscript' | 'glossary';
