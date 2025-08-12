#!/usr/bin/env tsx
/**
 * Test complete tool_calls scenarios to verify conversion works correctly
 */

import { formatRequestClaude } from './utils/formatRequestClaude';
import type { OpenAIRequest } from './utils/types';

// Complete request with all tool results
const completeRequest: OpenAIRequest = {
  model: "gpt-4",
  messages: [
    {
      role: "user",
      content: "Can you help me with multiple tasks?"
    },
    {
      role: "assistant",
      content: "I'll help you with those tasks. Let me gather some information first.",
      tool_calls: [
        {
          id: "call_1",
          type: "function",
          function: {
            name: "get_info",
            arguments: JSON.stringify({ query: "task1" })
          }
        }
      ]
    },
    {
      role: "tool",
      tool_call_id: "call_1",
      content: JSON.stringify({ result: "Task 1 info" })
    },
    {
      role: "assistant",
      content: "Now let me get more information.",
      tool_calls: [
        {
          id: "call_2",
          type: "function",
          function: {
            name: "get_info",
            arguments: JSON.stringify({ query: "task2" })
          }
        }
      ]
    },
    {
      role: "tool",
      tool_call_id: "call_2",
      content: JSON.stringify({ result: "Task 2 info" })
    },
    {
      role: "assistant",
      content: "I've gathered all the information. Here's what I found..."
    }
  ],
  tools: [
    {
      type: "function",
      function: {
        name: "get_info",
        description: "Get information",
        parameters: {
          type: "object",
          properties: {
            query: { type: "string" }
          }
        }
      }
    }
  ]
};

console.log('=== Complete Request Test ===\n');
console.log('Original OpenAI Request (with all tool results):');
console.log(JSON.stringify(completeRequest, null, 2));
console.log('\n' + '='.repeat(50) + '\n');

const claudeRequest = formatRequestClaude(completeRequest);
console.log('Converted Claude Request:');
console.log(JSON.stringify(claudeRequest, null, 2));

// Validate tool pairing
console.log('\n=== Validation ===');
const toolUses: Map<string, number> = new Map();
const toolResults: Map<string, number> = new Map();

claudeRequest.messages.forEach((msg, index) => {
  if (Array.isArray(msg.content)) {
    msg.content.forEach(c => {
      if (c.type === 'tool_use') {
        toolUses.set(c.id, index);
        console.log(`✓ Found tool_use at message[${index}]: id="${c.id}"`);
      } else if (c.type === 'tool_result') {
        toolResults.set(c.tool_use_id, index);
        console.log(`✓ Found tool_result at message[${index}]: tool_use_id="${c.tool_use_id}"`);
      }
    });
  }
});

// Check pairing
let allPaired = true;
for (const [id, msgIndex] of toolUses) {
  if (toolResults.has(id)) {
    const resultIndex = toolResults.get(id)!;
    if (resultIndex > msgIndex) {
      console.log(`✓ Tool "${id}" properly paired: use at [${msgIndex}], result at [${resultIndex}]`);
    } else {
      console.log(`✗ Tool "${id}" has incorrect order: use at [${msgIndex}], result at [${resultIndex}]`);
      allPaired = false;
    }
  } else {
    console.log(`✗ Tool "${id}" at message[${msgIndex}] has no result`);
    allPaired = false;
  }
}

if (allPaired) {
  console.log('\n✅ SUCCESS: All tool_uses have properly paired tool_results!');
  console.log('This request should work with the Claude API without errors.');
} else {
  console.log('\n❌ ERROR: Some tool_uses are missing results or have incorrect ordering.');
}

// Test incomplete scenario for comparison
console.log('\n\n=== Incomplete Request Test (for comparison) ===\n');

const incompleteRequest: OpenAIRequest = {
  ...completeRequest,
  messages: completeRequest.messages.slice(0, -2) // Remove last tool result and final assistant message
};

console.log('Incomplete request (missing last tool result):');
const incompleteClaudeRequest = formatRequestClaude(incompleteRequest);

// Quick validation
const incompleteToolUses: string[] = [];
const incompleteToolResults: string[] = [];

incompleteClaudeRequest.messages.forEach((msg) => {
  if (Array.isArray(msg.content)) {
    msg.content.forEach(c => {
      if (c.type === 'tool_use') {
        incompleteToolUses.push(c.id);
      } else if (c.type === 'tool_result') {
        incompleteToolResults.push(c.tool_use_id);
      }
    });
  }
});

console.log('Tool uses:', incompleteToolUses);
console.log('Tool results:', incompleteToolResults);

const orphaned = incompleteToolUses.filter(id => !incompleteToolResults.includes(id));
if (orphaned.length > 0) {
  console.log(`\n⚠️  Orphaned tool_uses: ${orphaned.join(', ')}`);
  console.log('This will cause the API error: "tool_calls must be followed by tool messages"');
}
