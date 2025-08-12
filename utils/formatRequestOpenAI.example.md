# Claude to OpenAI Request Format Converter - Usage Examples

## 基本使用

### 1. 简单文本消息转换

```typescript
import { formatRequestOpenAI } from './formatRequestOpenAI';
import type { ClaudeRequest } from './types';

// Claude 请求格式
const claudeRequest: ClaudeRequest = {
  model: 'claude-3-opus-20240229',
  messages: [
    {
      role: 'user',
      content: 'Hello, how are you?'
    }
  ],
  max_tokens: 100,
  temperature: 0.7
};

// 转换为 OpenAI 格式
const openAIRequest = formatRequestOpenAI(claudeRequest);

// 输出结果：
// {
//   model: 'gpt-4-turbo',
//   messages: [
//     { role: 'user', content: 'Hello, how are you?' }
//   ],
//   max_tokens: 100,
//   temperature: 0.7
// }
```

### 2. 带系统提示的转换

```typescript
const claudeRequest: ClaudeRequest = {
  model: 'claude-3-sonnet-20240229',
  system: 'You are a helpful coding assistant. Always provide code examples.',
  messages: [
    {
      role: 'user',
      content: 'Explain Python decorators'
    }
  ],
  max_tokens: 500
};

const openAIRequest = formatRequestOpenAI(claudeRequest);

// 输出结果：
// {
//   model: 'gpt-4',
//   messages: [
//     { role: 'system', content: 'You are a helpful coding assistant. Always provide code examples.' },
//     { role: 'user', content: 'Explain Python decorators' }
//   ],
//   max_tokens: 500
// }
```

### 3. 多模态内容（文本+图像）

```typescript
const claudeRequest: ClaudeRequest = {
  model: 'claude-3-opus-20240229',
  messages: [
    {
      role: 'user',
      content: [
        {
          type: 'text',
          text: 'What can you see in this image?'
        },
        {
          type: 'image',
          source: {
            type: 'base64',
            media_type: 'image/jpeg',
            data: 'base64EncodedImageData...'
          }
        }
      ]
    }
  ],
  max_tokens: 300
};

const openAIRequest = formatRequestOpenAI(claudeRequest);

// 输出结果：
// {
//   model: 'gpt-4-turbo',
//   messages: [
//     {
//       role: 'user',
//       content: [
//         { type: 'text', text: 'What can you see in this image?' },
//         {
//           type: 'image_url',
//           image_url: {
//             url: 'data:image/jpeg;base64,base64EncodedImageData...',
//             detail: 'auto'
//           }
//         }
//       ]
//     }
//   ],
//   max_tokens: 300
// }
```

## 工具调用转换

### 4. 工具定义转换

```typescript
const claudeRequest: ClaudeRequest = {
  model: 'claude-3-opus-20240229',
  messages: [
    {
      role: 'user',
      content: 'What is the weather in San Francisco?'
    }
  ],
  max_tokens: 100,
  tools: [
    {
      name: 'get_weather',
      description: 'Get current weather for a location',
      input_schema: {
        type: 'object',
        properties: {
          location: {
            type: 'string',
            description: 'City and state, e.g. San Francisco, CA'
          },
          unit: {
            type: 'string',
            enum: ['celsius', 'fahrenheit']
          }
        },
        required: ['location']
      }
    }
  ],
  tool_choice: { type: 'auto' }
};

const openAIRequest = formatRequestOpenAI(claudeRequest);

// 输出结果：
// {
//   model: 'gpt-4-turbo',
//   messages: [...],
//   max_tokens: 100,
//   tools: [
//     {
//       type: 'function',
//       function: {
//         name: 'get_weather',
//         description: 'Get current weather for a location',
//         parameters: {
//           type: 'object',
//           properties: {
//             location: {
//               type: 'string',
//               description: 'City and state, e.g. San Francisco, CA'
//             },
//             unit: {
//               type: 'string',
//               enum: ['celsius', 'fahrenheit']
//             }
//           },
//           required: ['location']
//         }
//       }
//     }
//   ],
//   tool_choice: 'auto'
// }
```

### 5. 工具调用和结果

```typescript
const claudeRequest: ClaudeRequest = {
  model: 'claude-3-opus-20240229',
  messages: [
    {
      role: 'user',
      content: 'What is the weather?'
    },
    {
      role: 'assistant',
      content: [
        {
          type: 'text',
          text: 'I\'ll check the weather for you.'
        },
        {
          type: 'tool_use',
          id: 'call_abc123',
          name: 'get_weather',
          input: {
            location: 'San Francisco, CA',
            unit: 'fahrenheit'
          }
        }
      ]
    },
    {
      role: 'user',
      content: [
        {
          type: 'tool_result',
          tool_use_id: 'call_abc123',
          content: 'Temperature: 72°F, Sunny'
        }
      ]
    }
  ],
  max_tokens: 100
};

const openAIRequest = formatRequestOpenAI(claudeRequest);

// 输出结果包含：
// - assistant 消息带 tool_calls
// - tool 角色消息带结果
```

