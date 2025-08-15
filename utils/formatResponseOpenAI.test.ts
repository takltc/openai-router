/**
 * Tests for OpenAI to Claude response format converter
 * @author jizhejiang
 * @date 2025-08-11
 */

import { describe, it, expect } from 'vitest';
import {
  formatResponseOpenAI,
  formatStreamChunkOpenAI,
  initializeOpenAIStreamState,
  parseAndConvertOpenAIStreamChunk,
  convertOpenAIError,
  __testing,
} from './formatResponseOpenAI';
import type { OpenAIResponse, OpenAIStreamChunk } from './types';

const {
  mapFinishReasonToStopReason,
  convertUsage,
  extractBase64FromDataUrl,
  mapMediaType,
  convertImageContent,
  convertToolCalls,
  convertMessageContent,
  mapModelToClaude,
} = __testing;

describe('formatResponseOpenAI', () => {
  describe('mapFinishReasonToStopReason', () => {
    it('should map stop to end_turn', () => {
      expect(mapFinishReasonToStopReason('stop')).toBe('end_turn');
    });

    it('should map length to max_tokens', () => {
      expect(mapFinishReasonToStopReason('length')).toBe('max_tokens');
    });

    it('should map tool_calls to tool_use', () => {
      expect(mapFinishReasonToStopReason('tool_calls')).toBe('tool_use');
    });

    it('should map function_call to tool_use', () => {
      expect(mapFinishReasonToStopReason('function_call')).toBe('tool_use');
    });

    it('should map content_filter to end_turn', () => {
      expect(mapFinishReasonToStopReason('content_filter')).toBe('end_turn');
    });

    it('should return null for null input', () => {
      expect(mapFinishReasonToStopReason(null)).toBe(null);
    });
  });

  describe('convertUsage', () => {
    it('should convert OpenAI usage to Claude format', () => {
      const openAIUsage = {
        prompt_tokens: 100,
        completion_tokens: 50,
        total_tokens: 150,
      };

      const result = convertUsage(openAIUsage);
      expect(result).toEqual({
        input_tokens: 100,
        output_tokens: 50,
      });
    });

    it('should return default values for undefined usage', () => {
      const result = convertUsage(undefined);
      expect(result).toEqual({
        input_tokens: 0,
        output_tokens: 0,
      });
    });
  });

  describe('extractBase64FromDataUrl', () => {
    it('should extract base64 data from valid data URL', () => {
      const dataUrl = 'data:image/jpeg;base64,/9j/4AAQSkZJRg==';
      const result = extractBase64FromDataUrl(dataUrl);

      expect(result).toEqual({
        mediaType: 'image/jpeg',
        data: '/9j/4AAQSkZJRg==',
      });
    });

    it('should return null for invalid data URL', () => {
      const invalidUrl = 'https://example.com/image.jpg';
      const result = extractBase64FromDataUrl(invalidUrl);

      expect(result).toBeNull();
    });
  });

  describe('mapMediaType', () => {
    it('should map JPEG media types', () => {
      expect(mapMediaType('image/jpeg')).toBe('image/jpeg');
      expect(mapMediaType('image/jpg')).toBe('image/jpeg');
      expect(mapMediaType('IMAGE/JPEG')).toBe('image/jpeg');
    });

    it('should map PNG media type', () => {
      expect(mapMediaType('image/png')).toBe('image/png');
      expect(mapMediaType('IMAGE/PNG')).toBe('image/png');
    });

    it('should map GIF media type', () => {
      expect(mapMediaType('image/gif')).toBe('image/gif');
    });

    it('should map WebP media type', () => {
      expect(mapMediaType('image/webp')).toBe('image/webp');
    });

    it('should default to JPEG for unknown types', () => {
      expect(mapMediaType('image/unknown')).toBe('image/jpeg');
    });
  });

  describe('convertImageContent', () => {
    it('should convert OpenAI image content to Claude format', () => {
      const openAIImage = {
        type: 'image_url' as const,
        image_url: {
          url: 'data:image/png;base64,iVBORw0KGgoAAAANS==',
          detail: 'high' as const,
        },
      };

      const result = convertImageContent(openAIImage);
      expect(result).toEqual({
        type: 'image',
        source: {
          type: 'base64',
          media_type: 'image/png',
          data: 'iVBORw0KGgoAAAANS==',
        },
      });
    });

    it('should return null for non-base64 URLs', () => {
      const openAIImage = {
        type: 'image_url' as const,
        image_url: {
          url: 'https://example.com/image.png',
        },
      };

      const result = convertImageContent(openAIImage);
      expect(result).toBeNull();
    });
  });

  describe('convertToolCalls', () => {
    it('should convert OpenAI tool calls to Claude tool use', () => {
      const toolCalls = [
        {
          id: 'call_123',
          type: 'function' as const,
          function: {
            name: 'get_weather',
            arguments: '{"location": "San Francisco"}',
          },
        },
      ];

      const result = convertToolCalls(toolCalls);
      expect(result).toEqual([
        {
          type: 'tool_use',
          id: 'call_123',
          name: 'get_weather',
          input: { location: 'San Francisco' },
        },
      ]);
    });

    it('should handle invalid JSON in arguments', () => {
      const toolCalls = [
        {
          id: 'call_456',
          type: 'function' as const,
          function: {
            name: 'invalid_json',
            arguments: 'not valid json',
          },
        },
      ];

      const result = convertToolCalls(toolCalls);
      expect(result).toEqual([
        {
          type: 'tool_use',
          id: 'call_456',
          name: 'invalid_json',
          input: {},
        },
      ]);
    });
  });

  describe('convertMessageContent', () => {
    it('should convert string content', () => {
      const result = convertMessageContent('Hello, world!');
      expect(result).toEqual([
        {
          type: 'text',
          text: 'Hello, world!',
        },
      ]);
    });

    it('should convert array content with text and images', () => {
      const content = [
        {
          type: 'text' as const,
          text: 'Here is an image:',
        },
        {
          type: 'image_url' as const,
          image_url: {
            url: 'data:image/png;base64,abc123',
          },
        },
      ];

      const result = convertMessageContent(content);
      expect(result).toHaveLength(2);
      expect(result[0]).toEqual({
        type: 'text',
        text: 'Here is an image:',
      });
      expect(result[1]).toEqual({
        type: 'image',
        source: {
          type: 'base64',
          media_type: 'image/png',
          data: 'abc123',
        },
      });
    });

    it('should handle tool calls', () => {
      const toolCalls = [
        {
          id: 'call_789',
          type: 'function' as const,
          function: {
            name: 'calculate',
            arguments: '{"a": 1, "b": 2}',
          },
        },
      ];

      const result = convertMessageContent('Result:', toolCalls);
      expect(result).toHaveLength(2);
      expect(result[0]).toEqual({
        type: 'text',
        text: 'Result:',
      });
      expect(result[1]).toEqual({
        type: 'tool_use',
        id: 'call_789',
        name: 'calculate',
        input: { a: 1, b: 2 },
      });
    });

    it('should handle legacy function_call', () => {
      const functionCall = {
        name: 'legacy_function',
        arguments: '{"param": "value"}',
      };

      const result = convertMessageContent('', undefined, functionCall);
      expect(result).toHaveLength(1);
      expect(result[0]).toHaveProperty('type', 'tool_use');
      expect(result[0]).toHaveProperty('name', 'legacy_function');
    });

    it('should return empty text for empty content', () => {
      const result = convertMessageContent('');
      expect(result).toEqual([
        {
          type: 'text',
          text: '',
        },
      ]);
    });
  });

  describe('mapModelToClaude', () => {
    it('should pass through GPT-4 models without conversion', () => {
      // Direct pass-through - no conversion
      expect(mapModelToClaude('gpt-4')).toBe('gpt-4');
      expect(mapModelToClaude('gpt-4-turbo')).toBe('gpt-4-turbo');
      expect(mapModelToClaude('gpt-4o')).toBe('gpt-4o');
      expect(mapModelToClaude('gpt-4o-mini')).toBe('gpt-4o-mini');
    });

    it('should pass through GPT-3.5 models without conversion', () => {
      expect(mapModelToClaude('gpt-3.5-turbo')).toBe('gpt-3.5-turbo');
      expect(mapModelToClaude('gpt-3.5-turbo-16k')).toBe('gpt-3.5-turbo-16k');
    });

    it('should pass through model variants without conversion', () => {
      expect(mapModelToClaude('gpt-4-some-variant')).toBe('gpt-4-some-variant');
      expect(mapModelToClaude('claude-3-opus-20240229')).toBe('claude-3-opus-20240229');
    });

    it('should pass through unknown models without conversion', () => {
      expect(mapModelToClaude('unknown-model')).toBe('unknown-model');
      expect(mapModelToClaude('custom-model-xyz')).toBe('custom-model-xyz');
    });
  });

  describe('formatResponseOpenAI - main converter', () => {
    it('should convert simple text response', () => {
      const openAIResponse: OpenAIResponse = {
        id: 'chatcmpl-123',
        object: 'chat.completion',
        created: 1234567890,
        model: 'gpt-4',
        choices: [
          {
            index: 0,
            message: {
              role: 'assistant',
              content: 'Hello from OpenAI!',
            },
            finish_reason: 'stop',
            // logprobs intentionally omitted to align with type expectations
          },
        ],
        usage: {
          prompt_tokens: 10,
          completion_tokens: 5,
          total_tokens: 15,
        },
      };

      const result = formatResponseOpenAI(openAIResponse);

      expect(result.type).toBe('message');
      expect(result.role).toBe('assistant');
      expect(result.model).toBe('gpt-4'); // Direct pass-through
      expect(result.content).toHaveLength(1);
      expect(result.content[0]).toEqual({
        type: 'text',
        text: 'Hello from OpenAI!',
      });
      expect(result.stop_reason).toBe('end_turn');
      expect(result.usage).toEqual({
        input_tokens: 10,
        output_tokens: 5,
      });
    });

    it('should convert response with tool calls', () => {
      const openAIResponse: OpenAIResponse = {
        id: 'chatcmpl-456',
        object: 'chat.completion',
        created: 1234567890,
        model: 'gpt-4-turbo',
        choices: [
          {
            index: 0,
            message: {
              role: 'assistant',
              content: "I'll help you with that.",
              tool_calls: [
                {
                  id: 'call_abc',
                  type: 'function',
                  function: {
                    name: 'search',
                    arguments: '{"query": "test"}',
                  },
                },
              ],
            },
            finish_reason: 'tool_calls',
            // logprobs intentionally omitted to align with type expectations
          },
        ],
      };

      const result = formatResponseOpenAI(openAIResponse);

      expect(result.content).toHaveLength(2);
      expect(result.content[0]).toEqual({
        type: 'text',
        text: "I'll help you with that.",
      });
      expect(result.content[1]).toEqual({
        type: 'tool_use',
        id: 'call_abc',
        name: 'search',
        input: { query: 'test' },
      });
      expect(result.stop_reason).toBe('tool_use');
    });

    it('should throw error for empty choices', () => {
      const openAIResponse: OpenAIResponse = {
        id: 'chatcmpl-789',
        object: 'chat.completion',
        created: 1234567890,
        model: 'gpt-4',
        choices: [],
      };

      expect(() => formatResponseOpenAI(openAIResponse)).toThrow('No choices available');
    });
  });

  describe('Stream conversion', () => {
    it('should convert stream chunks to Claude events', () => {
      const state = initializeOpenAIStreamState();

      const chunk: OpenAIStreamChunk = {
        id: 'chatcmpl-stream',
        object: 'chat.completion.chunk',
        created: 1234567890,
        model: 'gpt-4',
        choices: [
          {
            index: 0,
            delta: {
              role: 'assistant',
              content: 'Hello',
            },
            finish_reason: null,
          },
        ],
      };

      const events = formatStreamChunkOpenAI(chunk, state);

      expect(events).not.toBeNull();
      expect(events).toBeInstanceOf(Array);
      if (events) {
        expect(events[0]).toHaveProperty('type', 'message_start');
        expect(events).toContainEqual(
          expect.objectContaining({
            type: 'content_block_start',
          })
        );
      }
    });

    it('should handle stream with tool calls', () => {
      const state = initializeOpenAIStreamState();
      state.hasStarted = true;

      const chunk: OpenAIStreamChunk = {
        id: 'chatcmpl-stream',
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
                  id: 'call_123',
                  type: 'function',
                  function: {
                    name: 'search',
                    arguments: '{"q":',
                  },
                },
              ],
            },
            finish_reason: null,
          },
        ],
      };

      const events = formatStreamChunkOpenAI(chunk, state);

      expect(events).not.toBeNull();
      if (events) {
        expect(events).toContainEqual(
          expect.objectContaining({
            type: 'content_block_start',
            content_block: expect.objectContaining({
              type: 'tool_use',
            }),
          })
        );
      }
    });

    it('should handle finish reason in stream', () => {
      const state = initializeOpenAIStreamState();
      state.hasStarted = true;
      state.currentContent = 'Some content';

      const chunk: OpenAIStreamChunk = {
        id: 'chatcmpl-stream',
        object: 'chat.completion.chunk',
        created: 1234567890,
        model: 'gpt-4',
        choices: [
          {
            index: 0,
            delta: {},
            finish_reason: 'stop',
          },
        ],
        usage: {
          prompt_tokens: 10,
          completion_tokens: 5,
          total_tokens: 15,
        },
      };

      const events = formatStreamChunkOpenAI(chunk, state);

      expect(events).not.toBeNull();
      if (events) {
        expect(events).toContainEqual(
          expect.objectContaining({
            type: 'content_block_stop',
          })
        );
        expect(events).toContainEqual(
          expect.objectContaining({
            type: 'message_delta',
            delta: expect.objectContaining({
              stop_reason: 'end_turn',
            }),
          })
        );
        expect(events).toContainEqual(
          expect.objectContaining({
            type: 'message_stop',
          })
        );
      }
    });
  });

  describe('parseAndConvertOpenAIStreamChunk', () => {
    it('should parse and convert valid SSE data', () => {
      const state = initializeOpenAIStreamState();
      const sseData = JSON.stringify({
        id: 'chatcmpl-test',
        object: 'chat.completion.chunk',
        created: 1234567890,
        model: 'gpt-4',
        choices: [
          {
            index: 0,
            delta: { content: 'Test' },
            finish_reason: null,
          },
        ],
      });

      const result = parseAndConvertOpenAIStreamChunk(sseData, state);

      expect(result.events).not.toBeNull();
      expect(result.updatedState).toBe(state);
    });

    it('should handle [DONE] message', () => {
      const state = initializeOpenAIStreamState();
      const result = parseAndConvertOpenAIStreamChunk('[DONE]', state);

      expect(result.events).toBeNull();
      expect(result.updatedState).toBe(state);
    });

    it('should handle invalid JSON', () => {
      const state = initializeOpenAIStreamState();
      const result = parseAndConvertOpenAIStreamChunk('invalid json', state);

      expect(result.events).toBeNull();
      expect(result.updatedState).toBe(state);
    });
  });

  describe('convertOpenAIError', () => {
    it('should convert OpenAI error format', () => {
      const openAIError = {
        error: {
          type: 'invalid_request_error',
          message: 'Invalid API key',
          code: 'invalid_api_key',
        },
      };

      const result = convertOpenAIError(openAIError);

      expect(result).toEqual({
        type: 'error',
        error: {
          type: 'invalid_request_error',
          message: 'Invalid API key',
        },
      });
    });

    it('should handle errors without error wrapper', () => {
      const error = {
        message: 'Something went wrong',
      };

      const result = convertOpenAIError(error);

      expect(result).toEqual({
        type: 'error',
        error: {
          type: 'api_error',
          message: 'Something went wrong',
        },
      });
    });

    it('should handle completely unknown error format', () => {
      const result = convertOpenAIError({});

      expect(result).toEqual({
        type: 'error',
        error: {
          type: 'api_error',
          message: 'An error occurred',
        },
      });
    });
  });
});
