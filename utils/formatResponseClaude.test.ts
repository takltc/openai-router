/**
 * Tests for Claude to OpenAI response format converter
 * @author jizhejiang
 * @date 2025-08-11
 */

import { describe, it, expect } from 'vitest';
import {
  formatResponseClaude,
  formatStreamChunkClaude,
  convertClaudeError,
  __testing,
} from './formatResponseClaude';
import type {
  ClaudeResponse,
  OpenAIResponse,
  ClaudeStreamEvent,
  StreamConversionState,
  OpenAIRequest,
} from './types';

const {
  mapStopReasonToFinishReason,
  convertUsage,
  extractToolCalls,
  extractTextContent,
  convertClaudeContentToMessage,
  mapModelToOpenAI,
} = __testing;

describe('formatResponseClaude', () => {
  describe('Basic Response Conversion', () => {
    it('should convert a simple text response', () => {
      const claudeResponse: ClaudeResponse = {
        id: 'msg_123',
        type: 'message',
        role: 'assistant',
        model: 'claude-3-sonnet-20240229',
        content: [
          {
            type: 'text',
            text: 'Hello, how can I help you today?',
          },
        ],
        stop_reason: 'end_turn',
        stop_sequence: null,
        usage: {
          input_tokens: 10,
          output_tokens: 8,
        },
      };

      const result = formatResponseClaude(claudeResponse);

      expect(result.object).toBe('chat.completion');
      // Direct pass-through - no conversion
      expect(result.model).toBe('claude-3-sonnet-20240229');
      expect(result.choices).toHaveLength(1);
      expect(result.choices[0].message.content).toBe('Hello, how can I help you today?');
      expect(result.choices[0].finish_reason).toBe('stop');
      expect(result.usage?.prompt_tokens).toBe(10);
      expect(result.usage?.completion_tokens).toBe(8);
      expect(result.usage?.total_tokens).toBe(18);
    });

    it('should convert response with multiple text blocks', () => {
      const claudeResponse: ClaudeResponse = {
        id: 'msg_456',
        type: 'message',
        role: 'assistant',
        model: 'claude-3-haiku-20240307',
        content: [
          {
            type: 'text',
            text: 'First paragraph.',
          },
          {
            type: 'text',
            text: 'Second paragraph.',
          },
        ],
        stop_reason: 'max_tokens',
        stop_sequence: null,
        usage: {
          input_tokens: 20,
          output_tokens: 30,
        },
      };

      const result = formatResponseClaude(claudeResponse);

      // Direct pass-through - no conversion
      expect(result.model).toBe('claude-3-haiku-20240307');
      expect(result.choices[0].message.content).toBe('First paragraph.\nSecond paragraph.');
      expect(result.choices[0].finish_reason).toBe('length');
    });
  });

  describe('Tool Use Conversion', () => {
    it('should convert tool_use to tool_calls format', () => {
      const claudeResponse: ClaudeResponse = {
        id: 'msg_789',
        type: 'message',
        role: 'assistant',
        model: 'claude-3-5-sonnet-20241022',
        content: [
          {
            type: 'text',
            text: "I'll help you with that calculation.",
          },
          {
            type: 'tool_use',
            id: 'tool_1',
            name: 'calculator',
            input: { operation: 'add', a: 5, b: 3 },
          },
        ],
        stop_reason: 'tool_use',
        stop_sequence: null,
        usage: {
          input_tokens: 50,
          output_tokens: 20,
        },
      };

      const result = formatResponseClaude(claudeResponse);

      // Direct pass-through - no conversion
      expect(result.model).toBe('claude-3-5-sonnet-20241022');
      expect(result.choices[0].message.content).toBe("I'll help you with that calculation.");
      expect(result.choices[0].message.tool_calls).toHaveLength(1);
      expect(result.choices[0].message.tool_calls![0].id).toBe('tool_1');
      expect(result.choices[0].message.tool_calls![0].function.name).toBe('calculator');
      expect(result.choices[0].message.tool_calls![0].function.arguments).toBe(
        JSON.stringify({ operation: 'add', a: 5, b: 3 })
      );
      expect(result.choices[0].finish_reason).toBe('tool_calls');
    });

    it('should convert tool_use to function_call format when requested', () => {
      const claudeResponse: ClaudeResponse = {
        id: 'msg_101',
        type: 'message',
        role: 'assistant',
        model: 'claude-3-sonnet-20240229',
        content: [
          {
            type: 'tool_use',
            id: 'func_1',
            name: 'get_weather',
            input: { location: 'New York' },
          },
        ],
        stop_reason: 'tool_use',
        stop_sequence: null,
        usage: {
          input_tokens: 30,
          output_tokens: 10,
        },
      };

      const originalRequest: OpenAIRequest = {
        model: 'gpt-4',
        messages: [],
        functions: [
          {
            name: 'get_weather',
            parameters: {},
          },
        ],
      };

      const result = formatResponseClaude(claudeResponse, originalRequest);

      expect(result.choices[0].message.function_call).toBeDefined();
      expect(result.choices[0].message.function_call!.name).toBe('get_weather');
      expect(result.choices[0].message.function_call!.arguments).toBe(
        JSON.stringify({ location: 'New York' })
      );
      expect(result.choices[0].message.tool_calls).toBeUndefined();
    });
  });

  describe('Utility Functions', () => {
    it('should map stop reasons correctly', () => {
      expect(mapStopReasonToFinishReason('end_turn', false)).toBe('stop');
      expect(mapStopReasonToFinishReason('end_turn', true)).toBe('tool_calls');
      expect(mapStopReasonToFinishReason('max_tokens', false)).toBe('length');
      expect(mapStopReasonToFinishReason('stop_sequence', false)).toBe('stop');
      expect(mapStopReasonToFinishReason('tool_use', false)).toBe('tool_calls');
      expect(mapStopReasonToFinishReason(null, false)).toBe(null);
    });

    it('should convert usage correctly', () => {
      const usage = convertUsage({
        input_tokens: 100,
        output_tokens: 50,
      });

      expect(usage.prompt_tokens).toBe(100);
      expect(usage.completion_tokens).toBe(50);
      expect(usage.total_tokens).toBe(150);
    });

    it('should extract text content correctly', () => {
      const content = [
        { type: 'text' as const, text: 'Hello' },
        { type: 'text' as const, text: 'World' },
        {
          type: 'tool_use' as const,
          id: 'tool_1',
          name: 'test',
          input: {},
        },
      ];

      const text = extractTextContent(content);
      expect(text).toBe('Hello\nWorld');
    });

    it('should extract tool calls correctly', () => {
      const content = [
        { type: 'text' as const, text: 'Some text' },
        {
          type: 'tool_use' as const,
          id: 'tool_1',
          name: 'function1',
          input: { param: 'value' },
        },
        {
          type: 'tool_use' as const,
          id: 'tool_2',
          name: 'function2',
          input: { x: 1, y: 2 },
        },
      ];

      const toolCalls = extractToolCalls(content);
      expect(toolCalls).toHaveLength(2);
      expect(toolCalls[0].id).toBe('tool_1');
      expect(toolCalls[0].function.name).toBe('function1');
      expect(toolCalls[1].id).toBe('tool_2');
      expect(toolCalls[1].function.name).toBe('function2');
    });

    it('should pass through Claude models without conversion', () => {
      // Direct pass-through - no conversion
      expect(mapModelToOpenAI('claude-3-5-sonnet-20241022')).toBe('claude-3-5-sonnet-20241022');
      expect(mapModelToOpenAI('claude-3-opus-20240229')).toBe('claude-3-opus-20240229');
      expect(mapModelToOpenAI('claude-3-haiku-20240307')).toBe('claude-3-haiku-20240307');
      expect(mapModelToOpenAI('unknown-model')).toBe('unknown-model');
      expect(mapModelToOpenAI('gpt-4')).toBe('gpt-4');
      expect(mapModelToOpenAI('custom-model-xyz')).toBe('custom-model-xyz');
    });
  });

  describe('Stream Conversion', () => {
    it('should convert message_start event', () => {
      const event: ClaudeStreamEvent = {
        type: 'message_start',
        message: {
          id: 'msg_stream',
          type: 'message',
          role: 'assistant',
          model: 'claude-3-sonnet-20240229',
          content: [],
          stop_reason: null,
          stop_sequence: null,
          usage: {
            input_tokens: 10,
            output_tokens: 0,
          },
        },
      };

      const state: StreamConversionState = {
        messageId: 'test_id',
        created: 1234567890,
        model: 'gpt-4',
      };

      const chunk = formatStreamChunkClaude(event, state);

      expect(chunk).not.toBeNull();
      expect(chunk!.object).toBe('chat.completion.chunk');
      expect(chunk!.choices[0].delta.role).toBe('assistant');
    });

    it('should convert text content_block_delta', () => {
      const event: ClaudeStreamEvent = {
        type: 'content_block_delta',
        index: 0,
        delta: {
          type: 'text_delta',
          text: 'Hello ',
        },
      };

      const state: StreamConversionState = {
        messageId: 'test_id',
        created: 1234567890,
        model: 'gpt-4',
      };

      const chunk = formatStreamChunkClaude(event, state);

      expect(chunk).not.toBeNull();
      expect(chunk!.choices[0].delta.content).toBe('Hello ');
    });
  });

  describe('Error Conversion', () => {
    it('should convert Claude error format', () => {
      const claudeError = {
        type: 'error',
        error: {
          type: 'invalid_request_error',
          message: 'Invalid API key',
        },
      };

      const openAIError = convertClaudeError(claudeError);

      expect(openAIError.error.type).toBe('invalid_request_error');
      expect(openAIError.error.message).toBe('Invalid API key');
      expect(openAIError.error.code).toBe('invalid_request_error');
    });

    it('should handle unknown error formats', () => {
      const unknownError = { message: 'Something went wrong' };

      const openAIError = convertClaudeError(unknownError);

      expect(openAIError.error.type).toBe('api_error');
      expect(openAIError.error.message).toBe('Something went wrong');
    });
  });
});
