const assert = require('assert');

const { createRecentMessageCache } = require('../src/common/recentMessageCache');

module.exports.tests = [
    {
        name: 'remember returns false for duplicate message ids',
        run() {
            const cache = createRecentMessageCache();
            const message = { id: 'msg-1' };

            assert.strictEqual(cache.remember(message), true);
            assert.strictEqual(cache.remember(message), false);
        }
    },
    {
        name: 'cache evicts oldest entries beyond max size',
        run() {
            const cache = createRecentMessageCache({
                maxEntries: 2,
                ttlMs: 1000
            });

            cache.add('a');
            cache.add('b');
            cache.add('c');

            assert.strictEqual(cache.has('a'), false);
            assert.strictEqual(cache.has('b'), true);
            assert.strictEqual(cache.has('c'), true);
        }
    },
    {
        name: 'cache expires entries by ttl',
        run() {
            let nowValue = 0;
            const cache = createRecentMessageCache({
                maxEntries: 10,
                ttlMs: 50,
                now: () => nowValue
            });

            cache.add('msg-1');
            nowValue = 100;

            assert.strictEqual(cache.has('msg-1'), false);
            assert.strictEqual(cache.size(), 0);
        }
    }
];
