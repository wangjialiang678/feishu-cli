import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import {
  feishuToMarkdown,
  markdownToBlocks,
  inlineMarkdownToElements,
  BLOCK_TYPE,
} from './feishu-md.js';
import {
  readManifest,
  writeManifest,
  hashFile,
  sanitizeFilename,
  ensurePosixPath,
  fileExists,
  deleteLocalFile,
  ensureUniqueFilePathWithFs,
  shouldSyncLocalPath,
  buildConflictPath,
  resolveFileType,
} from './helpers.js';

export const API_BASE = 'https://open.feishu.cn/open-apis';
const DELETE_BATCH_SIZE = 100;
const CREATE_BATCH_SIZE = 100;

export async function apiRequest(method, pathSuffix, token, { query = {}, body } = {}) {
  const url = new URL(`${API_BASE}${pathSuffix}`);
  for (const [key, value] of Object.entries(query)) {
    if (value === undefined || value === null || value === '') continue;
    url.searchParams.set(key, String(value));
  }

  const headers = {
    Authorization: `Bearer ${token}`,
  };
  const options = {
    method,
    headers,
  };

  if (body !== undefined) {
    headers['Content-Type'] = 'application/json; charset=utf-8';
    options.body = JSON.stringify(body);
  }

  const maxRetries = 5;
  for (let attempt = 0; attempt <= maxRetries; attempt += 1) {
    let response;
    try {
      response = await fetch(url, options);
    } catch (err) {
      const bodyPreview = body ? JSON.stringify(body).slice(0, 200) : '';
      throw new Error(
        `Fetch failed for ${url.toString()}: ${err && err.message ? err.message : err}${
          bodyPreview ? ` | body=${bodyPreview}` : ''
        }`
      );
    }

    if (response.status === 429) {
      const retryAfter = Number(response.headers.get('retry-after'));
      const delayMs = Number.isFinite(retryAfter)
        ? retryAfter * 1000
        : Math.min(8000, 1000 * 2 ** attempt);
      await new Promise((resolve) => setTimeout(resolve, delayMs));
      continue;
    }

    const text = await response.text();
    let data;
    try {
      data = text ? JSON.parse(text) : null;
    } catch (err) {
      throw new Error(
        `API response is not JSON (status ${response.status}). Raw response: ${text || '<empty>'}`
      );
    }

    if (!data) {
      throw new Error(`API response is empty (status ${response.status}).`);
    }

    if (data.code !== 0) {
      const message = data.msg || data.error_description || data.error || 'Unknown error';
      throw new Error(`API error (${data.code}): ${message}`);
    }
    return data.data ?? data;
  }

  throw new Error('API error: rate limited (429) after retries.');
}

export function apiGet(pathSuffix, token, query) {
  return apiRequest('GET', pathSuffix, token, { query });
}

export function apiPost(pathSuffix, token, body, query) {
  return apiRequest('POST', pathSuffix, token, { query, body });
}

export function apiDelete(pathSuffix, token, body, query) {
  return apiRequest('DELETE', pathSuffix, token, { query, body });
}

export async function deleteRemoteDocument(documentId, token, fileType) {
  const type = fileType || 'docx';
  await apiDelete(`/drive/v1/files/${documentId}`, token, undefined, { type });
}

export async function fetchAllBlocks(documentId, token) {
  const blocks = [];
  let pageToken;
  let hasMore = true;

  while (hasMore) {
    const data = await apiGet(
      `/docx/v1/documents/${documentId}/blocks`,
      token,
      {
        page_size: 100,
        document_revision_id: -1,
        page_token: pageToken,
      }
    );

    const items = data.items || data.blocks || [];
    blocks.push(...items);

    pageToken = data.page_token || data.next_page_token || '';
    if (typeof data.has_more === 'boolean') {
      hasMore = data.has_more;
    } else {
      hasMore = Boolean(pageToken);
    }
  }

  return blocks;
}

