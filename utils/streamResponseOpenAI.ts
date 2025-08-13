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
import { enqueueSSE, parseSSE, isDoneMessage, createDoneMessage, parseIncompleteSSE, enqueueErrorAndDone } from './sse';

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
      // If this is the first content block, send content_block_start
      if (!state.contentBlockStarted) {
        const blockStart: ClaudeStreamContentBlockStart = {
          type: 'content_block_start',
          index: 0,
          content_block: {
            type: 'text',
            text: '',
          },
        };
        events.push(blockStart);
        state.contentBlockStarted = true;
      }

      // Send content delta
      const contentDelta: ClaudeStreamContentBlockDelta = {
        type: 'content_block_delta',
        index: 0,
        delta: {
          type: 'text_delta',
          text: delta.content,
        },
      };
      events.push(contentDelta);
    }

    // Handle tool calls
    if (delta.tool_calls) {
      for (const toolCall of delta.tool_calls) {
        const index = toolCall.index || 0;

        // Start a new tool call
        if (toolCall.id) {
          // Close previous content block if exists
          if (state.contentBlockStarted) {
            const blockStop: ClaudeStreamContentBlockStop = {
              type: 'content_block_stop',
              index: 0,
            };
            events.push(blockStop);
            state.contentBlockStarted = false;
          }
          // Close previous tool call if exists
          if (state.currentToolCall) {
            const blockStop: ClaudeStreamContentBlockStop = {
              type: 'content_block_stop',
              index: index - 1,
            };
            events.push(blockStop);
          }

          state.currentToolCall = {
            id: toolCall.id,
            name: toolCall.function?.name || '',
            arguments: '',
          };

          const toolStart: ClaudeStreamContentBlockStart = {
            type: 'content_block_start',
            index,
            content_block: {
              type: 'tool_use',
              id: toolCall.id,
              name: toolCall.function?.name || '',
              input: {},
            },
          };
          events.push(toolStart);
        }

        // Append tool call arguments
        if (toolCall.function?.arguments) {
          if (state.currentToolCall) {
            state.currentToolCall.arguments += toolCall.function.arguments;

            const toolDelta: ClaudeStreamContentBlockDelta = {
              type: 'content_block_delta',
              index,
              delta: {
                type: 'input_json_delta',
                partial_json: toolCall.function.arguments,
              },
            };
            events.push(toolDelta);
          }
        }
      }
    }

    // Handle finish reason
    if (choice.finish_reason) {
      // Close any open content blocks
      if (state.contentBlockStarted) {
        const blockStop: ClaudeStreamContentBlockStop = {
          type: 'content_block_stop',
          index: 0,
        };
        events.push(blockStop);
        state.contentBlockStarted = false;
      }
      // Close any open tool calls
      if (state.currentToolCall) {
        const blockStop: ClaudeStreamContentBlockStop = {
          type: 'content_block_stop',
          index: 0,
        };
        events.push(blockStop);
        state.currentToolCall = undefined;
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
          const messages = buffer.split('\n\n');
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

            // Send each event as SSE
            for (const event of events) {
              enqueueSSE(controller, {
                event: event.type,
                data: JSON.stringify(event),
              });
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
              for (const event of events) {
                enqueueSSE(controller, {
                  event: event.type,
                  data: JSON.stringify(event),
                });
              }
              
              // Check if this is a completion event that needs to trigger a finish
              const hasFinish = events.some(e => e.type === 'message_stop');
              if (!hasFinish) {
                // If we have a finish_reason in the chunk but didn't generate message_stop, force it
                const hasFinishReason = chunk.choices?.some(choice => choice.finish_reason);
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
  let chunkCount = 0;
  let eventCount = 0;

  console.log('=== OpenAI to Claude Transform Stream Created ===');

  return new TransformStream({
    transform(chunk: Uint8Array, controller) {
      chunkCount++;
      const chunkText = decoder.decode(chunk, { stream: true });
      console.log(`OpenAI Transform: Chunk #${chunkCount} received, size: ${chunk.length} bytes`);
      console.log(`OpenAI Transform: Chunk preview: ${chunkText.substring(0, 200)}${chunkText.length > 200 ? '...' : ''}`);
      
      buffer += chunkText;
      console.log(`OpenAI Transform: Buffer size after append: ${buffer.length}`);
      
      const messages = buffer.split('\n\n');
      buffer = messages.pop() || '';
      console.log(`OpenAI Transform: Split into ${messages.length} messages, remaining buffer: ${buffer.length} chars`);

      for (const message of messages) {
        if (!message.trim()) {
          console.log('OpenAI Transform: Empty message, skipping');
          continue;
        }

        console.log(`OpenAI Transform: Processing message: ${message.substring(0, 100)}`);
        const parsed = parseSSE(message);
        if (!parsed) {
          console.log('OpenAI Transform: Failed to parse SSE message');
          continue;
        }

        console.log('OpenAI Transform: Parsed SSE:', parsed);
        if (isDoneMessage(parsed)) {
          console.log('OpenAI Transform: [DONE] message received');
          // Claude doesn't use [DONE]
          continue;
        }

        const openAIChunk = parsed.data as OpenAIStreamChunk;
        if (!openAIChunk || typeof openAIChunk !== 'object') {
          console.log('OpenAI Transform: Invalid chunk data');
          continue;
        }

        console.log('OpenAI Transform: Converting OpenAI chunk:', openAIChunk);
        const events = convertOpenAIChunkToClaude(openAIChunk, state);
        console.log(`OpenAI Transform: Generated ${events.length} Claude events`);
        
        for (const event of events) {
          eventCount++;
          const sseMessage = `event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`;
          console.log(`OpenAI Transform: Sending event #${eventCount} (${event.type})`);
          controller.enqueue(encoder.encode(sseMessage));
        }
      }
    },

    flush(controller) {
      console.log('=== OpenAI Transform: Flush called ===');
      console.log(`OpenAI Transform: Total chunks processed: ${chunkCount}`);
      console.log(`OpenAI Transform: Total events sent: ${eventCount}`);
      console.log(`OpenAI Transform: Buffer length: ${buffer.length}`);
      console.log(`OpenAI Transform: Buffer content: ${buffer.substring(0, 200)}${buffer.length > 200 ? '...' : ''}`);
      
      if (buffer.trim()) {
        console.log('OpenAI Transform: Processing remaining buffer in flush');
        let parsed = parseSSE(buffer);
        
        // If normal parsing fails, try parsing incomplete SSE data
        if (!parsed) {
          console.log('OpenAI Transform: Normal parsing failed in flush, trying incomplete parsing');
          parsed = parseIncompleteSSE(buffer);
        }
        
        if (parsed && !isDoneMessage(parsed)) {
          const openAIChunk = parsed.data as OpenAIStreamChunk;
          if (openAIChunk && typeof openAIChunk === 'object') {
            console.log('OpenAI Transform: Processing chunk from flush buffer');
            const events = convertOpenAIChunkToClaude(openAIChunk, state);
            for (const event of events) {
              const sseMessage = `event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`;
              controller.enqueue(encoder.encode(sseMessage));
            }
            
            // Check if we need to force generate message_stop for completion
            const hasFinish = events.some(e => e.type === 'message_stop');
            if (!hasFinish) {
              const hasFinishReason = openAIChunk.choices?.some(choice => choice.finish_reason);
              if (hasFinishReason) {
                console.log('OpenAI Transform: Force generating message_stop from flush');
                const messageStop: ClaudeStreamMessageStop = {
                  type: 'message_stop',
                };
                const sseMessage = `event: ${messageStop.type}\ndata: ${JSON.stringify(messageStop)}\n\n`;
                controller.enqueue(encoder.encode(sseMessage));
              }
            }
          }
        } else {
          console.log('OpenAI Transform: No valid data in flush buffer');
        }
      }
    },
  });
}
