/**
 * Test SSE parsing logic to identify potential issues
 * @author jizhejiang
 * @date 2025-08-12
 */

import { parseSSE } from './utils/sse';

console.log('=== Testing SSE Parsing Logic ===\n');

// Test Case 1: Normal message_start event
console.log('Test Case 1: message_start event');
const messageStart = `event: message_start
data: {"type":"message_start","message":{"id":"msg_123","type":"message","role":"assistant","model":"claude-3-haiku-20240307","content":[],"stop_reason":null,"stop_sequence":null,"usage":{"input_tokens":10,"output_tokens":0}}}`;

console.log('Input:', JSON.stringify(messageStart));
const parsed1 = parseSSE(messageStart);
console.log('Result:', parsed1);
console.log('');

// Test Case 2: message_stop event (this is the critical one)
console.log('Test Case 2: message_stop event');
const messageStop = `event: message_stop
data: {"type":"message_stop"}`;

console.log('Input:', JSON.stringify(messageStop));
const parsed2 = parseSSE(messageStop);
console.log('Result:', parsed2);
console.log('');

// Test Case 3: message_stop without event header
console.log('Test Case 3: message_stop without event header');
const messageStopNoEvent = `data: {"type":"message_stop"}`;

console.log('Input:', JSON.stringify(messageStopNoEvent));
const parsed3 = parseSSE(messageStopNoEvent);
console.log('Result:', parsed3);
console.log('');

// Test Case 4: Empty data case (potential issue)
console.log('Test Case 4: Event with empty data');
const emptyData = `event: ping
data: `;

console.log('Input:', JSON.stringify(emptyData));
const parsed4 = parseSSE(emptyData);
console.log('Result:', parsed4);
console.log('');

// Test Case 5: Only event line, no data
console.log('Test Case 5: Only event line, no data');
const onlyEvent = `event: ping`;

console.log('Input:', JSON.stringify(onlyEvent));
const parsed5 = parseSSE(onlyEvent);
console.log('Result:', parsed5);
console.log('');

// Test Case 6: Typical Claude stream chunk
console.log('Test Case 6: Typical Claude content_block_delta');
const contentDelta = `event: content_block_delta
data: {"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"Hello"}}`;

console.log('Input:', JSON.stringify(contentDelta));
const parsed6 = parseSSE(contentDelta);
console.log('Result:', parsed6);
console.log('');

// Test Case 7: Multi-line data
console.log('Test Case 7: Multi-line data');
const multiLineData = `data: line1
data: line2
data: line3`;

console.log('Input:', JSON.stringify(multiLineData));
const parsed7 = parseSSE(multiLineData);
console.log('Result:', parsed7);
console.log('');

console.log('=== All tests completed ===');