## 流式传输支持

### 6. 启用流式传输

```typescript
const claudeRequest: ClaudeRequest = {
  model: 'claude-3-5-sonnet-20241022',
  messages: [
    {
      role: 'user',
      content: 'Write a long story about a robot'
    }
  ],
  max_tokens: 2000,
  stream: true,  // 启用流式传输
  temperature: 0.8
};

const openAIRequest = formatRequestOpenAI(claudeRequest);

// 输出结果：
// {
//   model: 'gpt-4-turbo',
//   messages: [...],
//   max_tokens: 2000,
//   stream: true,  // 流式传输标记被保留
//   temperature: 0.8
// }
```

## 模型映射

### 7. 自动模型映射

```typescript
// Claude 模型自动映射到相应的 OpenAI 模型
const modelMappings = [
  { claude: 'claude-3-opus-20240229', openai: 'gpt-4-turbo' },
  { claude: 'claude-3-sonnet-20240229', openai: 'gpt-4' },
  { claude: 'claude-3-haiku-20240307', openai: 'gpt-3.5-turbo' },
  { claude: 'claude-3-5-sonnet-20241022', openai: 'gpt-4-turbo' },
  { claude: 'claude-3-5-haiku-20241022', openai: 'gpt-4' },
  { claude: 'claude-2.1', openai: 'gpt-4' },
  { claude: 'claude-2.0', openai: 'gpt-4' },
  { claude: 'claude-instant-1.2', openai: 'gpt-3.5-turbo' }
];
```

## 参数映射

### 8. 完整参数转换

```typescript
const claudeRequest: ClaudeRequest = {
  model: 'claude-3-opus-20240229',
  messages: [
    {
      role: 'user',
      content: 'Tell me a joke'
    }
  ],
  max_tokens: 150,
  temperature: 0.9,        // 温度参数（0-2）
  top_p: 0.95,            // Top-p 采样
  stop_sequences: ['END', '\n\n'],  // 停止序列
  stream: false,          // 非流式
  metadata: {
    user_id: 'user_123'   // 用户元数据
  }
};

const openAIRequest = formatRequestOpenAI(claudeRequest);

// 输出结果：
// {
//   model: 'gpt-4-turbo',
//   messages: [...],
//   max_tokens: 150,
//   temperature: 0.9,
//   top_p: 0.95,
//   stop: ['END', '\n\n'],  // stop_sequences -> stop
//   stream: false,
//   user: 'user_123'        // metadata.user_id -> user
// }
```

## 验证和错误处理

### 9. 请求验证

```typescript
import { validateClaudeRequest, convertClaudeToOpenAI } from './formatRequestOpenAI';

const claudeRequest: ClaudeRequest = {
  model: 'claude-3-opus-20240229',
  messages: [],  // 空消息数组
  max_tokens: 100
};

// 验证请求
if (!validateClaudeRequest(claudeRequest)) {
  console.error('Invalid Claude request');
}

// 使用带验证的转换
const result = convertClaudeToOpenAI(claudeRequest);
if (result === null) {
  console.error('Failed to convert request');
} else {
  // 使用转换后的请求
  console.log(result);
}
```

### 10. 批量转换

```typescript
// 批量处理多个请求
const claudeRequests: ClaudeRequest[] = [
  /* ... multiple requests ... */
];

const openAIRequests = claudeRequests
  .filter(validateClaudeRequest)
  .map(formatRequestOpenAI);
```

## 注意事项

1. **Claude 特有参数**：`top_k` 参数在 OpenAI API 中没有直接对应，会被忽略
2. **消息角色**：Claude 只支持 `user` 和 `assistant`，系统提示会被转换为 `system` 角色消息
3. **工具调用**：Claude 的 `tool_use` 和 `tool_result` 会被转换为 OpenAI 的 `tool_calls` 和 `tool` 消息
4. **图像格式**：Claude 的 base64 图像会被转换为 OpenAI 的 data URL 格式
5. **错误处理**：建议使用 `convertClaudeToOpenAI` 函数，它包含验证和错误处理

## TypeScript 类型支持

所有函数都完全支持 TypeScript 类型：

```typescript
import type { 
  ClaudeRequest, 
  OpenAIRequest,
  RequestConverter 
} from './types';

// 类型安全的转换
const converter: RequestConverter<ClaudeRequest, OpenAIRequest> = formatRequestOpenAI;
```
