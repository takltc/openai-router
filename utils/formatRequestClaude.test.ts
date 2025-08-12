/**
 * Tests for OpenAI to Claude request format converter
 * @author jizhejiang
 * @date 2024-12-20
 */

import { describe, it, expect } from 'vitest';
import { formatRequestClaude, __testing } from './formatRequestClaude';
import type { OpenAIRequest, ClaudeRequest, OpenAIMessage, ClaudeMessage } from './types';

const {
  extractBase64FromImageUrl,
  mapMediaType,
  convertImageContent,
  convertMessage,
  extractSystemMessages,
  convertTool,
  convertToolChoice,
  mapModel,
  validateMessageAlternation,
} = __testing;

describe('formatRequestClaude', () => {
  describe('extractBase64FromImageUrl', () => {
    it('should extract base64 data from data URL', () => {
      const dataUrl =
        'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';
      const result = extractBase64FromImageUrl(dataUrl);

      expect(result).not.toBeNull();
      expect(result?.mediaType).toBe('image/png');
      expect(result?.data).toBe(
        'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg=='
      );
    });

    it('should return null for HTTP URLs', () => {
      const httpUrl = 'https://example.com/image.png';
      const result = extractBase64FromImageUrl(httpUrl);

      expect(result).toBeNull();
    });
  });

  describe('mapMediaType', () => {
    it('should map common media types correctly', () => {
      expect(mapMediaType('image/jpeg')).toBe('image/jpeg');
      expect(mapMediaType('image/jpg')).toBe('image/jpeg');
      expect(mapMediaType('image/png')).toBe('image/png');
      expect(mapMediaType('image/gif')).toBe('image/gif');
      expect(mapMediaType('image/webp')).toBe('image/webp');
    });

    it('should default to jpeg for unknown types', () => {
      expect(mapMediaType('image/bmp')).toBe('image/jpeg');
      expect(mapMediaType('application/octet-stream')).toBe('image/jpeg');
    });
  });

  describe('mapModel', () => {
    it('should pass through model names without conversion', () => {
      // Direct pass-through - no conversion
      expect(mapModel('gpt-4')).toBe('gpt-4');
      expect(mapModel('gpt-4-turbo')).toBe('gpt-4-turbo');
      expect(mapModel('gpt-4o')).toBe('gpt-4o');
      expect(mapModel('gpt-4o-mini')).toBe('gpt-4o-mini');
    });

    it('should pass through GPT-3.5 models without conversion', () => {
      expect(mapModel('gpt-3.5-turbo')).toBe('gpt-3.5-turbo');
      expect(mapModel('gpt-3.5-turbo-16k')).toBe('gpt-3.5-turbo-16k');
    });

    it('should pass through unknown models without conversion', () => {
      expect(mapModel('unknown-model')).toBe('unknown-model');
      expect(mapModel('claude-3-opus-20240229')).toBe('claude-3-opus-20240229');
      expect(mapModel('custom-model-xyz')).toBe('custom-model-xyz');
    });

    // 新增测试用例 - 2025-08-12
    it('should pass through models not in mapping table unchanged', () => {
      // 测试不在映射表中的模型名应保持不变
      expect(mapModel('llama-2-70b')).toBe('llama-2-70b');
      expect(mapModel('mistral-7b')).toBe('mistral-7b');
      expect(mapModel('gemini-pro')).toBe('gemini-pro');
      expect(mapModel('custom-internal-model')).toBe('custom-internal-model');
      expect(mapModel('test-model-v1')).toBe('test-model-v1');
    });

    it('should correctly map models that would be in mapping table', () => {
      // 测试映射表内的模型名仍应得到正确映射
      // 由于当前实现是直接透传，这些也会保持不变
      expect(mapModel('gpt-4')).toBe('gpt-4');
      expect(mapModel('gpt-3.5-turbo')).toBe('gpt-3.5-turbo');
      expect(mapModel('claude-3-opus-20240229')).toBe('claude-3-opus-20240229');
      expect(mapModel('claude-3-sonnet-20240229')).toBe('claude-3-sonnet-20240229');
    });

    it('should handle empty string model name', () => {
      // 测试空字符串的情况
      expect(mapModel('')).toBe('');
    });

    it('should handle special characters in model names', () => {
      // 测试包含特殊字符的模型名
      expect(mapModel('model-with-dash')).toBe('model-with-dash');
      expect(mapModel('model_with_underscore')).toBe('model_with_underscore');
      expect(mapModel('model.with.dots')).toBe('model.with.dots');
      expect(mapModel('model/with/slash')).toBe('model/with/slash');
      expect(mapModel('model@special')).toBe('model@special');
    });
  });

  describe('convertMessage', () => {
    it('should convert user message with text content', () => {
      const openAIMessage: OpenAIMessage = {
        role: 'user',
        content: 'Hello, how are you?',
      };

      const result = convertMessage(openAIMessage);

      expect(result).toEqual({
        role: 'user',
        content: 'Hello, how are you?',
      });
    });

    it('should convert assistant message with text content', () => {
      const openAIMessage: OpenAIMessage = {
        role: 'assistant',
        content: 'I am doing well, thank you!',
      };

      const result = convertMessage(openAIMessage);

      expect(result).toEqual({
        role: 'assistant',
        content: 'I am doing well, thank you!',
      });
    });

    it('should return null for system messages', () => {
      const openAIMessage: OpenAIMessage = {
        role: 'system',
        content: 'You are a helpful assistant.',
      };

      const result = convertMessage(openAIMessage);

      expect(result).toBeNull();
    });

    it('should convert tool messages to user messages with tool_result', () => {
      const openAIMessage: OpenAIMessage = {
        role: 'tool',
        content: '{"result": "success"}',
        tool_call_id: 'tool_123',
      };

      const result = convertMessage(openAIMessage);

      expect(result).toEqual({
        role: 'user',
        content: [
          {
            type: 'tool_result',
            tool_use_id: 'tool_123',
            content: '{"result": "success"}',
          },
        ],
      });
    });

    it('should convert messages with tool_calls', () => {
      const openAIMessage: OpenAIMessage = {
        role: 'assistant',
        content: 'Let me search for that.',
        tool_calls: [
          {
            id: 'call_123',
            type: 'function',
            function: {
              name: 'search',
              arguments: '{"query": "weather"}',
            },
          },
        ],
      };

      const result = convertMessage(openAIMessage);

      expect(result).toEqual({
        role: 'assistant',
        content: [
          {
            type: 'text',
            text: 'Let me search for that.',
          },
          {
            type: 'tool_use',
            id: 'call_123',
            name: 'search',
            input: { query: 'weather' },
          },
        ],
      });
    });

    it('should convert legacy function_call format', () => {
      const openAIMessage: OpenAIMessage = {
        role: 'assistant',
        content: '',
        function_call: {
          name: 'get_weather',
          arguments: '{"location": "New York"}',
        },
      };

      const result = convertMessage(openAIMessage);

      expect(result?.role).toBe('assistant');
      expect(Array.isArray(result?.content)).toBe(true);
      const content = result?.content as any[];
      expect(content.some((item) => item.type === 'tool_use' && item.name === 'get_weather')).toBe(
        true
      );
    });
  });

  describe('extractSystemMessages', () => {
    it('should extract system messages and return other messages', () => {
      const messages: OpenAIMessage[] = [
        { role: 'system', content: 'You are helpful.' },
        { role: 'user', content: 'Hello' },
        { role: 'assistant', content: 'Hi there!' },
      ];

      const result = extractSystemMessages(messages);

      expect(result.system).toBe('You are helpful.');
      expect(result.otherMessages).toHaveLength(2);
      expect(result.otherMessages[0].role).toBe('user');
      expect(result.otherMessages[1].role).toBe('assistant');
    });

    it('should combine multiple system messages', () => {
      const messages: OpenAIMessage[] = [
        { role: 'system', content: 'First instruction.' },
        { role: 'system', content: 'Second instruction.' },
        { role: 'user', content: 'Hello' },
      ];

      const result = extractSystemMessages(messages);

      expect(result.system).toBe('First instruction.\n\nSecond instruction.');
      expect(result.otherMessages).toHaveLength(1);
    });
  });

  describe('convertTool', () => {
    it('should convert OpenAI tool to Claude tool format', () => {
      const openAITool = {
        type: 'function' as const,
        function: {
          name: 'get_weather',
          description: 'Get the weather for a location',
          parameters: {
            type: 'object',
            properties: {
              location: { type: 'string' },
              unit: { type: 'string', enum: ['celsius', 'fahrenheit'] },
            },
            required: ['location'],
          },
        },
      };

      const result = convertTool(openAITool);

      expect(result).toEqual({
        name: 'get_weather',
        description: 'Get the weather for a location',
        input_schema: {
          type: 'object',
          properties: {
            location: { type: 'string' },
            unit: { type: 'string', enum: ['celsius', 'fahrenheit'] },
          },
          required: ['location'],
        },
      });
    });

    it('should convert legacy function format', () => {
      const openAIFunction = {
        name: 'calculate',
        description: 'Perform calculation',
        parameters: {
          type: 'object',
          properties: {
            expression: { type: 'string' },
          },
          required: ['expression'],
        },
      };

      const result = convertTool(openAIFunction);

      expect(result.name).toBe('calculate');
      expect(result.description).toBe('Perform calculation');
      expect(result.input_schema.properties).toHaveProperty('expression');
    });
  });

  describe('convertToolChoice', () => {
    it('should convert string tool choices', () => {
      expect(convertToolChoice('auto')).toEqual({ type: 'auto' });
      expect(convertToolChoice('required')).toEqual({ type: 'any' });
      expect(convertToolChoice('none')).toBeUndefined();
    });

    it('should convert specific function choice', () => {
      const toolChoice = {
        type: 'function' as const,
        function: { name: 'get_weather' },
      };

      expect(convertToolChoice(toolChoice)).toEqual({
        type: 'tool',
        name: 'get_weather',
      });
    });
  });

  describe('validateMessageAlternation', () => {
    it('should merge consecutive messages from same role', () => {
      const messages: ClaudeMessage[] = [
        { role: 'user', content: 'First message' },
        { role: 'user', content: 'Second message' },
        { role: 'assistant', content: 'Response' },
      ];

      const result = validateMessageAlternation(messages);

      expect(result).toHaveLength(2);
      expect(result[0].content).toBe('First message\n\nSecond message');
      expect(result[1].content).toBe('Response');
    });

    it('should add user message if first message is assistant', () => {
      const messages: ClaudeMessage[] = [{ role: 'assistant', content: 'Starting with assistant' }];

      const result = validateMessageAlternation(messages);

      expect(result).toHaveLength(2);
      expect(result[0].role).toBe('user');
      expect(result[0].content).toBe('Continue.');
      expect(result[1].role).toBe('assistant');
    });
  });

  describe('full conversion tests', () => {
    it('should convert simple chat request', () => {
      const openAIRequest: OpenAIRequest = {
        model: 'gpt-4',
        messages: [
          { role: 'system', content: 'You are a helpful assistant.' },
          { role: 'user', content: 'What is the capital of France?' },
        ],
        temperature: 0.7,
        max_tokens: 150,
        stream: false,
      };

      const result = formatRequestClaude(openAIRequest);

      // Direct pass-through - no conversion
      expect(result.model).toBe('gpt-4');
      expect(result.system).toBe('You are a helpful assistant.');
      expect(result.messages).toHaveLength(1);
      expect(result.messages[0]).toEqual({
        role: 'user',
        content: 'What is the capital of France?',
      });
      expect(result.temperature).toBe(0.7);
      expect(result.max_tokens).toBe(150);
      expect(result.stream).toBe(false);
    });

    it('should convert request with tools', () => {
      const openAIRequest: OpenAIRequest = {
        model: 'gpt-4-turbo',
        messages: [{ role: 'user', content: 'What is the weather?' }],
        tools: [
          {
            type: 'function',
            function: {
              name: 'get_weather',
              description: 'Get weather information',
              parameters: {
                type: 'object',
                properties: {
                  location: { type: 'string' },
                },
                required: ['location'],
              },
            },
          },
        ],
        tool_choice: 'auto',
      };

      const result = formatRequestClaude(openAIRequest);

      expect(result.tools).toHaveLength(1);
      expect(result.tools![0].name).toBe('get_weather');
      expect(result.tool_choice).toEqual({ type: 'auto' });
    });

    it('should convert request with legacy functions', () => {
      const openAIRequest: OpenAIRequest = {
        model: 'gpt-3.5-turbo',
        messages: [{ role: 'user', content: 'Calculate 2+2' }],
        functions: [
          {
            name: 'calculate',
            description: 'Perform calculations',
            parameters: {
              type: 'object',
              properties: {
                expression: { type: 'string' },
              },
              required: ['expression'],
            },
          },
        ],
        function_call: { name: 'calculate' },
      };

      const result = formatRequestClaude(openAIRequest);

      // Direct pass-through - no conversion
      expect(result.model).toBe('gpt-3.5-turbo');
      expect(result.tools).toHaveLength(1);
      expect(result.tools![0].name).toBe('calculate');
      expect(result.tool_choice).toEqual({
        type: 'tool',
        name: 'calculate',
      });
    });

    it('should handle multi-turn conversation with tool use', () => {
      const openAIRequest: OpenAIRequest = {
        model: 'gpt-4',
        messages: [
          { role: 'user', content: 'What is the weather in Paris?' },
          {
            role: 'assistant',
            content: 'Let me check the weather for you.',
            tool_calls: [
              {
                id: 'call_123',
                type: 'function',
                function: {
                  name: 'get_weather',
                  arguments: '{"location": "Paris"}',
                },
              },
            ],
          },
          {
            role: 'tool',
            content: '{"temperature": 22, "condition": "sunny"}',
            tool_call_id: 'call_123',
          },
          {
            role: 'assistant',
            content: 'The weather in Paris is sunny with a temperature of 22°C.',
          },
        ],
      };

      const result = formatRequestClaude(openAIRequest);

      expect(result.messages.length).toBeGreaterThan(0);
      // Check that tool use and tool result are properly converted
      const hasToolUse = result.messages.some(
        (msg) => Array.isArray(msg.content) && msg.content.some((c: any) => c.type === 'tool_use')
      );
      const hasToolResult = result.messages.some(
        (msg) =>
          Array.isArray(msg.content) && msg.content.some((c: any) => c.type === 'tool_result')
      );

      expect(hasToolUse).toBe(true);
      expect(hasToolResult).toBe(true);
    });

    it('should handle image content', () => {
      const openAIRequest: OpenAIRequest = {
        model: 'gpt-4o',
        messages: [
          {
            role: 'user',
            content: [
              { type: 'text', text: 'What is in this image?' },
              {
                type: 'image_url',
                image_url: {
                  url: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==',
                },
              },
            ],
          },
        ],
      };

      const result = formatRequestClaude(openAIRequest);

      expect(Array.isArray(result.messages[0].content)).toBe(true);
      const content = result.messages[0].content as any[];
      const hasText = content.some((c) => c.type === 'text');
      const hasImage = content.some((c) => c.type === 'image');

      expect(hasText).toBe(true);
      expect(hasImage).toBe(true);
    });

    it('should handle metadata and stop sequences', () => {
      const openAIRequest: OpenAIRequest = {
        model: 'gpt-4',
        messages: [{ role: 'user', content: 'Tell me a story' }],
        stop: ['END', 'STOP'],
        user: 'user_123',
        top_p: 0.9,
      };

      const result = formatRequestClaude(openAIRequest);

      expect(result.stop_sequences).toEqual(['END', 'STOP']);
      expect(result.metadata).toEqual({ user_id: 'user_123' });
      expect(result.top_p).toBe(0.9);
    });

    it('should provide default max_tokens when not specified', () => {
      const openAIRequest: OpenAIRequest = {
        model: 'gpt-4',
        messages: [{ role: 'user', content: 'Hello' }],
      };

      const result = formatRequestClaude(openAIRequest);

      expect(result.max_tokens).toBe(4096);
    });

    // 新增测试用例 - 2025-08-12
    it('should handle request with model name not in mapping table', () => {
      // 测试映射表外的模型名，应当在转换后保持不变
      const openAIRequest: OpenAIRequest = {
        model: 'llama-2-70b-chat',
        messages: [{ role: 'user', content: 'Hello' }],
      };

      const result = formatRequestClaude(openAIRequest);

      expect(result.model).toBe('llama-2-70b-chat');
      expect(result.max_tokens).toBe(4096); // 使用默认值
    });

    it('should handle request with empty model name', () => {
      // 测试空字符串模型名的情况
      const openAIRequest: OpenAIRequest = {
        model: '',
        messages: [{ role: 'user', content: 'Hello' }],
      };

      const result = formatRequestClaude(openAIRequest);

      expect(result.model).toBe(''); // 空字符串仍保持为空字符串
      expect(result.max_tokens).toBe(4096); // 使用默认值
    });

    it('should correctly map known models in request', () => {
      // 测试映射表内的模型名，仍应得到正确映射
      const requests = [
        { model: 'gpt-4', expectedModel: 'gpt-4' },
        { model: 'gpt-3.5-turbo', expectedModel: 'gpt-3.5-turbo' },
        { model: 'gpt-4o', expectedModel: 'gpt-4o' },
        { model: 'claude-3-opus-20240229', expectedModel: 'claude-3-opus-20240229' },
      ];

      requests.forEach(({ model, expectedModel }) => {
        const openAIRequest: OpenAIRequest = {
          model,
          messages: [{ role: 'user', content: 'Test' }],
        };

        const result = formatRequestClaude(openAIRequest);
        expect(result.model).toBe(expectedModel);
      });
    });

    it('should handle various model name formats', () => {
      // 测试各种格式的模型名
      const modelNames = [
        'custom-model-v1.0',
        'org/model-name',
        'model_with_underscore',
        'MODEL-UPPERCASE',
        '123-numeric-start',
        'special@char#model',
      ];

      modelNames.forEach((model) => {
        const openAIRequest: OpenAIRequest = {
          model,
          messages: [{ role: 'user', content: 'Test' }],
        };

        const result = formatRequestClaude(openAIRequest);
        expect(result.model).toBe(model); // 所有格式都应保持不变
      });
    });
  });
});
