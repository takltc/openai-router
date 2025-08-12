/**
 * Tests for stream response conversion
 * @author jizhejiang
 * @date 2025-08-11
 */

import { describe, it, expect } from 'vitest';
import type { OpenAIStreamChunk, ClaudeStreamEvent, StreamConversionState } from './types';
import { convertOpenAIChunkToClaude, createOpenAIToClaudeTransform } from './streamResponseOpenAI';
import { convertClaudeEventToOpenAI, createClaudeToOpenAITransform } from './streamResponseClaude';
import { parseSSE, enqueueSSE, createDoneMessage, isDoneMessage, parseIncompleteSSE } from './sse';

describe('SSE utilities', () => {
  it('should parse SSE messages correctly', () => {
    const sseString = 'data: {"test": "value"}\n';
    const parsed = parseSSE(sseString);

    expect(parsed).not.toBeNull();
    expect(parsed?.data).toEqual({ test: 'value' });
  });

  it('should handle multi-line data in SSE', () => {
    const sseString = 'data: line1\ndata: line2\n';
    const parsed = parseSSE(sseString);

    expect(parsed).not.toBeNull();
    expect(parsed?.data).toBe('line1\nline2');
  });

  it('should parse SSE with event type', () => {
    const sseString = 'event: test-event\ndata: {"message": "hello"}\n';
    const parsed = parseSSE(sseString);

    expect(parsed).not.toBeNull();
    expect(parsed?.event).toBe('test-event');
    expect(parsed?.data).toEqual({ message: 'hello' });
  });

  it('should detect [DONE] messages', () => {
    const doneMessage = createDoneMessage();
    expect(doneMessage.data).toBe('[DONE]');

    const parsed = parseSSE('data: [DONE]\n');
    expect(parsed).not.toBeNull();
    if (parsed) {
      expect(isDoneMessage(parsed)).toBe(true);
    }
  });

  it('should parse [DONE] message without JSON errors', () => {
    // 这个测试确保[DONE]消息不会产生JSON解析错误
    const sseString = 'data: [DONE]\n\n';
    const parsed = parseSSE(sseString);
    
    expect(parsed).not.toBeNull();
    expect(parsed?.data).toBe('[DONE]');
    expect(isDoneMessage(parsed!)).toBe(true);
  });

  it('should handle incomplete [DONE] message', () => {
    // 测试缺少换行符的[DONE]消息
    const incompleteSSE = 'data: [DONE]';
    const parsed = parseIncompleteSSE(incompleteSSE);
    
    expect(parsed).not.toBeNull();
    expect(parsed?.data).toBe('[DONE]');
    expect(isDoneMessage(parsed!)).toBe(true);
  });

  it('should handle special SSE markers correctly', () => {
    const specialMarkers = ['[DONE]', 'ping', 'heartbeat'];
    
    for (const marker of specialMarkers) {
      const sseString = `data: ${marker}\n\n`;
      const parsed = parseSSE(sseString);
      
      expect(parsed).not.toBeNull();
      expect(parsed?.data).toBe(marker);
    }
  });
});

describe('OpenAI to Claude stream conversion', () => {
  it('should convert OpenAI message start chunk', () => {
    const state: StreamConversionState = {
      messageId: '',
      created: 0,
      model: '',
    };

    const chunk: OpenAIStreamChunk = {
      id: 'chatcmpl-123',
      object: 'chat.completion.chunk',
      created: 1234567890,
      model: 'gpt-4',
      choices: [
        {
          index: 0,
          delta: { role: 'assistant' },
          finish_reason: null,
        },
      ],
    };

    const events = convertOpenAIChunkToClaude(chunk, state);

    expect(events).toHaveLength(1);
    expect(events[0].type).toBe('message_start');

    const messageStart = events[0] as ClaudeStreamEvent & { type: 'message_start' };
    expect(messageStart.message.id).toBe('chatcmpl-123');
    expect(messageStart.message.role).toBe('assistant');
  });

  it('should convert OpenAI content delta', () => {
    const state: StreamConversionState = {
      messageId: 'chatcmpl-123',
      created: 1234567890,
      model: 'gpt-4',
    };

    const chunk: OpenAIStreamChunk = {
      id: 'chatcmpl-123',
      object: 'chat.completion.chunk',
      created: 1234567890,
      model: 'gpt-4',
      choices: [
        {
          index: 0,
          delta: { content: 'Hello, world!' },
          finish_reason: null,
        },
      ],
    };

    const events = convertOpenAIChunkToClaude(chunk, state);

    expect(events.length).toBeGreaterThan(0);

    const contentDelta = events.find((e) => e.type === 'content_block_delta');
    expect(contentDelta).toBeDefined();
    if (contentDelta && contentDelta.type === 'content_block_delta') {
      expect(contentDelta.delta.text).toBe('Hello, world!');
    }
  });

  it('should handle OpenAI tool calls', () => {
    const state: StreamConversionState = {
      messageId: 'chatcmpl-123',
      created: 1234567890,
      model: 'gpt-4',
    };

    const chunk: OpenAIStreamChunk = {
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
                function: {
                  name: 'get_weather',
                  arguments: '{"location":',
                },
              },
            ],
          },
          finish_reason: null,
        },
      ],
    };

    const events = convertOpenAIChunkToClaude(chunk, state);

    const toolStart = events.find((e) => e.type === 'content_block_start');
    expect(toolStart).toBeDefined();
    if (toolStart && toolStart.type === 'content_block_start') {
      expect(toolStart.content_block.type).toBe('tool_use');
    }
  });
});

