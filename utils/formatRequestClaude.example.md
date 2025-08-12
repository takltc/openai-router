# OpenAI to Claude Request Format Converter - Usage Examples

## Basic Usage

```typescript
import { formatRequestClaude } from './formatRequestClaude';

// Simple text conversation
const openAIRequest = {
  model: 'gpt-4',
  messages: [
    { role: 'system', content: 'You are a helpful assistant.' },
    { role: 'user', content: 'What is the capital of France?' }
  ],
  temperature: 0.7,
  max_tokens: 150
};

const claudeRequest = formatRequestClaude(openAIRequest);
// Result:
// {
//   model: 'claude-3-sonnet-20240229',
//   messages: [
//     { role: 'user', content: 'What is the capital of France?' }
//   ],
//   system: 'You are a helpful assistant.',
//   temperature: 0.7,
//   max_tokens: 150
// }
```

## Model Mapping

| OpenAI Model | Claude Model |
|-------------|--------------|
| gpt-4-turbo | claude-3-5-sonnet-20241022 |
| gpt-4 | claude-3-sonnet-20240229 |
| gpt-4o | claude-3-5-sonnet-20241022 |
| gpt-4o-mini | claude-3-haiku-20240307 |
| gpt-3.5-turbo | claude-3-haiku-20240307 |

## Function Calling / Tool Use

### OpenAI Tools Format
```typescript
const openAIRequest = {
  model: 'gpt-4',
  messages: [
    { role: 'user', content: 'What is the weather in Paris?' }
  ],
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
            unit: { type: 'string', enum: ['celsius', 'fahrenheit'] }
          },
          required: ['location']
        }
      }
    }
  ],
  tool_choice: 'auto'
};

const claudeRequest = formatRequestClaude(openAIRequest);
// Result includes:
// tools: [{
//   name: 'get_weather',
//   description: 'Get weather information',
//   input_schema: {
//     type: 'object',
//     properties: {
//       location: { type: 'string' },
//       unit: { type: 'string', enum: ['celsius', 'fahrenheit'] }
//     },
//     required: ['location']
//   }
// }],
// tool_choice: { type: 'auto' }
```

### Legacy Function Format
```typescript
const openAIRequest = {
  model: 'gpt-3.5-turbo',
  messages: [
    { role: 'user', content: 'Calculate 2+2' }
  ],
  functions: [
    {
      name: 'calculate',
      description: 'Perform calculations',
      parameters: {
        type: 'object',
        properties: {
          expression: { type: 'string' }
        },
        required: ['expression']
      }
    }
  ],
  function_call: { name: 'calculate' }
};

const claudeRequest = formatRequestClaude(openAIRequest);
// Converts to Claude tools format with tool_choice
```

## Multi-turn Conversations with Tool Results

```typescript
const openAIRequest = {
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
            arguments: '{"location": "Paris"}'
          }
        }
      ]
    },
    {
      role: 'tool',
      content: '{"temperature": 22, "condition": "sunny"}',
      tool_call_id: 'call_123'
    },
    {
      role: 'assistant',
      content: 'The weather in Paris is sunny with 22°C.'
    }
  ]
};

const claudeRequest = formatRequestClaude(openAIRequest);
// Converts tool messages to Claude's tool_result format
// Maintains conversation flow with proper role alternation
```

## Image Content

```typescript
const openAIRequest = {
  model: 'gpt-4o',
  messages: [
    {
      role: 'user',
      content: [
        { type: 'text', text: 'What is in this image?' },
        {
          type: 'image_url',
          image_url: {
            url: 'data:image/png;base64,iVBORw0KG...',
            detail: 'high'
          }
        }
      ]
    }
  ]
};

const claudeRequest = formatRequestClaude(openAIRequest);
// Converts to Claude's image format:
// content: [
//   { type: 'text', text: 'What is in this image?' },
//   {
//     type: 'image',
//     source: {
//       type: 'base64',
//       media_type: 'image/png',
//       data: 'iVBORw0KG...'
//     }
//   }
// ]
```

## Parameter Mapping

### Sampling Parameters
```typescript
const openAIRequest = {
  model: 'gpt-4',
  messages: [...],
  temperature: 0.8,      // Maps directly
  top_p: 0.9,           // Maps directly
  max_tokens: 1000,     // Maps directly
  stop: ['END', 'STOP'] // Maps to stop_sequences
};

const claudeRequest = formatRequestClaude(openAIRequest);
// Result:
// {
//   temperature: 0.8,
//   top_p: 0.9,
//   max_tokens: 1000,
//   stop_sequences: ['END', 'STOP']
// }
```

### Metadata
```typescript
const openAIRequest = {
  model: 'gpt-4',
  messages: [...],
  user: 'user_123'  // Maps to metadata.user_id
};

const claudeRequest = formatRequestClaude(openAIRequest);
// Result includes:
// metadata: {
//   user_id: 'user_123'
// }
```

## Message Alternation

Claude requires strict user/assistant message alternation. The converter handles this automatically:

```typescript
const openAIRequest = {
  model: 'gpt-4',
  messages: [
    { role: 'user', content: 'First question' },
    { role: 'user', content: 'Second question' },  // Consecutive user messages
    { role: 'assistant', content: 'Answer' }
  ]
};

const claudeRequest = formatRequestClaude(openAIRequest);
// Messages are merged:
// messages: [
//   { role: 'user', content: 'First question\n\nSecond question' },
//   { role: 'assistant', content: 'Answer' }
// ]
```

## Streaming

```typescript
const openAIRequest = {
  model: 'gpt-4',
  messages: [...],
  stream: true  // Maps directly
};

const claudeRequest = formatRequestClaude(openAIRequest);
// Result includes:
// stream: true
```

## Default Values

- If `max_tokens` is not specified, defaults to 4096
- Unknown models default to `claude-3-sonnet-20240229`
- System messages are extracted and set in the `system` field

## Unsupported Parameters

The following OpenAI parameters have no Claude equivalents and are ignored:
- `n` (number of completions)
- `presence_penalty`
- `frequency_penalty`
- `logit_bias`
- `response_format`
- `seed`
- `logprobs`
- `top_logprobs`

## Error Handling

### Invalid Image URLs
```typescript
// HTTP URLs cannot be converted to base64
const openAIRequest = {
  model: 'gpt-4o',
  messages: [
    {
      role: 'user',
      content: [
        { type: 'text', text: 'What is this?' },
        {
          type: 'image_url',
          image_url: { url: 'https://example.com/image.png' }
        }
      ]
    }
  ]
};

const claudeRequest = formatRequestClaude(openAIRequest);
// Image is replaced with placeholder text:
// content: [
//   { type: 'text', text: 'What is this?' },
//   { type: 'text', text: '[Image: https://example.com/image.png]' }
// ]
```

## Complete Example

```typescript
import { formatRequestClaude } from './formatRequestClaude';

async function convertAndSendToClaude(openAIRequest) {
  // Convert OpenAI format to Claude format
  const claudeRequest = formatRequestClaude(openAIRequest);
  
  // Send to Claude API
  const response = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': process.env.CLAUDE_API_KEY,
      'anthropic-version': '2023-06-01'
    },
    body: JSON.stringify(claudeRequest)
  });
  
  return await response.json();
}

// Usage
const openAIRequest = {
  model: 'gpt-4-turbo',
  messages: [
    { role: 'system', content: 'You are a coding assistant.' },
    { role: 'user', content: 'Write a TypeScript function to sort an array.' }
  ],
  temperature: 0.2,
  max_tokens: 500
};

const claudeResponse = await convertAndSendToClaude(openAIRequest);
```
