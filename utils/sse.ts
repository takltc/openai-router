/**
 * Server-Sent Events (SSE) utility functions
 * @author jizhejiang
 * @date 2025-08-11
 */

import type { SSEMessage, ParsedSSEMessage } from './types';

/**
 * Enqueue an SSE message to a WritableStream
 * @param controller - The WritableStreamDefaultController
 * @param message - The SSE message to send
 */
export function enqueueSSE(
  controller: ReadableStreamDefaultController<Uint8Array>,
  message: SSEMessage
): void {
  const encoder = new TextEncoder();
  let sseString = '';

  // Add event field if present
  if (message.event) {
    sseString += `event: ${message.event}\n`;
  }

  // Add data field (required)
  const dataLines = message.data.split('\n');
  for (const line of dataLines) {
    sseString += `data: ${line}\n`;
  }

  // Add id field if present
  if (message.id) {
    sseString += `id: ${message.id}\n`;
  }

  // Add retry field if present
  if (message.retry !== undefined) {
    sseString += `retry: ${message.retry}\n`;
  }

  // Add double newline to end the message
  sseString += '\n';

  // Enqueue the encoded message
  controller.enqueue(encoder.encode(sseString));
}

/**
 * Parse an SSE message from a string
 * @param sseString - The raw SSE string
 * @returns Parsed SSE message or null if invalid
 */
export function parseSSE(sseString: string): ParsedSSEMessage | null {
  // Handle empty or whitespace-only strings
  if (!sseString || !sseString.trim()) {
    return null;
  }

  const lines = sseString.trim().split('\n');
  const message: ParsedSSEMessage = {
    data: '',
  };

  let dataLines: string[] = [];

  for (const line of lines) {
    if (line.startsWith('event:')) {
      message.event = line.slice(6).trim();
    } else if (line.startsWith('data:')) {
      const dataContent = line.slice(5).trim();
      dataLines.push(dataContent);
    } else if (line.startsWith('id:')) {
      message.id = line.slice(3).trim();
    } else if (line.startsWith('retry:')) {
      const retryValue = parseInt(line.slice(6).trim(), 10);
      if (!isNaN(retryValue)) {
        message.retry = retryValue;
      }
    }
  }
  
  // Allow events without data (like ping or certain control events)
  if (dataLines.length === 0) {
    // If there's at least an event field, still return a valid message
    if (message.event) {
      console.log('SSE: Event without data detected:', message.event);
      message.data = null;
      return message;
    } else {
      console.log('WARNING: SSE message with no event and no data, dropping:', JSON.stringify(sseString));
      return null;
    }
  }

  // Join data lines and try to parse as JSON
  const dataString = dataLines.join('\n');
  
  // Handle special SSE markers that should remain as strings
  const specialMarkers = ['[DONE]', 'ping', 'heartbeat'];
  if (specialMarkers.includes(dataString.trim())) {
    message.data = dataString;
    return message;
  }
  
  try {
    message.data = JSON.parse(dataString);
  } catch (e) {
    // If not valid JSON, keep as string
    message.data = dataString;
    // Only log JSON parse errors for non-empty data that's not a known special marker
    if (dataString.trim() && !dataString.startsWith('[') && !dataString.endsWith(']')) {
      console.log('SSE: Failed to parse JSON, keeping as string:', {
        error: e instanceof Error ? e.message : String(e),
        stack: e instanceof Error ? e.stack : undefined,
        eventSummary: {
          dataLength: dataString.length,
          dataPreview: dataString.substring(0, 100),
          event: message.event || 'no-event'
        }
      });
    }
  }

  return message;
}

/**
 * Try to parse incomplete SSE data that may be missing trailing newlines
 * Used in flush scenarios where the last chunk may be incomplete
 * @param incompleteData - Potentially incomplete SSE data
 * @returns Parsed SSE message or null if invalid
 */
export function parseIncompleteSSE(incompleteData: string): ParsedSSEMessage | null {
  if (!incompleteData || !incompleteData.trim()) {
    return null;
  }

  // If the data doesn't end with a newline, add one for parsing
  let dataToProcess = incompleteData;
  if (!dataToProcess.endsWith('\n')) {
    dataToProcess += '\n';
  }

  // Try to parse as normal SSE
  const parsed = parseSSE(dataToProcess);
  if (parsed) {
    console.log('SSE: Successfully parsed incomplete data:', incompleteData.substring(0, 100));
    return parsed;
  }

  // If normal parsing fails, try to extract just the data content
  const lines = incompleteData.split('\n').filter(line => line.trim());
  for (const line of lines) {
    if (line.startsWith('data:')) {
      const dataContent = line.slice(5).trim();
      if (dataContent) {
        console.log('SSE: Extracted data from incomplete SSE:', dataContent.substring(0, 100));
        
        // Handle special SSE markers
        const specialMarkers = ['[DONE]', 'ping', 'heartbeat'];
        if (specialMarkers.includes(dataContent.trim())) {
          return {
            data: dataContent,
          };
        }
        
        try {
          return {
            data: JSON.parse(dataContent),
          };
        } catch (e) {
          // Only log errors for non-special markers
          if (!dataContent.startsWith('[') || !dataContent.endsWith(']')) {
            console.log('SSE: Failed to parse incomplete data JSON:', {
              error: e instanceof Error ? e.message : String(e),
              stack: e instanceof Error ? e.stack : undefined,
              eventSummary: {
                dataLength: dataContent.length,
                dataPreview: dataContent.substring(0, 100)
              }
            });
          }
          return {
            data: dataContent,
          };
        }
      }
    }
  }

  console.log('SSE: Failed to parse incomplete data:', incompleteData.substring(0, 100));
  return null;
}

