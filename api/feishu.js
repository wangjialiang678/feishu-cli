import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import {
  feishuToMarkdown,
  markdownToBlocks,
  inlineMarkdownToElements,
  BLOCK_TYPE,
} from './feishu-md.js';

export const API_BASE = 'https://open.feishu.cn/open-apis';
const DELETE_BATCH_SIZE = 100;
const CREATE_BATCH_SIZE = 50;
const MAX_RETRY_DELAY_MS = 60000;

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
      let delayMs = Number.isFinite(retryAfter)
        ? retryAfter * 1000
        : Math.min(8000, 1000 * 2 ** attempt);
      delayMs = Math.min(MAX_RETRY_DELAY_MS, delayMs);
      await new Promise((resolve) => setTimeout(resolve, delayMs));
      continue;
    }

    let text;
    try {
      text = await response.text();
    } catch (err) {
      throw new Error(
        `Failed to read response from ${url.toString()} (status ${response.status}): ${err.message || err}`
      );
    }

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

export function apiPut(pathSuffix, token, body, query) {
  return apiRequest('PUT', pathSuffix, token, { query, body });
}

export async function fetchAllPaged(pathSuffix, token, query = {}, { pageSize = 100 } = {}) {
  const items = [];
  let pageToken;
  let hasMore = true;

  while (hasMore) {
    const data = await apiGet(pathSuffix, token, {
      ...query,
      page_size: pageSize,
      page_token: pageToken,
    });

    const batch = data.items || data.blocks || data.nodes || data.children || [];
    items.push(...batch);

    pageToken = data.page_token || data.next_page_token || '';
    if (typeof data.has_more === 'boolean') {
      hasMore = data.has_more;
    } else {
      hasMore = Boolean(pageToken);
    }
  }

  return items;
}

export async function fetchAllBlocks(documentId, token) {
  return fetchAllPaged(`/docx/v1/documents/${documentId}/blocks`, token, { document_revision_id: -1 });
}

export async function fetchWikiNodes(spaceId, token, parentNodeToken) {
  return fetchAllPaged(`/wiki/v2/spaces/${spaceId}/nodes`, token, { parent_node_token: parentNodeToken }, { pageSize: 50 });
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

// --- Table utilities (shared with upload.js) ---

let _tableIdCounter = 0;
export function tempId(prefix) {
  _tableIdCounter += 1;
  return `${prefix}_${Date.now()}_${_tableIdCounter}`;
}

export function stripMarkdownForWidth(text) {
  return text.replace(/\[([^\]]+)\]\([^)]+\)/g, '$1');
}

export function getDisplayWidth(text) {
  const visible = stripMarkdownForWidth(text);
  let width = 0;
  for (const char of visible) {
    width += /[\u4e00-\u9fff\u3000-\u303f\uff00-\uffef]/.test(char) ? 2 : 1;
  }
  return width;
}

export function calculateColumnWidths(rows, colSize) {
  const colMaxWidth = new Array(colSize).fill(0);
  for (const row of rows) {
    if (!row) continue;
    for (let c = 0; c < row.length && c < colSize; c++) {
      const text = typeof row[c] === 'string' ? row[c] : '';
      colMaxWidth[c] = Math.max(colMaxWidth[c], getDisplayWidth(text));
    }
  }
  const MIN_COL_WIDTH = 60;
  const MAX_COL_WIDTH = 360;
  const CHAR_WIDTH = 10;
  return colMaxWidth.map(w => Math.min(MAX_COL_WIDTH, Math.max(MIN_COL_WIDTH, w * CHAR_WIDTH)));
}

export function buildTableDescendants(rows, colSize, columnWidth) {
  const rowSize = rows.length;
  const tableId = tempId('tbl');
  const cellIds = [];
  const descendants = [];

  for (let r = 0; r < rowSize; r++) {
    const row = rows[r];
    for (let c = 0; c < colSize; c++) {
      const cellId = tempId('cell');
      const contentId = tempId('txt');
      const cellText = (row && typeof row[c] === 'string') ? row[c] : '';

      // Parent (cell) before child (text)
      descendants.push({
        block_id: cellId,
        block_type: BLOCK_TYPE.table_cell,
        table_cell: {},
        children: [contentId],
      });

      descendants.push({
        block_id: contentId,
        block_type: BLOCK_TYPE.text,
        text: { elements: inlineMarkdownToElements(cellText), style: {} },
        children: [],
      });

      cellIds.push(cellId);
    }
  }

  descendants.unshift({
    block_id: tableId,
    block_type: BLOCK_TYPE.table,
    table: {
      property: {
        row_size: rowSize,
        column_size: colSize,
        header_row: true,
        column_width: columnWidth,
      },
    },
    children: cellIds,
  });

  return { tableId, descendants };
}

