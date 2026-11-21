import type { BookAsset, BookProject, GlossaryTerm, PublisherConfig } from '../types/translator';
import { auditBanglaTranslation } from './auditor';
import { buildTranslationChunks, countWords, parseBookIntoChapters } from './chunker';

export const DEFAULT_PUBLISHER: PublisherConfig = {
  publishingHouse: 'Prothoma Prokashon',
  publishingHouseBangla: 'প্রথমা প্রকাশন',
  imprintCity: 'ঢাকা, বাংলাদেশ',
  rightsStatement: 'অনুমোদিত বাংলা অনুবাদ স্বত্ব সংরক্ষিত: প্রথমা প্রকাশন',
  register: 'literary',
  modelTier: 'full_chapter_swarm',
  defaultLayout: 'phone',
  swarmConcurrency: 'auto',
  maxWordsPerChunk: 3200,
  maxAutoRetries: 3,
  strictZeroEnglish: true,
  twoPassPolish: true,
  preserveAssets: true,
};

// Original vector tidal & printing cadence graph preserved verbatim inside the book
const SAMPLE_GRAPH_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 640 240" width="640" height="240">
  <rect width="640" height="240" fill="#F8FAFC"/>
  <rect x="12" y="12" width="616" height="216" fill="#FFFFFF" stroke="#CBD5E1" stroke-width="1"/>
  <line x1="64" y1="188" x2="592" y2="188" stroke="#64748B" stroke-width="1.2"/>
  <line x1="64" y1="42" x2="64" y2="188" stroke="#64748B" stroke-width="1.2"/>
  <line x1="64" y1="140" x2="592" y2="140" stroke="#E2E8F0" stroke-dasharray="4 4"/>
  <line x1="64" y1="92" x2="592" y2="92" stroke="#E2E8F0" stroke-dasharray="4 4"/>
  <path d="M 64 166 C 128 166, 152 68, 224 68 C 296 68, 326 154, 398 154 C 468 154, 502 58, 578 58" fill="none" stroke="#1D4ED8" stroke-width="2.5"/>
  <path d="M 64 176 L 146 146 L 224 118 L 312 128 L 398 112 L 490 88 L 578 76" fill="none" stroke="#0F172A" stroke-width="1.8" stroke-dasharray="5 3"/>
  <circle cx="224" cy="68" r="4.5" fill="#1D4ED8"/>
  <circle cx="398" cy="154" r="4.5" fill="#1D4ED8"/>
  <circle cx="578" cy="58" r="4.5" fill="#1D4ED8"/>
  <text x="72" y="34" font-family="sans-serif" font-size="11" font-weight="600" fill="#0F172A">FIG 1.1 — ESTUARY TIDE LEVEL vs. PRESS OUTPUT (WINTER CYCLE)</text>
  <text x="64" y="208" font-family="monospace" font-size="10" fill="#475569">00:00</text>
  <text x="210" y="208" font-family="monospace" font-size="10" fill="#475569">06:00 (High)</text>
  <text x="382" y="208" font-family="monospace" font-size="10" fill="#475569">12:00 (Low)</text>
  <text x="536" y="208" font-family="monospace" font-size="10" fill="#475569">18:00 (Peak)</text>
</svg>`;

function encodeSvgDataUrl(svg: string): string {
  const bytes = new TextEncoder().encode(svg);
  let binary = '';
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return `data:image/svg+xml;base64,${btoa(binary)}`;
}

export const SAMPLE_ASSETS: BookAsset[] = [
  {
    id: 'fig-01',
    token: '[[ASSET:fig-01]]',
    kind: 'graph',
    mimeType: 'image/svg+xml',
    dataUrl: encodeSvgDataUrl(SAMPLE_GRAPH_SVG),
    fileName: 'fig-01-estuary-tide-graph.svg',
    captionEnglish: 'Figure 1.1: Estuary tide height and winter cylinder-press output at Clockwork Harbor.',
    captionBangla: 'চিত্র ১.১: ক্লকওয়ার্ক হারবারের মোহনায় জোয়ারের উচ্চতা এবং শীতকালীন ছাপাখানার উৎপাদন সূচক।',
  },
];

export const SAMPLE_GLOSSARY: GlossaryTerm[] = [
  {
    id: 'g-1',
    english: 'Alden Vance',
    bangla: 'অ্যালডেন ভ্যান্স',
    category: 'person',
    notes: 'Protagonist — keep transliteration identical in every chapter',
  },
  {
    id: 'g-2',
    english: 'Clockwork Harbor',
    bangla: 'ক্লকওয়ার্ক হারবার',
    category: 'place',
    notes: 'Coastal printing town',
  },
  {
    id: 'g-3',
    english: 'Lead Typesetter',
    bangla: 'সিসার অক্ষর-বিন্যাসক',
    category: 'term',
    notes: 'Traditional letterpress craft role',
  },
  {
    id: 'g-4',
    english: 'The Folio of Tides',
    bangla: 'জোয়ারের ফোলিও',
    category: 'title',
    notes: 'Recurring manuscript referenced across chapters',
  },
];

const SAMPLE_BOOK_RAW = `# Chapter 1: The Lantern at Clockwork Harbor

