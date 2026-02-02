const DEFAULT_ALIGN = 1;

export const BLOCK_TYPE = {
  page: 1,
  text: 2,
  heading1: 3,
  heading2: 4,
  heading3: 5,
  heading4: 6,
  heading5: 7,
  heading6: 8,
  heading7: 9,
  heading8: 10,
  heading9: 11,
  bullet: 12,
  ordered: 13,
  code: 14,
  quote: 15,
  todo: 17,
  divider: 22,
  image: 27,
  table: 31,
  table_cell: 32,
  quote_container: 34,
};

function safeDecodeUrl(value) {
  if (!value) return '';
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

function safeEncodeUrl(value) {
  if (!value) return '';
  try {
    return encodeURIComponent(value);
  } catch {
    return value;
  }
}

function textElementsToMarkdown(elements) {
  if (!Array.isArray(elements) || elements.length === 0) return '';
  const inline = elements.length > 1;
  return elements.map((el) => textElementToMarkdown(el, inline)).join('');
}

function textElementToMarkdown(element, inline) {
  if (!element || typeof element !== 'object') return '';
  if (element.text_run) {
    return textRunToMarkdown(element.text_run);
  }
  if (element.mention_user) {
    return element.mention_user.user_id || element.mention_user.userId || '';
  }
  if (element.mention_doc) {
    const title = element.mention_doc.title || '';
    const url = safeDecodeUrl(element.mention_doc.url || '');
    return title ? `[${title}](${url})` : url;
  }
  if (element.equation) {
    const symbol = inline ? '$' : '$$';
    const content = (element.equation.content || '').replace(/\n+$/g, '');
    return `${symbol}${content}${symbol}`;
  }
  return '';
}

function textRunToMarkdown(textRun) {
  const content = textRun.content || '';
  const style = textRun.text_element_style || {};
  let prefix = '';
  let suffix = '';

  if (style.bold) {
    prefix = '**';
    suffix = '**';
  } else if (style.italic) {
    prefix = '_';
    suffix = '_';
  } else if (style.strikethrough) {
    prefix = '~~';
    suffix = '~~';
  } else if (style.underline) {
    prefix = '<u>';
    suffix = '</u>';
  } else if (style.inline_code) {
    prefix = '`';
    suffix = '`';
  } else if (style.link && style.link.url) {
    prefix = '[';
    suffix = `](${safeDecodeUrl(style.link.url)})`;
  }

  return `${prefix}${content}${suffix}`;
}

function blockTypeFromBlock(block) {
  if (block.block_type) return block.block_type;
  if (block.page) return BLOCK_TYPE.page;
  if (block.text) return BLOCK_TYPE.text;
  if (block.heading1) return BLOCK_TYPE.heading1;
  if (block.heading2) return BLOCK_TYPE.heading2;
  if (block.heading3) return BLOCK_TYPE.heading3;
  if (block.heading4) return BLOCK_TYPE.heading4;
  if (block.heading5) return BLOCK_TYPE.heading5;
  if (block.heading6) return BLOCK_TYPE.heading6;
  if (block.heading7) return BLOCK_TYPE.heading7;
  if (block.heading8) return BLOCK_TYPE.heading8;
  if (block.heading9) return BLOCK_TYPE.heading9;
  if (block.bullet) return BLOCK_TYPE.bullet;
  if (block.ordered) return BLOCK_TYPE.ordered;
  if (block.code) return BLOCK_TYPE.code;
  if (block.quote) return BLOCK_TYPE.quote;
  if (block.todo) return BLOCK_TYPE.todo;
  if (block.divider) return BLOCK_TYPE.divider;
  if (block.image) return BLOCK_TYPE.image;
  if (block.table) return BLOCK_TYPE.table;
  if (block.table_cell) return BLOCK_TYPE.table_cell;
  if (block.quote_container) return BLOCK_TYPE.quote_container;
  return null;
}

function renderBlock(block, blockMap, indentLevel = 0) {
  const lines = [];
  const type = blockTypeFromBlock(block);
  const indent = '  '.repeat(indentLevel);

  switch (type) {
    case BLOCK_TYPE.page: {
      const title = textElementsToMarkdown(block.page?.elements || []);
      lines.push(`# ${title}`.trimEnd());
      lines.push('---');
      renderChildren(block, blockMap, lines, indentLevel);
      break;
    }
    case BLOCK_TYPE.text: {
      const text = textElementsToMarkdown(block.text?.elements || []);
      const line = `${indent}${text}`.replace(/[ \t]+$/g, '');
      if (line.trim().length === 0) {
        lines.push('');
      } else {
        lines.push(`${line}  `);
      }
      break;
    }
    case BLOCK_TYPE.heading1:
    case BLOCK_TYPE.heading2:
    case BLOCK_TYPE.heading3:
    case BLOCK_TYPE.heading4:
    case BLOCK_TYPE.heading5:
    case BLOCK_TYPE.heading6:
    case BLOCK_TYPE.heading7:
    case BLOCK_TYPE.heading8:
    case BLOCK_TYPE.heading9: {
      const level = type - BLOCK_TYPE.heading1 + 1;
      const key = `heading${level}`;
      const text = textElementsToMarkdown(block[key]?.elements || []);
      lines.push(`${'#'.repeat(level)} ${text}`.trimEnd());
      renderChildren(block, blockMap, lines, indentLevel);
      break;
    }
    case BLOCK_TYPE.bullet: {
      const text = textElementsToMarkdown(block.bullet?.elements || []);
      lines.push(`${indent}- ${text}`.trimEnd());
      renderChildren(block, blockMap, lines, indentLevel + 1);
      break;
    }
    case BLOCK_TYPE.ordered: {
      const text = textElementsToMarkdown(block.ordered?.elements || []);
      const order = calculateOrderedIndex(block, blockMap);
      lines.push(`${indent}${order}. ${text}`.trimEnd());
      renderChildren(block, blockMap, lines, indentLevel + 1);
      break;
    }
    case BLOCK_TYPE.code: {
      const lang = codeLanguageToMarkdown(block.code?.style?.language);
      lines.push(`\`\`\`${lang}`.trimEnd());
      const codeText = textElementsToMarkdown(block.code?.elements || []).replace(/\n+$/g, '');
      lines.push(codeText);
      lines.push('```');
      break;
    }
    case BLOCK_TYPE.quote: {
      const text = textElementsToMarkdown(block.quote?.elements || []);
      lines.push(`${indent}> ${text}`.trimEnd());
      break;
    }
    case BLOCK_TYPE.todo: {
      const done = Boolean(block.todo?.style?.done);
      const text = textElementsToMarkdown(block.todo?.elements || []);
      lines.push(`${indent}- [${done ? 'x' : ' '}] ${text}`.trimEnd());
      break;
    }
    case BLOCK_TYPE.divider: {
      lines.push(`${indent}---`.trimEnd());
      break;
    }
    case BLOCK_TYPE.image: {
      const token = block.image?.token || '';
      lines.push(`${indent}![](${token})`.trimEnd());
      break;
    }
    case BLOCK_TYPE.table: {
      lines.push(renderTable(block.table, blockMap));
      break;
    }
    case BLOCK_TYPE.table_cell: {
      lines.push(renderTableCell(block, blockMap));
      break;
    }
    case BLOCK_TYPE.quote_container: {
      const childIds = block.children || [];
      for (const childId of childIds) {
        const child = blockMap.get(childId);
        if (!child) continue;
        const childLines = renderBlock(child, blockMap, indentLevel).split('\n');
        for (const line of childLines) {
          if (line === '') {
            lines.push('>');
          } else {
            lines.push(`> ${line}`);
          }
        }
      }
      break;
    }
    default: {
      renderChildren(block, blockMap, lines, indentLevel);
      break;
    }
  }

  return lines.join('\n');
}

function renderTableCell(block, blockMap) {
  const parts = [];
  const childIds = block.children || [];
  for (const childId of childIds) {
    const child = blockMap.get(childId);
    if (!child) continue;
    parts.push(renderBlock(child, blockMap, 0));
  }
  return parts.join('<br/>');
}

function normalizeMergeInfo(mergeInfo) {
  if (!mergeInfo) return null;
  const rowSpan = mergeInfo.row_span ?? mergeInfo.rowSpan ?? 1;
  const colSpan = mergeInfo.col_span ?? mergeInfo.colSpan ?? 1;
  return { rowSpan, colSpan };
}

function renderTable(tableData, blockMap) {
  if (!tableData || !tableData.property) return '';

  const columnSize =
    tableData.property.column_size ?? tableData.property.columnSize ?? 0;
  if (!columnSize) return '';

  const cells = Array.isArray(tableData.cells) ? tableData.cells : [];
  const rows = [];

  for (let i = 0; i < cells.length; i += 1) {
    const cellId = cells[i];
    const cellBlock = blockMap.get(cellId);
    const cellContent = cellBlock
      ? renderTableCell(cellBlock, blockMap).replace(/\n/g, '')
      : '';
    const rowIndex = Math.floor(i / columnSize);
    const colIndex = i % columnSize;

    while (rows.length <= rowIndex) rows.push([]);
    while (rows[rowIndex].length <= colIndex) rows[rowIndex].push('');
    rows[rowIndex][colIndex] = cellContent;
  }

  const mergeInfoList = tableData.property.merge_info || tableData.property.mergeInfo;
  const mergeInfoMap = {};
  if (Array.isArray(mergeInfoList)) {
    for (let i = 0; i < mergeInfoList.length; i += 1) {
      const rowIndex = Math.floor(i / columnSize);
      const colIndex = i % columnSize;
      if (!mergeInfoMap[rowIndex]) mergeInfoMap[rowIndex] = {};
      mergeInfoMap[rowIndex][colIndex] = normalizeMergeInfo(mergeInfoList[i]);
    }
  }

  const processed = new Set();
  const html = [];
  html.push('<table>');

  for (let r = 0; r < rows.length; r += 1) {
    html.push('<tr>');
    for (let c = 0; c < rows[r].length; c += 1) {
      const key = `${r}-${c}`;
      if (processed.has(key)) continue;
      const mergeInfo = mergeInfoMap[r]?.[c];
      let attrs = '';
      if (mergeInfo && mergeInfo.rowSpan > 1) {
        attrs += ` rowspan="${mergeInfo.rowSpan}"`;
      }
      if (mergeInfo && mergeInfo.colSpan > 1) {
        attrs += ` colspan="${mergeInfo.colSpan}"`;
      }
      html.push(`<td${attrs}>${rows[r][c]}</td>`);
      if (mergeInfo) {
        for (let rr = r; rr < r + mergeInfo.rowSpan; rr += 1) {
          for (let cc = c; cc < c + mergeInfo.colSpan; cc += 1) {
            processed.add(`${rr}-${cc}`);
          }
        }
      }
    }
    html.push('</tr>');
  }

  html.push('</table>');
  return html.join('\n');
}

function isBlankTextBlock(block) {
  if (!block || blockTypeFromBlock(block) !== BLOCK_TYPE.text) return false;
  const text = textElementsToMarkdown(block.text?.elements || []);
  return text.trim().length === 0;
}

function renderChildren(parent, blockMap, lines, indentLevel) {
  const childIds = parent.children || [];
  for (const childId of childIds) {
    const child = blockMap.get(childId);
    if (!child) continue;
    const isBlank = isBlankTextBlock(child);

    if (isBlank) {
      if (lines.length === 0 || lines[lines.length - 1] !== '') {
        lines.push('');
      }
      continue;
    }

    const rendered = renderBlock(child, blockMap, indentLevel);
    if (rendered) {
      lines.push(rendered);
    }
  }
}

function calculateOrderedIndex(block, blockMap) {
  const parent = blockMap.get(block.parent_id);
  if (!parent || !Array.isArray(parent.children)) return 1;
  let order = 1;
  for (const childId of parent.children) {
    if (childId === block.block_id) return order;
    const child = blockMap.get(childId);
    if (child && blockTypeFromBlock(child) === BLOCK_TYPE.ordered) {
      order += 1;
    }
  }
  return order;
}

function codeLanguageToMarkdown(language) {
  if (!language) return '';
  if (typeof language === 'string') return language;
  const mapping = {
    1: '',
    2: 'abap',
    3: 'ada',
  };
  return mapping[language] || '';
}

export function feishuToMarkdown(doc) {
  if (!doc || !Array.isArray(doc.blocks)) return '';
  const blockMap = new Map();
  for (const block of doc.blocks) {
    if (block && block.block_id) {
      blockMap.set(block.block_id, block);
    }
  }

  const rootId = doc.metadata?.document_id || doc.document?.document_id;
  let root = rootId ? blockMap.get(rootId) : null;
  if (!root) {
    root = doc.blocks.find((block) => blockTypeFromBlock(block) === BLOCK_TYPE.page) || doc.blocks[0];
  }
  if (!root) return '';

  const rendered = renderBlock(root, blockMap, 0);
  const normalized = rendered.replace(/\n{3,}/g, '\n\n').replace(/\n+$/g, '');
  return `${normalized}\n`;
}

function splitMarkdownLines(markdown) {
  return markdown.replace(/\r\n/g, '\n').replace(/\r/g, '\n').split('\n');
}

function parseInlineMarkdown(text) {
  const elements = [];
  let remaining = text;

  while (remaining.length > 0) {
    const next = findNextInlineToken(remaining);
    if (!next) {
      if (remaining.length > 0) {
        elements.push(textRunElement(remaining));
      }
      break;
    }

    if (next.index > 0) {
      elements.push(textRunElement(remaining.slice(0, next.index)));
    }

    const tokenText = remaining.slice(next.index, next.index + next.length);
    const content = next.content;

    if (next.type === 'link') {
      elements.push({
        text_run: {
          content,
          text_element_style: {
            link: { url: safeEncodeUrl(next.url) },
          },
        },
      });
    } else if (next.type === 'code') {
      elements.push(textRunElement(content, { inline_code: true }));
    } else if (next.type === 'bold') {
      elements.push(textRunElement(content, { bold: true }));
    } else if (next.type === 'italic') {
      elements.push(textRunElement(content, { italic: true }));
    } else if (next.type === 'strike') {
      elements.push(textRunElement(content, { strikethrough: true }));
    }

    remaining = remaining.slice(next.index + next.length);
  }

  return elements.length ? elements : [textRunElement('')];
}

function findNextInlineToken(text) {
  const patterns = [
    { type: 'link', regex: /\[([^\]]+)\]\(([^)]+)\)/ },
    { type: 'code', regex: /`([^`]+)`/ },
    { type: 'bold', regex: /\*\*([^*]+)\*\*/ },
    { type: 'bold', regex: /__([^_]+)__/ },
    { type: 'strike', regex: /~~([^~]+)~~/ },
    { type: 'italic', regex: /\*([^*]+)\*/ },
    { type: 'italic', regex: /_([^_]+)_/ },
  ];

  let best = null;
  for (const pattern of patterns) {
    const match = pattern.regex.exec(text);
    if (!match) continue;
    if (best && match.index >= best.index) continue;
    const length = match[0].length;
    best = {
      type: pattern.type,
      index: match.index,
      length,
      content: match[1],
      url: match[2],
    };
  }

  return best;
}

function textRunElement(content, style = {}) {
  return {
    text_run: {
      content,
      text_element_style: style,
    },
  };
}

function createBlockPayload({ type, key, elements, extra = {} }) {
  const block = {
    block_type: type,
  };

  if (key) {
    block[key] = {
      style: {},
      elements: elements || [textRunElement('')],
      ...extra,
    };
  }

  return block;
}

function mergeElementsWithNewlines(lines) {
  const merged = [];
  lines.forEach((line, idx) => {
    const elements = parseInlineMarkdown(line);
    merged.push(...elements);
    if (idx < lines.length - 1) {
      merged.push(textRunElement('\n'));
    }
  });
  return merged.length ? merged : [textRunElement('')];
}

export function markdownToBlocks(markdown) {
  const lines = splitMarkdownLines(markdown);
  const blocks = [];

  let title = 'Untitled';
  let i = 0;
  while (i < lines.length && lines[i].trim() === '') i += 1;
  if (i < lines.length && lines[i].startsWith('# ')) {
    title = lines[i].slice(2).trim() || title;
    i += 1;
    if (i < lines.length && lines[i].trim() === '---') {
      i += 1;
    }
  }

  let pendingParagraph = [];

  const flushParagraph = () => {
    if (!pendingParagraph.length) return;
    const paragraphText = pendingParagraph.join(' ');
    blocks.push(
      createBlockPayload({
        type: BLOCK_TYPE.text,
        key: 'text',
        elements: parseInlineMarkdown(paragraphText),
      })
    );
    pendingParagraph = [];
  };

  const pushBlankLine = () => {
    blocks.push(
      createBlockPayload({
        type: BLOCK_TYPE.text,
        key: 'text',
        elements: [textRunElement('')],
      })
    );
  };

  while (i < lines.length) {
    const line = lines[i];
    const hasHardBreak = /[ \t]{2,}$/.test(line);
    const trimmed = line.trim();

    const htmlTable = parseHtmlTable(lines, i);
    if (htmlTable) {
      flushParagraph();
      blocks.push(htmlTable.block);
      i = htmlTable.nextIndex;
      continue;
    }

    const mdTable = parseMarkdownTable(lines, i);
    if (mdTable) {
      flushParagraph();
      blocks.push(mdTable.block);
      i = mdTable.nextIndex;
      continue;
    }

    if (trimmed.startsWith('```')) {
      flushParagraph();
      i += 1;
      const codeLines = [];
      while (i < lines.length && !lines[i].trim().startsWith('```')) {
        codeLines.push(lines[i]);
        i += 1;
      }
      const codeText = codeLines.join('\n');
      blocks.push(
        createBlockPayload({
          type: BLOCK_TYPE.code,
          key: 'code',
          elements: [textRunElement(codeText)],
          extra: { style: {} },
        })
      );
      i += 1;
      continue;
    }

    if (trimmed.startsWith('>')) {
      flushParagraph();
      const quoteLines = [];
      while (i < lines.length && lines[i].trim().startsWith('>')) {
        const quoteLine = lines[i].replace(/^\s*>\s?/, '');
        quoteLines.push(quoteLine);
        i += 1;
      }
      blocks.push(
        createBlockPayload({
          type: BLOCK_TYPE.quote,
          key: 'quote',
          elements: mergeElementsWithNewlines(quoteLines),
        })
      );
      continue;
    }

    if (trimmed === '---' || trimmed === '***' || trimmed === '___') {
      flushParagraph();
      blocks.push({ block_type: BLOCK_TYPE.divider, divider: {} });
      i += 1;
      continue;
    }

    const headingMatch = trimmed.match(/^(#{1,9})\s+(.*)$/);
    if (headingMatch) {
      flushParagraph();
      const level = headingMatch[1].length;
      const text = headingMatch[2].trim();
      const key = `heading${level}`;
      blocks.push(
        createBlockPayload({
          type: BLOCK_TYPE[key],
          key,
          elements: parseInlineMarkdown(text),
        })
      );
      i += 1;
      continue;
    }

    const imageMatch = trimmed.match(/^!\[[^\]]*\]\(([^)]+)\)$/);
    if (imageMatch) {
      flushParagraph();
      const token = imageMatch[1];
      blocks.push({
        block_type: BLOCK_TYPE.image,
        image: { token },
      });
      i += 1;
      continue;
    }

    const listMatch = line.match(/^(\s*)([-*+]\s+|\d+\.\s+)(.*)$/);
    if (listMatch) {
      flushParagraph();
      const marker = listMatch[2].trim();
      const content = listMatch[3] || '';
      const isOrdered = /\d+\./.test(marker);
      const key = isOrdered ? 'ordered' : 'bullet';
      blocks.push(
        createBlockPayload({
          type: BLOCK_TYPE[key],
          key,
          elements: parseInlineMarkdown(content.trim()),
        })
      );
      i += 1;
      continue;
    }

    if (trimmed === '') {
      flushParagraph();
      pushBlankLine();
      i += 1;
      continue;
    }

    pendingParagraph.push(trimmed);
    if (hasHardBreak) {
      flushParagraph();
    }
    i += 1;
  }

  flushParagraph();

  return { title, blocks };
}

