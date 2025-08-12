# Claude to OpenAI Response Format Converter Examples

## 基本文本响应转换

### Claude 响应（输入）
```json
{
  "id": "msg_01XQZj5mkmHH6g9N7DVtQzx7",
  "type": "message",
  "role": "assistant",
  "model": "claude-3-sonnet-20240229",
  "content": [
    {
      "type": "text",
      "text": "Hello! I'm Claude, an AI assistant. How can I help you today?"
    }
  ],
  "stop_reason": "end_turn",
  "stop_sequence": null,
  "usage": {
    "input_tokens": 15,
    "output_tokens": 20
  }
}
```

### OpenAI 响应（输出）
```json
{
  "id": "chatcmpl-1734567890abcdefg",
  "object": "chat.completion",
  "created": 1734567890,
  "model": "gpt-4",
  "choices": [
    {
      "index": 0,
      "message": {
        "role": "assistant",
        "content": "Hello! I'm Claude, an AI assistant. How can I help you today?"
      },
      "finish_reason": "stop",
      "logprobs": null
    }
  ],
  "usage": {
    "prompt_tokens": 15,
    "completion_tokens": 20,
    "total_tokens": 35
  },
  "system_fingerprint": "claude_msg_01XQZj5mkmHH6g9N7DVtQzx7"
}
```

## 工具调用响应转换（tool_calls 格式）

### Claude 响应（输入）
```json
{
  "id": "msg_01YRbK9Zj5mkmHH6g9N7DVtQ",
  "type": "message",
  "role": "assistant",
  "model": "claude-3-5-sonnet-20241022",
  "content": [
    {
      "type": "text",
      "text": "I'll help you get the current weather information for New York."
    },
    {
      "type": "tool_use",
      "id": "toolu_01A09q90qw90lq917835lq9",
      "name": "get_weather",
      "input": {
        "location": "New York",
        "units": "fahrenheit"
      }
    }
  ],
  "stop_reason": "tool_use",
  "stop_sequence": null,
  "usage": {
    "input_tokens": 50,
    "output_tokens": 30
  }
}
```

### OpenAI 响应（输出）
```json
{
  "id": "chatcmpl-1734567891hijklmn",
  "object": "chat.completion",
  "created": 1734567891,
  "model": "gpt-4-turbo",
  "choices": [
    {
      "index": 0,
      "message": {
        "role": "assistant",
        "content": "I'll help you get the current weather information for New York.",
        "tool_calls": [
          {
            "id": "toolu_01A09q90qw90lq917835lq9",
            "type": "function",
            "function": {
              "name": "get_weather",
              "arguments": "{\"location\":\"New York\",\"units\":\"fahrenheit\"}"
            }
          }
        ]
      },
      "finish_reason": "tool_calls",
      "logprobs": null
    }
  ],
  "usage": {
    "prompt_tokens": 50,
    "completion_tokens": 30,
    "total_tokens": 80
  },
  "system_fingerprint": "claude_msg_01YRbK9Zj5mkmHH6g9N7DVtQ"
}
```

## 工具调用响应转换（function_call 格式）

当原始请求使用了 `functions` 参数时，响应会使用旧版的 `function_call` 格式：

### OpenAI 响应（输出）
```json
{
  "id": "chatcmpl-1734567892opqrstu",
  "object": "chat.completion",
  "created": 1734567892,
  "model": "gpt-4",
  "choices": [
    {
      "index": 0,
      "message": {
        "role": "assistant",
        "content": null,
        "function_call": {
          "name": "get_weather",
          "arguments": "{\"location\":\"New York\",\"units\":\"fahrenheit\"}"
        }
      },
      "finish_reason": "function_call",
      "logprobs": null
    }
  ],
  "usage": {
    "prompt_tokens": 50,
    "completion_tokens": 30,
    "total_tokens": 80
  },
  "system_fingerprint": "claude_msg_01YRbK9Zj5mkmHH6g9N7DVtQ"
}
```

## 流式响应转换

### Claude 流事件（输入）
```javascript
// Event 1: message_start
{
  "type": "message_start",
  "message": {
    "id": "msg_01Z",
    "type": "message",
    "role": "assistant",
    "model": "claude-3-sonnet-20240229",
    "content": [],
    "stop_reason": null,
    "stop_sequence": null,
    "usage": {
      "input_tokens": 25,
      "output_tokens": 0
    }
  }
}

// Event 2: content_block_start
{
  "type": "content_block_start",
  "index": 0,
  "content_block": {
    "type": "text",
    "text": ""
  }
}

// Event 3: content_block_delta
{
  "type": "content_block_delta",
  "index": 0,
  "delta": {
    "type": "text_delta",
    "text": "Hello, "
  }
}

// Event 4: content_block_delta
{
  "type": "content_block_delta",
  "index": 0,
  "delta": {
    "type": "text_delta",
    "text": "how can I help?"
  }
}
```

