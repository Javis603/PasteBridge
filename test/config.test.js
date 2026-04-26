const assert = require('assert');

const { loadClientConfig, loadServerConfig, parseByteSize } = require('../src/common/config');

module.exports.tests = [
    {
        name: 'loadServerConfig parses defaults and numeric overrides',
        run() {
            const config = loadServerConfig({
                PORT: '9000',
                POLL_INTERVAL_MS: '1500',
                MAX_TEXT_BYTES: '2KB',
                MESSAGE_CACHE_SIZE: '333',
                MESSAGE_CACHE_TTL_MS: '90000',
                SENDER_ID: 'my-server'
            });

            assert.strictEqual(config.port, 9000);
            assert.strictEqual(config.pollIntervalMs, 1500);
            assert.strictEqual(config.maxTextBytes, 2048);
            assert.strictEqual(config.messageCacheSize, 333);
            assert.strictEqual(config.messageCacheTtlMs, 90000);
            assert.strictEqual(config.senderId, 'my-server');
            assert.strictEqual(config.tlsCertPath, '');
        }
    },
    {
        name: 'loadServerConfig defaults to one second clipboard polling',
        run() {
            const config = loadServerConfig({});

            assert.strictEqual(config.pollIntervalMs, 1000);
        }
    },
    {
        name: 'loadServerConfig requires TLS cert and key together',
        run() {
            assert.throws(() => {
                loadServerConfig({
                    TLS_CERT_PATH: '/tmp/cert.pem'
                });
            }, /TLS_CERT_PATH and TLS_KEY_PATH must be set together/);
        }
    },
    {
        name: 'loadClientConfig parses tls and reconnect settings',
        run() {
            const config = loadClientConfig({
                SERVER_IP: '10.0.0.2',
                PORT: '8766',
                USE_TLS: 'true',
                SENDER_ID: 'win-box',
                RECONNECT_DELAY_MS: '2500',
                MAX_RECONNECT_DELAY_MS: '9000',
                MAX_IMAGE_BYTES: '25MB',
                MESSAGE_CACHE_SIZE: '123'
            });

            assert.strictEqual(config.serverIp, '10.0.0.2');
            assert.strictEqual(config.serverPort, 8766);
            assert.strictEqual(config.useTls, true);
            assert.strictEqual(config.senderId, 'win-box');
            assert.strictEqual(config.initialReconnectDelayMs, 2500);
            assert.strictEqual(config.maxReconnectDelayMs, 9000);
            assert.strictEqual(config.maxImageBytes, 25 * 1024 * 1024);
            assert.strictEqual(config.messageCacheSize, 123);
        }
    },
    {
        name: 'parseByteSize supports human-readable units',
        run() {
            assert.strictEqual(parseByteSize('X', 1, { X: '512KB' }), 512 * 1024);
            assert.strictEqual(parseByteSize('X', 1, { X: '4MB' }), 4 * 1024 * 1024);
            assert.strictEqual(parseByteSize('X', 1, { X: '1GB' }), 1024 * 1024 * 1024);
        }
    },
    {
        name: 'parseByteSize rejects invalid size strings',
        run() {
            assert.throws(() => {
                parseByteSize('X', 1, { X: '12TB' });
            }, /positive byte size/);
        }
    }
];
