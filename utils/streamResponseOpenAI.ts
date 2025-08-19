/**
 * OpenAI stream response converter to Claude format
 * @author jizhejiang
 * @date 2025-08-11
 */

import type {
  OpenAIStreamChunk,
  ClaudeStreamEvent,
  ClaudeStreamMessageStart,
  ClaudeStreamContentBlockStart,
  ClaudeStreamContentBlockDelta,
  ClaudeStreamContentBlockStop,
  ClaudeStreamMessageDelta,
  ClaudeStreamMessageStop,
  StreamConversionState,
} from './types';
import {
  enqueueSSE,
  parseSSE,
  isDoneMessage,
  parseIncompleteSSE,
  enqueueErrorAndDone,
} from './sse';

// Support both LF and CRLF separators when splitting SSE frames
const SSE_MESSAGE_SPLIT_REGEX = /\r?\n\r?\n/;

/**
 * Convert OpenAI stream chunk to Claude stream events
 * @param chunk - OpenAI stream chunk
 * @param state - Current stream conversion state
 * @returns Array of Claude stream events
 */
export function convertOpenAIChunkToClaude(
  chunk: OpenAIStreamChunk,
  state: StreamConversionState
): ClaudeStreamEvent[] {
  const events: ClaudeStreamEvent[] = [];
  // Initialize extended indexing state if absent
  if (typeof state.contentIndex !== 'number') state.contentIndex = 0;
  if (!state.toolCallIndexToContentBlockIndex)
    state.toolCallIndexToContentBlockIndex = new Map<number, number>();
  if (!state.toolBlockStartedIndices) state.toolBlockStartedIndices = new Set<number>();
  if (!state.openToolBlockIndices) state.openToolBlockIndices = new Set<number>();
  if (!state.toolCallsState)
    state.toolCallsState = new Map<number, { id?: string; name?: string; arguments: string }>();

  // Handle first chunk - send message_start
  if (!state.messageId && chunk.id) {
    state.messageId = chunk.id;
    state.created = chunk.created;
    state.model = chunk.model;

    const messageStart: ClaudeStreamMessageStart = {
      type: 'message_start',
      message: {
        id: chunk.id,
        type: 'message',
        role: 'assistant',
        model: mapOpenAIModelToClaude(chunk.model),
        content: [],
        stop_reason: null,
        stop_sequence: null,
        usage: {
          input_tokens: state.usage?.input_tokens || 0,
          output_tokens: 0,
        },
      },
    };
    events.push(messageStart);
  }

  // Process each choice
  for (const choice of chunk.choices) {
    const delta = choice.delta;

    // Handle content
    if (delta.content !== undefined) {
      // Open a text content block if not started
      if (!state.contentBlockStarted && !state.currentToolCall) {
        const blockStart: ClaudeStreamContentBlockStart = {
          type: 'content_block_start',
          index: state.contentIndex || 0,
          content_block: { type: 'text', text: '' },
        };
        events.push(blockStart);
        state.contentBlockStarted = true;
      }

      // Send content delta
      const contentDelta: ClaudeStreamContentBlockDelta = {
        type: 'content_block_delta',
        index: state.contentIndex || 0,
        delta: {
          type: 'text_delta',
          text: delta.content,
        },
      };
      events.push(contentDelta);
    }

    // Handle tool calls
    if (delta.tool_calls) {
      const processedThisChoice = new Set<number>();
      for (const toolCall of delta.tool_calls) {
        const openAIToolIdx = toolCall.index ?? 0;
        if (processedThisChoice.has(openAIToolIdx)) continue;
        processedThisChoice.add(openAIToolIdx);

        // Prepare per-index state
        if (!state.toolCallsState.has(openAIToolIdx)) {
          state.toolCallsState.set(openAIToolIdx, { arguments: '' });
        }
        const callState = state.toolCallsState.get(openAIToolIdx)!;

        // Close text block once when entering tools
        if (state.contentBlockStarted && !state.openToolBlockIndices.size) {
          const blockStop: ClaudeStreamContentBlockStop = {
            type: 'content_block_stop',
            index: state.contentIndex || 0,
          };
          events.push(blockStop);
          state.contentBlockStarted = false;
          state.contentIndex = (state.contentIndex || 0) + 1;
        }

        // Stable mapping from tool idx to content_block idx
        if (!state.toolCallIndexToContentBlockIndex.has(openAIToolIdx)) {
          const assignIndex: number = state.contentIndex || 0;
          state.toolCallIndexToContentBlockIndex.set(openAIToolIdx, assignIndex);
          state.contentIndex = assignIndex + 1;
        }
        const contentBlockIndex = state.toolCallIndexToContentBlockIndex.get(openAIToolIdx) || 0;

        // If tool id/name arrive (possibly later), update state and emit start once
        if (toolCall.id) callState.id = toolCall.id;
        if (toolCall.function?.name) callState.name = toolCall.function.name;

        if (!state.toolBlockStartedIndices.has(contentBlockIndex)) {
          const toolStart: ClaudeStreamContentBlockStart = {
            type: 'content_block_start',
            index: contentBlockIndex,
            content_block: {
              type: 'tool_use',
              id: callState.id || `call_${openAIToolIdx}`,
              name: callState.name || `tool_${openAIToolIdx}`,
              input: {},
            },
          };
          events.push(toolStart);
          state.toolBlockStartedIndices.add(contentBlockIndex);
          state.openToolBlockIndices.add(contentBlockIndex);
        }

        // If later we receive definitive id/name, only update internal state; do not re-emit start
        if (toolCall.id && !callState.id) callState.id = toolCall.id;
        if (toolCall.function?.name && !callState.name) callState.name = toolCall.function.name;

        // Accumulate arguments and emit delta
        if (toolCall.function?.arguments) {
          callState.arguments += toolCall.function.arguments;
          const toolDelta: ClaudeStreamContentBlockDelta = {
            type: 'content_block_delta',
            index: contentBlockIndex,
            delta: {
              type: 'input_json_delta',
              partial_json: toolCall.function.arguments,
            },
          };
          events.push(toolDelta);
        }
      }
    }

    // Handle finish reason
    if (choice.finish_reason) {
      // Close any open tool blocks (all indices)
      if (state.openToolBlockIndices.size) {
        for (const idx of Array.from(state.openToolBlockIndices.values()).sort((a, b) => a - b)) {
          const blockStop: ClaudeStreamContentBlockStop = {
            type: 'content_block_stop',
            index: idx,
          };
          events.push(blockStop);
        }
        state.openToolBlockIndices.clear();
        state.toolBlockStartedIndices.clear();
        state.toolCallsState.clear();
        state.currentToolCall = undefined;
        state.currentToolCallIndex = undefined;
        state.contentIndex = (state.contentIndex || 0) + 1;
      } else if (state.contentBlockStarted) {
        const blockStop: ClaudeStreamContentBlockStop = {
          type: 'content_block_stop',
          index: state.contentIndex || 0,
        };
        events.push(blockStop);
        state.contentBlockStarted = false;
        state.contentIndex = (state.contentIndex || 0) + 1;
      }

      // Send message delta with stop reason
      const messageDelta: ClaudeStreamMessageDelta = {
        type: 'message_delta',
        delta: {
          stop_reason: mapFinishReasonToStopReason(choice.finish_reason),
          stop_sequence: null,
        },
        usage: {
          output_tokens: state.usage?.output_tokens || 0,
        },
      };
      events.push(messageDelta);

      // Send message stop
      const messageStop: ClaudeStreamMessageStop = {
        type: 'message_stop',
      };
      events.push(messageStop);

      // Reset per-stream transient states to avoid leaking into next message
      state.toolBlockStartedIndices?.clear();
      state.openToolBlockIndices?.clear();
      state.toolCallsState?.clear();
      state.toolCallIndexToContentBlockIndex?.clear();
      state.currentToolCall = undefined;
      state.currentToolCallIndex = undefined;
    }
  }

  // Update usage if provided
  if (chunk.usage) {
    state.usage = {
      input_tokens: chunk.usage.prompt_tokens,
      output_tokens: chunk.usage.completion_tokens,
    };
  }

  return events;
}

