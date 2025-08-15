/**
 * OpenAI to Claude response format converter
 * @author jizhejiang
 * @date 2025-08-11
 * @update 2025-08-12
 * @description Converts OpenAI API response format to Claude format, including stop_reason mapping,
 * usage conversion, and tool_use transformation
 *
 * Model Mapping Strategy (v2.0.0+):
 * - Primary: Direct pass-through - model names are transmitted without conversion
 * - Fallback: When mapping is needed (e.g., legacy compatibility):
 *   - gpt-4 → claude-3-opus-20240229
 *   - gpt-4-turbo → claude-3-sonnet-20240229
 *   - gpt-3.5-turbo → claude-3-haiku-20240307
 *   - Other models → pass through unchanged
 */

import type {
  OpenAIResponse,
  OpenAIMessage,
  OpenAIMessageContent,
  OpenAIImageContent,
  OpenAIToolCall,
  OpenAIStreamChunk,
  OpenAIUsage,
  ClaudeResponse,
  ClaudeContent,
  ClaudeImageContent,
  ClaudeToolUseContent,
  ClaudeStreamEvent,
  ClaudeStreamMessageStart,
  ClaudeStreamContentBlockStart,
  ClaudeStreamContentBlockDelta,
  ClaudeStreamContentBlockStop,
  ClaudeStreamMessageDelta,
  ClaudeStreamMessageStop,
  ResponseConverter,
  StreamConversionState,
  ClaudeError,
} from './types';

// Model mapping removed - now passing model names directly without conversion

/**
 * Generate Claude-style message ID
 */
function generateClaudeId(): string {
  const timestamp = Date.now();
  const randomStr = Math.random().toString(36).substring(2, 15);
  return `msg_${randomStr}${timestamp}`;
}

/**
 * Map OpenAI finish_reason to Claude stop_reason
 */
function mapFinishReasonToStopReason(
  finishReason: OpenAIResponse['choices'][0]['finish_reason']
): ClaudeResponse['stop_reason'] {
  if (!finishReason) {
    return null;
  }

  switch (finishReason) {
    case 'stop':
      return 'end_turn';
    case 'length':
      return 'max_tokens';
    case 'tool_calls':
    case 'function_call':
      return 'tool_use';
    case 'content_filter':
      // Claude doesn't have a direct equivalent for content_filter
      return 'end_turn';
    default:
      return 'end_turn';
  }
}

/**
 * Convert OpenAI usage to Claude usage format
 */
function convertUsage(openAIUsage?: OpenAIUsage): ClaudeResponse['usage'] {
  if (!openAIUsage) {
    // Provide default values if usage is not available
    return {
      input_tokens: 0,
      output_tokens: 0,
    };
  }

  return {
    input_tokens: openAIUsage.prompt_tokens,
    output_tokens: openAIUsage.completion_tokens,
  };
}

/**
 * Extract base64 and media type from data URL
 */
function extractBase64FromDataUrl(dataUrl: string): { mediaType: string; data: string } | null {
  const match = dataUrl.match(/^data:([^;]+);base64,(.+)$/);
  if (!match) {
    return null;
  }
  return {
    mediaType: match[1],
    data: match[2],
  };
}

/**
 * Map media type to Claude supported format
 */
function mapMediaType(mediaType: string): 'image/jpeg' | 'image/png' | 'image/gif' | 'image/webp' {
  const lowerMediaType = mediaType.toLowerCase();

  if (lowerMediaType.includes('jpeg') || lowerMediaType.includes('jpg')) {
    return 'image/jpeg';
  } else if (lowerMediaType.includes('png')) {
    return 'image/png';
  } else if (lowerMediaType.includes('gif')) {
    return 'image/gif';
  } else if (lowerMediaType.includes('webp')) {
    return 'image/webp';
  }

  // Default to jpeg if unknown
  return 'image/jpeg';
}

/**
 * Convert OpenAI image content to Claude format
 */
function convertImageContent(content: OpenAIImageContent): ClaudeImageContent | null {
  const { image_url } = content;

  // Extract base64 data from URL
  const base64Data = extractBase64FromDataUrl(image_url.url);
  if (!base64Data) {
    // If it's an HTTP(S) URL, pass through as Claude URL source
    if (image_url.url.startsWith('http://') || image_url.url.startsWith('https://')) {
      return {
        type: 'image',
        source: {
          type: 'url',
          url: image_url.url,
        },
      } as ClaudeImageContent;
    }
    console.warn('Failed to extract base64 data from image URL');
    return null;
  }

  return {
    type: 'image',
    source: {
      type: 'base64',
      media_type: mapMediaType(base64Data.mediaType),
      data: base64Data.data,
    },
  };
}

