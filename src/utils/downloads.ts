import JSZip from 'jszip';
import type { BookProject, DeviceLayoutProfile, SkillRepoFile } from '../types/translator';
import {
  assembleBanglaMarkdown,
  assemblePrintReadyHtml,
  buildEpubFileEntries,
} from '../lib/exporters';
import { slugifyPublisher } from '../lib/skillGenerator';
import { buildAntigravityLedgerJson } from '../lib/antigravityBridge';
import { buildSwarmPlan } from '../lib/swarmPlanner';

export function triggerBlobDownload(blob: Blob, fileName: string) {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = fileName;
  document.body.appendChild(anchor);
  anchor.click();
  document.body.removeChild(anchor);
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export async function downloadSkillRepoZip(files: SkillRepoFile[], publishingHouse: string) {
  const zip = new JSZip();
  const rootFolderName = `bangla-book-translator-${slugifyPublisher(publishingHouse)}`;
  const folder = zip.folder(rootFolderName);
  if (!folder) return;

  for (const file of files) {
    folder.file(file.path, file.content);
  }

  const blob = await zip.generateAsync({ type: 'blob', compression: 'DEFLATE' });
  triggerBlobDownload(blob, `${rootFolderName}.zip`);
}

export async function downloadBanglaEpub(project: BookProject) {
  const zip = new JSZip();
  const entries = buildEpubFileEntries(project);

  for (const entry of entries) {
    if (entry.compress === false) {
      zip.file(entry.path, entry.content, { compression: 'STORE' });
    } else if (entry.base64) {
      zip.file(entry.path, entry.content, { base64: true, compression: 'DEFLATE' });
    } else {
      zip.file(entry.path, entry.content, { compression: 'DEFLATE' });
    }
  }

  const blob = await zip.generateAsync({
    type: 'blob',
    mimeType: 'application/epub+zip',
  });
  const slug = slugifyPublisher(project.title || 'bangla-book');
  triggerBlobDownload(blob, `${slug}-bangla.epub`);
}

export function downloadBanglaPrintHtml(
  project: BookProject,
  layoutProfile?: DeviceLayoutProfile
) {
  const profile = layoutProfile ?? project.publisher.defaultLayout ?? 'phone';
  const html = assemblePrintReadyHtml(project, profile);
  const blob = new Blob([html], { type: 'text/html;charset=utf-8' });
  const slug = slugifyPublisher(project.title || 'bangla-book');
  triggerBlobDownload(blob, `${slug}-bangla-${profile}.html`);
}

export async function downloadRealBanglaPdf(
  project: BookProject,
  layoutProfile?: DeviceLayoutProfile
): Promise<boolean> {
  const profile = layoutProfile ?? project.publisher.defaultLayout ?? 'phone';
  const html = assemblePrintReadyHtml(project, profile);
  const slug = slugifyPublisher(project.title || 'bangla-book');
  const fileName = `${slug}-bangla-${profile}.pdf`;

  const res = await fetch('/api/render-pdf', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ html, fileName }),
  });

  if (!res.ok) {
    return false;
  }

  const pdfBlob = await res.blob();
  triggerBlobDownload(pdfBlob, fileName);
  return true;
}

export function downloadBanglaMarkdown(project: BookProject) {
  const md = assembleBanglaMarkdown(project);
  const blob = new Blob([md], { type: 'text/markdown;charset=utf-8' });
  const slug = slugifyPublisher(project.title || 'bangla-book');
  triggerBlobDownload(blob, `${slug}-bangla.md`);
}

export function downloadCheckpointJson(project: BookProject) {
  const blob = new Blob([JSON.stringify(project, null, 2)], {
    type: 'application/json;charset=utf-8',
  });
  const slug = slugifyPublisher(project.title || 'bangla-book');
  triggerBlobDownload(blob, `${slug}-checkpoint.json`);
}

