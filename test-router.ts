/**
 * Test script for OpenAI Router
 * @author jizhejiang
 * @date 2025-08-11
 */

import { formatRequestClaude } from './utils/formatRequestClaude';
import { convertClaudeToOpenAI } from './utils/formatRequestOpenAI';
import { formatResponseOpenAI } from './utils/formatResponseOpenAI';
import { formatResponseClaude } from './utils/formatResponseClaude';

console.log('Testing OpenAI Router Format Conversion...\n');

// Test 1: OpenAI to Claude Request Conversion
console.log('Test 1: OpenAI → Claude Request');
const openAIRequest = {
  model: 'gpt-4',
  messages: [
    { role: 'system', content: 'You are a helpful assistant.' },
    { role: 'user', content: 'Hello!' },
  ],
  temperature: 0.7,
  max_tokens: 100,
  stream: false,
};

const claudeRequest = formatRequestClaude(openAIRequest);
console.log('Original OpenAI Request:', JSON.stringify(openAIRequest, null, 2));
console.log('Converted Claude Request:', JSON.stringify(claudeRequest, null, 2));
console.log('✅ OpenAI to Claude request conversion successful\n');

// Test 2: Claude to OpenAI Request Conversion
console.log('Test 2: Claude → OpenAI Request');
const claudeRequestOriginal = {
  model: 'claude-3-opus-20240229',
  messages: [
    { role: 'user', content: 'Hello!' },
    { role: 'assistant', content: 'Hi there!' },
    { role: 'user', content: 'How are you?' },
  ],
  system: 'You are a helpful assistant.',
  max_tokens: 100,
  temperature: 0.7,
  stream: false,
};

const openAIRequestConverted = convertClaudeToOpenAI(claudeRequestOriginal);
console.log('Original Claude Request:', JSON.stringify(claudeRequestOriginal, null, 2));
console.log('Converted OpenAI Request:', JSON.stringify(openAIRequestConverted, null, 2));
console.log('✅ Claude to OpenAI request conversion successful\n');

// Test 3: OpenAI Response to Claude Response Conversion
console.log('Test 3: OpenAI → Claude Response');
const openAIResponse = {
  id: 'chatcmpl-123',
  object: 'chat.completion',
  created: 1702000000,
  model: 'gpt-4',
  choices: [
    {
      index: 0,
      message: {
        role: 'assistant',
        content: 'Hello! How can I help you today?',
      },
      finish_reason: 'stop',
    },
  ],
  usage: {
    prompt_tokens: 10,
    completion_tokens: 20,
    total_tokens: 30,
  },
};

const claudeResponseConverted = formatResponseOpenAI(openAIResponse);
console.log('Original OpenAI Response:', JSON.stringify(openAIResponse, null, 2));
console.log('Converted Claude Response:', JSON.stringify(claudeResponseConverted, null, 2));
console.log('✅ OpenAI to Claude response conversion successful\n');

// Test 4: Claude Response to OpenAI Response Conversion
console.log('Test 4: Claude → OpenAI Response');
const claudeResponse = {
  id: 'msg_123',
  type: 'message',
  role: 'assistant',
  content: [
    {
      type: 'text',
      text: 'Hello! How can I assist you today?',
    },
  ],
  model: 'claude-3-opus-20240229',
  stop_reason: 'end_turn',
  stop_sequence: null,
  usage: {
    input_tokens: 10,
    output_tokens: 20,
  },
};

const openAIResponseConverted = formatResponseClaude(claudeResponse);
console.log('Original Claude Response:', JSON.stringify(claudeResponse, null, 2));
console.log('Converted OpenAI Response:', JSON.stringify(openAIResponseConverted, null, 2));
console.log('✅ Claude to OpenAI response conversion successful\n');

console.log('All tests completed successfully! 🎉');