export function inlineMarkdownToElements(text) {
  return parseInlineMarkdown(text);
}

function parseMarkdownTable(lines, startIndex) {
  if (startIndex + 1 >= lines.length) return null;
  const headerLine = lines[startIndex];
  const separatorLine = lines[startIndex + 1];
  if (!headerLine.includes('|')) return null;
  if (!isMarkdownTableSeparator(separatorLine)) return null;

  const header = splitTableRow(headerLine);
  if (header.length === 0) return null;

  const rows = [];
  rows.push(header);

  let i = startIndex + 2;
  while (i < lines.length && lines[i].includes('|') && lines[i].trim() !== '') {
    const row = splitTableRow(lines[i]);
    if (row.length === 0) break;
    rows.push(row);
    i += 1;
  }

  const columnCount = Math.max(...rows.map((row) => row.length));
  const normalizedRows = rows.map((row) => {
    const next = row.slice();
    while (next.length < columnCount) next.push('');
    return next;
  });

  return {
    block: createTableBlock(normalizedRows, true),
    nextIndex: i,
  };
}

function parseHtmlTable(lines, startIndex) {
  const line = lines[startIndex];
  if (!line.includes('<table')) return null;

  let i = startIndex;
  const tableLines = [];
  while (i < lines.length) {
    tableLines.push(lines[i]);
    if (lines[i].includes('</table>')) {
      i += 1;
      break;
    }
    i += 1;
  }

  const html = tableLines.join('\n');
  const rows = [];
  let hasHeader = false;
  const rowRegex = /<tr[^>]*>([\s\S]*?)<\/tr>/gi;
  let rowMatch;
  while ((rowMatch = rowRegex.exec(html))) {
    const rowHtml = rowMatch[1];
    const cells = [];
    const cellRegex = /<(td|th)[^>]*>([\s\S]*?)<\/\1>/gi;
    let cellMatch;
    while ((cellMatch = cellRegex.exec(rowHtml))) {
      const tag = cellMatch[1];
      if (tag.toLowerCase() === 'th') hasHeader = true;
      const content = stripHtml(cellMatch[2]);
      cells.push(content);
    }
    if (cells.length) rows.push(cells);
  }

  if (!rows.length) return null;

  const columnCount = Math.max(...rows.map((row) => row.length));
  const normalizedRows = rows.map((row) => {
    const next = row.slice();
    while (next.length < columnCount) next.push('');
    return next;
  });

  return {
    block: createTableBlock(normalizedRows, hasHeader),
    nextIndex: i,
  };
}