Every winter before the river froze, **Alden Vance** walked down the narrow stone quay of Clockwork Harbor with a leather satchel strapped across his shoulder. Inside the satchel rested three hundred unbound pages of *The Folio of Tides*, smelling faintly of linseed ink and damp salt air. ==The town slept beneath a slate sky, yet the tall windows of the old printing press glowed warm amber against the mist.==

[[ASSET:fig-01]]

> "A book that crosses oceans cannot wait for lazy mornings — every line must arrive intact, as if written in its new tongue from the very first breath."

Inside the pressroom, the **Lead Typesetter** was already sorting brass matrices by hand. He did not turn around when the heavy oak door swung open, because he recognized the steady cadence of Alden's boots on the timber floorboards. ~Archival Note: Recorded in the Harbor Press Ledger, Winter 1894.~

# Chapter 2: Ink, Memory, and the Unbroken Line

Alden placed the manuscript upon the oak proofing table and untied the linen cord. For twelve years he had studied how stories survive when carried from one tongue into another. Most hurried translations broke like brittle glass: they copied every dictionary meaning while losing the heartbeat that made a reader lean closer to the lamp.

He opened the first signature and ran his thumb along the margin notes. ==Each character's name had to ring true from the prologue to the final colophon.== If a harbor changed its name halfway through the voyage, the reader would wake from the dream and notice the machinery behind the curtain.

# Chapter 3: The Press Awakens at Dawn

When the first pale streak of daylight crossed the eastern estuary, the iron cylinder press began to turn. Sheet after sheet emerged damp and crisp, carrying centuries of distant thought in a script that belonged completely to its new home. Neither the cold wind off the bay nor the length of the manuscript could slow the rhythm of the rollers.

By noon the first bound proof sat beside a steaming cup of tea. Alden opened the title page, checked the imprint of the publishing house at the foot of the sheet, and smiled. **Every paragraph stood intact**, every metaphor breathed naturally, and not a single stray foreign syllable broke the spell of the page.`;

const PRETRANSLATED_CHAPTER_1 = `প্রতি বছর শীতকালে নদী জমে যাওয়ার আগে **অ্যালডেন ভ্যান্স** কাঁধে চামড়ার ঝোলা ঝুলিয়ে ক্লকওয়ার্ক হারবারের সরু পাথরের ঘাট ধরে নেমে যেতেন। ঝোলার ভেতরে ছিল *জোয়ারের ফোলিও*-র তিনশত বাঁধাইহীন পাতা, যেগুলো থেকে তিসির তেলের কালি আর ভেজা লোনা বাতাসের মৃদু গন্ধ ভেসে আসত। ==স্লেট-রঙা আকাশের নিচে গোটা শহর তখনো গভীর ঘুমে আচ্ছন্ন, তবু পুরোনো ছাপাখানার উঁচু জানালাগুলো কুয়াশার বুক চিরে উষ্ণ অ্যাম্বার আলোয় জ্বলজ্বল করত।==

[[ASSET:fig-01]]

> “যে বই সাগর পাড়ি দেবে, সে কখনোই অলস সকালের জন্য অপেক্ষা করে বসে থাকতে পারে না; প্রতিটি পঙ্‌ক্তি অক্ষত অবস্থায় পৌঁছাতে হবে, যেন প্রথম নিশ্বাস থেকেই সেটি নতুন ভাষায় রচিত হয়েছিল।”

ছাপাখানার ভেতরে **সিসার অক্ষর-বিন্যাসক** ততক্ষণে হাত দিয়ে পিতলের ছাঁচগুলো আলাদা করছিলেন। ভারী ওক কাঠের দরজা খুলে যাওয়ার শব্দেও তিনি পেছন ফিরে তাকালেন না, কারণ কাঠের মেঝেতে অ্যালডেনের বুটের চেনা ছন্দময় পায়ের শব্দ তিনি ঠিকই চিনতে পেরেছিলেন। ~আর্কাইভ নোট: হারবার ছাপাখানার খাতায় লিপিবদ্ধ, শীতকাল ১৮৯৪।~`;

const PRETRANSLATED_CHAPTER_2 = `অ্যালডেন পাণ্ডুলিপিটি ওক কাঠের প্রুফ দেখার টেবিলের ওপর রাখলেন এবং লিনেনের সুতোটি খুলে দিলেন। দীর্ঘ ১২ বছর ধরে তিনি নিবিড়ভাবে গবেষণা করেছেন যে, একটি ভাষা থেকে অন্য ভাষায় রূপান্তরিত হওয়ার সময় গল্প কীভাবে নিজের প্রাণশক্তি অক্ষুণ্ণ রাখে। তাড়াহুড়ো করে করা বেশির ভাগ অনুবাদই ভঙ্গুর কাচের মতো ভেঙে যায়: সেগুলো অভিধানের প্রতিটি আক্ষরিক অর্থ হুবহু তুলে ধরে ঠিকই, কিন্তু পাঠককে বাতির আলোর কাছে টেনে আনার সেই আসল হৃদস্পন্দনটুকু হারিয়ে ফেলে।