/**
 * Create a TransformStream for SSE parsing
 * @returns TransformStream that parses SSE messages
 */
export function createSSEParser(): TransformStream<Uint8Array, ParsedSSEMessage> {
  const decoder = new TextDecoder();
  let buffer = '';

  return new TransformStream({
    transform(chunk: Uint8Array, controller) {
      buffer += decoder.decode(chunk, { stream: true });
      const messages = buffer.split('\n\n');

      // Keep the last incomplete message in the buffer
      buffer = messages.pop() || '';

      for (const message of messages) {
        if (message.trim()) {
          const parsed = parseSSE(message);
          if (parsed) {
            controller.enqueue(parsed);
          }
        }
      }
    },

    flush(controller) {
      // Process any remaining data in the buffer
      if (buffer.trim()) {
        // Try normal parsing first
        let parsed = parseSSE(buffer);
        
        // If normal parsing fails, try parsing incomplete SSE data
        if (!parsed) {
          console.log('SSE: Normal parsing failed in flush, trying incomplete parsing');
          parsed = parseIncompleteSSE(buffer);
        }
        
        if (parsed) {
          controller.enqueue(parsed);
        } else {
          console.log('SSE: Failed to parse buffer in flush:', buffer.substring(0, 100));
        }
      }
    },
  });
}

/**
 * Create an SSE response from a ReadableStream
 * @param stream - The stream of SSE messages
 * @param headers - Optional additional headers
 * @returns Response object configured for SSE
 */
export function createSSEResponse(
  stream: ReadableStream<Uint8Array>,
  headers?: HeadersInit
): Response {
  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
      ...headers,
    },
  });
}

/**
 * Parse SSE stream from a Response object
 * @param response - The Response object containing SSE stream
 * @returns AsyncIterable of parsed SSE messages
 */
export async function* parseSSEStream(response: Response): AsyncIterable<ParsedSSEMessage> {
  if (!response.body) {
    throw new Error('Response body is empty');
  }

  const reader = response.body.pipeThrough(new TextDecoderStream()).getReader();

  let buffer = '';

  try {
    while (true) {
      const { done, value } = await reader.read();

      if (done) {
        // Process any remaining data
        if (buffer.trim()) {
          const parsed = parseSSE(buffer);
          if (parsed) {
            yield parsed;
          }
        }
        break;
      }

      buffer += value;
      const messages = buffer.split('\n\n');
      buffer = messages.pop() || '';

      for (const message of messages) {
        if (message.trim()) {
          const parsed = parseSSE(message);
          if (parsed) {
            yield parsed;
          }
        }
      }
    }
  } finally {
    reader.releaseLock();
  }
}

/**
 * Helper to create a done SSE message for OpenAI format
 * @returns SSE message indicating stream end
 */
export function createDoneMessage(): SSEMessage {
  return {
    data: '[DONE]',
  };
}

/**
 * Check if an SSE message is a done message
 * @param message - The SSE message to check
 * @returns True if it's a done message
 */
export function isDoneMessage(message: ParsedSSEMessage): boolean {
  return message.data === '[DONE]';
}

/**
 * Create an error SSE message
 * @param error - Error object or message
 * @returns SSE message containing error information
 */
export function createErrorMessage(error: any): SSEMessage {
  const errorData = {
    type: 'error',
    error: {
      type: error?.type || 'stream_error',
      message: error?.message || 'An error occurred during streaming',
    },
  };
  
  return {
    data: JSON.stringify(errorData),
  };
}

/**
 * Safely enqueue error message and done message
 * Used as fallback when stream errors occur
 * @param controller - Stream controller
 * @param error - Error that occurred
 */
export function enqueueErrorAndDone(
  controller: ReadableStreamDefaultController<Uint8Array>,
  error: any
): void {
  try {
    // Enqueue error message first
    const errorMessage = createErrorMessage(error);
    enqueueSSE(controller, errorMessage);
    
    // Then enqueue done message to terminate stream properly
    const doneMessage = createDoneMessage();
    enqueueSSE(controller, doneMessage);
    
    console.log('SSE: Error and DONE messages enqueued successfully');
  } catch (enqueueError) {
    console.error('SSE: Failed to enqueue error/done messages:', enqueueError);
    // Try to close the controller as last resort
    try {
      controller.close();
    } catch (closeError) {
      console.error('SSE: Failed to close controller:', closeError);
    }
  }
}
