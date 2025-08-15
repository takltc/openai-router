/**
 * Validation utility for checking tool_calls completeness
 * Helps prevent API errors by ensuring all tool_calls have corresponding results
 */

import type { OpenAIMessage, ClaudeMessage } from './types';

/**
 * Validate that all tool_calls in OpenAI messages have corresponding tool results
 */
export function validateOpenAIToolCalls(messages: OpenAIMessage[]): {
  valid: boolean;
  errors: string[];
} {
  const errors: string[] = [];
  const toolCallIds = new Set<string>();
  const toolResultIds = new Set<string>();

  messages.forEach((msg) => {
    // Collect tool_calls from assistant messages
    if (msg.role === 'assistant' && msg.tool_calls) {
      msg.tool_calls.forEach((tc) => {
        toolCallIds.add(tc.id);
      });
    }

    // Collect tool results
    if (msg.role === 'tool' && msg.tool_call_id) {
      toolResultIds.add(msg.tool_call_id);
    }
  });

  // Find orphaned tool_calls
  for (const id of toolCallIds) {
    if (!toolResultIds.has(id)) {
      errors.push(`Tool call "${id}" has no corresponding tool result message`);
    }
  }

  return {
    valid: errors.length === 0,
    errors,
  };
}

/**
 * Validate that all tool_use in Claude messages have corresponding tool_result
 */
export function validateClaudeToolCalls(messages: ClaudeMessage[]): {
  valid: boolean;
  errors: string[];
} {
  const errors: string[] = [];
  const toolUseIds = new Map<string, number>();
  const toolResultIds = new Map<string, number>();

  messages.forEach((msg, index) => {
    if (Array.isArray(msg.content)) {
      msg.content.forEach((content) => {
        if (content.type === 'tool_use') {
          toolUseIds.set(content.id, index);
        } else if (content.type === 'tool_result') {
          toolResultIds.set(content.tool_use_id, index);
        }
      });
    }
  });

  // Find orphaned tool_uses
  for (const [id, msgIndex] of toolUseIds) {
    if (!toolResultIds.has(id)) {
      errors.push(`Tool use "${id}" at message[${msgIndex}] has no corresponding tool_result`);
    } else {
      const resultIndex = toolResultIds.get(id)!;
      if (resultIndex <= msgIndex) {
        errors.push(
          `Tool use "${id}" at message[${msgIndex}] has tool_result at message[${resultIndex}] (should come after)`
        );
      }
    }
  }

  return {
    valid: errors.length === 0,
    errors,
  };
}

/**
 * Auto-fix orphaned tool_calls by adding placeholder results
 * WARNING: This should only be used as a last resort, as it may mask real issues
 */
export function fixOrphanedToolCalls(messages: OpenAIMessage[]): OpenAIMessage[] {
  const validation = validateOpenAIToolCalls(messages);
  if (validation.valid) {
    return messages;
  }

  const fixed = [...messages];
  const toolCallsWithoutResults = new Set<string>();
  const toolResultIds = new Set<string>();

  // First pass: identify what's missing
  messages.forEach((msg) => {
    if (msg.role === 'assistant' && msg.tool_calls) {
      msg.tool_calls.forEach((tc) => {
        toolCallsWithoutResults.add(tc.id);
      });
    }
    if (msg.role === 'tool' && msg.tool_call_id) {
      toolResultIds.add(msg.tool_call_id);
      toolCallsWithoutResults.delete(msg.tool_call_id);
    }
  });

  // Second pass: insert missing tool results
  for (let i = fixed.length - 1; i >= 0; i--) {
    const msg = fixed[i];
    if (msg.role === 'assistant' && msg.tool_calls) {
      const missingResults = msg.tool_calls
        .filter((tc) => toolCallsWithoutResults.has(tc.id))
        .map((tc) => ({
          role: 'tool' as const,
          tool_call_id: tc.id,
          content: JSON.stringify({
            error: 'No tool result provided',
            note: 'This is a placeholder generated to prevent API errors',
          }),
        }));

      if (missingResults.length > 0) {
        // Insert the missing results after this assistant message
        fixed.splice(i + 1, 0, ...missingResults);
      }
    }
  }

  return fixed;
}
