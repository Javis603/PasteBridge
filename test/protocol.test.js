const assert = require('assert');

const {
    BINARY_HEADER_LENGTH_BYTES,
    PROTOCOL_VERSION,
    createClipboardState,
    createMessageFactory,
    createMessage,
    parseIncomingMessage,
    preview,
    sanitizeText,
    serializeOutgoingMessage,
    sameClipboardState
} = require('../src/common/protocol');

module.exports.tests = [
    {
        name: 'sanitizeText removes null bytes from clipboard text',
        run() {
            assert.strictEqual(sanitizeText('Table of Contents\u0000'), 'Table of Contents');
            assert.strictEqual(sanitizeText('a\u0000b\u0000c'), 'abc');
        }
    },
    {
        name: 'createMessage removes null bytes from text payloads',
        run() {
            const message = createMessage({
                senderId: 'client-workstation',
                sessionId: 'session-null',
                sequence: 1,
                type: 'text',
                data: 'hello\u0000',
                timestamp: 1234567890,
                id: 'msg-null'
            });

            assert.strictEqual(message.data, 'hello');
        }
    },
    {
        name: 'parseIncomingMessage removes null bytes from text payloads',
        run() {
            const result = parseIncomingMessage(JSON.stringify(createMessage({
                senderId: 'client-workstation',
                sessionId: 'session-null-parse',
                sequence: 2,
                type: 'text',
                data: 'hello\u0000',
                timestamp: 1234567890,
                id: 'msg-null-parse'
            })), {
                maxTextBytes: 1024,
                maxImageBytes: 2048
            });

            assert.strictEqual(result.ok, true);
            assert.strictEqual(result.message.data, 'hello');
        }
    },
    {
        name: 'sameClipboardState compares type and hash',
        run() {
            const left = createClipboardState('text', 'hello');
            const right = createClipboardState('text', 'hello');
            const differentType = createClipboardState('image', 'hello');

            assert.strictEqual(sameClipboardState(left, right), true);
            assert.strictEqual(sameClipboardState(left, differentType), false);
        }
    },
    {
        name: 'createMessage adds protocol metadata',
        run() {
            const message = createMessage({
                senderId: 'client-workstation',
                sessionId: 'session-1',
                sequence: 7,
                type: 'text',
                data: 'hello',
                timestamp: 1234567890,
                id: 'msg-1'
            });

            assert.deepStrictEqual(message, {
                version: PROTOCOL_VERSION,
                id: 'msg-1',
                senderId: 'client-workstation',
                sessionId: 'session-1',
                sequence: 7,
                timestamp: 1234567890,
                type: 'text',
                data: 'hello'
            });
        }
    },
    {
        name: 'createMessageFactory increments sequence within a session',
        run() {
            const factory = createMessageFactory({
                senderId: 'client-workstation',
                sessionId: 'session-2',
                now: () => 1234567890
            });

            const first = factory.next('text', 'hello');
            const second = factory.next('text', 'world');

            assert.strictEqual(first.sessionId, 'session-2');
            assert.strictEqual(first.sequence, 1);
            assert.strictEqual(second.sequence, 2);
            assert.strictEqual(second.senderId, 'client-workstation');
        }
    },
    {
        name: 'parseIncomingMessage accepts valid text payload',
        run() {
            const result = parseIncomingMessage(JSON.stringify(createMessage({
                senderId: 'client-workstation',
                sessionId: 'session-3',
                sequence: 3,
                type: 'text',
                data: 'hello',
                timestamp: 1234567890,
                id: 'msg-2'
            })), {
                maxTextBytes: 1024,
                maxImageBytes: 2048
            });

            assert.strictEqual(result.ok, true);
            assert.deepStrictEqual(result.message, {
                version: PROTOCOL_VERSION,
                id: 'msg-2',
                senderId: 'client-workstation',
                sessionId: 'session-3',
                sequence: 3,
                timestamp: 1234567890,
                type: 'text',
                data: 'hello'
            });
        }
    },
    {
        name: 'parseIncomingMessage rejects oversized image payload',
        run() {
            const encoded = serializeOutgoingMessage(createMessage({
                senderId: 'client-workstation',
                sessionId: 'session-4',
                sequence: 4,
                type: 'image',
                data: Buffer.from('1234567890'),
                timestamp: 1234567890,
                id: 'msg-3'
            }));
            const result = parseIncomingMessage(encoded.payload, {
                maxTextBytes: 1024,
                maxImageBytes: 2
            }, {
                isBinary: true
            });

            assert.strictEqual(result.ok, false);
        }
    },
    {
        name: 'serializeOutgoingMessage uses binary frame for images',
        run() {
            const image = Buffer.from([1, 2, 3, 4]);
            const encoded = serializeOutgoingMessage(createMessage({
                senderId: 'client-workstation',
                sessionId: 'session-6',
                sequence: 6,
                type: 'image',
                data: image,
                timestamp: 1234567890,
                id: 'msg-6'
            }));

            assert.strictEqual(encoded.isBinary, true);
            assert.ok(Buffer.isBuffer(encoded.payload));
            assert.ok(encoded.payload.length > image.length + BINARY_HEADER_LENGTH_BYTES);
        }
    },
    {
        name: 'parseIncomingMessage accepts binary image payload',
        run() {
            const image = Buffer.from([9, 8, 7, 6]);
            const encoded = serializeOutgoingMessage(createMessage({
                senderId: 'client-workstation',
                sessionId: 'session-7',
                sequence: 7,
                type: 'image',
                data: image,
                timestamp: 1234567890,
                id: 'msg-7'
            }));

            const result = parseIncomingMessage(encoded.payload, {
                maxTextBytes: 1024,
                maxImageBytes: 2048
            }, {
                isBinary: true
            });

            assert.strictEqual(result.ok, true);
            assert.strictEqual(result.message.type, 'image');
            assert.ok(Buffer.isBuffer(result.message.data));
            assert.deepStrictEqual(Array.from(result.message.data), Array.from(image));
        }
    },
    {
        name: 'parseIncomingMessage rejects unsupported protocol version',
        run() {
            const result = parseIncomingMessage(JSON.stringify({
                version: 999,
                id: 'msg-4',
                senderId: 'client-workstation',
                sessionId: 'session-5',
                sequence: 5,
                timestamp: 1234567890,
                type: 'text',
                data: 'hello'
            }), {
                maxTextBytes: 1024,
                maxImageBytes: 2048
            });

            assert.strictEqual(result.ok, false);
            assert.match(result.error, /unsupported protocol version/);
        }
    },
    {
        name: 'preview normalizes whitespace and truncates',
        run() {
            assert.strictEqual(preview('a   b\nc\td'), 'a b c d');
            assert.strictEqual(preview('x'.repeat(50)).length, 40);
        }
    }
];
