/**
 * Tests for Claude to OpenAI request format converter
 * @author jizhejiang
 * @date 2025-08-11
 */

import { describe, it, expect } from 'vitest';
import {
  formatRequestOpenAI,
  validateClaudeRequest,
  convertClaudeToOpenAI,
} from './formatRequestOpenAI';
import type { ClaudeRequest, OpenAIRequest, ClaudeMessage, ClaudeTool } from './types';

describe('formatRequestOpenAI', () => {
  describe('Basic message conversion', () => {
    it('should convert simple text messages', () => {
      const claudeRequest: ClaudeRequest = {
        model: 'claude-3-opus-20240229',
        messages: [
          {
            role: 'user',
            content: 'Hello, how are you?',
          },
          {
            role: 'assistant',
            content: 'I am doing well, thank you!',
          },
        ],
        max_tokens: 1000,
      };

      const openAIRequest = formatRequestOpenAI(claudeRequest);

      // Direct pass-through - no conversion
      expect(openAIRequest.model).toBe('claude-3-opus-20240229');
      expect(openAIRequest.messages).toHaveLength(2);
      expect(openAIRequest.messages[0]).toEqual({
        role: 'user',
        content: 'Hello, how are you?',
      });
      expect(openAIRequest.messages[1]).toEqual({
        role: 'assistant',
        content: 'I am doing well, thank you!',
      });
      expect(openAIRequest.max_tokens).toBe(1000);
    });

    it('should handle system prompts', () => {
      const claudeRequest: ClaudeRequest = {
        model: 'claude-3-sonnet-20240229',
        system: 'You are a helpful assistant.',
        messages: [
          {
            role: 'user',
            content: 'What is 2+2?',
          },
        ],
        max_tokens: 100,
      };

      const openAIRequest = formatRequestOpenAI(claudeRequest);

      expect(openAIRequest.messages).toHaveLength(2);
      expect(openAIRequest.messages[0]).toEqual({
        role: 'system',
        content: 'You are a helpful assistant.',
      });
      expect(openAIRequest.messages[1]).toEqual({
        role: 'user',
        content: 'What is 2+2?',
      });
    });

    it('should handle system prompts as array', () => {
      const claudeRequest: ClaudeRequest = {
        model: 'claude-3-haiku-20240307',
        system: [
          {
            type: 'text',
            text: 'You are an expert programmer.',
          },
          {
            type: 'text',
            text: 'Always provide code examples.',
            cache_control: { type: 'ephemeral' },
          },
        ],
        messages: [
          {
            role: 'user',
            content: 'Explain Python decorators',
          },
        ],
        max_tokens: 500,
      };

      const openAIRequest = formatRequestOpenAI(claudeRequest);

      // Direct pass-through - no conversion
      expect(openAIRequest.model).toBe('claude-3-haiku-20240307');
      expect(openAIRequest.messages[0]).toEqual({
        role: 'system',
        content: 'You are an expert programmer.\nAlways provide code examples.',
      });
    });
  });

  describe('Content type conversion', () => {
    it('should convert text content arrays', () => {
      const claudeRequest: ClaudeRequest = {
        model: 'claude-3-5-sonnet-20241022',
        messages: [
          {
            role: 'user',
            content: [
              {
                type: 'text',
                text: 'First part of message.',
              },
              {
                type: 'text',
                text: 'Second part of message.',
              },
            ],
          },
        ],
        max_tokens: 200,
      };

      const openAIRequest = formatRequestOpenAI(claudeRequest);

      expect(openAIRequest.messages[0].content).toEqual([
        { type: 'text', text: 'First part of message.' },
        { type: 'text', text: 'Second part of message.' },
      ]);
    });

    it('should convert image content', () => {
      const claudeRequest: ClaudeRequest = {
        model: 'claude-3-opus-20240229',
        messages: [
          {
            role: 'user',
            content: [
              {
                type: 'text',
                text: 'What is in this image?',
              },
              {
                type: 'image',
                source: {
                  type: 'base64',
                  media_type: 'image/jpeg',
                  data: 'base64EncodedImageData',
                },
              },
            ],
          },
        ],
        max_tokens: 300,
      };

      const openAIRequest = formatRequestOpenAI(claudeRequest);

      expect(openAIRequest.messages[0].content).toEqual([
        { type: 'text', text: 'What is in this image?' },
        {
          type: 'image_url',
          image_url: {
            url: 'data:image/jpeg;base64,base64EncodedImageData',
            detail: 'auto',
          },
        },
      ]);
    });
  });

  describe('Tool conversion', () => {
    it('should convert tools to OpenAI functions', () => {
      const claudeTool: ClaudeTool = {
        name: 'get_weather',
        description: 'Get the current weather for a location',
        input_schema: {
          type: 'object',
          properties: {
            location: {
              type: 'string',
              description: 'The city and state, e.g. San Francisco, CA',
            },
            unit: {
              type: 'string',
              enum: ['celsius', 'fahrenheit'],
              description: 'The temperature unit',
            },
          },
          required: ['location'],
        },
      };

      const claudeRequest: ClaudeRequest = {
        model: 'claude-3-opus-20240229',
        messages: [
          {
            role: 'user',
            content: 'What is the weather in San Francisco?',
          },
        ],
        max_tokens: 100,
        tools: [claudeTool],
      };

      const openAIRequest = formatRequestOpenAI(claudeRequest);

      expect(openAIRequest.tools).toHaveLength(1);
      expect(openAIRequest.tools![0]).toEqual({
        type: 'function',
        function: {
          name: 'get_weather',
          description: 'Get the current weather for a location',
          parameters: {
            type: 'object',
            properties: {
              location: {
                type: 'string',
                description: 'The city and state, e.g. San Francisco, CA',
              },
              unit: {
                type: 'string',
                enum: ['celsius', 'fahrenheit'],
                description: 'The temperature unit',
              },
            },
            required: ['location'],
          },
        },
      });
    });

    it('should convert tool_use content to tool_calls', () => {
      const claudeRequest: ClaudeRequest = {
        model: 'claude-3-opus-20240229',
        messages: [
          {
            role: 'user',
            content: 'What is the weather?',
          },
          {
            role: 'assistant',
            content: [
              {
                type: 'text',
                text: "I'll check the weather for you.",
              },
              {
                type: 'tool_use',
                id: 'tool_call_123',
                name: 'get_weather',
                input: {
                  location: 'San Francisco, CA',
                  unit: 'fahrenheit',
                },
              },
            ],
          },
        ],
        max_tokens: 100,
      };

      const openAIRequest = formatRequestOpenAI(claudeRequest);

      const assistantMessage = openAIRequest.messages[1];
      expect(assistantMessage.role).toBe('assistant');
      expect(assistantMessage.tool_calls).toHaveLength(1);
      expect(assistantMessage.tool_calls![0]).toEqual({
        id: 'tool_call_123',
        type: 'function',
        function: {
          name: 'get_weather',
          arguments: '{"location":"San Francisco, CA","unit":"fahrenheit"}',
        },
      });
    });

    it('should convert tool_result content to tool messages', () => {
      const claudeRequest: ClaudeRequest = {
        model: 'claude-3-opus-20240229',
        messages: [
          {
            role: 'user',
            content: [
              {
                type: 'tool_result',
                tool_use_id: 'tool_call_123',
                content: 'The weather in San Francisco is 72°F and sunny.',
              },
            ],
          },
        ],
        max_tokens: 100,
      };

      const openAIRequest = formatRequestOpenAI(claudeRequest);

      // When a message contains ONLY tool_result, it should be converted directly to tool message(s)
      expect(openAIRequest.messages).toHaveLength(1);
      expect(openAIRequest.messages[0]).toEqual({
        role: 'tool',
        content: 'The weather in San Francisco is 72°F and sunny.',
        tool_call_id: 'tool_call_123',
      });
    });

    it('should handle tool error results', () => {
      const claudeRequest: ClaudeRequest = {
        model: 'claude-3-opus-20240229',
        messages: [
          {
            role: 'user',
            content: [
              {
                type: 'tool_result',
                tool_use_id: 'tool_call_456',
                content: 'Location not found',
                is_error: true,
              },
            ],
          },
        ],
        max_tokens: 100,
      };

      const openAIRequest = formatRequestOpenAI(claudeRequest);

      // When a message contains ONLY tool_result, it should be converted directly to tool message(s)
      expect(openAIRequest.messages).toHaveLength(1);
      expect(openAIRequest.messages[0]).toEqual({
        role: 'tool',
        content: 'Error: Location not found',
        tool_call_id: 'tool_call_456',
      });
    });
  });

  describe('Tool choice conversion', () => {
    it('should convert auto tool choice', () => {
      const claudeRequest: ClaudeRequest = {
        model: 'claude-3-opus-20240229',
        messages: [{ role: 'user', content: 'Hello' }],
        max_tokens: 100,
        tool_choice: { type: 'auto' },
      };

      const openAIRequest = formatRequestOpenAI(claudeRequest);
      expect(openAIRequest.tool_choice).toBe('auto');
    });

    it('should convert any tool choice to required', () => {
      const claudeRequest: ClaudeRequest = {
        model: 'claude-3-opus-20240229',
        messages: [{ role: 'user', content: 'Hello' }],
        max_tokens: 100,
        tool_choice: { type: 'any' },
      };

      const openAIRequest = formatRequestOpenAI(claudeRequest);
      expect(openAIRequest.tool_choice).toBe('required');
    });

    it('should convert specific tool choice', () => {
      const claudeRequest: ClaudeRequest = {
        model: 'claude-3-opus-20240229',
        messages: [{ role: 'user', content: 'Hello' }],
        max_tokens: 100,
        tool_choice: { type: 'tool', name: 'get_weather' },
      };

      const openAIRequest = formatRequestOpenAI(claudeRequest);
      expect(openAIRequest.tool_choice).toEqual({
        type: 'function',
        function: { name: 'get_weather' },
      });
    });
  });

  describe('Parameter mapping', () => {
    it('should map all common parameters', () => {
      const claudeRequest: ClaudeRequest = {
        model: 'claude-3-opus-20240229',
        messages: [{ role: 'user', content: 'Hello' }],
        max_tokens: 500,
        temperature: 0.7,
        top_p: 0.9,
        stop_sequences: ['\n\n', 'END'],
        stream: true,
        metadata: {
          user_id: 'user123',
        },
      };

      const openAIRequest = formatRequestOpenAI(claudeRequest);

      expect(openAIRequest.max_tokens).toBe(500);
      expect(openAIRequest.temperature).toBe(0.7);
      expect(openAIRequest.top_p).toBe(0.9);
      expect(openAIRequest.stop).toEqual(['\n\n', 'END']);
      expect(openAIRequest.stream).toBe(true);
      expect(openAIRequest.user).toBe('user123');
    });

    it('should handle missing optional parameters', () => {
      const claudeRequest: ClaudeRequest = {
        model: 'claude-3-opus-20240229',
        messages: [{ role: 'user', content: 'Hello' }],
        max_tokens: 100,
      };

      const openAIRequest = formatRequestOpenAI(claudeRequest);

      expect(openAIRequest.temperature).toBeUndefined();
      expect(openAIRequest.top_p).toBeUndefined();
      expect(openAIRequest.stop).toBeUndefined();
      expect(openAIRequest.stream).toBeUndefined();
      expect(openAIRequest.user).toBeUndefined();
    });
  });

  describe('Model mapping', () => {
    it('should pass through Claude 3 models without conversion', () => {
      const models = [
        'claude-3-opus-20240229',
        'claude-3-sonnet-20240229',
        'claude-3-haiku-20240307',
        'claude-3-5-sonnet-20241022',
        'claude-3-5-haiku-20241022',
      ];

      for (const model of models) {
        const claudeRequest: ClaudeRequest = {
          model: model,
          messages: [{ role: 'user', content: 'Test' }],
          max_tokens: 100,
        };

        const openAIRequest = formatRequestOpenAI(claudeRequest);
        // Direct pass-through - no conversion
        expect(openAIRequest.model).toBe(model);
      }
    });

    it('should pass through Claude 2 and instant models without conversion', () => {
      const models = [
        'claude-2.1',
        'claude-2.0',
        'claude-instant-1.2',
      ];

      for (const model of models) {
        const claudeRequest: ClaudeRequest = {
          model: model,
          messages: [{ role: 'user', content: 'Test' }],
          max_tokens: 100,
        };

        const openAIRequest = formatRequestOpenAI(claudeRequest);
        // Direct pass-through - no conversion
        expect(openAIRequest.model).toBe(model);
      }
    });

    it('should pass through unknown models without conversion', () => {
      const claudeRequest: ClaudeRequest = {
        model: 'claude-unknown-model',
        messages: [{ role: 'user', content: 'Test' }],
        max_tokens: 100,
      };

      const openAIRequest = formatRequestOpenAI(claudeRequest);
      // Direct pass-through - no conversion
      expect(openAIRequest.model).toBe('claude-unknown-model');
    });

    it('should pass through OpenAI models without conversion', () => {
      const models = ['gpt-4', 'gpt-4-turbo', 'gpt-3.5-turbo', 'custom-model'];

      for (const model of models) {
        const claudeRequest: ClaudeRequest = {
          model: model,
          messages: [{ role: 'user', content: 'Test' }],
          max_tokens: 100,
        };

        const openAIRequest = formatRequestOpenAI(claudeRequest);
        // Direct pass-through - no conversion
        expect(openAIRequest.model).toBe(model);
      }
    });
  });

  describe('validateClaudeRequest', () => {
    it('should validate valid requests', () => {
      const request: ClaudeRequest = {
        model: 'claude-3-opus-20240229',
        messages: [{ role: 'user', content: 'Hello' }],
        max_tokens: 100,
      };

      expect(validateClaudeRequest(request)).toBe(true);
    });

    it('should reject requests without required fields', () => {
      const request1 = {
        messages: [{ role: 'user', content: 'Hello' }],
        max_tokens: 100,
      } as any;

      const request2 = {
        model: 'claude-3-opus-20240229',
        max_tokens: 100,
      } as any;

      const request3 = {
        model: 'claude-3-opus-20240229',
        messages: [{ role: 'user', content: 'Hello' }],
      } as any;

      expect(validateClaudeRequest(request1)).toBe(false);
      expect(validateClaudeRequest(request2)).toBe(false);
      expect(validateClaudeRequest(request3)).toBe(false);
    });

    it('should reject empty messages array', () => {
      const request: ClaudeRequest = {
        model: 'claude-3-opus-20240229',
        messages: [],
        max_tokens: 100,
      };

      expect(validateClaudeRequest(request)).toBe(false);
    });

    it('should validate temperature range', () => {
      const validRequest: ClaudeRequest = {
        model: 'claude-3-opus-20240229',
        messages: [{ role: 'user', content: 'Hello' }],
        max_tokens: 100,
        temperature: 1.5,
      };

      const invalidRequest: ClaudeRequest = {
        model: 'claude-3-opus-20240229',
        messages: [{ role: 'user', content: 'Hello' }],
        max_tokens: 100,
        temperature: 2.5,
      };

      expect(validateClaudeRequest(validRequest)).toBe(true);
      expect(validateClaudeRequest(invalidRequest)).toBe(false);
    });

    it('should validate top_p range', () => {
      const validRequest: ClaudeRequest = {
        model: 'claude-3-opus-20240229',
        messages: [{ role: 'user', content: 'Hello' }],
        max_tokens: 100,
        top_p: 0.8,
      };

      const invalidRequest: ClaudeRequest = {
        model: 'claude-3-opus-20240229',
        messages: [{ role: 'user', content: 'Hello' }],
        max_tokens: 100,
        top_p: 1.5,
      };

      expect(validateClaudeRequest(validRequest)).toBe(true);
      expect(validateClaudeRequest(invalidRequest)).toBe(false);
    });
  });

  describe('convertClaudeToOpenAI', () => {
    it('should convert valid requests', () => {
      const request: ClaudeRequest = {
        model: 'claude-3-opus-20240229',
        messages: [{ role: 'user', content: 'Hello' }],
        max_tokens: 100,
      };

      const result = convertClaudeToOpenAI(request);
      expect(result).not.toBeNull();
      // Direct pass-through - no conversion
      expect(result?.model).toBe('claude-3-opus-20240229');
    });

    it('should return null for invalid requests', () => {
      const request = {
        model: 'claude-3-opus-20240229',
        messages: [],
        max_tokens: 100,
      } as ClaudeRequest;

      const result = convertClaudeToOpenAI(request);
      expect(result).toBeNull();
    });
  });
});