/**
 * Transform OpenAI SSE stream to Claude SSE stream
 * @param openAIStream - ReadableStream of OpenAI SSE data
 * @returns ReadableStream of Claude SSE data
 */
export function transformOpenAIStreamToClaude(
  openAIStream: ReadableStream<Uint8Array>
): ReadableStream<Uint8Array> {
  const state: StreamConversionState = {
    messageId: '',
    created: 0,
    model: '',
    contentBlockStarted: false,
  };

  return new ReadableStream({
    async start(controller) {
      const reader = openAIStream.getReader();
      const decoder = new TextDecoder();
      let buffer = '';

      try {
        while (true) {
          const { done, value } = await reader.read();

          if (done) {
            break;
          }

          buffer += decoder.decode(value, { stream: true });
          const messages = buffer.split(SSE_MESSAGE_SPLIT_REGEX);
          buffer = messages.pop() || '';

          for (const message of messages) {
            if (!message.trim()) continue;

            const parsed = parseSSE(message);
            if (!parsed) continue;

            // Check for [DONE] message
            if (isDoneMessage(parsed)) {
              // Claude doesn't use [DONE], it ends with message_stop
              continue;
            }

            // Parse OpenAI chunk
            const chunk = parsed.data as OpenAIStreamChunk;
            if (!chunk || typeof chunk !== 'object') continue;

            // Convert to Claude events
            const events = convertOpenAIChunkToClaude(chunk, state);

            // Send each event as SSE with de-dup guard per event type
            const lastEventByType: Record<string, string> = {};
            for (const event of events) {
              const payload = JSON.stringify(event);
              if (lastEventByType[event.type] === payload) continue;
              lastEventByType[event.type] = payload;
              enqueueSSE(controller, { event: event.type, data: payload });
            }
          }
        }

        // Process any remaining buffer with enhanced parsing
        if (buffer.trim()) {
          let parsed = parseSSE(buffer);

          // If normal parsing fails, try parsing incomplete SSE data
          if (!parsed) {
            console.log('OpenAI Stream: Normal parsing failed, trying incomplete parsing');
            parsed = parseIncompleteSSE(buffer);
          }

          if (parsed && !isDoneMessage(parsed)) {
            const chunk = parsed.data as OpenAIStreamChunk;
            if (chunk && typeof chunk === 'object') {
              const events = convertOpenAIChunkToClaude(chunk, state);
              const lastEventByType: Record<string, string> = {};
              for (const event of events) {
                const payload = JSON.stringify(event);
                if (lastEventByType[event.type] === payload) continue;
                lastEventByType[event.type] = payload;
                enqueueSSE(controller, { event: event.type, data: payload });
              }

              // Check if this is a completion event that needs to trigger a finish
              const hasFinish = events.some((e) => e.type === 'message_stop');
              if (!hasFinish) {
                // If we have a finish_reason in the chunk but didn't generate message_stop, force it
                const hasFinishReason = chunk.choices?.some((choice) => choice.finish_reason);
                if (hasFinishReason) {
                  console.log('OpenAI Stream: Force generating message_stop from remaining buffer');
                  const messageStop: ClaudeStreamMessageStop = {
                    type: 'message_stop',
                  };
                  enqueueSSE(controller, {
                    event: messageStop.type,
                    data: JSON.stringify(messageStop),
                  });
                }
              }
            }
          }
        }

        controller.close();
      } catch (error) {
        console.error('OpenAI Stream: Error occurred, sending error message and closing:', error);
        // Send error message instead of just erroring the controller
        enqueueErrorAndDone(controller, error);
        controller.close();
      } finally {
        reader.releaseLock();
      }
    },
  });
}