function createTableBlock(rows, hasHeaderRow) {
  return {
    block_type: BLOCK_TYPE.table,
    table: {
      property: {
        row_size: rows.length,
        column_size: rows[0]?.length || 0,
        header_row: Boolean(hasHeaderRow),
        header_column: false,
      },
    },
    _table: {
      rows,
    },
  };
}

function splitTableRow(line) {
  let row = line.trim();
  if (row.startsWith('|')) row = row.slice(1);
  if (row.endsWith('|')) row = row.slice(0, -1);
  return row.split('|').map((cell) => cell.trim());
}

function isMarkdownTableSeparator(line) {
  const trimmed = line.trim();
  if (!trimmed.includes('-')) return false;
  const separator = trimmed.replace(/^\|/, '').replace(/\|$/, '');
  const parts = separator.split('|');
  return parts.every((part) => /^:?-+:?$/.test(part.trim()));
}

function stripHtml(html) {
  return html
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/p>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .trim();
}

function createBlock({
  id,
  parentId,
  type,
  key,
  elements,
  children = [],
  extra = {},
}) {
  const block = {
    block_id: id,
    parent_id: parentId,
    block_type: type,
    children: children.length ? children : undefined,
  };

  if (key) {
    block[key] = {
      style: {},
      elements: elements || [textRunElement('')],
      ...extra,
    };
  }

  return block;
}

