/**
 * Claude to OpenAI response format converter
 * @author jizhejiang
 * @date 2025-08-11
 * @update 2025-08-12
 * @description Converts Claude API response format to OpenAI format, including finish_reason mapping,
 * usage conversion, and function_call/tool_calls transformation
 * 
 * Model Mapping Strategy (v2.0.0+):
 * - Primary: Direct pass-through - model names are transmitted without conversion
 * - Fallback: When mapping is needed (e.g., legacy compatibility):
 *   - claude-3-opus-20240229 → gpt-4
 *   - claude-3-sonnet-20240229 → gpt-4-turbo
 *   - claude-3-haiku-20240307 → gpt-3.5-turbo
 *   - Other models → pass through unchanged
 */

import type {
  ClaudeResponse,
  ClaudeContent,
  ClaudeToolUseContent,
  ClaudeStreamEvent,
  ClaudeStreamMessageStart,
  ClaudeStreamContentBlockStart,
  ClaudeStreamContentBlockDelta,
  ClaudeStreamMessageDelta,
  OpenAIResponse,
  OpenAIMessage,
  OpenAIToolCall,
  OpenAIStreamChunk,
  OpenAIStreamDelta,
  OpenAIUsage,
  OpenAIRequest,
  ResponseConverter,
  StreamConverter,
  StreamConversionState,
} from './types';

// Model mapping removed - now passing model names directly without conversion

/**
 * Generate OpenAI-style completion ID
 */
function generateCompletionId(): string {
  const timestamp = Date.now();
  const randomStr = Math.random().toString(36).substring(2, 9);
  return `chatcmpl-${timestamp}${randomStr}`;
}

/**
 * Map Claude stop_reason to OpenAI finish_reason
 */
function mapStopReasonToFinishReason(
  stopReason: ClaudeResponse['stop_reason'],
  hasToolUse: boolean = false
): OpenAIResponse['choices'][0]['finish_reason'] {
  if (!stopReason) {
    return null;
  }

  switch (stopReason) {
    case 'end_turn':
      return hasToolUse ? 'tool_calls' : 'stop';
    case 'max_tokens':
      return 'length';
    case 'stop_sequence':
      return 'stop';
    case 'tool_use':
      return 'tool_calls';
    default:
      return 'stop';
  }
}

/**
 * Convert Claude usage to OpenAI usage format
 */
function convertUsage(claudeUsage: ClaudeResponse['usage']): OpenAIUsage {
  return {
    prompt_tokens: claudeUsage.input_tokens,
    completion_tokens: claudeUsage.output_tokens,
    total_tokens: claudeUsage.input_tokens + claudeUsage.output_tokens,
  };
}

/**
 * Extract tool calls from Claude content
 */
function extractToolCalls(content: ClaudeContent[]): OpenAIToolCall[] {
  const toolCalls: OpenAIToolCall[] = [];

  for (const item of content) {
    if (item.type === 'tool_use') {
      const toolUse = item as ClaudeToolUseContent;
      toolCalls.push({
        id: toolUse.id,
        type: 'function',
        function: {
          name: toolUse.name,
          arguments: JSON.stringify(toolUse.input),
        },
      });
    }
  }

  return toolCalls;
}

/**
 * Extract text content from Claude content array
 */
function extractTextContent(content: ClaudeContent[]): string {
  const textParts: string[] = [];

  for (const item of content) {
    if (item.type === 'text') {
      textParts.push(item.text);
    }
  }

  return textParts.join('\n');
}

/**
 * Convert Claude content to OpenAI message format
 */
function convertClaudeContentToMessage(
  content: ClaudeContent[],
  role: 'assistant' = 'assistant',
  useFunctionCall: boolean = false
): OpenAIMessage {
  const textContent = extractTextContent(content);
  const toolCalls = extractToolCalls(content);

  const message: OpenAIMessage = {
    role,
    content: textContent || null,
  };

  // Handle tool calls
  if (toolCalls.length > 0) {
    if (useFunctionCall && toolCalls.length === 1) {
      // Use legacy function_call format for single tool call
      message.function_call = {
        name: toolCalls[0].function.name,
        arguments: toolCalls[0].function.arguments,
      };
    } else {
      // Use modern tool_calls format
      message.tool_calls = toolCalls;
    }
  }

  return message;
}

