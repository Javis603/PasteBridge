const assert = require('assert');

const { buildWebSocketUrl } = require('../src/common/url');

module.exports.tests = [
    {
        name: 'buildWebSocketUrl creates ws url without token',
        run() {
            const url = buildWebSocketUrl({
                serverIp: '192.168.1.8',
                serverPort: 8765,
                useTls: false,
                authToken: ''
            });

            assert.strictEqual(url, 'ws://192.168.1.8:8765');
        }
    },
    {
        name: 'buildWebSocketUrl creates wss url with encoded token',
        run() {
            const url = buildWebSocketUrl({
                serverIp: 'clip.local',
                serverPort: 443,
                useTls: true,
                authToken: 'a b+c'
            });

            assert.strictEqual(url, 'wss://clip.local:443?token=a%20b%2Bc');
        }
    }
];
