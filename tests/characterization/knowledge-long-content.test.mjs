import test from 'node:test';
import assert from 'node:assert/strict';
import {
  KNOWLEDGE_CONTENT_CHUNK_SIZE,
  firstKnowledgeContentChunk,
  isLongKnowledgeContent,
  joinKnowledgeContentChunks,
  splitKnowledgeContent,
} from '../../backend/src/services/knowledge-content-chunks.js';

test('base de conocimientos divide contenido largo por debajo del límite de Sheets', () => {
  const content = `<p>${'A'.repeat(95_000)}</p>`;
  const chunks = splitKnowledgeContent(content);

  assert.equal(KNOWLEDGE_CONTENT_CHUNK_SIZE, 40_000);
  assert.equal(chunks.length, 3);
  assert.ok(chunks.every((chunk) => chunk.length <= 40_000));
  assert.equal(joinKnowledgeContentChunks(chunks), content);
  assert.equal(firstKnowledgeContentChunk(content), chunks[0]);
  assert.equal(isLongKnowledgeContent(content), true);
});

test('base de conocimientos conserva contenido corto sin fragmentación funcional', () => {
  const content = '<p>Tutorial corto</p>';
  const chunks = splitKnowledgeContent(content);

  assert.deepEqual(chunks, [content]);
  assert.equal(joinKnowledgeContentChunks(chunks), content);
  assert.equal(isLongKnowledgeContent(content), false);
});

test('el corte no separa pares sustitutos UTF-16', () => {
  const prefix = 'A'.repeat(KNOWLEDGE_CONTENT_CHUNK_SIZE - 1);
  const content = `${prefix}😀B`;
  const chunks = splitKnowledgeContent(content);

  assert.equal(chunks.length, 2);
  assert.equal(chunks[0], prefix);
  assert.equal(chunks[1], '😀B');
  assert.equal(joinKnowledgeContentChunks(chunks), content);
});