/**
 * Convert OpenAI tool calls to Claude tool use content
 */
function convertToolCalls(toolCalls: OpenAIToolCall[]): ClaudeToolUseContent[] {
  const claudeToolUses: ClaudeToolUseContent[] = [];

  for (const toolCall of toolCalls) {
    try {
      const input = JSON.parse(toolCall.function.arguments);
      claudeToolUses.push({
        type: 'tool_use',
        id: toolCall.id,
        name: toolCall.function.name,
        input,
      });
    } catch (error) {
      console.error('Failed to parse tool call arguments:', {
        error: error instanceof Error ? error.message : String(error),
        stack: error instanceof Error ? error.stack : undefined,
        toolCallSummary: {
          id: toolCall.id,
          name: toolCall.function.name,
          argumentsPreview: toolCall.function.arguments?.substring(0, 200) || '',
        },
      });
      // Create with empty input if parsing fails
      claudeToolUses.push({
        type: 'tool_use',
        id: toolCall.id,
        name: toolCall.function.name,
        input: {},
      });
    }
  }

  return claudeToolUses;
}

/**
 * Convert OpenAI message content to Claude content format
 */
function convertMessageContent(
  content: OpenAIMessageContent,
  toolCalls?: OpenAIToolCall[],
  functionCall?: OpenAIMessage['function_call']
): ClaudeContent[] {
  const claudeContent: ClaudeContent[] = [];

  // Handle string content
  if (typeof content === 'string') {
    if (content) {
      claudeContent.push({
        type: 'text',
        text: content,
      });
    }
  } else if (Array.isArray(content)) {
    // Handle content array
    for (const item of content) {
      if (item.type === 'text') {
        claudeContent.push({
          type: 'text',
          text: item.text,
        });
      } else if (item.type === 'image_url') {
        const imageContent = convertImageContent(item);
        if (imageContent) {
          claudeContent.push(imageContent);
        }
      }
    }
  }

  // Handle tool calls
  if (toolCalls && toolCalls.length > 0) {
    const toolUses = convertToolCalls(toolCalls);
    claudeContent.push(...toolUses);
  }

  // Handle legacy function_call format
  if (functionCall) {
    try {
      const input = JSON.parse(functionCall.arguments);
      claudeContent.push({
        type: 'tool_use',
        id: `call_${Date.now()}`,
        name: functionCall.name,
        input,
      });
    } catch (error) {
      console.error('Failed to parse function call arguments:', {
        error: error instanceof Error ? error.message : String(error),
        stack: error instanceof Error ? error.stack : undefined,
        functionCallSummary: {
          name: functionCall.name,
          argumentsPreview: functionCall.arguments?.substring(0, 200) || '',
        },
      });
      claudeContent.push({
        type: 'tool_use',
        id: `call_${Date.now()}`,
        name: functionCall.name,
        input: {},
      });
    }
  }

  // Ensure we always have at least some content
  if (claudeContent.length === 0) {
    claudeContent.push({
      type: 'text',
      text: '',
    });
  }

  return claudeContent;
}

/**
 * Map OpenAI model to Claude model
 *
 * Current implementation: Direct pass-through without any conversion.
 * Returns the input model name as-is to support flexible model routing.
 *
 * Note: If model mapping is needed in the future, implement the mapping logic here.
 * For scenarios where no model name is provided, a default mapping could be used.
 *
 * @param openAIModel - The OpenAI model name to map
 * @returns The model name unchanged (pass-through)
 */
function mapModelToClaude(openAIModel: string): string {
  // Direct pass-through - no conversion
  // If the model name is not in a predefined mapping, return the original value
  return openAIModel;
}

/**
 * Convert OpenAI response to Claude format
 * Main converter function that handles all aspects of the conversion
 */
export const formatResponseOpenAI: ResponseConverter<OpenAIResponse, ClaudeResponse> = (
  response: OpenAIResponse
): ClaudeResponse => {
  // Get the first choice (Claude doesn't support multiple choices)
  const choice = response.choices[0];
  if (!choice) {
    throw new Error('No choices available in OpenAI response');
  }

  const { message } = choice;

  // Convert message content to Claude format
  const claudeContent = convertMessageContent(
    message.content,
    message.tool_calls,
    message.function_call
  );

  // Map the model
  const claudeModel = mapModelToClaude(response.model);

  // Build Claude response
  const claudeResponse: ClaudeResponse = {
    id: generateClaudeId(),
    type: 'message',
    role: 'assistant',
    model: claudeModel,
    content: claudeContent,
    stop_reason: mapFinishReasonToStopReason(choice.finish_reason),
    stop_sequence: null,
    usage: convertUsage(response.usage),
  };

  return claudeResponse;
};