### OpenAI 流块（输出）
```javascript
// Chunk 1
{
  "id": "chatcmpl-1734567893vwxyz",
  "object": "chat.completion.chunk",
  "created": 1734567893,
  "model": "gpt-4",
  "choices": [
    {
      "index": 0,
      "delta": {
        "role": "assistant",
        "content": ""
      },
      "finish_reason": null
    }
  ]
}

// Chunk 2
{
  "id": "chatcmpl-1734567893vwxyz",
  "object": "chat.completion.chunk",
  "created": 1734567893,
  "model": "gpt-4",
  "choices": [
    {
      "index": 0,
      "delta": {
        "content": "Hello, "
      },
      "finish_reason": null
    }
  ]
}

// Chunk 3
{
  "id": "chatcmpl-1734567893vwxyz",
  "object": "chat.completion.chunk",
  "created": 1734567893,
  "model": "gpt-4",
  "choices": [
    {
      "index": 0,
      "delta": {
        "content": "how can I help?"
      },
      "finish_reason": null
    }
  ]
}
```

## 使用示例

### 基本用法
```typescript
import { formatResponseClaude } from './formatResponseClaude';

// 简单转换
const claudeResponse = /* Claude API 响应 */;
const openAIResponse = formatResponseClaude(claudeResponse);
```

### 带原始请求的转换（用于决定工具调用格式）
```typescript
import { formatResponseClaude } from './formatResponseClaude';

// 原始 OpenAI 请求
const originalRequest = {
  model: "gpt-4",
  messages: [...],
  functions: [/* 函数定义 */]  // 使用旧版 functions 格式
};

// 转换时会使用 function_call 格式而不是 tool_calls
const openAIResponse = formatResponseClaude(claudeResponse, originalRequest);
```

### 流式响应处理
```typescript
import { formatStreamChunkClaude, parseAndConvertStreamChunk } from './formatResponseClaude';

// 维护转换状态
let state = {
  messageId: '',
  created: 0,
  model: ''
};

// 处理每个流事件
function handleStreamEvent(sseData: string) {
  const { chunk, updatedState } = parseAndConvertStreamChunk(sseData, state);
  state = updatedState;
  
  if (chunk) {
    // 发送转换后的 OpenAI 格式块
    sendOpenAIChunk(chunk);
  }
}
```

### 错误处理
```typescript
import { convertClaudeError } from './formatResponseClaude';

try {
  // API 调用
} catch (claudeError) {
  // 转换为 OpenAI 错误格式
  const openAIError = convertClaudeError(claudeError);
  throw openAIError;
}
```

## 模型映射

转换器会自动映射 Claude 模型到对应的 OpenAI 模型：

| Claude 模型 | OpenAI 模型 |
|------------|------------|
| claude-3-5-sonnet-20241022 | gpt-4-turbo |
| claude-3-opus-20240229 | gpt-4 |
| claude-3-sonnet-20240229 | gpt-4 |
| claude-3-haiku-20240307 | gpt-3.5-turbo |
| claude-2.1 | gpt-3.5-turbo |
| claude-2.0 | gpt-3.5-turbo |
| claude-instant-1.2 | gpt-3.5-turbo |

## finish_reason 映射

| Claude stop_reason | OpenAI finish_reason | 条件 |
|-------------------|---------------------|------|
| end_turn | stop | 无工具调用 |
| end_turn | tool_calls | 有工具调用 |
| max_tokens | length | - |
| stop_sequence | stop | - |
| tool_use | tool_calls | - |
| null | null | - |

## 注意事项

1. **Content 格式**：Claude 的 content 是数组，可能包含多个文本块和工具调用，转换器会智能合并这些内容。

2. **工具调用格式选择**：
   - 如果原始请求使用 `tools` 参数，响应使用 `tool_calls` 格式
   - 如果原始请求使用 `functions` 参数，响应使用 `function_call` 格式
   - 如果没有原始请求信息，默认使用 `tool_calls` 格式

3. **ID 生成**：OpenAI 格式的 ID 会自动生成为 `chatcmpl-{timestamp}{random}` 格式。

4. **System Fingerprint**：使用 Claude 的消息 ID 作为 system_fingerprint，格式为 `claude_{message_id}`。

5. **流式响应状态**：处理流式响应时需要维护状态对象，以便正确组装工具调用参数等信息。
