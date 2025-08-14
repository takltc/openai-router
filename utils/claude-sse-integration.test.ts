/**
 * Claude SSE Stream Integration Tests
 * Tests complete Claude SSE event flows and their conversion to OpenAI format
 * @author jizhejiang
 * @date 2025-08-12
 */

import { describe, it, expect } from 'vitest';
import {
  parseSSE,
  createDoneMessage,
  isDoneMessage,
  parseIncompleteSSE,
  enqueueSSE,
  createSSEParser,
} from './sse';
import { transformClaudeStreamToOpenAI } from './streamResponseClaude';
import type { ClaudeStreamEvent, ParsedSSEMessage } from './types';

// Mock完整的Claude SSE事件流
const COMPLETE_CLAUDE_SSE_FLOW = [
  // message_start
  'event: message_start\ndata: {"type":"message_start","message":{"id":"msg_01ABC123","type":"message","role":"assistant","model":"claude-3-sonnet-20240229","content":[],"stop_reason":null,"stop_sequence":null,"usage":{"input_tokens":15,"output_tokens":0}}}\n\n',

  // content_block_start
  'event: content_block_start\ndata: {"type":"content_block_start","index":0,"content_block":{"type":"text","text":""}}\n\n',

  // content_block_delta - text_delta
  'event: content_block_delta\ndata: {"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"Hello"}}\n\n',

  // content_block_delta - more text
  'event: content_block_delta\ndata: {"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":" world"}}\n\n',

  // content_block_stop
  'event: content_block_stop\ndata: {"type":"content_block_stop","index":0}\n\n',

  // message_delta
  'event: message_delta\ndata: {"type":"message_delta","delta":{"stop_reason":"end_turn","stop_sequence":null},"usage":{"output_tokens":2}}\n\n',

  // message_stop
  'event: message_stop\ndata: {"type":"message_stop"}\n\n',
];

// 缺少结尾换行的异常流
const INCOMPLETE_SSE_DATA = [
  'event: message_start\ndata: {"type":"message_start","message":{"id":"msg_01XYZ789","type":"message","role":"assistant","model":"claude-3-sonnet-20240229","content":[],"stop_reason":null,"stop_sequence":null,"usage":{"input_tokens":10,"output_tokens":0}}}',

  'event: content_block_delta\ndata: {"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"Incomplete"}}',

  'data: [DONE]', // OpenAI结束标记，缺少换行
];