/**
 * Map Claude model to OpenAI model
 * 
 * Current implementation: Direct pass-through without any conversion.
 * Returns the input model name as-is to support flexible model routing.
 * 
 * Note: If model mapping is needed in the future, implement the mapping logic here.
 * For scenarios where no model name is provided, a default mapping could be used.
 * 
 * @param claudeModel - The Claude model name to map
 * @returns The model name unchanged (pass-through)
 */
function mapModelToOpenAI(claudeModel: string): string {
  // Direct pass-through - no conversion
  // If the model name is not in a predefined mapping, return the original value
  return claudeModel;
}

/**
 * Determine if we should use function_call format based on the original request
 */
function shouldUseFunctionCall(originalRequest?: OpenAIRequest): boolean {
  if (!originalRequest) {
    return false;
  }

  // If the original request used functions/function_call, use that format
  if (originalRequest.functions || originalRequest.function_call) {
    return true;
  }

  // Otherwise use the modern tool_calls format
  return false;
}

/**
 * Convert Claude response to OpenAI format
 * Main converter function that handles all aspects of the conversion
 */
export const formatResponseClaude = (
  response: ClaudeResponse,
  originalRequest?: OpenAIRequest
): OpenAIResponse => {
  // Determine whether to use function_call or tool_calls format
  const useFunctionCall = shouldUseFunctionCall(originalRequest);

  // Check if response contains tool use
  const hasToolUse = response.content.some((item) => item.type === 'tool_use');

  // Convert the message
  const message = convertClaudeContentToMessage(response.content, 'assistant', useFunctionCall);

  // Map the model
  const openAIModel = mapModelToOpenAI(response.model);

  // Build OpenAI response
  const openAIResponse: OpenAIResponse = {
    id: generateCompletionId(),
    object: 'chat.completion',
    created: Math.floor(Date.now() / 1000),
    model: openAIModel,
    choices: [
      {
        index: 0,
        message,
        finish_reason: mapStopReasonToFinishReason(response.stop_reason, hasToolUse),
        logprobs: null,
      },
    ],
    usage: convertUsage(response.usage),
    system_fingerprint: `claude_${response.id}`,
  };

  return openAIResponse;
};

/**
 * Initialize or update stream conversion state
 */
function initializeStreamState(
  event: ClaudeStreamMessageStart,
  existingState?: StreamConversionState
): StreamConversionState {
  const messageId = generateCompletionId();
  const created = Math.floor(Date.now() / 1000);

  return {
    messageId: existingState?.messageId || messageId,
    created: existingState?.created || created,
    model: mapModelToOpenAI(event.message.model),
    usage: {
      input_tokens: event.message.usage.input_tokens,
      output_tokens: event.message.usage.output_tokens,
    },
  };
}

/**
 * Convert Claude stream event to OpenAI stream chunk
 */
