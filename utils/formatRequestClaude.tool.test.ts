import { formatRequestClaude } from './formatRequestClaude';
import { OpenAIRequest, ClaudeRequest } from './types';

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
    const assistantContent = claudeRequest.messages[1].content as any[];
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
    const toolResultContent = claudeRequest.messages[2].content as any[];
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
    const content = assistantMessage.content as any[];
    expect(content).toHaveLength(3); // 1 text + 2 tool_use
    expect(content[0].type).toBe('text');
    expect(content[1].type).toBe('tool_use');
    expect(content[1].id).toBe('call_123');
    expect(content[2].type).toBe('tool_use');
    expect(content[2].id).toBe('call_456');

    // Check tool result messages are converted to user messages
    expect(claudeRequest.messages[2].role).toBe('user');
    const toolResult1 = claudeRequest.messages[2].content as any[];
    expect(toolResult1[0].type).toBe('tool_result');
    expect(toolResult1[0].tool_use_id).toBe('call_123');

    // Second tool result should be merged with the first
    expect(claudeRequest.messages[2].content).toHaveLength(2);
    const toolResult2 = claudeRequest.messages[2].content as any[];
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
    const content = assistantMessage.content as any[];
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
    const content = toolResultMessage.content as any[];
    expect(content[0].type).toBe('tool_result');
    expect(content[0].tool_use_id).toBe('call_error');
    expect(content[0].is_error).toBe(true);
    expect(content[0].content).toBe('Error: City not found');
  });
});
