/**
 * Claude stream response converter to OpenAI format
 * @author jizhejiang
 * @date 2025-08-11
 */

import type { ClaudeStreamEvent, OpenAIStreamChunk, StreamConversionState } from './types';
import {
  enqueueSSE,
  parseSSE,
  createDoneMessage,
  parseIncompleteSSE,
  enqueueErrorAndDone,
} from './sse';

// Support both LF and CRLF separators when splitting SSE frames
const SSE_MESSAGE_SPLIT_REGEX = /\r?\n\r?\n/;

/**
 * Convert Claude stream event to OpenAI stream chunk
 * @param event - Claude stream event
 * @param state - Current stream conversion state
 * @returns OpenAI stream chunk or null
 */
export function convertClaudeEventToOpenAI(
  event: ClaudeStreamEvent,
  state: StreamConversionState
): OpenAIStreamChunk | null {
  console.log('Converting Claude event:', event.type);

  switch (event.type) {
    case 'message_start': {
      // Initialize state from message_start
      state.messageId = event.message.id;
      // state.model is already set from the original request
      state.created = Math.floor(Date.now() / 1000);
      state.usage = {
        input_tokens: event.message.usage.input_tokens,
        output_tokens: event.message.usage.output_tokens,
      };

      // Return initial chunk with role
      return {
        id: state.messageId,
        object: 'chat.completion.chunk',
        created: state.created,
        model: state.model,
        choices: [
          {
            index: 0,
            delta: {
              role: 'assistant',
            },
            finish_reason: null,
          },
        ],
      };
    }

    case 'content_block_start': {
      const contentBlock = event.content_block;

      if (contentBlock.type === 'text') {
        // Text content starts, but we don't send anything yet
        return null;
      } else if (contentBlock.type === 'tool_use') {
        // Tool use starts
        state.currentToolCall = {
          id: contentBlock.id || generateToolCallId(),
          name: contentBlock.name || '',
          arguments: '',
        };

        // Assign a stable index for this tool call
        if (!state.toolCallIdToIndex) state.toolCallIdToIndex = new Map<string, number>();
        if (!state.nextToolCallIndex && state.nextToolCallIndex !== 0) state.nextToolCallIndex = 0;
        if (!state.toolCallIdToIndex.has(state.currentToolCall.id)) {
          const assignIndex = state.nextToolCallIndex ?? 0;
          state.toolCallIdToIndex.set(state.currentToolCall.id, assignIndex);
          state.nextToolCallIndex = assignIndex + 1;
        }

        return {
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
                    index: state.toolCallIdToIndex.get(state.currentToolCall.id) ?? 0,
                    id: state.currentToolCall.id,
                    type: 'function',
                    function: {
                      name: state.currentToolCall.name,
                      arguments: '',
                    },
                  },
                ],
              },
              finish_reason: null,
            },
          ],
        };
      }
      return null;
    }

    case 'content_block_delta': {
      const delta = event.delta;

      if (delta.type === 'text_delta' && delta.text) {
        // Text content delta
        return {
          id: state.messageId,
          object: 'chat.completion.chunk',
          created: state.created,
          model: state.model,
          choices: [
            {
              index: 0,
              delta: {
                content: delta.text,
              },
              finish_reason: null,
            },
          ],
        };
      } else if (delta.type === 'input_json_delta' && delta.partial_json) {
        // Tool input delta
        if (state.currentToolCall) {
          state.currentToolCall.arguments += delta.partial_json;

          return {
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
                      index: state.toolCallIdToIndex?.get(state.currentToolCall?.id ?? '') ?? 0,
                      function: {
                        arguments: delta.partial_json,
                      },
                    },
                  ],
                },
                finish_reason: null,
              },
            ],
          };
        }
      }
      return null;
    }

    case 'content_block_stop': {
      // Content block ended, clear current tool call if exists
      if (state.currentToolCall) {
        state.currentToolCall = undefined;
      }
      return null;
    }

    case 'message_delta': {
      // Update usage
      if (event.usage) {
        state.usage = {
          input_tokens: state.usage?.input_tokens || 0,
          output_tokens: event.usage.output_tokens,
        };
      }

      // Send finish chunk with stop reason
      return {
        id: state.messageId,
        object: 'chat.completion.chunk',
        created: state.created,
        model: state.model,
        choices: [
          {
            index: 0,
            delta: {},
            finish_reason: mapStopReasonToFinishReason(event.delta.stop_reason),
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
    }

    case 'message_stop': {
      // Message ended, no need to send anything
      return null;
    }

    case 'ping': {
      // Heartbeat, ignore
      return null;
    }

    case 'error': {
      // Error occurred, could throw or handle differently
      console.error('Claude stream error:', event.error);
      return null;
    }

    default:
      return null;
  }
}

/**
 * Transform Claude SSE stream to OpenAI SSE stream
 * @param claudeStream - ReadableStream of Claude SSE data
 * @returns ReadableStream of OpenAI SSE data
 */
export function transformClaudeStreamToOpenAI(
  claudeStream: ReadableStream<Uint8Array>
): ReadableStream<Uint8Array> {
  const state: StreamConversionState = {
    messageId: '',
    created: 0,
    model: '',
    contentBlockStarted: false,
  };

  return new ReadableStream({
    async start(controller) {
      const reader = claudeStream.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      let messageComplete = false;
      let lastPayload = '';

      try {
        while (true) {
          const { done, value } = await reader.read();

          if (done) {
            break;
          }

          const newData = decoder.decode(value, { stream: true });

          buffer += newData;

          const messages = buffer.split(SSE_MESSAGE_SPLIT_REGEX);
          buffer = messages.pop() || '';

          for (let i = 0; i < messages.length; i++) {
            const message = messages[i];

            if (!message.trim()) {
              continue;
            }

            const parsed = parseSSE(message);
            if (!parsed) {
              continue;
            }

            // Parse Claude event
            const event = parsed.data as ClaudeStreamEvent;

            // Handle events without data (like ping or message_stop without data)
            if (!event) {
              if (parsed.event === 'ping') {
                continue;
              } else if (parsed.event === 'message_stop') {
                messageComplete = true;
                continue;
              }
              continue;
            }

            if (typeof event !== 'object') {
              continue;
            }

            // Convert to OpenAI chunk
            const chunk = convertClaudeEventToOpenAI(event, state);
            if (chunk) {
              const payload = JSON.stringify(chunk);
              if (payload !== lastPayload) {
                enqueueSSE(controller, { data: payload });
                lastPayload = payload;
              }
            }

            // Check if message is complete
            if (event.type === 'message_stop') {
              messageComplete = true;
            }
          }
        }

        // Process any remaining buffer with enhanced parsing
        if (buffer.trim()) {
          let parsed = parseSSE(buffer);

          // If normal parsing fails, try parsing incomplete SSE data
          if (!parsed) {
            parsed = parseIncompleteSSE(buffer);
          }

          if (parsed) {
            const event = parsed.data as ClaudeStreamEvent;
            if (event && typeof event === 'object') {
              const chunk = convertClaudeEventToOpenAI(event, state);
              if (chunk) {
                const payload = JSON.stringify(chunk);
                if (payload !== lastPayload) {
                  enqueueSSE(controller, { data: payload });
                  lastPayload = payload;
                }
              }

              if (event.type === 'message_stop') {
                messageComplete = true;
              } else if (event.type === 'message_delta' && event.delta.stop_reason) {
                messageComplete = true;
              }
            } else if (!event && parsed.event === 'message_stop') {
              messageComplete = true;
            }
          } else {
            // Check if buffer contains stop indicators even if parsing fails
            if (buffer.includes('message_stop') || buffer.includes('"stop_reason"')) {
              messageComplete = true;
            }
          }
        }

        // Send [DONE] message if message completed
        if (messageComplete) {
          enqueueSSE(controller, createDoneMessage());
        } else {
          // Force send [DONE] anyway to avoid hanging
          enqueueSSE(controller, createDoneMessage());
        }

        controller.close();
      } catch (error) {
        // Send error message and done message instead of erroring the controller
        enqueueErrorAndDone(controller, error);
        controller.close();
      } finally {
        reader.releaseLock();
      }
    },
  });
}

/**
 * Map Claude model name to OpenAI model name
 * @param claudeModel - Claude model name
 * @returns OpenAI model name
 */
// mapClaudeModelToOpenAI is currently unused; remove to satisfy lint

/**
 * Map Claude stop reason to OpenAI finish reason
 * @param stopReason - Claude stop reason
 * @returns OpenAI finish reason
 */
function mapStopReasonToFinishReason(
  stopReason: 'end_turn' | 'max_tokens' | 'stop_sequence' | 'tool_use'
): 'stop' | 'length' | 'tool_calls' | null {
  switch (stopReason) {
    case 'end_turn':
      return 'stop';
    case 'max_tokens':
      return 'length';
    case 'stop_sequence':
      return 'stop';
    case 'tool_use':
      return 'tool_calls';
    default:
      return null;
  }
}

/**
 * Generate a unique tool call ID
 * @returns Tool call ID
 */
function generateToolCallId(): string {
  return `call_${Math.random().toString(36).substring(2, 15)}`;
}

/**
 * Create a transform stream for Claude to OpenAI conversion
 * @returns TransformStream that converts Claude SSE to OpenAI SSE
 */
export function createClaudeToOpenAITransform(
  modelName: string
): TransformStream<Uint8Array, Uint8Array> {
  const state: StreamConversionState = {
    messageId: '',
    created: 0,
    model: modelName, // Use the provided model name
    contentBlockStarted: false,
  };

  const decoder = new TextDecoder();
  const encoder = new TextEncoder();
  let buffer = '';
  let messageComplete = false;
  let lastSentData = '';

  return new TransformStream({
    transform(chunk: Uint8Array, controller) {
      const chunkText = decoder.decode(chunk, { stream: true });

      buffer += chunkText;
      const lines = buffer.split('\n');
      buffer = lines.pop() || '';

      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed.startsWith('data:')) {
          continue;
        }
        const data = trimmed.slice(5).trim();

        if (data === '[DONE]') {
          if (!messageComplete) {
            const doneMessage = 'data: [DONE]\n\n';
            controller.enqueue(encoder.encode(doneMessage));
            messageComplete = true;
          }
          continue;
        }

        try {
          const event = JSON.parse(data) as ClaudeStreamEvent;
          if (event && typeof event === 'object') {
            const openAIChunk = convertClaudeEventToOpenAI(event, state);
            if (openAIChunk) {
              const payload = JSON.stringify(openAIChunk);
              if (payload !== lastSentData) {
                const sseMessage = `data: ${payload}\n\n`;
                controller.enqueue(encoder.encode(sseMessage));
                lastSentData = payload;
              }
            }

            if (event.type === 'message_stop') {
              messageComplete = true;
            } else if ((event as ClaudeStreamEvent).type === 'message_delta') {
              const messageDelta = event as ClaudeStreamEvent & {
                delta?: { stop_reason?: unknown };
              };
              if (messageDelta.delta?.stop_reason) {
                messageComplete = true;
              }
            }
          }
        } catch {
          // ignore malformed json/data line
        }
      }
    },

    flush(controller) {
      const trimmed = buffer.trim();
      if (trimmed.startsWith('data:')) {
        const data = trimmed.slice(5).trim();
        if (data && data !== '[DONE]') {
          try {
            const event = JSON.parse(data) as ClaudeStreamEvent;
            if (event && typeof event === 'object') {
              const openAIChunk = convertClaudeEventToOpenAI(event, state);
              if (openAIChunk) {
                const payload = JSON.stringify(openAIChunk);
                if (payload !== lastSentData) {
                  const sseMessage = `data: ${payload}\n\n`;
                  controller.enqueue(encoder.encode(sseMessage));
                  lastSentData = payload;
                }
              }
              if (event.type === 'message_stop') {
                messageComplete = true;
              }
            }
          } catch {
            // ignore
          }
        }
      }

      if (!messageComplete) {
        const doneMessage = 'data: [DONE]\n\n';
        controller.enqueue(encoder.encode(doneMessage));
      }
    },
  });
}

/**
 * Helper function to handle streaming response conversion
 * @param response - Original response from Claude API
 * @param targetFormat - Target format (should be 'openai')
 * @returns Converted response with OpenAI-formatted stream
 */
export async function convertClaudeStreamResponse(response: Response): Promise<Response> {
  if (!response.body) {
    throw new Error('Response body is empty');
  }

  const transformedStream = transformClaudeStreamToOpenAI(response.body);

  return new Response(transformedStream, {
    status: response.status,
    statusText: response.statusText,
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
    },
  });
}