export async function downloadAntigravityWorkspaceZip(
  projects: BookProject[],
  skillFiles: SkillRepoFile[]
) {
  if (projects.length === 0) return;
  const primary = projects[0];
  const zip = new JSZip();
  const rootSlug =
    projects.length > 1
      ? `batch-${projects.length}-books`
      : slugifyPublisher(primary.title || 'bangla-book');
  const rootName = `antigravity-bangla-swarm-${rootSlug}`;
  const folder = zip.folder(rootName);
  if (!folder) return;

  for (const file of skillFiles) {
    folder.file(file.path, file.content);
  }

  const usedSlugs = new Set<string>();
  const manifestBooks: Array<{
    slug: string;
    sourceFile: string;
    ledgerPath: string;
    chunks: number;
    assets: number;
  }> = [];
  const swarmInputs: Array<{ slug: string; title: string; chunkIds: string[] }> = [];

  for (const proj of projects) {
    const base = slugifyPublisher(proj.title || proj.fileName || 'book');
    let slug = base;
    let n = 2;
    while (usedSlugs.has(slug)) slug = `${base}-${n++}`;
    usedSlugs.add(slug);

    const ledgerObj = buildAntigravityLedgerJson(proj);
    const ledgerPath = `workspace/books/${slug}/ledger.json`;
    folder.file(ledgerPath, JSON.stringify(ledgerObj, null, 2));

    if (proj.coverImageDataUrl) {
      const coverMatch = proj.coverImageDataUrl.match(/^data:[^;]+;base64,(.+)$/);
      if (coverMatch) {
        folder.file(
          `workspace/books/${slug}/assets/${proj.coverFileName || 'cover.jpg'}`,
          coverMatch[1],
          { base64: true }
        );
      }
    }

    for (const asset of proj.assets) {
      const match = asset.dataUrl.match(/^data:[^;]+;base64,(.+)$/);
      if (match) {
        folder.file(`workspace/books/${slug}/assets/${asset.fileName}`, match[1], {
          base64: true,
        });
      }
    }

    manifestBooks.push({
      slug,
      sourceFile: proj.fileName,
      ledgerPath,
      chunks: proj.chunks.length,
      assets: proj.assets.length,
    });
    swarmInputs.push({
      slug,
      title: proj.title,
      chunkIds: proj.chunks.filter((c) => c.status !== 'passed').map((c) => c.id),
    });
  }

  // Also include root workspace/ledger.json for single-book convenience
  folder.file(
    'workspace/ledger.json',
    JSON.stringify(buildAntigravityLedgerJson(primary), null, 2)
  );
  if (primary.coverImageDataUrl) {
    const coverMatch = primary.coverImageDataUrl.match(/^data:[^;]+;base64,(.+)$/);
    if (coverMatch) {
      folder.file(`workspace/assets/${primary.coverFileName || 'cover.jpg'}`, coverMatch[1], {
        base64: true,
      });
    }
  }
  for (const asset of primary.assets) {
    const match = asset.dataUrl.match(/^data:[^;]+;base64,(.+)$/);
    if (match) {
      folder.file(`workspace/assets/${asset.fileName}`, match[1], { base64: true });
    }
  }

  const totalChunks = manifestBooks.reduce((s, b) => s + b.chunks, 0);
  folder.file(
    'workspace/batch-manifest.json',
    JSON.stringify(
      {
        createdAt: new Date().toISOString(),
        publisher:
          primary.publisher.publishingHouseBangla || primary.publisher.publishingHouse,
        totalBooks: manifestBooks.length,
        totalChunks,
        books: manifestBooks,
      },
      null,
      2
    )
  );

  // Pre-compute lock-free disjoint worker shards for immediate one-shot Antigravity swarm execution
  const plan = buildSwarmPlan(swarmInputs, primary.publisher.swarmConcurrency ?? 'auto');
  folder.file(
    'workspace/swarm-plan.json',
    JSON.stringify(
      {
        workerCount: plan.workerCount,
        totalBooks: plan.totalBooks,
        totalPending: plan.totalChunks,
        defaultLayout: primary.publisher.defaultLayout ?? 'phone',
        shards: plan.shards.map((s) => ({
          workerId: s.workerId,
          count: s.assignments.length,
          books: s.bookSlugs,
        })),
      },
      null,
      2
    )
  );

  for (const shard of plan.shards) {
    folder.file(
      `workspace/shards/${shard.workerId}.json`,
      JSON.stringify(
        {
          workerId: shard.workerId,
          items: shard.assignments.map((a) => ({
            bookSlug: a.bookSlug,
            chunkId: a.chunkId,
          })),
        },
        null,
        2
      )
    );
  }

  const blob = await zip.generateAsync({ type: 'blob', compression: 'DEFLATE' });
  triggerBlobDownload(blob, `${rootName}.zip`);
}