/**
 * Stream conversion state for OpenAI to Claude
 */
interface OpenAIToClaudeStreamState extends StreamConversionState {
  currentContent: string;
  currentToolCall?: {
    id: string;
    name: string;
    arguments: string;
  };
  contentBlockIndex: number;
  hasStarted: boolean;
}

/**
 * Convert OpenAI stream chunk to Claude stream event
 */
export const formatStreamChunkOpenAI = (
  chunk: OpenAIStreamChunk,
  state: OpenAIToClaudeStreamState
): ClaudeStreamEvent[] | null => {
  const events: ClaudeStreamEvent[] = [];

  // Initialize state if needed
  if (!state.hasStarted) {
    state.hasStarted = true;
    state.contentBlockIndex = 0;
    state.currentContent = '';

    // Send message_start event
    const messageStart: ClaudeStreamMessageStart = {
      type: 'message_start',
      message: {
        id: generateClaudeId(),
        type: 'message',
        role: 'assistant',
        model: mapModelToClaude(chunk.model),
        content: [],
        stop_reason: null,
        stop_sequence: null,
        usage: {
          input_tokens: chunk.usage?.prompt_tokens || 0,
          output_tokens: 0,
        },
      },
    };
    events.push(messageStart);
  }

  // Process delta
  const delta = chunk.choices[0]?.delta;
  if (!delta) {
    return events.length > 0 ? events : null;
  }

  // Handle text content
  if (delta.content !== undefined) {
    if (delta.content && !state.currentContent) {
      // Start new content block
      const blockStart: ClaudeStreamContentBlockStart = {
        type: 'content_block_start',
        index: state.contentBlockIndex,
        content_block: {
          type: 'text',
          text: '',
        },
      };
      events.push(blockStart);
      state.currentContent = delta.content;
    }

    if (delta.content) {
      // Send content delta
      const contentDelta: ClaudeStreamContentBlockDelta = {
        type: 'content_block_delta',
        index: state.contentBlockIndex,
        delta: {
          type: 'text_delta',
          text: delta.content,
        },
      };
      events.push(contentDelta);
      state.currentContent += delta.content;
    }
  }

  // Handle tool calls
  if (delta.tool_calls && delta.tool_calls.length > 0) {
    for (const toolCall of delta.tool_calls) {
      if (toolCall.function?.name && !state.currentToolCall) {
        // Close text content block if open
        if (state.currentContent) {
          const blockStop: ClaudeStreamContentBlockStop = {
            type: 'content_block_stop',
            index: state.contentBlockIndex,
          };
          events.push(blockStop);
          state.contentBlockIndex++;
          state.currentContent = '';
        }

        // Start new tool use block
        state.currentToolCall = {
          id: toolCall.id || `tool_${Date.now()}`,
          name: toolCall.function.name,
          arguments: '',
        };

        const toolBlockStart: ClaudeStreamContentBlockStart = {
          type: 'content_block_start',
          index: state.contentBlockIndex,
          content_block: {
            type: 'tool_use',
            id: state.currentToolCall.id,
            name: state.currentToolCall.name,
            input: {},
          },
        };
        events.push(toolBlockStart);
      }

      if (toolCall.function?.arguments && state.currentToolCall) {
        // Send tool arguments delta
        state.currentToolCall.arguments += toolCall.function.arguments;

        const toolDelta: ClaudeStreamContentBlockDelta = {
          type: 'content_block_delta',
          index: state.contentBlockIndex,
          delta: {
            type: 'input_json_delta',
            partial_json: toolCall.function.arguments,
          },
        };
        events.push(toolDelta);
      }
    }
  }

  // Handle function_call (legacy format)
  if (delta.function_call) {
    if (delta.function_call.name && !state.currentToolCall) {
      // Close text content block if open
      if (state.currentContent) {
        const blockStop: ClaudeStreamContentBlockStop = {
          type: 'content_block_stop',
          index: state.contentBlockIndex,
        };
        events.push(blockStop);
        state.contentBlockIndex++;
        state.currentContent = '';
      }

      // Start new tool use block
      state.currentToolCall = {
        id: `func_${Date.now()}`,
        name: delta.function_call.name,
        arguments: '',
      };

      const toolBlockStart: ClaudeStreamContentBlockStart = {
        type: 'content_block_start',
        index: state.contentBlockIndex,
        content_block: {
          type: 'tool_use',
          id: state.currentToolCall.id,
          name: state.currentToolCall.name,
          input: {},
        },
      };
      events.push(toolBlockStart);
    }

    if (delta.function_call.arguments && state.currentToolCall) {
      // Send tool arguments delta
      state.currentToolCall.arguments += delta.function_call.arguments;

      const toolDelta: ClaudeStreamContentBlockDelta = {
        type: 'content_block_delta',
        index: state.contentBlockIndex,
        delta: {
          type: 'input_json_delta',
          partial_json: delta.function_call.arguments,
        },
      };
      events.push(toolDelta);
    }
  }

  // Handle finish reason or detect end conditions
  const finishReason = chunk.choices[0]?.finish_reason;
  const hasUsage = !!chunk.usage;
  const isLastChunk = finishReason || hasUsage;

  if (finishReason || isLastChunk) {
    // Close any open content blocks
    if (state.currentContent || state.currentToolCall) {
      const blockStop: ClaudeStreamContentBlockStop = {
        type: 'content_block_stop',
        index: state.contentBlockIndex,
      };
      events.push(blockStop);
      state.contentBlockIndex++;
      state.currentContent = '';
      state.currentToolCall = undefined;
    }

    // Send message delta with stop reason (default to 'end_turn' if null)
    const stopReason = mapFinishReasonToStopReason(finishReason) || 'end_turn';
    const messageDelta: ClaudeStreamMessageDelta = {
      type: 'message_delta',
      delta: {
        stop_reason: stopReason,
        stop_sequence: null,
      },
      usage: {
        output_tokens: chunk.usage?.completion_tokens || 0,
      },
    };
    events.push(messageDelta);

    // Send message stop
    const messageStop: ClaudeStreamMessageStop = {
      type: 'message_stop',
    };
    events.push(messageStop);

    console.log('OpenAI to Claude: Message completion detected', {
      finishReason,
      hasUsage,
      stopReason,
      isLastChunk,
    });
  }

  return events.length > 0 ? events : null;
};

