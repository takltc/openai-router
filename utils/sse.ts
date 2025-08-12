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
  const lines = sseString.trim().split('\n');
  const message: ParsedSSEMessage = {
    data: '',
  };

  let dataLines: string[] = [];

  for (const line of lines) {
    if (line.startsWith('event:')) {
      message.event = line.slice(6).trim();
    } else if (line.startsWith('data:')) {
      dataLines.push(line.slice(5).trim());
    } else if (line.startsWith('id:')) {
      message.id = line.slice(3).trim();
    } else if (line.startsWith('retry:')) {
      const retryValue = parseInt(line.slice(6).trim(), 10);
      if (!isNaN(retryValue)) {
        message.retry = retryValue;
      }
    }
  }

  if (dataLines.length === 0) {
    return null;
  }

  // Join data lines and try to parse as JSON
  const dataString = dataLines.join('\n');
  try {
    message.data = JSON.parse(dataString);
  } catch {
    // If not valid JSON, keep as string
    message.data = dataString;
  }

  return message;
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
        const parsed = parseSSE(buffer);
        if (parsed) {
          controller.enqueue(parsed);
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
