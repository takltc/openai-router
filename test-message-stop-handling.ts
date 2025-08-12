/**
 * Test message_stop event handling in various scenarios
 * @author jizhejiang
 * @date 2025-08-12
 */

import { parseSSE } from './utils/sse';

console.log('=== Testing message_stop Event Handling ===\n');

// Test Case 1: Normal message_stop with data
console.log('Test Case 1: Normal message_stop with data');
const messageStopWithData = `event: message_stop
data: {"type":"message_stop"}`;

console.log('Input:', JSON.stringify(messageStopWithData));
const parsed1 = parseSSE(messageStopWithData);
console.log('Result:', parsed1);
console.log('Is event properly detected?', parsed1?.data && parsed1.data.type === 'message_stop');
console.log('');

// Test Case 2: message_stop without data (problematic case)
console.log('Test Case 2: message_stop without data (problematic case)');
const messageStopNoData = `event: message_stop`;

console.log('Input:', JSON.stringify(messageStopNoData));
const parsed2 = parseSSE(messageStopNoData);
console.log('Result:', parsed2);
console.log('Is event field preserved?', parsed2?.event === 'message_stop');
console.log('Can we detect this as a message_stop event?', parsed2?.event === 'message_stop');
console.log('');

// Test Case 3: Empty data with message_stop event
console.log('Test Case 3: Empty data with message_stop event');
const messageStopEmptyData = `event: message_stop
data: `;

console.log('Input:', JSON.stringify(messageStopEmptyData));
const parsed3 = parseSSE(messageStopEmptyData);
console.log('Result:', parsed3);
console.log('Is event field preserved?', parsed3?.event === 'message_stop');
console.log('');

// Test Case 4: message_stop with malformed JSON
console.log('Test Case 4: message_stop with malformed JSON');
const messageStopBadJson = `event: message_stop
data: {"type":"message_stop"`;

console.log('Input:', JSON.stringify(messageStopBadJson));
const parsed4 = parseSSE(messageStopBadJson);
console.log('Result:', parsed4);
console.log('Is event field preserved?', parsed4?.event === 'message_stop');
console.log('');

// Test Case 5: Simulate real-world scenario with buffer split
console.log('Test Case 5: Simulate buffer split scenario');
const bufferChunk1 = `event: message_st`;
const bufferChunk2 = `op
data: {"type":"message_stop"}`;
const combinedBuffer = bufferChunk1 + bufferChunk2;

console.log('Combined buffer:', JSON.stringify(combinedBuffer));
const parsed5 = parseSSE(combinedBuffer);
console.log('Result:', parsed5);
console.log('');

console.log('=== message_stop handling tests completed ===');