export async function fetchWikiNodes(spaceId, token, parentNodeToken) {
  const nodes = [];
  let pageToken;
  let hasMore = true;

  while (hasMore) {
    const data = await apiGet(`/wiki/v2/spaces/${spaceId}/nodes`, token, {
      parent_node_token: parentNodeToken,
      page_token: pageToken,
      page_size: 50,
    });

    const items = data.items || data.nodes || [];
    nodes.push(...items);

    pageToken = data.page_token || data.next_page_token || '';
    if (typeof data.has_more === 'boolean') {
      hasMore = data.has_more;
    } else {
      hasMore = Boolean(pageToken);
    }
  }

  return nodes;
}

export async function collectWikiDocNodes(spaceId, token, parentNodeToken, result) {
  const nodes = await fetchWikiNodes(spaceId, token, parentNodeToken);
  for (const node of nodes) {
    const hasChild = node.has_child ?? node.hasChild;
    const nodeToken = node.node_token || node.nodeToken;
    const objType = node.obj_type || node.objType;
    const objToken = node.obj_token || node.objToken;

    if (objToken && (objType === 'docx' || objType === 'doc')) {
      result.push({
        nodeToken,
        documentId: objToken,
        title: node.title || node.name || '',
        objType,
      });
    }

    if (hasChild && nodeToken) {
      await collectWikiDocNodes(spaceId, token, nodeToken, result);
    }
  }
}

export async function fetchDocumentMeta(documentId, token) {
  const data = await apiGet(`/docx/v1/documents/${documentId}`, token);
  return data.document || data;
}

export async function downloadDocumentToFile(documentId, token, metadata, filePath) {
  const blocks = await fetchAllBlocks(documentId, token);
  const markdown = feishuToMarkdown({ metadata, blocks });
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, markdown, 'utf8');
  return crypto.createHash('sha256').update(markdown).digest('hex');
}

function extractBlocksFromResponse(data) {
  if (!data) return [];
  if (Array.isArray(data)) return data;
  if (Array.isArray(data.children)) return data.children;
  if (Array.isArray(data.blocks)) return data.blocks;
  if (Array.isArray(data.items)) return data.items;
  if (data.data) return extractBlocksFromResponse(data.data);
  return [];
}

function buildCellTextBlocks(content) {
  const lines = content.split('\n');
  const blocks = [];
  for (const line of lines) {
    const elements = inlineMarkdownToElements(line);
    blocks.push({
      block_type: BLOCK_TYPE.text,
      text: {
        style: {},
        elements,
      },
    });
  }
  return blocks;
}

async function createTableWithContent(documentId, token, tableBlock, index) {
  const rows = tableBlock._table?.rows || [];
  const rowSize = tableBlock.table?.property?.row_size || rows.length;
  const columnSize = tableBlock.table?.property?.column_size || rows[0]?.length || 0;
  const headerRow = Boolean(tableBlock.table?.property?.header_row);

  if (!rows.length || !columnSize) {
    return index;
  }

  const payload = {
    block_type: BLOCK_TYPE.table,
    table: {
      property: {
        row_size: rowSize,
        column_size: columnSize,
        header_row: headerRow,
        header_column: false,
      },
    },
  };

  const resp = await apiPost(
    `/docx/v1/documents/${documentId}/blocks/${documentId}/children`,
    token,
    {
      index,
      children: [payload],
    }
  );

  const created = extractBlocksFromResponse(resp);
  const createdTable =
    created.find((block) => block.block_type === BLOCK_TYPE.table) || created[0];
  const cellIds = createdTable?.table?.cells || [];

  if (!cellIds.length) {
    return index + 1;
  }

  for (let r = 0; r < rows.length; r += 1) {
    for (let c = 0; c < rows[r].length; c += 1) {
      const cellId = cellIds[r * columnSize + c];
      if (!cellId) continue;
      const cellContent = rows[r][c] || '';
      if (!cellContent.trim()) continue;
      const children = buildCellTextBlocks(cellContent);
      await apiPost(
        `/docx/v1/documents/${documentId}/blocks/${cellId}/children`,
        token,
        {
          index: 0,
          children,
        }
      );
    }
  }

  return index + 1;
}

