import { describe, it, expect } from 'vitest';
import { convertOpenAIChunkToClaude } from './streamResponseOpenAI';
import type {
  OpenAIStreamChunk,
  StreamConversionState,
  ClaudeStreamContentBlockDelta,
} from './types';

describe('OpenAI to Claude content block management', () => {
  it('should only create one content_block_start for multiple content deltas', () => {
    const state: StreamConversionState = {
      messageId: 'chatcmpl-123',
      created: 1234567890,
      model: 'gpt-4',
      contentBlockStarted: false,
    };

    const chunk1: OpenAIStreamChunk = {
      id: 'chatcmpl-123',
      object: 'chat.completion.chunk',
      created: 1234567890,
      model: 'gpt-4',
      choices: [
        {
          index: 0,
          delta: { content: 'Hello' },
          finish_reason: null,
        },
      ],
    };

    const chunk2: OpenAIStreamChunk = {
      id: 'chatcmpl-123',
      object: 'chat.completion.chunk',
      created: 1234567890,
      model: 'gpt-4',
      choices: [
        {
          index: 0,
          delta: { content: ', world!' },
          finish_reason: null,
        },
      ],
    };

    // First chunk
    const events1 = convertOpenAIChunkToClaude(chunk1, state);
    const startEvents1 = events1.filter((e) => e.type === 'content_block_start');
    expect(startEvents1).toHaveLength(1);
    expect(state.contentBlockStarted).toBe(true);

    // Second chunk
    const events2 = convertOpenAIChunkToClaude(chunk2, state);
    const startEvents2 = events2.filter((e) => e.type === 'content_block_start');
    expect(startEvents2).toHaveLength(0);
    expect(state.contentBlockStarted).toBe(true);
  });

  it('should stop content block before a tool call', () => {
    const state: StreamConversionState = {
      messageId: 'chatcmpl-123',
      created: 1234567890,
      model: 'gpt-4',
      contentBlockStarted: false,
    };

    const contentChunk: OpenAIStreamChunk = {
      id: 'chatcmpl-123',
      object: 'chat.completion.chunk',
      created: 1234567890,
      model: 'gpt-4',
      choices: [{ index: 0, delta: { content: 'Thinking...' }, finish_reason: null }],
    };

    const toolChunk: OpenAIStreamChunk = {
      id: 'chatcmpl-123',
      object: 'chat.completion.chunk',
      created: 1234567890,
      model: 'gpt-4',
      choices: [
        {
          index: 0,
          delta: {
            tool_calls: [
              {
                index: 0,
                id: 'call_abc123',
                type: 'function',
                function: { name: 'get_weather', arguments: '' },
              },
            ],
          },
          finish_reason: null,
        },
      ],
    };

    // Content chunk
    const events1 = convertOpenAIChunkToClaude(contentChunk, state);
    expect(events1.some((e) => e.type === 'content_block_start')).toBe(true);
    expect(state.contentBlockStarted).toBe(true);

    // Tool chunk
    const events2 = convertOpenAIChunkToClaude(toolChunk, state);
    const stopContentEvent = events2.find((e) => e.type === 'content_block_stop');
    const startToolEvent = events2.find((e) => e.type === 'content_block_start');

    expect(stopContentEvent).toBeDefined();
    expect((stopContentEvent as { index: number }).index).toBe(0);
    expect(state.contentBlockStarted).toBe(false);
    expect(startToolEvent).toBeDefined();
    expect((startToolEvent as { content_block: { type: string } }).content_block.type).toBe(
      'tool_use'
    );
  });

  it('should handle multi-segment text with paragraphs correctly', () => {
    const state: StreamConversionState = {
      messageId: 'chatcmpl-123',
      created: 1234567890,
      model: 'gpt-4',
      contentBlockStarted: false,
    };

    // First segment with paragraph 1
    const chunk1: OpenAIStreamChunk = {
      id: 'chatcmpl-123',
      object: 'chat.completion.chunk',
      created: 1234567890,
      model: 'gpt-4',
      choices: [{ index: 0, delta: { content: 'Paragraph 1.\n\n' }, finish_reason: null }],
    };

    // Second segment with paragraph 2
    const chunk2: OpenAIStreamChunk = {
      id: 'chatcmpl-123',
      object: 'chat.completion.chunk',
      created: 1234567890,
      model: 'gpt-4',
      choices: [{ index: 0, delta: { content: 'Paragraph 2.\n\n' }, finish_reason: null }],
    };

    // Third segment with paragraph 3 and finish
    const chunk3: OpenAIStreamChunk = {
      id: 'chatcmpl-123',
      object: 'chat.completion.chunk',
      created: 1234567890,
      model: 'gpt-4',
      choices: [{ index: 0, delta: { content: 'Paragraph 3.' }, finish_reason: null }],
    };

    const finishChunk: OpenAIStreamChunk = {
      id: 'chatcmpl-123',
      object: 'chat.completion.chunk',
      created: 1234567890,
      model: 'gpt-4',
      choices: [{ index: 0, delta: {}, finish_reason: 'stop' }],
    };

    // Process chunks
    const events1 = convertOpenAIChunkToClaude(chunk1, state);
    const startEvents1 = events1.filter((e) => e.type === 'content_block_start');
    expect(startEvents1).toHaveLength(1); // Only one content_block_start
    expect(state.contentBlockStarted).toBe(true);

    const events2 = convertOpenAIChunkToClaude(chunk2, state);
    const startEvents2 = events2.filter((e) => e.type === 'content_block_start');
    expect(startEvents2).toHaveLength(0); // No new content_block_start

    const events3 = convertOpenAIChunkToClaude(chunk3, state);
    const startEvents3 = events3.filter((e) => e.type === 'content_block_start');
    expect(startEvents3).toHaveLength(0); // No new content_block_start

    // Verify text content is preserved
    const allEvents = [...events1, ...events2, ...events3];
    const contentDeltaEvents = allEvents.filter(
      (e) => e.type === 'content_block_delta'
    ) as ClaudeStreamContentBlockDelta[];
    const combinedText = contentDeltaEvents.map((e) => (e.delta as { text: string }).text).join('');
    expect(combinedText).toBe('Paragraph 1.\n\nParagraph 2.\n\nParagraph 3.');

    // Verify proper completion
    const eventsFinish = convertOpenAIChunkToClaude(finishChunk, state);
    expect(eventsFinish.some((e) => e.type === 'content_block_stop')).toBe(true);
    expect(eventsFinish.some((e) => e.type === 'message_stop')).toBe(true);
    expect(state.contentBlockStarted).toBe(false);
  });

  it('should stop content block on finish_reason', () => {
    const state: StreamConversionState = {
      messageId: 'chatcmpl-123',
      created: 1234567890,
      model: 'gpt-4',
      contentBlockStarted: false,
    };

    const contentChunk: OpenAIStreamChunk = {
      id: 'chatcmpl-123',
      object: 'chat.completion.chunk',
      created: 1234567890,
      model: 'gpt-4',
      choices: [{ index: 0, delta: { content: 'Final answer.' }, finish_reason: null }],
    };

    const finishChunk: OpenAIStreamChunk = {
      id: 'chatcmpl-123',
      object: 'chat.completion.chunk',
      created: 1234567890,
      model: 'gpt-4',
      choices: [{ index: 0, delta: {}, finish_reason: 'stop' }],
    };

    // Content chunk
    convertOpenAIChunkToClaude(contentChunk, state);
    expect(state.contentBlockStarted).toBe(true);

    // Finish chunk
    const events = convertOpenAIChunkToClaude(finishChunk, state);
    const stopEvent = events.find((e) => e.type === 'content_block_stop');
    expect(stopEvent).toBeDefined();
    expect(state.contentBlockStarted).toBe(false);
    expect(events.some((e) => e.type === 'message_stop')).toBe(true);
  });
});