/**
 * Initialize stream state for OpenAI to Claude conversion
 */
export function initializeOpenAIStreamState(): OpenAIToClaudeStreamState {
  return {
    messageId: generateClaudeId(),
    created: Math.floor(Date.now() / 1000),
    model: '',
    currentContent: '',
    contentBlockIndex: 0,
    hasStarted: false,
  };
}

/**
 * Parse SSE data and convert OpenAI stream to Claude format
 */
export function parseAndConvertOpenAIStreamChunk(
  sseData: string,
  state: OpenAIToClaudeStreamState
): { events: ClaudeStreamEvent[] | null; updatedState: OpenAIToClaudeStreamState } {
  try {
    // Handle the [DONE] message
    if (sseData.trim() === '[DONE]') {
      return { events: null, updatedState: state };
    }

    const openAIChunk = JSON.parse(sseData) as OpenAIStreamChunk;
    const events = formatStreamChunkOpenAI(openAIChunk, state);
    return { events, updatedState: state };
  } catch (error) {
    console.error('Failed to parse OpenAI stream chunk:', {
      error: error instanceof Error ? error.message : String(error),
      stack: error instanceof Error ? error.stack : undefined,
      eventSummary: {
        dataLength: sseData.length,
        dataPreview: sseData.substring(0, 200),
        state: {
          messageId: state.messageId,
          model: state.model,
          hasStarted: state.hasStarted,
        },
      },
    });
    return { events: null, updatedState: state };
  }
}

/**
 * Convert OpenAI error to Claude error format
 */
export function convertOpenAIError(openAIError: unknown): ClaudeError {
  // Handle OpenAI error format
  if (typeof openAIError === 'object' && openAIError !== null) {
    const maybeWrapped = (openAIError as { error?: unknown }).error;

    if (typeof maybeWrapped === 'object' && maybeWrapped !== null) {
      const wrapped = maybeWrapped as {
        message?: unknown;
        type?: unknown;
        code?: unknown;
      };

      let typeValue: string;
      if (typeof wrapped.type === 'string') {
        typeValue = wrapped.type;
      } else if (typeof wrapped.code === 'string') {
        typeValue = wrapped.code;
      } else {
        typeValue = 'api_error';
      }

      const messageValue =
        typeof wrapped.message === 'string' ? wrapped.message : 'An error occurred';

      return {
        type: 'error',
        error: {
          type: typeValue,
          message: messageValue,
        },
      };
    }
  }

  // Fallback for unexpected error formats
  return {
    type: 'error',
    error: {
      type: 'api_error',
      message:
        typeof (openAIError as { message?: unknown })?.message === 'string'
          ? (openAIError as { message: string }).message
          : 'An error occurred',
    },
  };
}

// Export additional utilities for testing
export const __testing = {
  generateClaudeId,
  mapFinishReasonToStopReason,
  convertUsage,
  extractBase64FromDataUrl,
  mapMediaType,
  convertImageContent,
  convertToolCalls,
  convertMessageContent,
  mapModelToClaude,
};