export async function appendBlocks(documentId, token, blocks, startIndex = 0) {
  if (!blocks.length) return startIndex;
  let index = startIndex;
  for (let i = 0; i < blocks.length; i += CREATE_BATCH_SIZE) {
    const chunk = blocks.slice(i, i + CREATE_BATCH_SIZE);
    await apiPost(`/docx/v1/documents/${documentId}/blocks/${documentId}/children`, token, {
      index,
      children: chunk,
    });
    index += chunk.length;
  }
  return index;
}

export async function appendBlocksWithTables(documentId, token, blocks) {
  let index = 0;
  let buffer = [];

  const flushBuffer = async () => {
    if (!buffer.length) return;
    index = await appendBlocks(documentId, token, buffer, index);
    buffer = [];
  };

  for (const block of blocks) {
    if (block.block_type === BLOCK_TYPE.table && block._table) {
      await flushBuffer();
      index = await createTableWithContent(documentId, token, block, index);
      continue;
    }
    buffer.push(block);
  }

  await flushBuffer();
}

export async function createDocument(token, title) {
  try {
    const data = await apiPost('/docx/v1/documents', token, title ? { title } : undefined);
    const documentId = data?.document?.document_id || data?.document_id || data?.documentId;
    if (!documentId) {
      throw new Error('Create document response missing document_id.');
    }
    return { documentId, usedTitle: Boolean(title) };
  } catch (err) {
    if (title) {
      const data = await apiPost('/docx/v1/documents', token);
      const documentId = data?.document?.document_id || data?.document_id || data?.documentId;
      if (!documentId) {
        throw new Error('Create document response missing document_id.');
      }
      return { documentId, usedTitle: false };
    }
    throw err;
  }
}

export async function addDocToWiki(spaceId, token, documentId) {
  await apiPost(`/wiki/v2/spaces/${spaceId}/nodes/move_docs_to_wiki`, token, {
    obj_type: 'docx',
    obj_token: documentId,
  });
}

async function fetchChildrenCount(documentId, token) {
  let count = 0;
  let pageToken;
  let hasMore = true;
  while (hasMore) {
    const data = await apiGet(
      `/docx/v1/documents/${documentId}/blocks/${documentId}/children`,
      token,
      {
        page_size: 200,
        document_revision_id: -1,
        page_token: pageToken,
      }
    );
    const items = data.items || data.blocks || data.children || [];
    count += items.length;
    pageToken = data.page_token || data.next_page_token || '';
    if (typeof data.has_more === 'boolean') {
      hasMore = data.has_more;
    } else {
      hasMore = Boolean(pageToken);
    }
  }
  return count;
}

async function deleteAllChildren(documentId, token) {
  let remaining = await fetchChildrenCount(documentId, token);
  while (remaining > 0) {
    const batch = Math.min(DELETE_BATCH_SIZE, remaining);
    await apiDelete(
      `/docx/v1/documents/${documentId}/blocks/${documentId}/children/batch_delete`,
      token,
      {
        start_index: 0,
        end_index: batch,
      },
      { document_revision_id: -1 }
    );
    remaining -= batch;
  }
}

export async function uploadMarkdownToDocument(documentId, token, markdown) {
  const { blocks } = markdownToBlocks(markdown);
  await deleteAllChildren(documentId, token);
  await appendBlocksWithTables(documentId, token, blocks);
}

export async function createDocumentFromMarkdown(spaceId, token, markdown) {
  const { title, blocks } = markdownToBlocks(markdown);
  const { documentId, usedTitle } = await createDocument(token, title);

  const contentBlocks = usedTitle
    ? blocks
    : [
        {
          block_type: BLOCK_TYPE.heading1,
          heading1: {
            style: {},
            elements: [{ text_run: { content: title, text_element_style: {} } }],
          },
        },
        ...blocks,
      ];

  await appendBlocksWithTables(documentId, token, contentBlocks);
  await addDocToWiki(spaceId, token, documentId);
  return documentId;
}

export async function subscribeToDocEvents(fileToken, token, fileType, eventType) {
  if (!fileToken) {
    throw new Error('Missing file token for event subscription.');
  }
  if (!fileType) {
    throw new Error('Missing file type for event subscription.');
  }
  const query = { file_type: String(fileType).toLowerCase() };
  if (eventType) {
    query.event_type = eventType;
  }
  await apiPost(`/drive/v1/files/${fileToken}/subscribe`, token, undefined, query);
}

