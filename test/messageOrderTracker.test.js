const assert = require('assert');

const { createMessageOrderTracker } = require('../src/common/messageOrderTracker');

module.exports.tests = [
    {
        name: 'accepts increasing sequence within same sender session',
        run() {
            const tracker = createMessageOrderTracker();

            assert.strictEqual(tracker.observe({
                senderId: 'sender-a',
                sessionId: 'session-1',
                sequence: 1,
                timestamp: 100
            }), true);
            assert.strictEqual(tracker.observe({
                senderId: 'sender-a',
                sessionId: 'session-1',
                sequence: 2,
                timestamp: 101
            }), true);
        }
    },
    {
        name: 'rejects stale sequence within same sender session',
        run() {
            const tracker = createMessageOrderTracker();

            tracker.observe({
                senderId: 'sender-a',
                sessionId: 'session-1',
                sequence: 5,
                timestamp: 100
            });

            assert.strictEqual(tracker.observe({
                senderId: 'sender-a',
                sessionId: 'session-1',
                sequence: 4,
                timestamp: 101
            }), false);
        }
    },
    {
        name: 'rejects old session messages after newer timestamp from same sender',
        run() {
            const tracker = createMessageOrderTracker();

            tracker.observe({
                senderId: 'sender-a',
                sessionId: 'session-new',
                sequence: 1,
                timestamp: 200
            });

            assert.strictEqual(tracker.observe({
                senderId: 'sender-a',
                sessionId: 'session-old',
                sequence: 99,
                timestamp: 150
            }), false);
        }
    },
    {
        name: 'allows different senders to progress independently',
        run() {
            const tracker = createMessageOrderTracker();

            assert.strictEqual(tracker.observe({
                senderId: 'sender-a',
                sessionId: 'session-1',
                sequence: 10,
                timestamp: 500
            }), true);

            assert.strictEqual(tracker.observe({
                senderId: 'sender-b',
                sessionId: 'session-1',
                sequence: 1,
                timestamp: 100
            }), true);
        }
    }
];
