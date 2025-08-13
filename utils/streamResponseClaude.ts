/**
 * Claude stream response converter to OpenAI format
 * @author jizhejiang
 * @date 2025-08-11
 */

import type {
  ClaudeStreamEvent,
  OpenAIStreamChunk,
  OpenAIStreamChoice,
  OpenAIStreamDelta,
  StreamConversionState,
} from './types';
import { enqueueSSE, parseSSE, createDoneMessage, parseIncompleteSSE, enqueueErrorAndDone } from './sse';

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
      state.model = mapClaudeModelToOpenAI(event.message.model);
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
                    index: event.index,
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
                      index: event.index,
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
  console.log('=== transformClaudeStreamToOpenAI function called ===');
  
  const state: StreamConversionState = {
    messageId: '',
    created: 0,
    model: '',
    contentBlockStarted: false,
  };

  return new ReadableStream({
    async start(controller) {
      console.log('=== ReadableStream started ===');
      const reader = claudeStream.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      let messageComplete = false;
      let chunkCount = 0;

      try {
        while (true) {
          const { done, value } = await reader.read();
          
          if (done) {
            console.log('=== Stream done, breaking loop ===');
            break;
          }

          chunkCount++;
          const newData = decoder.decode(value, { stream: true });
          console.log(`=== Chunk #${chunkCount} received ===`);
          console.log('Chunk length:', newData.length);
          console.log('Chunk content:', JSON.stringify(newData.substring(0, 200) + (newData.length > 200 ? '...' : '')));
          
          buffer += newData;
          console.log('Buffer length after append:', buffer.length);
          console.log('Buffer content:', JSON.stringify(buffer.substring(0, 300) + (buffer.length > 300 ? '...' : '')));
          
          const messages = buffer.split('\n\n');
          console.log('Split into', messages.length, 'messages');
          buffer = messages.pop() || '';
          console.log('Remaining buffer after split:', JSON.stringify(buffer));
          
          for (let i = 0; i < messages.length; i++) {
            const message = messages[i];
            console.log(`Processing message ${i + 1}/${messages.length}:`, JSON.stringify(message));
            
            if (!message.trim()) {
              console.log('Message is empty, skipping');
              continue;
            }

            const parsed = parseSSE(message);
            if (!parsed) {
              console.log('parseSSE returned null, skipping');
              continue;
            }

            // Parse Claude event
            const event = parsed.data as ClaudeStreamEvent;
            
            // Handle events without data (like ping or message_stop without data)
            if (!event) {
              console.log('Event has no data, checking event type:', parsed.event);
              if (parsed.event === 'ping') {
                console.log('Ping event detected, ignoring');
                continue;
              } else if (parsed.event === 'message_stop') {
                console.log('CRITICAL: message_stop event without data detected in main loop!');
                messageComplete = true;
                continue;
              }
              console.log('Unknown event without data, skipping:', parsed.event);
              continue;
            }
            
            if (typeof event !== 'object') {
              console.log('Invalid event data type:', typeof event, event);
              continue;
            }

            // Convert to OpenAI chunk
            const chunk = convertClaudeEventToOpenAI(event, state);
            if (chunk) {
              console.log('Generated OpenAI chunk, enqueueing');
              enqueueSSE(controller, {
                data: JSON.stringify(chunk),
              });
            } else {
              console.log('convertClaudeEventToOpenAI returned null');
            }

            // Check if message is complete
            if (event.type === 'message_stop') {
              console.log('=== message_stop detected in main loop ===');
              messageComplete = true;
            }
          }
        }

        // Process any remaining buffer with enhanced parsing
        console.log('=== Processing remaining buffer ===');
        console.log('Remaining buffer:', JSON.stringify(buffer));
        
        if (buffer.trim()) {
          console.log('Buffer has content, parsing...');
          let parsed = parseSSE(buffer);
          
          // If normal parsing fails, try parsing incomplete SSE data
          if (!parsed) {
            console.log('Claude Stream: Normal parsing failed, trying incomplete parsing');
            parsed = parseIncompleteSSE(buffer);
          }
          
          if (parsed) {
            console.log('Successfully parsed remaining buffer');
            const event = parsed.data as ClaudeStreamEvent;
            if (event && typeof event === 'object') {
              console.log('Valid event from remaining buffer:', event.type);
              const chunk = convertClaudeEventToOpenAI(event, state);
              if (chunk) {
                console.log('Generated chunk from remaining buffer');
                enqueueSSE(controller, {
                  data: JSON.stringify(chunk),
                });
              }

              if (event.type === 'message_stop') {
                console.log('=== message_stop detected in remaining buffer ===');
                messageComplete = true;
              } else if (event.type === 'message_delta' && event.delta.stop_reason) {
                console.log('=== message_delta with stop_reason detected, marking complete ===');
                messageComplete = true;
              }
            } else if (!event && parsed.event === 'message_stop') {
              console.log('=== Eventless message_stop detected in remaining buffer ===');
              messageComplete = true;
            }
          } else {
            console.log('Failed to parse remaining buffer, checking for stop indicators');
            // Check if buffer contains stop indicators even if parsing fails
            if (buffer.includes('message_stop') || buffer.includes('"stop_reason"')) {
              console.log('=== Stop indicators found in unparseable buffer, marking complete ===');
              messageComplete = true;
            }
          }
        } else {
          console.log('No remaining buffer to process');
        }

        // Send [DONE] message if message completed
        console.log('Final messageComplete status:', messageComplete);
        if (messageComplete) {
          console.log('=== Sending [DONE] message ===');
          enqueueSSE(controller, createDoneMessage());
        } else {
          console.log('WARNING: Stream ended but messageComplete is false - may be missing message_stop event');
          // Force send [DONE] anyway to avoid hanging
          console.log('=== Force sending [DONE] message ===');
          enqueueSSE(controller, createDoneMessage());
        }

        controller.close();
      } catch (error) {
        console.error('Error in transformClaudeStreamToOpenAI:', error);
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
function mapClaudeModelToOpenAI(claudeModel: string): string {
  const modelMap: Record<string, string> = {
    'claude-3-opus-20240229': 'gpt-4',
    'claude-3-sonnet-20240229': 'gpt-3.5-turbo',
    'claude-3-haiku-20240307': 'gpt-3.5-turbo',
    'claude-2.1': 'gpt-3.5-turbo',
    'claude-2.0': 'gpt-3.5-turbo',
    'claude-instant-1.2': 'gpt-3.5-turbo',
  };

  return modelMap[claudeModel] || 'gpt-3.5-turbo';
}

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
export function createClaudeToOpenAITransform(): TransformStream<Uint8Array, Uint8Array> {
  const state: StreamConversionState = {
    messageId: '',
    created: 0,
    model: '',
    contentBlockStarted: false,
  };

  const decoder = new TextDecoder();
  const encoder = new TextEncoder();
  let buffer = '';
  let messageComplete = false;
  let chunkCount = 0;
  let sentCount = 0;

  console.log('=== Claude to OpenAI Transform Stream Created ===');

  return new TransformStream({
    transform(chunk: Uint8Array, controller) {
      chunkCount++;
      const chunkText = decoder.decode(chunk, { stream: true });
      console.log(`Stream chunk #${chunkCount} received:`, chunkText.substring(0, 200) + (chunkText.length > 200 ? '...' : ''));
      
      buffer += chunkText;
      const messages = buffer.split('\n\n');
      buffer = messages.pop() || '';

      console.log(`Processing ${messages.length} messages from chunk #${chunkCount}`);

      for (const message of messages) {
        if (!message.trim()) continue;

        console.log('Raw SSE message:', message);
        const parsed = parseSSE(message);
        if (!parsed) {
          console.log('Failed to parse SSE message:', message);
          continue;
        }

        console.log('Parsed SSE:', parsed);
        const event = parsed.data as ClaudeStreamEvent;
        
        // Handle events without data (like ping)
        if (!event) {
          console.log('Event has no data, checking event type:', parsed.event);
          if (parsed.event === 'ping') {
            console.log('Ping event detected, ignoring');
            continue;
          } else if (parsed.event === 'message_stop') {
            console.log('CRITICAL: message_stop event without data detected!');
            // Create a synthetic message_stop event
            const syntheticEvent = { type: 'message_stop' } as ClaudeStreamEvent;
            const openAIChunk = convertClaudeEventToOpenAI(syntheticEvent, state);
            if (openAIChunk) {
              sentCount++;
              const sseMessage = `data: ${JSON.stringify(openAIChunk)}\n\n`;
              console.log(`Sending synthetic OpenAI chunk #${sentCount}:`, openAIChunk);
              controller.enqueue(encoder.encode(sseMessage));
            }
            // Mark message as complete
            messageComplete = true;
            console.log('=== Message complete (from eventless message_stop), sending [DONE] ===');
            const doneMessage = 'data: [DONE]\n\n';
            controller.enqueue(encoder.encode(doneMessage));
            continue;
          }
          console.log('Unknown event without data, skipping:', parsed.event);
          continue;
        }
        
        if (typeof event !== 'object') {
          console.log('Invalid event data type:', typeof event, event);
          continue;
        }

        console.log('Claude event:', event.type, event);
        const openAIChunk = convertClaudeEventToOpenAI(event, state);
        if (openAIChunk) {
          sentCount++;
          const sseMessage = `data: ${JSON.stringify(openAIChunk)}\n\n`;
          console.log(`Sending OpenAI chunk #${sentCount}:`, openAIChunk);
          controller.enqueue(encoder.encode(sseMessage));
        } else {
          console.log('No OpenAI chunk generated for event:', event.type);
        }

        if (event.type === 'message_stop') {
          messageComplete = true;
          console.log('=== Message complete, sending [DONE] ===');
          // Send [DONE] message
          const doneMessage = 'data: [DONE]\n\n';
          controller.enqueue(encoder.encode(doneMessage));
        }
      }
    },

    flush(controller) {
      console.log('=== Stream flush called ===');
      console.log('Buffer remaining:', buffer);
      console.log('Message complete status:', messageComplete);
      console.log('Total chunks processed:', chunkCount);
      console.log('Total OpenAI messages sent:', sentCount);
      
      if (buffer.trim()) {
        console.log('Processing remaining buffer:', buffer);
        const parsed = parseSSE(buffer);
        if (parsed) {
          console.log('Parsed remaining SSE:', parsed);
          const event = parsed.data as ClaudeStreamEvent;
          if (event && typeof event === 'object') {
            console.log('Processing flush event:', event.type, event);
            const openAIChunk = convertClaudeEventToOpenAI(event, state);
            if (openAIChunk) {
              const sseMessage = `data: ${JSON.stringify(openAIChunk)}\n\n`;
              console.log('Sending flush chunk:', openAIChunk);
              controller.enqueue(encoder.encode(sseMessage));
            }

            if (event.type === 'message_stop') {
              console.log('=== Flush: Message stop detected, sending [DONE] ===');
              const doneMessage = 'data: [DONE]\n\n';
              controller.enqueue(encoder.encode(doneMessage));
              messageComplete = true;
            }
          }
        } else {
          console.log('Failed to parse remaining buffer as SSE');
        }
      }

      // Ensure [DONE] is sent if not already sent
      if (!messageComplete) {
        console.log('=== Stream ended but no [DONE] sent, forcing [DONE] ===');
        const doneMessage = 'data: [DONE]\n\n';
        controller.enqueue(encoder.encode(doneMessage));
      } else {
        console.log('=== Stream completed normally with [DONE] already sent ===');
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
export async function convertClaudeStreamResponse(
  response: Response,
  targetFormat: 'openai' = 'openai'
): Promise<Response> {
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