async function createTableWithContent(documentId, token, tableBlock, index) {
  const rows = tableBlock._table?.rows || [];
  const columnSize = tableBlock.table?.property?.column_size || rows[0]?.length || 0;

  if (!rows.length || !columnSize) {
    return index;
  }

  const columnWidth = calculateColumnWidths(rows, columnSize);

  const { tableId, descendants } = buildTableDescendants(rows, columnSize, columnWidth);
  await apiPost(
    `/docx/v1/documents/${documentId}/blocks/${documentId}/descendant`,
    token,
    { children_id: [tableId], descendants },
    { document_revision_id: -1 },
  );

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

export function buildCalloutDescendants(block) {
  const calloutId = tempId('callout');
  const children = block._callout_children || [];
  const descendants = [];
  const childIds = [];

  for (const child of children) {
    const childId = tempId('ctxt');
    childIds.push(childId);
    descendants.push({
      block_id: childId,
      block_type: child.block_type || BLOCK_TYPE.text,
      text: child.text || { elements: [{ text_run: { content: '', text_element_style: {} } }], style: {} },
      children: [],
    });
  }

  descendants.unshift({
    block_id: calloutId,
    block_type: BLOCK_TYPE.callout,
    callout: block.callout || {},
    children: childIds,
  });

  return { calloutId, descendants };
}

export function buildQuoteContainerDescendants(block) {
  const quoteId = tempId('quote');
  const children = block._quote_children || [];
  const descendants = [];
  const childIds = [];

  for (const child of children) {
    const childId = tempId('qtxt');
    childIds.push(childId);
    descendants.push({
      block_id: childId,
      block_type: child.block_type || BLOCK_TYPE.text,
      text: child.text || { elements: [{ text_run: { content: '', text_element_style: {} } }], style: {} },
      children: [],
    });
  }

  descendants.unshift({
    block_id: quoteId,
    block_type: BLOCK_TYPE.quote_container,
    quote_container: {},
    children: childIds,
  });

  return { quoteId, descendants };
}

async function createCalloutWithContent(documentId, token, block, index) {
  const { calloutId, descendants } = buildCalloutDescendants(block);
  await apiPost(
    `/docx/v1/documents/${documentId}/blocks/${documentId}/descendant`,
    token,
    { children_id: [calloutId], descendants },
    { document_revision_id: -1 },
  );
  return index + 1;
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
    if (block.block_type === BLOCK_TYPE.callout && block._callout_children) {
      await flushBuffer();
      index = await createCalloutWithContent(documentId, token, block, index);
      continue;
    }
    if (block.block_type === BLOCK_TYPE.quote_container && block._quote_children) {
      await flushBuffer();
      const { quoteId, descendants } = buildQuoteContainerDescendants(block);
      await apiPost(
        `/docx/v1/documents/${documentId}/blocks/${documentId}/descendant`,
        token,
        { children_id: [quoteId], descendants },
        { document_revision_id: -1 },
      );
      index += 1;
      continue;
    }
    buffer.push(block);
  }

  await flushBuffer();
}

export async function createDocument(token, title) {
  const extractId = (data) => data?.document?.document_id || data?.document_id || data?.documentId;

  try {
    const data = await apiPost('/docx/v1/documents', token, title ? { title } : undefined);
    const documentId = extractId(data);
    if (!documentId) {
      throw new Error('Create document response missing document_id.');
    }
    return { documentId, usedTitle: Boolean(title) };
  } catch (err) {
    if (title) {
      const data = await apiPost('/docx/v1/documents', token);
      const documentId = extractId(data);
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

export async function fetchChildrenCount(documentId, token) {
  const items = await fetchAllPaged(
    `/docx/v1/documents/${documentId}/blocks/${documentId}/children`,
    token,
    { document_revision_id: -1 },
    { pageSize: 200 },
  );
  return items.length;
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