export function createChangeProcessor({
  token,
  spaceId,
  rootDir,
  debounceMs,
  dedupeWindowMs,
  logEvents,
  fileTypes,
  runFullSync,
  subscribeToDocument,
  manifestName,
}) {
  let processing = false;
  let queued = false;
  let debounceTimer = null;
  let lastProcessCompletedAt = 0;
  const recentEvents = new Map();
  const pendingRemote = new Map();
  const pendingLocal = new Set();

  const pruneRecent = (now) => {
    for (const [eventId, ts] of recentEvents.entries()) {
      if (now - ts > dedupeWindowMs) {
        recentEvents.delete(eventId);
      }
    }
  };

  const seenEvent = (eventId) => {
    if (!eventId) return false;
    const now = Date.now();
    pruneRecent(now);
    if (recentEvents.has(eventId)) return true;
    recentEvents.set(eventId, now);
    return false;
  };

  const scheduleProcess = () => {
    if (debounceTimer) clearTimeout(debounceTimer);
    debounceTimer = setTimeout(() => {
      processPending().catch((err) => {
        console.error(`[realtime-sync] process failed: ${err.message || err}`);
      });
    }, debounceMs);
  };

  const handleEvent = (eventType, data) => {
    const eventId = data.event_id || data.eventId || '';
    if (eventId && seenEvent(eventId)) return;

    const fileTypeRaw = data.file_type || data.fileType || '';
    const fileType = String(fileTypeRaw).toLowerCase();
    if (fileType && fileTypes && !fileTypes.has(fileType)) {
      if (logEvents) {
        console.log(
          `[realtime-sync] ignored ${eventType} for file type ${fileType || 'unknown'}`
        );
      }
      return;
    }

    const fileToken =
      data.file_token || data.fileToken || data.resource_id || data.resourceId || '';
    if (!fileToken) {
      if (logEvents) {
        console.log(`[realtime-sync] ignored ${eventType} without file token`);
      }
      return;
    }

    if (logEvents) {
      const eventInfo = [eventType, fileType, fileToken].filter(Boolean).join(' | ');
      console.log(`[realtime-sync] event ${eventInfo}`);
    }

    pendingRemote.set(fileToken, eventType);
    scheduleProcess();
  };

  const handleLocalChange = (detail) => {
    const relPath = detail ? ensurePosixPath(detail) : '';
    if (relPath && !shouldSyncLocalPath(relPath, manifestName)) return;
    if (logEvents) {
      console.log(`[realtime-sync] local change ${relPath || ''}`.trim());
    }
    if (relPath) {
      pendingLocal.add(relPath);
    } else {
      pendingLocal.add('local');
    }
    scheduleProcess();
  };

  const processPending = async () => {
    if (processing) {
      queued = true;
      return;
    }
    processing = true;
    const remoteBatch = new Map(pendingRemote);
    const localBatch = new Set(pendingLocal);
    pendingRemote.clear();
    pendingLocal.clear();

    try {
      await processChanges(remoteBatch, localBatch);
    } finally {
      processing = false;
      lastProcessCompletedAt = Date.now();
      if (queued || pendingRemote.size || pendingLocal.size) {
        queued = false;
        setTimeout(() => {
          processPending().catch((err) => {
            console.error(`[realtime-sync] process failed: ${err.message || err}`);
          });
        }, 0);
      }
    }
  };

  const processChanges = async (remoteBatch, localBatch) => {
    if (localBatch.has('local')) {
      localBatch.delete('local');
      if (typeof runFullSync === 'function') {
        await runFullSync('local-change');
      }
      return;
    }
    const manifest = await readManifest(rootDir, manifestName);
    const manifestDocs = manifest.docs || {};
    let manifestDirty = false;

    const fileToDoc = new Map();
    const usedPaths = new Set();
    for (const [docId, entry] of Object.entries(manifestDocs)) {
      if (entry?.file) {
        fileToDoc.set(entry.file, docId);
        usedPaths.add(entry.file);
      }
    }

    for (const [docId, eventType] of remoteBatch.entries()) {
      if (eventType === 'drive.file.trashed_v1') {
        const entry = manifestDocs[docId];
        if (entry?.file) {
          localBatch.delete(entry.file);
          const fileAbs = path.join(rootDir, entry.file);
          await deleteLocalFile(fileAbs);
          manifestDirty = true;
        }
        if (manifestDocs[docId]) {
          delete manifestDocs[docId];
          manifestDirty = true;
        }
        continue;
      }

      let meta;
      try {
        meta = await fetchDocumentMeta(docId, token);
      } catch (err) {
        console.warn(
          `[realtime-sync] failed to fetch meta for ${docId}: ${err.message || err}`
        );
        continue;
      }

      const entry = manifestDocs[docId];
      const title = meta.title || entry?.title || '';
      const revisionId = meta.revision_id ?? meta.revisionId ?? entry?.revisionId ?? null;
      const baseName = sanitizeFilename(title) || docId;
      const desiredName = `${baseName}.md`;
      let fileRel = entry?.file;
      const renameCandidates = new Set(usedPaths);
      if (fileRel) {
        renameCandidates.delete(fileRel);
      }
      const desiredRel = await ensureUniqueFilePathWithFs(
        rootDir,
        desiredName,
        renameCandidates
      );
      if (!fileRel) {
        fileRel = desiredRel;
      } else if (desiredRel && desiredRel !== fileRel) {
        const oldRel = fileRel;
        const oldAbs = path.join(rootDir, oldRel);
        const newAbs = path.join(rootDir, desiredRel);
        if (await fileExists(oldAbs)) {
          await fs.rename(oldAbs, newAbs);
        }
        fileRel = desiredRel;
        usedPaths.delete(oldRel);
        usedPaths.add(fileRel);
        fileToDoc.delete(oldRel);
        fileToDoc.set(fileRel, docId);
        localBatch.delete(oldRel);
        if (entry) {
          entry.file = fileRel;
        }
        manifestDirty = true;
      }
      localBatch.delete(fileRel);

      const fileAbs = path.join(rootDir, fileRel);
      let localHash = null;
      let localExists = false;
      if (await fileExists(fileAbs)) {
        localExists = true;
        localHash = await hashFile(fileAbs);
      }

      const localChanged =
        entry?.hash && localHash && entry.hash !== localHash;
      const remoteChanged =
        entry?.revisionId && revisionId && entry.revisionId !== revisionId;

      if (!entry || !localExists) {
        const hash = await downloadDocumentToFile(
          docId,
          token,
          { document_id: docId, revision_id: revisionId, title },
          fileAbs
        );
        manifestDocs[docId] = {
          file: fileRel,
          revisionId,
          title,
          fileType: resolveFileType({ fileType: entry?.fileType }),
          hash,
        };
        usedPaths.add(fileRel);
        manifestDirty = true;
        if (typeof subscribeToDocument === 'function') {
          await subscribeToDocument(docId, resolveFileType(null, manifestDocs[docId]));
        }
        continue;
      }

      if (remoteChanged && localChanged) {
        const conflictRel = buildConflictPath(fileRel);
        const conflictAbs = path.join(rootDir, conflictRel);
        await downloadDocumentToFile(
          docId,
          token,
          { document_id: docId, revision_id: revisionId, title },
          conflictAbs
        );
        continue;
      }

      if (remoteChanged && !localChanged) {
        const hash = await downloadDocumentToFile(
          docId,
          token,
          { document_id: docId, revision_id: revisionId, title },
          fileAbs
        );
        manifestDocs[docId] = {
          ...entry,
          file: fileRel,
          revisionId,
          title,
          fileType: resolveFileType({ fileType: entry?.fileType }),
          hash,
        };
        manifestDirty = true;
        continue;
      }

      if (title && entry?.title !== title) {
        manifestDocs[docId] = {
          ...entry,
          title,
        };
        manifestDirty = true;
      }
    }

    for (const fileRel of Array.from(localBatch)) {
      if (fileRel === 'local') continue;
      const docId = fileToDoc.get(fileRel);
      const fileAbs = path.join(rootDir, fileRel);
      const exists = await fileExists(fileAbs);

      if (!exists) {
        if (docId) {
          const entry = manifestDocs[docId];
          await deleteRemoteDocument(docId, token, resolveFileType(null, entry));
          delete manifestDocs[docId];
          manifestDirty = true;
        }
        continue;
      }

      const hash = await hashFile(fileAbs);
      if (docId) {
        const entry = manifestDocs[docId];
        if (entry?.hash && entry.hash === hash) continue;
        const markdown = await fs.readFile(fileAbs, 'utf8');
        await uploadMarkdownToDocument(docId, token, markdown);
        const meta = await fetchDocumentMeta(docId, token);
        manifestDocs[docId] = {
          ...entry,
          file: fileRel,
          revisionId: meta.revision_id ?? meta.revisionId ?? entry?.revisionId ?? null,
          title: meta.title || entry?.title || '',
          fileType: resolveFileType(null, entry),
          hash,
        };
        manifestDirty = true;
      } else {
        const markdown = await fs.readFile(fileAbs, 'utf8');
        const newDocId = await createDocumentFromMarkdown(spaceId, token, markdown);
        const meta = await fetchDocumentMeta(newDocId, token);
        manifestDocs[newDocId] = {
          file: fileRel,
          revisionId: meta.revision_id ?? meta.revisionId ?? null,
          title: meta.title || '',
          fileType: 'docx',
          hash,
        };
        fileToDoc.set(fileRel, newDocId);
        usedPaths.add(fileRel);
        manifestDirty = true;
        if (typeof subscribeToDocument === 'function') {
          await subscribeToDocument(newDocId, 'docx');
        }
      }
    }

    if (manifestDirty) {
      await writeManifest(rootDir, { spaceId, docs: manifestDocs }, manifestName);
    }
  };

  return {
    handleEvent,
    handleLocalChange,
    processPending,
    isProcessing: () => processing,
    getLastProcessCompletedAt: () => lastProcessCompletedAt,
  };
}