/**
 * Map OpenAI model name to Claude model name
 * @param openAIModel - OpenAI model name
 * @returns Claude model name
 */
function mapOpenAIModelToClaude(openAIModel: string): string {
  const modelMap: Record<string, string> = {
    'gpt-4': 'claude-3-opus-20240229',
    'gpt-4-turbo': 'claude-3-opus-20240229',
    'gpt-4-turbo-preview': 'claude-3-opus-20240229',
    'gpt-3.5-turbo': 'claude-3-sonnet-20240229',
    'gpt-3.5-turbo-16k': 'claude-3-sonnet-20240229',
  };

  return modelMap[openAIModel] || 'claude-3-sonnet-20240229';
}

/**
 * Map OpenAI finish reason to Claude stop reason
 * @param finishReason - OpenAI finish reason
 * @returns Claude stop reason
 */
function mapFinishReasonToStopReason(
  finishReason: string | null
): 'end_turn' | 'max_tokens' | 'stop_sequence' | 'tool_use' {
  switch (finishReason) {
    case 'stop':
      return 'end_turn';
    case 'length':
      return 'max_tokens';
    case 'tool_calls':
    case 'function_call':
      return 'tool_use';
    default:
      return 'end_turn';
  }
}

/**
 * Create a transform stream for OpenAI to Claude conversion
 * @returns TransformStream that converts OpenAI SSE to Claude SSE
 */