export const formatStreamChunkClaude: StreamConverter<ClaudeStreamEvent, OpenAIStreamChunk> = (
  event: ClaudeStreamEvent,
  state: StreamConversionState
): OpenAIStreamChunk | null => {
  switch (event.type) {
    case 'message_start': {
      // Initialize state and send first chunk with role
      const chunk: OpenAIStreamChunk = {
        id: state.messageId,
        object: 'chat.completion.chunk',
        created: state.created,
        model: state.model,
        choices: [
          {
            index: 0,
            delta: {
              role: 'assistant',
              content: '',
            },
            finish_reason: null,
          },
        ],
      };
      return chunk;
    }

    case 'content_block_start': {
      const block = event.content_block;

      if (block.type === 'text') {
        // Start of text content
        const chunk: OpenAIStreamChunk = {
          id: state.messageId,
          object: 'chat.completion.chunk',
          created: state.created,
          model: state.model,
          choices: [
            {
              index: 0,
              delta: {
                content: block.text || '',
              },
              finish_reason: null,
            },
          ],
        };
        return chunk;
      } else if (block.type === 'tool_use') {
        // Start of tool use
        state.currentToolCall = {
          id: block.id!,
          name: block.name!,
          arguments: '',
        };

        const chunk: OpenAIStreamChunk = {
          id: state.messageId,
          object: 'chat.completion.chunk',
          created: state.created,
          model: state.model,
          choices: [
            {
              index: 0,
              delta: {
                tool_calls: [
                  {
                    index: 0,
                    id: block.id!,
                    type: 'function',
                    function: {
                      name: block.name!,
                      arguments: '',
                    },
                  },
                ],
              },
              finish_reason: null,
            },
          ],
        };
        return chunk;
      }
      break;
    }

    case 'content_block_delta': {
      const delta = event.delta;

      if (delta.type === 'text_delta') {
        // Text content delta
        const chunk: OpenAIStreamChunk = {
          id: state.messageId,
          object: 'chat.completion.chunk',
          created: state.created,
          model: state.model,
          choices: [
            {
              index: 0,
              delta: {
                content: delta.text || '',
              },
              finish_reason: null,
            },
          ],
        };
        return chunk;
      } else if (delta.type === 'input_json_delta' && state.currentToolCall) {
        // Tool arguments delta
        state.currentToolCall.arguments += delta.partial_json || '';

        const chunk: OpenAIStreamChunk = {
          id: state.messageId,
          object: 'chat.completion.chunk',
          created: state.created,
          model: state.model,
          choices: [
            {
              index: 0,
              delta: {
                tool_calls: [
                  {
                    index: 0,
                    function: {
                      arguments: delta.partial_json || '',
                    },
                  },
                ],
              },
              finish_reason: null,
            },
          ],
        };
        return chunk;
      }
      break;
    }

    case 'content_block_stop': {
      // Content block completed, no action needed
      return null;
    }

    case 'message_delta': {
      // Update usage if provided
      if (event.usage) {
        state.usage!.output_tokens = event.usage.output_tokens;
      }

      // Send finish reason
      const hasToolUse = state.currentToolCall !== undefined;
      const chunk: OpenAIStreamChunk = {
        id: state.messageId,
        object: 'chat.completion.chunk',
        created: state.created,
        model: state.model,
        choices: [
          {
            index: 0,
            delta: {},
            finish_reason: mapStopReasonToFinishReason(event.delta.stop_reason, hasToolUse),
          },
        ],
      };
      return chunk;
    }

    case 'message_stop': {
      // Final chunk with usage information
      const chunk: OpenAIStreamChunk = {
        id: state.messageId,
        object: 'chat.completion.chunk',
        created: state.created,
        model: state.model,
        choices: [
          {
            index: 0,
            delta: {},
            finish_reason: null,
          },
        ],
        usage: state.usage
          ? {
              prompt_tokens: state.usage.input_tokens,
              completion_tokens: state.usage.output_tokens,
              total_tokens: state.usage.input_tokens + state.usage.output_tokens,
            }
          : undefined,
      };
      return chunk;
    }

    case 'ping': {
      // Ping events are ignored
      return null;
    }

    case 'error': {
      // Error events should be handled separately
      console.error('Claude stream error:', event.error);
      return null;
    }

    default:
      return null;
  }
};

/**
 * Parse SSE data and convert Claude stream to OpenAI format
 */
export function parseAndConvertStreamChunk(
  sseData: string,
  state: StreamConversionState
): { chunk: OpenAIStreamChunk | null; updatedState: StreamConversionState } {
  try {
    const claudeEvent = JSON.parse(sseData) as ClaudeStreamEvent;

    // Update state if it's a message_start event
    if (claudeEvent.type === 'message_start') {
      state = initializeStreamState(claudeEvent, state);
    }

    const chunk = formatStreamChunkClaude(claudeEvent, state);
    return { chunk, updatedState: state };
  } catch (error) {
    console.error('Failed to parse Claude stream event:', error);
    return { chunk: null, updatedState: state };
  }
}

/**
 * Convert Claude error to OpenAI error format
 */
export function convertClaudeError(claudeError: any): any {
  // Handle Claude-specific error format
  if (claudeError?.error?.type && claudeError?.error?.message) {
    return {
      error: {
        message: claudeError.error.message,
        type: claudeError.error.type,
        param: null,
        code: claudeError.error.type,
      },
    };
  }

  // Fallback for unexpected error formats
  return {
    error: {
      message: claudeError?.message || 'An error occurred',
      type: 'api_error',
      param: null,
      code: 'api_error',
    },
  };
}

// Export additional utilities for testing
export const __testing = {
  generateCompletionId,
  mapStopReasonToFinishReason,
  convertUsage,
  extractToolCalls,
  extractTextContent,
  convertClaudeContentToMessage,
  mapModelToOpenAI,
  shouldUseFunctionCall,
  initializeStreamState,
};