তিনি প্রথম ফর্মাটি খুললেন এবং পাতার মার্জিনে লেখা টীকাগুলোর ওপর বুড়ো আঙুল বুলিয়ে গেলেন। ==ভূমিকা থেকে শেষ মুদ্রণ-পরিচিতি পর্যন্ত প্রতিটি চরিত্রের নাম যেন একসুরে আর অভিন্ন রূপে ধ্বনিত হয়।== সমুদ্রযাত্রার মাঝপথে কোনো বন্দরের নাম যদি বদলে যায়, তবে পাঠক সেই গল্পের ঘোর থেকে আচমকাই জেগে ওঠেন এবং পর্দার আড়ালের যান্ত্রিকতা তাঁর চোখে ধরা পড়ে যায়।`;

const PRETRANSLATED_CHAPTER_3 = `ভোরের প্রথম ম্লান আলোকরেখা যখন পূর্ব দিকের মোহনা ছুঁয়ে গেল, তখন লোহার সিলিন্ডার ছাপাখানাটি ঘুরতে শুরু করল। একের পর এক ভেজা আর ঝকঝকে পাতা বেরিয়ে আসতে লাগল, যেগুলোর বুকে দূরের শতাব্দীর ভাবনাগুলো এমন এক লিপিতে ধারণ করা ছিল যা সম্পূর্ণভাবে তার নতুন আবাসের নিজস্ব হয়ে উঠেছে। উপসাগর থেকে ধেয়ে আসা শীতল বাতাস কিংবা পাণ্ডুলিপির বিশাল দৈর্ঘ্য, কোনোটাই রোলারগুলোর ছন্দময় গতিকে ধীর করতে পারল না।

দুপুর নাগাদ প্রথম বাঁধাই করা প্রুফ কপিটি ধোঁয়া ওঠা এক কাপ চায়ের পাশে এসে বসল। অ্যালডেন শিরোনাম পাতাটি খুললেন, পাতার নিচে প্রকাশনা প্রতিষ্ঠানের নামফলকটি পরীক্ষা করে দেখলেন এবং মৃদু হাসলেন। **প্রতিটি অনুচ্ছেদ অক্ষত অবস্থায় দাঁড়িয়ে আছে**, প্রতিটি উপমা স্বাভাবিক ছন্দে শ্বাস নিচ্ছে, আর একটি মাত্র অযাচিত বিদেশি শব্দাংশও পাতার সেই সাহিত্যিক মাধুর্য নষ্ট করতে পারেনি।`;

export function createSampleBookProject(): BookProject {
  const chapters = parseBookIntoChapters(SAMPLE_BOOK_RAW);
  const chunks = buildTranslationChunks(chapters, DEFAULT_PUBLISHER.maxWordsPerChunk);

  const pretranslated: Array<{ titleBn: string; textBn: string }> = [
    {
      titleBn: 'অধ্যায় ১: ক্লকওয়ার্ক হারবারের লণ্ঠন',
      textBn: PRETRANSLATED_CHAPTER_1,
    },
    {
      titleBn: 'অধ্যায় ২: কালি, স্মৃতি এবং অখণ্ড ধারা',
      textBn: PRETRANSLATED_CHAPTER_2,
    },
    {
      titleBn: 'অধ্যায় ৩: ভোরের আলোয় জেগে ওঠা ছাপাখানা',
      textBn: PRETRANSLATED_CHAPTER_3,
    },
  ];

  pretranslated.forEach((item, index) => {
    const ck = chunks[index];
    if (!ck) return;
    ck.chapterTitleBangla = item.titleBn;
    ck.banglaText = item.textBn;
    ck.attempts = 1;
    ck.audit = auditBanglaTranslation(ck.sourceText, item.textBn, {
      strictZeroEnglish: DEFAULT_PUBLISHER.strictZeroEnglish,
      glossary: SAMPLE_GLOSSARY,
    });
    ck.status = ck.audit.passed ? 'passed' : 'needs_retry';
  });

  return {
    id: 'sample-folio-of-tides',
    title: 'The Folio of Tides',
    titleBangla: 'জোয়ারের ফোলিও',
    author: 'Eleanor Marlowe',
    authorBangla: 'এলিনর মার্লো',
    sourceFormat: 'md',
    fileName: 'the-folio-of-tides-sample.md',
    totalWords: countWords(SAMPLE_BOOK_RAW),
    createdAt: '2026-11-20T10:00:00.000Z',
    updatedAt: '2026-11-20T10:00:00.000Z',
    publisher: { ...DEFAULT_PUBLISHER },
    glossary: SAMPLE_GLOSSARY.map((g) => ({ ...g })),
    assets: SAMPLE_ASSETS.map((a) => ({ ...a })),
    chunks,
  };
}