export async function syncNewDocsFromWiki({
  rootDir,
  spaceId,
  token,
  logEvents,
  subscribeToDocument,
  manifestName,
}) {
  const manifest = await readManifest(rootDir, manifestName);
  const manifestDocs = manifest.docs || {};
  const existingDocIds = new Set(Object.keys(manifestDocs));
  const usedPaths = new Set();
  for (const entry of Object.values(manifestDocs)) {
    if (entry?.file) usedPaths.add(entry.file);
  }

  const wikiDocs = [];
  await collectWikiDocNodes(spaceId, token, undefined, wikiDocs);

  let added = 0;
  let manifestDirty = false;

  for (const node of wikiDocs) {
    const docId = node.documentId;
    if (!docId || existingDocIds.has(docId)) continue;

    let meta;
    try {
      meta = await fetchDocumentMeta(docId, token);
    } catch (err) {
      console.warn(`[realtime-sync] poll meta failed for ${docId}: ${err.message || err}`);
      continue;
    }

    const title = meta.title || node.title || '';
    const revisionId = meta.revision_id ?? meta.revisionId ?? null;
    const baseName = sanitizeFilename(title) || docId;
    const fileRel = await ensureUniqueFilePathWithFs(rootDir, `${baseName}.md`, usedPaths);
    const fileAbs = path.join(rootDir, fileRel);

    const hash = await downloadDocumentToFile(
      docId,
      token,
      { document_id: docId, revision_id: revisionId, title },
      fileAbs
    );

    manifestDocs[docId] = {
      file: fileRel,
      revisionId,
      title,
      fileType: resolveFileType({ fileType: node.objType }),
      hash,
    };
    usedPaths.add(fileRel);
    existingDocIds.add(docId);
    manifestDirty = true;
    added += 1;

    if (typeof subscribeToDocument === 'function') {
      await subscribeToDocument(docId, resolveFileType(null, manifestDocs[docId]));
    }
  }

  if (manifestDirty) {
    await writeManifest(rootDir, { spaceId, docs: manifestDocs }, manifestName);
  }

  if (logEvents) {
    console.log(`[realtime-sync] poll complete (new docs: ${added})`);
  }

  return { added };
}
