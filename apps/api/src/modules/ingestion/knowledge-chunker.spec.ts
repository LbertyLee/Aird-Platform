import { chunkKnowledgeText } from './knowledge-chunker';

describe('chunkKnowledgeText', () => {
  it('keeps paragraph boundaries in smart mode when they fit', () => {
    const chunks = chunkKnowledgeText(
      '第一段内容。\n\n第二段内容。',
      100,
      0,
      'smart',
    );

    expect(chunks).toEqual(['第一段内容。\n\n第二段内容。']);
  });

  it('uses overlap only after a chunk boundary', () => {
    const chunks = chunkKnowledgeText('abcdefghij', 6, 2, 'fixed');

    expect(chunks).toEqual(['abcdef', 'efghij', 'ij']);
  });
});