export function createOpenAIToClaudeTransform(): TransformStream<Uint8Array, Uint8Array> {
  const state: StreamConversionState = {
    messageId: '',
    created: 0,
    model: '',
    contentBlockStarted: false,
  };

  const decoder = new TextDecoder();
  const encoder = new TextEncoder();
  let buffer = '';
  let messageStopSent = false;
  const lastEventByType: Record<string, string> = {};

  return new TransformStream({
    transform(chunk: Uint8Array, controller) {
      const chunkText = decoder.decode(chunk, { stream: true });
      buffer += chunkText;
      const lines = buffer.split('\n');
      buffer = lines.pop() || '';

      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed.startsWith('data:')) continue;
        const data = trimmed.slice(5).trim();

        if (data === '[DONE]') {
          if (!messageStopSent) {
            if (state.contentBlockStarted) {
              const blockStop: ClaudeStreamContentBlockStop = {
                type: 'content_block_stop',
                index: 0,
              };
              controller.enqueue(
                encoder.encode(`event: ${blockStop.type}\ndata: ${JSON.stringify(blockStop)}\n\n`)
              );
              state.contentBlockStarted = false;
            }
            const messageDelta: ClaudeStreamMessageDelta = {
              type: 'message_delta',
              delta: { stop_reason: 'end_turn', stop_sequence: null },
              usage: { output_tokens: state.usage?.output_tokens || 0 },
            };
            controller.enqueue(
              encoder.encode(
                `event: ${messageDelta.type}\ndata: ${JSON.stringify(messageDelta)}\n\n`
              )
            );
            const messageStop: ClaudeStreamMessageStop = { type: 'message_stop' };
            controller.enqueue(
              encoder.encode(`event: ${messageStop.type}\ndata: ${JSON.stringify(messageStop)}\n\n`)
            );
            messageStopSent = true;
          }
          continue;
        }

        try {
          const openAIChunk = JSON.parse(data) as OpenAIStreamChunk;
          if (!openAIChunk || typeof openAIChunk !== 'object') continue;
          const events = convertOpenAIChunkToClaude(openAIChunk, state);
          for (const event of events) {
            const payload = JSON.stringify(event);
            if (lastEventByType[event.type] === payload) continue;
            lastEventByType[event.type] = payload;
            controller.enqueue(encoder.encode(`event: ${event.type}\ndata: ${payload}\n\n`));
            if (event.type === 'message_stop') messageStopSent = true;
          }
        } catch {
          // ignore malformed json line
        }
      }
    },

    flush(controller) {
      const trimmed = buffer.trim();
      if (trimmed.startsWith('data:')) {
        const data = trimmed.slice(5).trim();
        if (data && data !== '[DONE]') {
          try {
            const openAIChunk = JSON.parse(data) as OpenAIStreamChunk;
            if (openAIChunk && typeof openAIChunk === 'object') {
              const events = convertOpenAIChunkToClaude(openAIChunk, state);
              for (const event of events) {
                const payload = JSON.stringify(event);
                if (lastEventByType[event.type] === payload) continue;
                lastEventByType[event.type] = payload;
                controller.enqueue(encoder.encode(`event: ${event.type}\ndata: ${payload}\n\n`));
                if (event.type === 'message_stop') messageStopSent = true;
              }
            }
          } catch {
            // ignore
          }
        }
      }

      if (!messageStopSent) {
        if (state.contentBlockStarted) {
          const blockStop: ClaudeStreamContentBlockStop = { type: 'content_block_stop', index: 0 };
          controller.enqueue(
            encoder.encode(`event: ${blockStop.type}\ndata: ${JSON.stringify(blockStop)}\n\n`)
          );
          state.contentBlockStarted = false;
        }
        const messageDelta: ClaudeStreamMessageDelta = {
          type: 'message_delta',
          delta: { stop_reason: 'end_turn', stop_sequence: null },
          usage: { output_tokens: state.usage?.output_tokens || 0 },
        };
        controller.enqueue(
          encoder.encode(`event: ${messageDelta.type}\ndata: ${JSON.stringify(messageDelta)}\n\n`)
        );
        const messageStop: ClaudeStreamMessageStop = { type: 'message_stop' };
        controller.enqueue(
          encoder.encode(`event: ${messageStop.type}\ndata: ${JSON.stringify(messageStop)}\n\n`)
        );
        messageStopSent = true;
      }
    },
  });
}