describe('Claude to OpenAI stream conversion', () => {
  it('should convert Claude message start', () => {
    const state: StreamConversionState = {
      messageId: '',
      created: 0,
      model: '',
    };

    const event: ClaudeStreamEvent = {
      type: 'message_start',
      message: {
        id: 'msg_123',
        type: 'message',
        role: 'assistant',
        model: 'claude-3-opus-20240229',
        content: [],
        stop_reason: null,
        stop_sequence: null,
        usage: {
          input_tokens: 10,
          output_tokens: 0,
        },
      },
    };

    const chunk = convertClaudeEventToOpenAI(event, state);

    expect(chunk).not.toBeNull();
    if (chunk) {
      expect(chunk.id).toBe('msg_123');
      expect(chunk.object).toBe('chat.completion.chunk');
      expect(chunk.choices[0].delta.role).toBe('assistant');
    }
  });

  it('should convert Claude text delta', () => {
    const state: StreamConversionState = {
      messageId: 'msg_123',
      created: 1234567890,
      model: 'claude-3-opus-20240229',
    };

    const event: ClaudeStreamEvent = {
      type: 'content_block_delta',
      index: 0,
      delta: {
        type: 'text_delta',
        text: 'Hello from Claude!',
      },
    };

    const chunk = convertClaudeEventToOpenAI(event, state);

    expect(chunk).not.toBeNull();
    if (chunk) {
      expect(chunk.choices[0].delta.content).toBe('Hello from Claude!');
    }
  });

  it('should handle Claude tool use', () => {
    const state: StreamConversionState = {
      messageId: 'msg_123',
      created: 1234567890,
      model: 'claude-3-opus-20240229',
    };

    const event: ClaudeStreamEvent = {
      type: 'content_block_start',
      index: 0,
      content_block: {
        type: 'tool_use',
        id: 'tool_123',
        name: 'get_weather',
        input: {},
      },
    };

    const chunk = convertClaudeEventToOpenAI(event, state);

    expect(chunk).not.toBeNull();
    if (chunk) {
      expect(chunk.choices[0].delta.tool_calls).toBeDefined();
      const toolCalls = chunk.choices[0].delta.tool_calls;
      if (toolCalls && toolCalls.length > 0) {
        expect(toolCalls[0].function?.name).toBe('get_weather');
      }
    }
  });

  it('should convert Claude message stop with finish reason', () => {
    const state: StreamConversionState = {
      messageId: 'msg_123',
      created: 1234567890,
      model: 'claude-3-opus-20240229',
      usage: {
        input_tokens: 10,
        output_tokens: 20,
      },
    };

    const event: ClaudeStreamEvent = {
      type: 'message_delta',
      delta: {
        stop_reason: 'end_turn',
        stop_sequence: null,
      },
      usage: {
        output_tokens: 20,
      },
    };

    const chunk = convertClaudeEventToOpenAI(event, state);

    expect(chunk).not.toBeNull();
    if (chunk) {
      expect(chunk.choices[0].finish_reason).toBe('stop');
      expect(chunk.usage).toBeDefined();
      expect(chunk.usage?.total_tokens).toBe(30);
    }
  });
});

describe('Stream transformation', () => {
  it('should create OpenAI to Claude transform stream', () => {
    const transform = createOpenAIToClaudeTransform();
    expect(transform).toBeDefined();
    expect(transform).toBeInstanceOf(TransformStream);
  });

  it('should create Claude to OpenAI transform stream', () => {
    const transform = createClaudeToOpenAITransform();
    expect(transform).toBeDefined();
    expect(transform).toBeInstanceOf(TransformStream);
  });
});
