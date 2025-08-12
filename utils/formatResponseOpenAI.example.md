# OpenAI to Claude Response Format Converter Examples

## Basic Text Response Conversion

### OpenAI Format:
```json
{
  "id": "chatcmpl-123456789",
  "object": "chat.completion",
  "created": 1702345678,
  "model": "gpt-4",
  "choices": [
    {
      "index": 0,
      "message": {
        "role": "assistant",
        "content": "Hello! How can I help you today?"
      },
      "finish_reason": "stop",
      "logprobs": null
    }
  ],
  "usage": {
    "prompt_tokens": 25,
    "completion_tokens": 10,
    "total_tokens": 35
  }
}
```

### Claude Format:
```json
{
  "id": "msg_abc123def456",
  "type": "message",
  "role": "assistant",
  "model": "claude-3-opus-20240229",
  "content": [
    {
      "type": "text",
      "text": "Hello! How can I help you today?"
    }
  ],
  "stop_reason": "end_turn",
  "stop_sequence": null,
  "usage": {
    "input_tokens": 25,
    "output_tokens": 10
  }
}
```

## Response with Tool Calls

### OpenAI Format:
```json
{
  "id": "chatcmpl-987654321",
  "object": "chat.completion",
  "created": 1702345678,
  "model": "gpt-4-turbo",
  "choices": [
    {
      "index": 0,
      "message": {
        "role": "assistant",
        "content": "I'll search for that information.",
        "tool_calls": [
          {
            "id": "call_abc123",
            "type": "function",
            "function": {
              "name": "search_web",
              "arguments": "{\"query\": \"latest AI news\", \"limit\": 5}"
            }
          }
        ]
      },
      "finish_reason": "tool_calls"
    }
  ],
  "usage": {
    "prompt_tokens": 30,
    "completion_tokens": 25,
    "total_tokens": 55
  }
}
```

### Claude Format:
```json
{
  "id": "msg_xyz789ghi012",
  "type": "message",
  "role": "assistant",
  "model": "claude-3-5-sonnet-20241022",
  "content": [
    {
      "type": "text",
      "text": "I'll search for that information."
    },
    {
      "type": "tool_use",
      "id": "call_abc123",
      "name": "search_web",
      "input": {
        "query": "latest AI news",
        "limit": 5
      }
    }
  ],
  "stop_reason": "tool_use",
  "stop_sequence": null,
  "usage": {
    "input_tokens": 30,
    "output_tokens": 25
  }
}
```

## Response with Images

### OpenAI Format:
```json
{
  "id": "chatcmpl-img123",
  "object": "chat.completion",
  "created": 1702345678,
  "model": "gpt-4-vision-preview",
  "choices": [
    {
      "index": 0,
      "message": {
        "role": "assistant",
        "content": [
          {
            "type": "text",
            "text": "Here's the analysis of the image:"
          },
          {
            "type": "image_url",
            "image_url": {
              "url": "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAUA...",
              "detail": "high"
            }
          }
        ]
      },
      "finish_reason": "stop"
    }
  ]
}
```

### Claude Format:
```json
{
  "id": "msg_img456def789",
  "type": "message",
  "role": "assistant",
  "model": "claude-3-opus-20240229",
  "content": [
    {
      "type": "text",
      "text": "Here's the analysis of the image:"
    },
    {
      "type": "image",
      "source": {
        "type": "base64",
        "media_type": "image/png",
        "data": "iVBORw0KGgoAAAANSUhEUgAAAAUA..."
      }
    }
  ],
  "stop_reason": "end_turn",
  "stop_sequence": null,
  "usage": {
    "input_tokens": 0,
    "output_tokens": 0
  }
}
```

## Stream Response Conversion

### OpenAI Stream Chunks:
```javascript
// Chunk 1: Start
{
  "id": "chatcmpl-stream123",
  "object": "chat.completion.chunk",
  "created": 1702345678,
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

// Chunk 2: Content
{
  "id": "chatcmpl-stream123",
  "object": "chat.completion.chunk",
  "created": 1702345678,
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

// Chunk 3: More Content
{
  "id": "chatcmpl-stream123",
  "object": "chat.completion.chunk",
  "created": 1702345678,
  "model": "gpt-4",
  "choices": [
    {
      "index": 0,
      "delta": {
        "content": "world!"
      },
      "finish_reason": null
    }
  ]
}

// Chunk 4: Finish
{
  "id": "chatcmpl-stream123",
  "object": "chat.completion.chunk",
  "created": 1702345678,
  "model": "gpt-4",
  "choices": [
    {
      "index": 0,
      "delta": {},
      "finish_reason": "stop"
    }
  ],
  "usage": {
    "prompt_tokens": 10,
    "completion_tokens": 3,
    "total_tokens": 13
  }
}
```

