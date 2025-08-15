import { describe, it, expect } from 'vitest';
import { formatRequestClaude } from './formatRequestClaude';
import { OpenAIRequest } from './types';

describe('formatRequestClaude - tool_calls handling', () => {
  it('should correctly convert messages with tool_calls and tool responses', () => {
    const openAIRequest: OpenAIRequest = {
      model: 'gpt-4',
      messages: [
        {
          role: 'user',
          content: "What's the weather in San Francisco?",
        },
        {
          role: 'assistant',
          content: "I'll check the weather for you.",
          tool_calls: [
            {
              id: 'call_123',
              type: 'function',
              function: {
                name: 'get_weather',
                arguments: JSON.stringify({ location: 'San Francisco' }),
              },
            },
          ],
        },
        {
          role: 'tool',
          tool_call_id: 'call_123',
          content: JSON.stringify({ temperature: 68, condition: 'sunny' }),
        },
        {
          role: 'assistant',
          content: 'The weather in San Francisco is sunny with a temperature of 68°F.',
        },
      ],
      max_tokens: 1000,
      temperature: 0.7,
      tools: [
        {
          type: 'function',
          function: {
            name: 'get_weather',
            description: 'Get the current weather',
            parameters: {
              type: 'object',
              properties: {
                location: {
                  type: 'string',
                  description: 'The city name',
                },
              },
              required: ['location'],
            },
          },
        },
      ],
    };

    const claudeRequest = formatRequestClaude(openAIRequest);

    // Check that the request was converted
    expect(claudeRequest.model).toBe('gpt-4');
    expect(claudeRequest.messages).toHaveLength(4);

    // Check first message (user)
    expect(claudeRequest.messages[0].role).toBe('user');
    expect(claudeRequest.messages[0].content).toBe("What's the weather in San Francisco?");

    // Check second message (assistant with tool_use)
    expect(claudeRequest.messages[1].role).toBe('assistant');
    expect(Array.isArray(claudeRequest.messages[1].content)).toBe(true);
    const assistantContent = claudeRequest.messages[1].content as Array<{
      type: string;
      [k: string]: unknown;
    }>;
    expect(assistantContent).toHaveLength(2);
    expect(assistantContent[0].type).toBe('text');
    expect(assistantContent[0].text).toBe("I'll check the weather for you.");
    expect(assistantContent[1].type).toBe('tool_use');
    expect(assistantContent[1].id).toBe('call_123');
    expect(assistantContent[1].name).toBe('get_weather');
    expect(assistantContent[1].input).toEqual({ location: 'San Francisco' });

    // Check third message (user with tool_result)
    expect(claudeRequest.messages[2].role).toBe('user');
    expect(Array.isArray(claudeRequest.messages[2].content)).toBe(true);
    const toolResultContent = claudeRequest.messages[2].content as Array<{
      type: string;
      [k: string]: unknown;
    }>;
    expect(toolResultContent).toHaveLength(1);
    expect(toolResultContent[0].type).toBe('tool_result');
    expect(toolResultContent[0].tool_use_id).toBe('call_123');
    expect(toolResultContent[0].content).toBe(
      JSON.stringify({ temperature: 68, condition: 'sunny' })
    );

    // Check fourth message (assistant)
    expect(claudeRequest.messages[3].role).toBe('assistant');
    expect(claudeRequest.messages[3].content).toBe(
      'The weather in San Francisco is sunny with a temperature of 68°F.'
    );

    // Check tools conversion
    expect(claudeRequest.tools).toHaveLength(1);
    expect(claudeRequest.tools![0].name).toBe('get_weather');
    expect(claudeRequest.tools![0].description).toBe('Get the current weather');
  });

  it('should handle multiple tool calls in a single message', () => {
    const openAIRequest: OpenAIRequest = {
      model: 'gpt-4',
      messages: [
        {
          role: 'user',
          content: 'What is the weather in both San Francisco and New York?',
        },
        {
          role: 'assistant',
          content: "I'll check the weather in both cities.",
          tool_calls: [
            {
              id: 'call_123',
              type: 'function',
              function: {
                name: 'get_weather',
                arguments: JSON.stringify({ location: 'San Francisco' }),
              },
            },
            {
              id: 'call_456',
              type: 'function',
              function: {
                name: 'get_weather',
                arguments: JSON.stringify({ location: 'New York' }),
              },
            },
          ],
        },
        {
          role: 'tool',
          tool_call_id: 'call_123',
          content: JSON.stringify({ temperature: 68, condition: 'sunny' }),
        },
        {
          role: 'tool',
          tool_call_id: 'call_456',
          content: JSON.stringify({ temperature: 55, condition: 'cloudy' }),
        },
      ],
      max_tokens: 1000,
    };

    const claudeRequest = formatRequestClaude(openAIRequest);

    // Check assistant message with multiple tool_use
    const assistantMessage = claudeRequest.messages[1];
    expect(assistantMessage.role).toBe('assistant');
    expect(Array.isArray(assistantMessage.content)).toBe(true);
    const content = assistantMessage.content as Array<{
      type: string;
      [k: string]: unknown;
    }>;
    expect(content).toHaveLength(3); // 1 text + 2 tool_use
    expect(content[0].type).toBe('text');
    expect(content[1].type).toBe('tool_use');
    expect(content[1].id).toBe('call_123');
    expect(content[2].type).toBe('tool_use');
    expect(content[2].id).toBe('call_456');

    // Check tool result messages are converted to user messages
    expect(claudeRequest.messages[2].role).toBe('user');
    const toolResult1 = claudeRequest.messages[2].content as Array<{
      type: string;
      [k: string]: unknown;
    }>;
    expect(toolResult1[0].type).toBe('tool_result');
    expect(toolResult1[0].tool_use_id).toBe('call_123');

    // Second tool result should be merged with the first
    expect(claudeRequest.messages[2].content).toHaveLength(2);
    const toolResult2 = claudeRequest.messages[2].content as Array<{
      type: string;
      [k: string]: unknown;
    }>;
    expect(toolResult2[1].type).toBe('tool_result');
    expect(toolResult2[1].tool_use_id).toBe('call_456');
  });

  it('should handle tool calls without text content', () => {
    const openAIRequest: OpenAIRequest = {
      model: 'gpt-4',
      messages: [
        {
          role: 'user',
          content: 'Get the weather',
        },
        {
          role: 'assistant',
          content: '',
          tool_calls: [
            {
              id: 'call_789',
              type: 'function',
              function: {
                name: 'get_weather',
                arguments: JSON.stringify({ location: 'London' }),
              },
            },
          ],
        },
      ],
      max_tokens: 1000,
    };

    const claudeRequest = formatRequestClaude(openAIRequest);

    const assistantMessage = claudeRequest.messages[1];
    expect(assistantMessage.role).toBe('assistant');
    expect(Array.isArray(assistantMessage.content)).toBe(true);
    const content = assistantMessage.content as Array<{ type: string; [k: string]: unknown }>;
    // Should only have tool_use, no text content since it was empty
    expect(content).toHaveLength(1);
    expect(content[0].type).toBe('tool_use');
    expect(content[0].id).toBe('call_789');
  });

  it('should handle error responses from tools', () => {
    const openAIRequest: OpenAIRequest = {
      model: 'gpt-4',
      messages: [
        {
          role: 'user',
          content: 'Get the weather',
        },
        {
          role: 'assistant',
          content: '',
          tool_calls: [
            {
              id: 'call_error',
              type: 'function',
              function: {
                name: 'get_weather',
                arguments: JSON.stringify({ location: 'InvalidCity' }),
              },
            },
          ],
        },
        {
          role: 'tool',
          tool_call_id: 'call_error',
          content: 'Error: City not found',
        },
      ],
      max_tokens: 1000,
    };

    const claudeRequest = formatRequestClaude(openAIRequest);

    // Check error tool result
    const toolResultMessage = claudeRequest.messages[2];
    expect(toolResultMessage.role).toBe('user');
    const content = toolResultMessage.content as Array<{ type: string; [k: string]: unknown }>;
    expect(content[0].type).toBe('tool_result');
    expect(content[0].tool_use_id).toBe('call_error');
    expect(content[0].is_error).toBe(true);
    expect(content[0].content).toBe('Error: City not found');
  });

  it('should map function.strict to input_schema.additionalProperties=false', () => {
    const openAIRequest: OpenAIRequest = {
      model: 'gpt-4',
      messages: [
        { role: 'user', content: 'Call tool' },
        { role: 'assistant', content: 'ok' },
      ],
      tools: [
        {
          type: 'function',
          function: {
            name: 'strict_tool',
            description: 'strict tool',
            parameters: { type: 'object', properties: { a: { type: 'string' } }, required: ['a'] },
            strict: true,
          },
        },
      ],
      max_tokens: 100,
    };

    const claudeRequest = formatRequestClaude(openAIRequest);
    expect(claudeRequest.tools?.[0].input_schema.additionalProperties).toBe(false);
  });

  it('should remove tools when tool_choice is none', () => {
    const openAIRequest: OpenAIRequest = {
      model: 'gpt-4',
      messages: [{ role: 'user', content: 'Hello' }],
      tools: [
        {
          type: 'function',
          function: {
            name: 'foo',
            parameters: { type: 'object', properties: {} },
          },
        },
      ],
      tool_choice: 'none',
      max_tokens: 100,
    };

    const claudeRequest = formatRequestClaude(openAIRequest);
    expect(claudeRequest.tools).toBeUndefined();
    expect(claudeRequest.tool_choice).toBeUndefined();
  });

  it('should append JSON-only hint for response_format: json_object', () => {
    const openAIRequest: OpenAIRequest = {
      model: 'gpt-4',
      messages: [
        { role: 'system', content: 'You are helpful.' },
        { role: 'user', content: 'Return JSON' },
      ],
      response_format: { type: 'json_object' },
      max_tokens: 100,
    };

    const claudeRequest = formatRequestClaude(openAIRequest);
    expect(typeof claudeRequest.system === 'string').toBe(true);
    const sys1 = claudeRequest.system as string;
    expect(sys1).toContain('strictly formatted JSON object');
  });

  it('should append schema hint for response_format: json_schema', () => {
    const openAIRequest: OpenAIRequest = {
      model: 'gpt-4',
      messages: [{ role: 'user', content: 'Return schema' }],
      response_format: {
        type: 'json_schema',
        json_schema: {
          name: 'Out',
          schema: { type: 'object', properties: { x: { type: 'string' } }, required: ['x'] },
          strict: true,
        },
      } as unknown as OpenAIRequest['response_format'],
      max_tokens: 100,
    };

    const claudeRequest = formatRequestClaude(openAIRequest);
    expect(typeof claudeRequest.system === 'string').toBe(true);
    const sys2 = claudeRequest.system as string;
    expect(sys2).toContain('conforms to the provided JSON Schema');
  });

  it('should default max_tokens to 262000 when missing', () => {
    const openAIRequest: OpenAIRequest = {
      model: 'gpt-4',
      messages: [{ role: 'user', content: 'Hello' }],
    } as unknown as OpenAIRequest;

    const claudeRequest = formatRequestClaude(openAIRequest);
    expect(claudeRequest.max_tokens).toBe(262000);
  });

  it('should map http image_url to Claude URL source', () => {
    const openAIRequest: OpenAIRequest = {
      model: 'gpt-4',
      messages: [
        {
          role: 'user',
          content: [
            { type: 'text', text: 'see image' },
            { type: 'image_url', image_url: { url: 'https://example.com/a.png' } },
          ] as unknown as OpenAIRequest['messages'][number]['content'],
        },
      ],
      max_tokens: 100,
    } as unknown as OpenAIRequest;

    const claudeRequest = formatRequestClaude(openAIRequest);
    const user = claudeRequest.messages[0];
    expect(Array.isArray(user.content)).toBe(true);
    const parts = user.content as Array<{ type: string; source?: { type?: string; url?: string } }>;
    const img = parts.find((p) => p.type === 'image');
    expect(img?.source?.type).toBe('url');
    expect(img?.source?.url).toBe('https://example.com/a.png');
  });
});
