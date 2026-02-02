import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  BLOCK_TYPE,
  feishuToMarkdown,
  markdownToBlocks,
  inlineMarkdownToElements,
  markdownToFeishu,
} from '../api/feishu-md.js';

// ── helpers ────────────────────────────────────────────────────────────

/** Build a minimal Feishu doc JSON that feishuToMarkdown accepts. */
function buildDoc(childBlocks) {
  const docId = 'doc1';
  const pageBlock = {
    block_id: docId,
    block_type: BLOCK_TYPE.page,
    page: {},
    children: childBlocks.map((b) => b.block_id),
  };
  return {
    blocks: [pageBlock, ...childBlocks],
    metadata: { document_id: docId },
  };
}

function textBlock(id, content) {
  return {
    block_id: id,
    block_type: BLOCK_TYPE.text,
    text: {
      style: {},
      elements: [{ text_run: { content, text_element_style: {} } }],
    },
  };
}

function headingBlock(id, level, content) {
  const key = `heading${level}`;
  return {
    block_id: id,
    block_type: BLOCK_TYPE[key],
    [key]: {
      style: {},
      elements: [{ text_run: { content, text_element_style: {} } }],
    },
  };
}

function bulletBlock(id, content) {
  return {
    block_id: id,
    block_type: BLOCK_TYPE.bullet,
    bullet: {
      style: {},
      elements: [{ text_run: { content, text_element_style: {} } }],
    },
  };
}

function orderedBlock(id, content) {
  return {
    block_id: id,
    block_type: BLOCK_TYPE.ordered,
    ordered: {
      style: {},
      elements: [{ text_run: { content, text_element_style: {} } }],
    },
  };
}

function codeBlock(id, content, language = 0) {
  return {
    block_id: id,
    block_type: BLOCK_TYPE.code,
    code: {
      style: { language },
      elements: [{ text_run: { content, text_element_style: {} } }],
    },
  };
}

function dividerBlock(id) {
  return { block_id: id, block_type: BLOCK_TYPE.divider, divider: {} };
}

function todoBlock(id, content, done = false) {
  return {
    block_id: id,
    block_type: BLOCK_TYPE.todo,
    todo: {
      style: { done },
      elements: [{ text_run: { content, text_element_style: {} } }],
    },
  };
}

// ── feishuToMarkdown ───────────────────────────────────────────────────