### Claude Stream Events:
```javascript
// Event 1: Message Start
{
  "type": "message_start",
  "message": {
    "id": "msg_stream456",
    "type": "message",
    "role": "assistant",
    "model": "claude-3-opus-20240229",
    "content": [],
    "stop_reason": null,
    "stop_sequence": null,
    "usage": {
      "input_tokens": 10,
      "output_tokens": 0
    }
  }
}

// Event 2: Content Block Start
{
  "type": "content_block_start",
  "index": 0,
  "content_block": {
    "type": "text",
    "text": ""
  }
}

// Event 3: Content Delta
{
  "type": "content_block_delta",
  "index": 0,
  "delta": {
    "type": "text_delta",
    "text": "Hello, "
  }
}

// Event 4: More Content Delta
{
  "type": "content_block_delta",
  "index": 0,
  "delta": {
    "type": "text_delta",
    "text": "world!"
  }
}

// Event 5: Content Block Stop
{
  "type": "content_block_stop",
  "index": 0
}

// Event 6: Message Delta
{
  "type": "message_delta",
  "delta": {
    "stop_reason": "end_turn",
    "stop_sequence": null
  },
  "usage": {
    "output_tokens": 3
  }
}

// Event 7: Message Stop
{
  "type": "message_stop"
}
```

## Model Mapping

| OpenAI Model | Claude Model |
|-------------|--------------|
| gpt-4 | claude-3-opus-20240229 |
| gpt-4-turbo | claude-3-5-sonnet-20241022 |
| gpt-4-turbo-preview | claude-3-5-sonnet-20241022 |
| gpt-4o | claude-3-5-sonnet-20241022 |
| gpt-4o-mini | claude-3-haiku-20240307 |
| gpt-3.5-turbo | claude-3-haiku-20240307 |
| gpt-3.5-turbo-16k | claude-3-haiku-20240307 |

## Finish Reason Mapping

| OpenAI finish_reason | Claude stop_reason |
|---------------------|-------------------|
| stop | end_turn |
| length | max_tokens |
| tool_calls | tool_use |
| function_call | tool_use |
| content_filter | end_turn |
| null | null |

## Error Response Conversion

### OpenAI Error:
```json
{
  "error": {
    "type": "invalid_request_error",
    "message": "Invalid API key provided",
    "code": "invalid_api_key"
  }
}
```

### Claude Error:
```json
{
  "type": "error",
  "error": {
    "type": "invalid_request_error",
    "message": "Invalid API key provided"
  }
}
```

## Usage Conversion

### OpenAI Usage:
```json
{
  "prompt_tokens": 100,
  "completion_tokens": 50,
  "total_tokens": 150
}
```

### Claude Usage:
```json
{
  "input_tokens": 100,
  "output_tokens": 50
}
```

## Legacy Function Call Support

### OpenAI Format (Legacy):
```json
{
  "id": "chatcmpl-legacy123",
  "object": "chat.completion",
  "created": 1702345678,
  "model": "gpt-4",
  "choices": [
    {
      "index": 0,
      "message": {
        "role": "assistant",
        "content": "Let me calculate that for you.",
        "function_call": {
          "name": "calculate",
          "arguments": "{\"expression\": \"2 + 2\"}"
        }
      },
      "finish_reason": "function_call"
    }
  ]
}
```

### Claude Format:
```json
{
  "id": "msg_legacy789",
  "type": "message",
  "role": "assistant",
  "model": "claude-3-opus-20240229",
  "content": [
    {
      "type": "text",
      "text": "Let me calculate that for you."
    },
    {
      "type": "tool_use",
      "id": "call_1234567890",
      "name": "calculate",
      "input": {
        "expression": "2 + 2"
      }
    }
  ],
  "stop_reason": "tool_use",
  "stop_sequence": null,
  "usage": {
    "input_tokens": 0,
    "output_tokens": 0
  }
}
```
