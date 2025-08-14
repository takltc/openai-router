#!/usr/bin/env tsx
/**
 * Test tool_calls conversion between OpenAI and Claude formats
 * This test validates that tool_calls and tool results are properly paired
 */

import { formatRequestClaude } from './utils/formatRequestClaude';
import { formatRequestOpenAI } from './utils/formatRequestOpenAI';
import type { OpenAIRequest, ClaudeRequest } from './utils/types';

console.log('Testing Tool Calls Conversion...\n');

// Test case 1: OpenAI format with tool_calls and tool results
const openAIRequestWithTools: OpenAIRequest = {
  model: 'gpt-4',
  messages: [
    {
      role: 'user',
      content: "What's the weather in San Francisco?",
    },
    {
      role: 'assistant',
      content: null,
      tool_calls: [
        {
          id: 'call_abc123',
          type: 'function',
          function: {
            name: 'get_weather',
            arguments: JSON.stringify({ location: 'San Francisco', unit: 'celsius' }),
          },
        },
      ],
    },
    {
      role: 'tool',
      tool_call_id: 'call_abc123',
      content: JSON.stringify({ temperature: 20, condition: 'sunny' }),
    },
    {
      role: 'assistant',
      content: 'The weather in San Francisco is currently 20°C and sunny.',
    },
  ],
  tools: [
    {
      type: 'function',
      function: {
        name: 'get_weather',
        description: 'Get the current weather in a given location',
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
            },
          },
          required: ['location'],
        },
      },
    },
  ],
  temperature: 0.7,
  max_tokens: 150,
};

console.log('Test 1: OpenAI with tool_calls → Claude');
console.log('Original OpenAI Request with tools:');
console.log(JSON.stringify(openAIRequestWithTools, null, 2));

try {
  const claudeRequest = formatRequestClaude(openAIRequestWithTools);
  console.log('\nConverted Claude Request:');
  console.log(JSON.stringify(claudeRequest, null, 2));

  // Validate that tool_use and tool_result are properly paired
  let foundToolUse = false;
  let foundToolResult = false;
  let toolUseId = '';

  for (const message of claudeRequest.messages) {
    if (Array.isArray(message.content)) {
      for (const content of message.content) {
        if (content.type === 'tool_use') {
          foundToolUse = true;
          toolUseId = content.id;
          console.log(`✓ Found tool_use with id: ${toolUseId}`);
        }
        if (content.type === 'tool_result') {
          foundToolResult = true;
          console.log(`✓ Found tool_result with tool_use_id: ${content.tool_use_id}`);
          if (content.tool_use_id === toolUseId || content.tool_use_id === 'call_abc123') {
            console.log('✓ tool_use_id matches correctly');
          } else {
            console.error('✗ tool_use_id mismatch!');
          }
        }
      }
    }
  }

  if (foundToolUse && foundToolResult) {
    console.log('✅ Tool calls conversion successful - both tool_use and tool_result present\n');
  } else {
    console.error('❌ Tool calls conversion failed - missing tool_use or tool_result\n');
  }
} catch (error) {
  console.error('❌ Conversion failed:', error);
}

// Test case 2: Claude format with tool_use back to OpenAI
const claudeRequestWithTools: ClaudeRequest = {
  model: 'claude-3-opus-20240229',
  messages: [
    {
      role: 'user',
      content: "What's the weather in New York?",
    },
    {
      role: 'assistant',
      content: [
        {
          type: 'tool_use',
          id: 'toolu_01A2B3C4',
          name: 'get_weather',
          input: { location: 'New York', unit: 'fahrenheit' },
        },
      ],
    },
    {
      role: 'user',
      content: [
        {
          type: 'tool_result',
          tool_use_id: 'toolu_01A2B3C4',
          content: JSON.stringify({ temperature: 75, condition: 'cloudy' }),
        },
      ],
    },
    {
      role: 'assistant',
      content: 'The weather in New York is currently 75°F and cloudy.',
    },
  ],
  tools: [
    {
      name: 'get_weather',
      description: 'Get the current weather in a given location',
      input_schema: {
        type: 'object',
        properties: {
          location: {
            type: 'string',
            description: 'The city and state',
          },
          unit: {
            type: 'string',
            enum: ['celsius', 'fahrenheit'],
          },
        },
        required: ['location'],
      },
    },
  ],
  max_tokens: 150,
  temperature: 0.7,
};

console.log('Test 2: Claude with tool_use → OpenAI');
console.log('Original Claude Request with tools:');
console.log(JSON.stringify(claudeRequestWithTools, null, 2));

try {
  const openAIRequest = formatRequestOpenAI(claudeRequestWithTools);
  console.log('\nConverted OpenAI Request:');
  console.log(JSON.stringify(openAIRequest, null, 2));

  // Validate that tool_calls and tool messages are properly converted
  let foundToolCall = false;
  let foundToolMessage = false;
  let toolCallId = '';

  for (const message of openAIRequest.messages) {
    if (message.tool_calls && message.tool_calls.length > 0) {
      foundToolCall = true;
      toolCallId = message.tool_calls[0].id;
      console.log(`✓ Found tool_calls with id: ${toolCallId}`);
    }
    if (message.role === 'tool' && message.tool_call_id) {
      foundToolMessage = true;
      console.log(`✓ Found tool message with tool_call_id: ${message.tool_call_id}`);
      if (message.tool_call_id === toolCallId || message.tool_call_id === 'toolu_01A2B3C4') {
        console.log('✓ tool_call_id matches correctly');
      } else {
        console.error('✗ tool_call_id mismatch!');
      }
    }
  }

  if (foundToolCall && foundToolMessage) {
    console.log('✅ Tool calls conversion successful - both tool_calls and tool message present\n');
  } else {
    console.error('❌ Tool calls conversion failed - missing tool_calls or tool message\n');
  }
} catch (error) {
  console.error('❌ Conversion failed:', error);
}

// Test case 3: Edge case - tool_use without corresponding tool_result
const openAIRequestMissingResult: OpenAIRequest = {
  model: 'gpt-4',
  messages: [
    {
      role: 'user',
      content: "What's the weather?",
    },
    {
      role: 'assistant',
      content: null,
      tool_calls: [
        {
          id: 'call_xyz789',
          type: 'function',
          function: {
            name: 'get_weather',
            arguments: JSON.stringify({ location: 'London' }),
          },
        },
      ],
    },
    // Note: Missing tool result message here
  ],
  tools: [
    {
      type: 'function',
      function: {
        name: 'get_weather',
        description: 'Get weather',
        parameters: {
          type: 'object',
          properties: {
            location: { type: 'string' },
          },
        },
      },
    },
  ],
};

console.log('Test 3: Edge case - tool_calls without tool result');
console.log('Original OpenAI Request (missing tool result):');
console.log(JSON.stringify(openAIRequestMissingResult, null, 2));

try {
  const claudeRequest = formatRequestClaude(openAIRequestMissingResult);
  console.log('\nConverted Claude Request:');
  console.log(JSON.stringify(claudeRequest, null, 2));
  console.log('✅ Conversion completed - API will report missing tool_result if needed\n');
} catch (error) {
  console.error('❌ Conversion failed:', error);
}

console.log('All tool_calls tests completed! 🎉');