describe('feishuToMarkdown', () => {
  it('returns empty string for null/undefined input', () => {
    assert.equal(feishuToMarkdown(null), '');
    assert.equal(feishuToMarkdown(undefined), '');
    assert.equal(feishuToMarkdown({}), '');
  });

  it('converts plain text blocks', () => {
    const doc = buildDoc([textBlock('b1', 'Hello world')]);
    const md = feishuToMarkdown(doc);
    assert.ok(md.includes('Hello world'));
  });

  it('converts headings (h1-h3)', () => {
    const doc = buildDoc([
      headingBlock('h1', 1, 'Title'),
      headingBlock('h2', 2, 'Subtitle'),
      headingBlock('h3', 3, 'Section'),
    ]);
    const md = feishuToMarkdown(doc);
    assert.ok(md.includes('# Title'));
    assert.ok(md.includes('## Subtitle'));
    assert.ok(md.includes('### Section'));
  });

  it('converts bullet list', () => {
    const doc = buildDoc([
      bulletBlock('b1', 'Item A'),
      bulletBlock('b2', 'Item B'),
    ]);
    const md = feishuToMarkdown(doc);
    assert.ok(md.includes('- Item A'));
    assert.ok(md.includes('- Item B'));
  });

  it('converts ordered list', () => {
    const doc = buildDoc([
      orderedBlock('o1', 'First'),
      orderedBlock('o2', 'Second'),
    ]);
    const md = feishuToMarkdown(doc);
    assert.ok(md.includes('1. First'));
    assert.ok(md.includes('1. Second'));
  });

  it('converts code block', () => {
    const doc = buildDoc([codeBlock('c1', 'const x = 1;')]);
    const md = feishuToMarkdown(doc);
    assert.ok(md.includes('```'));
    assert.ok(md.includes('const x = 1;'));
  });

  it('converts divider', () => {
    const doc = buildDoc([
      textBlock('t1', 'Before'),
      dividerBlock('d1'),
      textBlock('t2', 'After'),
    ]);
    const md = feishuToMarkdown(doc);
    assert.ok(md.includes('---'));
  });

  it('converts todo items', () => {
    const doc = buildDoc([
      todoBlock('td1', 'Pending task', false),
      todoBlock('td2', 'Done task', true),
    ]);
    const md = feishuToMarkdown(doc);
    assert.ok(md.includes('- [ ] Pending task'));
    assert.ok(md.includes('- [x] Done task'));
  });

  it('handles inline bold/italic/code styles', () => {
    const doc = buildDoc([{
      block_id: 'styled',
      block_type: BLOCK_TYPE.text,
      text: {
        style: {},
        elements: [
          { text_run: { content: 'bold', text_element_style: { bold: true } } },
          { text_run: { content: ' and ', text_element_style: {} } },
          { text_run: { content: 'italic', text_element_style: { italic: true } } },
          { text_run: { content: ' and ', text_element_style: {} } },
          { text_run: { content: 'code', text_element_style: { inline_code: true } } },
        ],
      },
    }]);
    const md = feishuToMarkdown(doc);
    assert.ok(md.includes('**bold**'));
    assert.ok(md.includes('_italic_'));
    assert.ok(md.includes('`code`'));
  });

  it('handles links', () => {
    const doc = buildDoc([{
      block_id: 'link1',
      block_type: BLOCK_TYPE.text,
      text: {
        style: {},
        elements: [
          { text_run: { content: 'click here', text_element_style: { link: { url: 'https%3A%2F%2Fexample.com' } } } },
        ],
      },
    }]);
    const md = feishuToMarkdown(doc);
    assert.ok(md.includes('[click here](https://example.com)'));
  });
});

// ── markdownToBlocks ───────────────────────────────────────────────────

describe('markdownToBlocks', () => {
  it('extracts title from first h1', () => {
    const { title, blocks } = markdownToBlocks('# My Title\n\nSome text');
    assert.equal(title, 'My Title');
  });

  it('defaults title to Untitled when no h1', () => {
    const { title } = markdownToBlocks('Just some text');
    assert.equal(title, 'Untitled');
  });

  it('parses plain text into text blocks', () => {
    const { blocks } = markdownToBlocks('# T\n\nHello world');
    const textBlocks = blocks.filter((b) => b.block_type === BLOCK_TYPE.text);
    assert.ok(textBlocks.length > 0);
  });

  it('parses headings', () => {
    const { blocks } = markdownToBlocks('# T\n\n## Section\n\n### Sub');
    const h2 = blocks.find((b) => b.block_type === BLOCK_TYPE.heading2);
    const h3 = blocks.find((b) => b.block_type === BLOCK_TYPE.heading3);
    assert.ok(h2, 'should have h2 block');
    assert.ok(h3, 'should have h3 block');
  });

  it('parses bullet list', () => {
    const { blocks } = markdownToBlocks('# T\n\n- a\n- b\n- c');
    const bullets = blocks.filter((b) => b.block_type === BLOCK_TYPE.bullet);
    assert.equal(bullets.length, 3);
  });

  it('parses ordered list', () => {
    const { blocks } = markdownToBlocks('# T\n\n1. first\n2. second');
    const ordered = blocks.filter((b) => b.block_type === BLOCK_TYPE.ordered);
    assert.equal(ordered.length, 2);
  });

  it('parses code blocks', () => {
    const { blocks } = markdownToBlocks('# T\n\n```js\nconst x = 1;\n```');
    const code = blocks.find((b) => b.block_type === BLOCK_TYPE.code);
    assert.ok(code, 'should have code block');
  });

  it('parses dividers', () => {
    const { blocks } = markdownToBlocks('# T\n\ntext\n\n---\n\nmore');
    const dividers = blocks.filter((b) => b.block_type === BLOCK_TYPE.divider);
    assert.ok(dividers.length >= 1);
  });

  it('parses todo items', () => {
    const { blocks } = markdownToBlocks('# T\n\n- [ ] pending\n- [x] done');
    const todos = blocks.filter((b) => b.block_type === BLOCK_TYPE.todo);
    assert.equal(todos.length, 2);
    assert.equal(todos[0].todo.style.done, false);
    assert.equal(todos[1].todo.style.done, true);
  });

  it('parses markdown table', () => {
    const md = '# T\n\n| A | B |\n|---|---|\n| 1 | 2 |\n| 3 | 4 |';
    const { blocks } = markdownToBlocks(md);
    const table = blocks.find((b) => b.block_type === BLOCK_TYPE.table);
    assert.ok(table, 'should have table block');
    assert.ok(table._table, 'should have _table data');
    assert.equal(table._table.rows.length, 3); // header + 2 data rows
  });
});