export function markdownToFeishu(markdown) {
  const lines = splitMarkdownLines(markdown);
  const blocks = [];
  let counter = 1;
  const makeId = () => `local_${counter++}`;

  let pageTitle = 'Untitled';
  let rootId = makeId();

  let i = 0;
  while (i < lines.length && lines[i].trim() === '') i += 1;
  if (i < lines.length && lines[i].startsWith('# ')) {
    pageTitle = lines[i].slice(2).trim() || pageTitle;
    i += 1;
    if (i < lines.length && lines[i].trim() === '---') {
      i += 1;
    }
  }

  const pageBlock = createBlock({
    id: rootId,
    parentId: '',
    type: BLOCK_TYPE.page,
    key: 'page',
    elements: parseInlineMarkdown(pageTitle),
    children: [],
    extra: { style: { align: DEFAULT_ALIGN } },
  });
  blocks.push(pageBlock);

  const listStack = [];
  let pendingParagraph = [];

  const flushParagraph = () => {
    if (!pendingParagraph.length) return;
    const paragraphText = pendingParagraph.join(' ');
    const textBlockId = makeId();
    const block = createBlock({
      id: textBlockId,
      parentId: rootId,
      type: BLOCK_TYPE.text,
      key: 'text',
      elements: parseInlineMarkdown(paragraphText),
      extra: { style: { align: DEFAULT_ALIGN, folded: false } },
    });
    blocks.push(block);
    pageBlock.children.push(textBlockId);
    pendingParagraph = [];
  };

  const pushBlankLine = () => {
    const blankId = makeId();
    const block = createBlock({
      id: blankId,
      parentId: rootId,
      type: BLOCK_TYPE.text,
      key: 'text',
      elements: [textRunElement('')],
      extra: { style: { align: DEFAULT_ALIGN, folded: false } },
    });
    blocks.push(block);
    pageBlock.children.push(blankId);
  };

  const pushBlock = (block) => {
    blocks.push(block);
    pageBlock.children.push(block.block_id);
  };

  const pushListBlock = (block, indentLevel) => {
    blocks.push(block);
    if (indentLevel === 0) {
      pageBlock.children.push(block.block_id);
    }
    listStack[indentLevel] = block.block_id;
    listStack.length = indentLevel + 1;
  };

  while (i < lines.length) {
    const line = lines[i];
    const hasHardBreak = /[ \t]{2,}$/.test(line);
    const trimmed = line.trim();

    if (trimmed.startsWith('```')) {
      flushParagraph();
      const lang = trimmed.slice(3).trim();
      i += 1;
      const codeLines = [];
      while (i < lines.length && !lines[i].trim().startsWith('```')) {
        codeLines.push(lines[i]);
        i += 1;
      }
      const codeText = codeLines.join('\n');
      const codeId = makeId();
      const codeBlock = createBlock({
        id: codeId,
        parentId: rootId,
        type: BLOCK_TYPE.code,
        key: 'code',
        elements: [textRunElement(codeText)],
        extra: { style: { language: lang || undefined, wrap: true } },
      });
      pushBlock(codeBlock);
      i += 1;
      continue;
    }

    if (trimmed.startsWith('>')) {
      flushParagraph();
      const quoteLines = [];
      while (i < lines.length && lines[i].trim().startsWith('>')) {
        const quoteLine = lines[i].replace(/^\s*>\s?/, '');
        quoteLines.push(quoteLine);
        i += 1;
      }
      const quoteContainerId = makeId();
      const quoteContainer = {
        block_id: quoteContainerId,
        parent_id: rootId,
        block_type: BLOCK_TYPE.quote_container,
        children: [],
        quote_container: {},
      };
      blocks.push(quoteContainer);
      pageBlock.children.push(quoteContainerId);

      for (const quoteLine of quoteLines) {
        const quoteId = makeId();
        const quoteBlock = createBlock({
          id: quoteId,
          parentId: quoteContainerId,
          type: BLOCK_TYPE.text,
          key: 'text',
          elements: parseInlineMarkdown(quoteLine),
          extra: { style: { align: DEFAULT_ALIGN, folded: false } },
        });
        blocks.push(quoteBlock);
        quoteContainer.children.push(quoteId);
      }
      continue;
    }

    if (trimmed === '---' || trimmed === '***' || trimmed === '___') {
      flushParagraph();
      const dividerId = makeId();
      pushBlock({
        block_id: dividerId,
        parent_id: rootId,
        block_type: BLOCK_TYPE.divider,
        divider: {},
      });
      i += 1;
      continue;
    }

    const headingMatch = trimmed.match(/^(#{1,9})\s+(.*)$/);
    if (headingMatch) {
      flushParagraph();
      const level = headingMatch[1].length;
      const text = headingMatch[2].trim();
      const headingId = makeId();
      const key = `heading${level}`;
      const block = createBlock({
        id: headingId,
        parentId: rootId,
        type: BLOCK_TYPE[key],
        key,
        elements: parseInlineMarkdown(text),
        extra: { style: { align: DEFAULT_ALIGN, folded: false } },
      });
      pushBlock(block);
      i += 1;
      continue;
    }

    const listMatch = line.match(/^(\s*)([-*+]\s+|\d+\.\s+)(.*)$/);
    if (listMatch) {
      flushParagraph();
      const indentSpaces = listMatch[1].length;
      const indentLevel = Math.floor(indentSpaces / 2);
      const marker = listMatch[2].trim();
      const content = listMatch[3] || '';
      const isOrdered = /\d+\./.test(marker);

      const listId = makeId();
      const parentId = indentLevel > 0 ? listStack[indentLevel - 1] : rootId;
      const key = isOrdered ? 'ordered' : 'bullet';
      const block = createBlock({
        id: listId,
        parentId,
        type: BLOCK_TYPE[key],
        key,
        elements: parseInlineMarkdown(content.trim()),
        extra: { style: { align: DEFAULT_ALIGN, folded: false } },
      });

      pushListBlock(block, indentLevel);
      if (indentLevel > 0) {
        const parentBlock = blocks.find((b) => b.block_id === parentId);
        if (parentBlock) {
          if (!Array.isArray(parentBlock.children)) parentBlock.children = [];
          parentBlock.children.push(listId);
        }
      }

      i += 1;
      continue;
    }

    if (trimmed === '') {
      flushParagraph();
      pushBlankLine();
      i += 1;
      continue;
    }

    pendingParagraph.push(trimmed);
    if (hasHardBreak) {
      flushParagraph();
    }
    i += 1;
  }

  flushParagraph();

  const metadata = {
    document_id: rootId,
    revision_id: 1,
    title: pageTitle,
  };

  return { metadata, blocks };
}