describe('Claude SSE Integration Tests', () => {
  describe('Complete Claude Event Flow Processing', () => {
    it('should parse complete Claude SSE event sequence', () => {
      const parsedEvents: ClaudeStreamEvent[] = [];

      for (const sseData of COMPLETE_CLAUDE_SSE_FLOW) {
        const parsed = parseSSE(sseData.trim());
        expect(parsed).not.toBeNull();

        if (parsed && parsed.data && typeof parsed.data === 'object') {
          parsedEvents.push(parsed.data as ClaudeStreamEvent);
        }
      }

      // 验证事件序列完整性
      expect(parsedEvents).toHaveLength(7);
      expect(parsedEvents[0].type).toBe('message_start');
      expect(parsedEvents[1].type).toBe('content_block_start');
      expect(parsedEvents[2].type).toBe('content_block_delta');
      expect(parsedEvents[3].type).toBe('content_block_delta');
      expect(parsedEvents[4].type).toBe('content_block_stop');
      expect(parsedEvents[5].type).toBe('message_delta');
      expect(parsedEvents[6].type).toBe('message_stop');

      // 验证具体事件数据
      const messageStart = parsedEvents[0] as any;
      expect(messageStart.message.id).toBe('msg_01ABC123');
      expect(messageStart.message.role).toBe('assistant');

      const textDelta1 = parsedEvents[2] as any;
      expect(textDelta1.delta.text).toBe('Hello');

      const textDelta2 = parsedEvents[3] as any;
      expect(textDelta2.delta.text).toBe(' world');

      const messageDelta = parsedEvents[5] as any;
      expect(messageDelta.delta.stop_reason).toBe('end_turn');
    });
  });

  describe('Incomplete SSE Data Handling', () => {
    it('should handle SSE data missing trailing newlines', () => {
      for (const incompleteData of INCOMPLETE_SSE_DATA) {
        const parsed = parseIncompleteSSE(incompleteData);
        expect(parsed).not.toBeNull();

        if (parsed) {
          // 验证数据被正确解析
          if (typeof parsed.data === 'object' && parsed.data !== null) {
            const event = parsed.data as ClaudeStreamEvent;
            expect(['message_start', 'content_block_delta'].includes(event.type)).toBe(true);
          } else if (parsed.data === '[DONE]') {
            // 验证[DONE]标记被正确处理
            expect(parsed.data).toBe('[DONE]');
          }
        }
      }
    });

    it('should parse incomplete message_stop event', () => {
      const incompleteStop = 'event: message_stop\ndata: {"type":"message_stop"}';
      const parsed = parseIncompleteSSE(incompleteStop);

      expect(parsed).not.toBeNull();
      expect(parsed?.data).toEqual({ type: 'message_stop' });
    });
  });

  describe('OpenAI [DONE] Message Handling', () => {
    it('should correctly identify [DONE] messages', () => {
      const doneMessage = createDoneMessage();
      expect(doneMessage.data).toBe('[DONE]');

      const parsedDone = parseSSE('data: [DONE]\n');
      expect(parsedDone).not.toBeNull();
      expect(isDoneMessage(parsedDone!)).toBe(true);
    });

    it('should parse [DONE] without JSON errors', () => {
      const doneSSE = 'data: [DONE]\n';
      const parsed = parseSSE(doneSSE);

      expect(parsed).not.toBeNull();
      expect(parsed?.data).toBe('[DONE]');
      // 不应该有JSON解析错误日志
    });

    it('should handle [DONE] in incomplete data', () => {
      const incompleteDone = 'data: [DONE]'; // 缺少换行
      const parsed = parseIncompleteSSE(incompleteDone);

      expect(parsed).not.toBeNull();
      expect(parsed?.data).toBe('[DONE]');
      expect(isDoneMessage(parsed!)).toBe(true);
    });
  });

  describe('Stream Transformation to OpenAI Format', () => {
    it('should transform Claude stream and end with [DONE]', async () => {
      // 创建模拟的Claude流
      const claudeSSEData = COMPLETE_CLAUDE_SSE_FLOW.join('');
      const encoder = new TextEncoder();

      const claudeStream = new ReadableStream({
        start(controller) {
          controller.enqueue(encoder.encode(claudeSSEData));
          controller.close();
        },
      });

      // 转换为OpenAI格式
      const openAIStream = transformClaudeStreamToOpenAI(claudeStream);
      const reader = openAIStream.getReader();
      const decoder = new TextDecoder();

      let fullResponse = '';
      const chunks: string[] = [];

      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;

          const chunkText = decoder.decode(value);
          fullResponse += chunkText;
          chunks.push(chunkText);
        }
      } finally {
        reader.releaseLock();
      }

      // 验证响应包含OpenAI格式的chunks
      expect(fullResponse).toContain('chat.completion.chunk');
      expect(fullResponse).toContain('"role":"assistant"');

      // 验证最后包含[DONE]消息
      expect(fullResponse).toContain('data: [DONE]');

      // 验证[DONE]是最后一条消息
      const lastChunk = chunks[chunks.length - 1];
      expect(lastChunk).toContain('[DONE]');
    });

    it('should handle stream with tool use and end with [DONE]', async () => {
      // 带工具使用的Claude流
      const toolUseFlow = [
        'event: message_start\ndata: {"type":"message_start","message":{"id":"msg_tool","type":"message","role":"assistant","model":"claude-3-sonnet-20240229","content":[],"stop_reason":null,"stop_sequence":null,"usage":{"input_tokens":20,"output_tokens":0}}}\n\n',

        'event: content_block_start\ndata: {"type":"content_block_start","index":0,"content_block":{"type":"tool_use","id":"tool_123","name":"get_weather","input":{}}}\n\n',

        'event: content_block_delta\ndata: {"type":"content_block_delta","index":0,"delta":{"type":"input_json_delta","partial_json":"{\\"location\\""}}\n\n',

        'event: content_block_delta\ndata: {"type":"content_block_delta","index":0,"delta":{"type":"input_json_delta","partial_json":": \\"Paris\\"}"}}\n\n',

        'event: content_block_stop\ndata: {"type":"content_block_stop","index":0}\n\n',

        'event: message_delta\ndata: {"type":"message_delta","delta":{"stop_reason":"tool_use","stop_sequence":null},"usage":{"output_tokens":5}}\n\n',

        'event: message_stop\ndata: {"type":"message_stop"}\n\n',
      ];

      const encoder = new TextEncoder();
      const claudeStream = new ReadableStream({
        start(controller) {
          controller.enqueue(encoder.encode(toolUseFlow.join('')));
          controller.close();
        },
      });

      const openAIStream = transformClaudeStreamToOpenAI(claudeStream);
      const reader = openAIStream.getReader();
      const decoder = new TextDecoder();

      let fullResponse = '';

      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          fullResponse += decoder.decode(value);
        }
      } finally {
        reader.releaseLock();
      }

      // 验证包含工具调用
      expect(fullResponse).toContain('tool_calls');
      expect(fullResponse).toContain('"name":"get_weather"');

      // 验证以[DONE]结束
      expect(fullResponse).toContain('data: [DONE]');
      expect(fullResponse.lastIndexOf('[DONE]')).toBeGreaterThan(
        fullResponse.lastIndexOf('tool_calls')
      );
    });
  });

  describe('Error Recovery and Edge Cases', () => {
    it('should handle malformed SSE data gracefully', () => {
      const malformedData = [
        'invalid line without colon',
        'data: {invalid json}',
        'event: test\n', // no data
        'data: \n', // empty data
        '\n\n', // empty message
      ];

      for (const data of malformedData) {
        expect(() => parseSSE(data)).not.toThrow();
        // 某些会返回null，某些会返回带空/错误数据的对象
      }
    });

    it('should handle mixed newline formats', () => {
      const mixedNewlines = 'data: {"test": "value"}\r\n\r\n';
      const parsed = parseSSE(mixedNewlines);

      expect(parsed).not.toBeNull();
      expect(parsed?.data).toEqual({ test: 'value' });
    });

    it('should parse events without explicit event field', () => {
      const noEventField = 'data: {"type":"message_stop"}\n\n';
      const parsed = parseSSE(noEventField);

      expect(parsed).not.toBeNull();
      expect(parsed?.event).toBeUndefined();
      expect(parsed?.data).toEqual({ type: 'message_stop' });
    });

    it('should handle ping events correctly', () => {
      const pingEvent = 'event: ping\ndata: ping\n\n';
      const parsed = parseSSE(pingEvent);

      expect(parsed).not.toBeNull();
      expect(parsed?.event).toBe('ping');
      expect(parsed?.data).toBe('ping');
    });
  });

  describe('SSE Parser Transform Stream', () => {
    it('should parse SSE stream correctly', async () => {
      const sseParser = createSSEParser();
      const encoder = new TextEncoder();

      const inputStream = new ReadableStream({
        start(controller) {
          // 发送分块的SSE数据
          controller.enqueue(encoder.encode('data: {"chunk": 1}\n\n'));
          controller.enqueue(encoder.encode('data: [DONE]\n\n'));
          controller.close();
        },
      });

      const parsedStream = inputStream.pipeThrough(sseParser);
      const reader = parsedStream.getReader();

      const messages: ParsedSSEMessage[] = [];

      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          messages.push(value);
        }
      } finally {
        reader.releaseLock();
      }

      expect(messages).toHaveLength(2);
      expect(messages[0].data).toEqual({ chunk: 1 });
      expect(messages[1].data).toBe('[DONE]');
      expect(isDoneMessage(messages[1])).toBe(true);
    });
  });
});