// ── inlineMarkdownToElements ───────────────────────────────────────────

describe('inlineMarkdownToElements', () => {
  it('parses plain text', () => {
    const els = inlineMarkdownToElements('hello');
    assert.equal(els.length, 1);
    assert.equal(els[0].text_run.content, 'hello');
  });

  it('parses bold', () => {
    const els = inlineMarkdownToElements('**bold**');
    const bold = els.find((e) => e.text_run?.text_element_style?.bold);
    assert.ok(bold, 'should have bold element');
    assert.equal(bold.text_run.content, 'bold');
  });

  it('parses italic', () => {
    const els = inlineMarkdownToElements('*italic*');
    const it = els.find((e) => e.text_run?.text_element_style?.italic);
    assert.ok(it, 'should have italic element');
  });

  it('parses inline code', () => {
    const els = inlineMarkdownToElements('`code`');
    const code = els.find((e) => e.text_run?.text_element_style?.inline_code);
    assert.ok(code, 'should have inline code element');
    assert.equal(code.text_run.content, 'code');
  });

  it('parses links', () => {
    const els = inlineMarkdownToElements('[text](https://example.com)');
    const link = els.find((e) => e.text_run?.text_element_style?.link);
    assert.ok(link, 'should have link element');
    assert.equal(link.text_run.content, 'text');
  });

  it('parses strikethrough', () => {
    const els = inlineMarkdownToElements('~~strike~~');
    const strike = els.find((e) => e.text_run?.text_element_style?.strikethrough);
    assert.ok(strike, 'should have strikethrough element');
  });

  it('parses mixed inline', () => {
    const els = inlineMarkdownToElements('normal **bold** and `code`');
    assert.ok(els.length >= 3);
  });
});

// ── roundtrip ──────────────────────────────────────────────────────────

describe('roundtrip: markdown → blocks → feishu → markdown', () => {
  it('preserves headings through roundtrip', () => {
    const original = '# Doc Title\n\n## Section One\n\nSome text here.\n\n### Subsection\n\nMore text.';
    const { blocks } = markdownToBlocks(original);
    // blocks should contain heading and text types
    const hasH2 = blocks.some((b) => b.block_type === BLOCK_TYPE.heading2);
    const hasH3 = blocks.some((b) => b.block_type === BLOCK_TYPE.heading3);
    assert.ok(hasH2);
    assert.ok(hasH3);
  });

  it('markdownToFeishu produces valid tree structure', () => {
    const md = '# Title\n\nParagraph\n\n- bullet\n\n1. ordered';
    const result = markdownToFeishu(md);
    assert.ok(result.blocks, 'should have blocks array');
    assert.ok(result.blocks.length > 0);
    // root should be a page block
    const page = result.blocks.find((b) => b.block_type === BLOCK_TYPE.page);
    assert.ok(page, 'should have page block');
    assert.ok(Array.isArray(page.children), 'page should have children');
  });
});
