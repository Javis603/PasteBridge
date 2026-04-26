const os = require('os');
const path = require('path');

function parsePositiveInt(name, fallback, source = process.env) {
    const raw = source[name];
    if (raw == null || raw === '') {
        return fallback;
    }

    const value = Number(raw);
    if (!Number.isInteger(value) || value <= 0) {
        throw new Error(`${name} must be a positive integer.`);
    }

    return value;
}

function parseByteSize(name, fallback, source = process.env) {
    const raw = source[name];
    if (raw == null || raw === '') {
        return fallback;
    }

    if (typeof raw === 'number') {
        if (!Number.isInteger(raw) || raw <= 0) {
            throw new Error(`${name} must be a positive byte size.`);
        }

        return raw;
    }

    const normalized = String(raw).trim().toUpperCase();
    const match = normalized.match(/^(\d+)\s*(B|KB|MB|GB)?$/);
    if (!match) {
        throw new Error(`${name} must be a positive byte size like 4194304, 512KB, 4MB, or 1GB.`);
    }

    const value = Number(match[1]);
    const unit = match[2] || 'B';
    const multipliers = {
        B: 1,
        KB: 1024,
        MB: 1024 * 1024,
        GB: 1024 * 1024 * 1024
    };

    const bytes = value * multipliers[unit];
    if (!Number.isSafeInteger(bytes) || bytes <= 0) {
        throw new Error(`${name} must be a positive byte size.`);
    }

    return bytes;
}

function validatePairedValues(leftName, leftValue, rightName, rightValue) {
    if (Boolean(leftValue) !== Boolean(rightValue)) {
        throw new Error(`${leftName} and ${rightName} must be set together.`);
    }
}

function resolveSenderId(role, source = process.env) {
    const explicitSenderId = (source.SENDER_ID || '').trim();
    if (explicitSenderId) {
        return explicitSenderId;
    }

    const host = os.hostname() || 'unknown-host';
    return `${role}-${host}`;
}

function loadServerConfig(source = process.env) {
    const tlsCertPath = source.TLS_CERT_PATH || '';
    const tlsKeyPath = source.TLS_KEY_PATH || '';
    validatePairedValues('TLS_CERT_PATH', tlsCertPath, 'TLS_KEY_PATH', tlsKeyPath);

    return {
        port: parsePositiveInt('PORT', 8765, source),
        authToken: source.AUTH_TOKEN || '',
        senderId: resolveSenderId('server', source),
        tlsCertPath,
        tlsKeyPath,
        tempSendPath: source.TEMP_SEND_PATH || '/tmp/pastebridge_send.png',
        tempRecvPath: source.TEMP_RECV_PATH || '/tmp/pastebridge_recv.png',
        pollIntervalMs: parsePositiveInt('POLL_INTERVAL_MS', 1000, source),
        suppressMs: parsePositiveInt('SUPPRESS_MS', 5000, source),
        maxTextBytes: parseByteSize('MAX_TEXT_BYTES', 4 * 1024 * 1024, source),
        maxImageBytes: parseByteSize('MAX_IMAGE_BYTES', 25 * 1024 * 1024, source),
        maxWsBufferBytes: parseByteSize('MAX_WS_BUFFER_BYTES', 16 * 1024 * 1024, source),
        heartbeatIntervalMs: parsePositiveInt('HEARTBEAT_INTERVAL_MS', 15000, source),
        messageCacheSize: parsePositiveInt('MESSAGE_CACHE_SIZE', 1000, source),
        messageCacheTtlMs: parsePositiveInt('MESSAGE_CACHE_TTL_MS', 5 * 60 * 1000, source)
    };
}

function loadClientConfig(source = process.env) {
    return {
        authToken: source.AUTH_TOKEN || '',
        senderId: resolveSenderId('client', source),
        serverIp: source.SERVER_IP || '',
        serverPort: parsePositiveInt('PORT', 8765, source),
        useTls: source.USE_TLS === 'true',
        tlsCaPath: source.TLS_CA_PATH || '',
        tempSendPath: source.TEMP_SEND_PATH || path.join(os.tmpdir(), 'pastebridge_send.png'),
        tempRecvPath: source.TEMP_RECV_PATH || path.join(os.tmpdir(), 'pastebridge_recv.png'),
        pollIntervalMs: parsePositiveInt('POLL_INTERVAL_MS', 1000, source),
        suppressMs: parsePositiveInt('SUPPRESS_MS', 5000, source),
        initialReconnectDelayMs: parsePositiveInt('RECONNECT_DELAY_MS', 5000, source),
        maxReconnectDelayMs: parsePositiveInt('MAX_RECONNECT_DELAY_MS', 30000, source),
        maxTextBytes: parseByteSize('MAX_TEXT_BYTES', 4 * 1024 * 1024, source),
        maxImageBytes: parseByteSize('MAX_IMAGE_BYTES', 25 * 1024 * 1024, source),
        maxWsBufferBytes: parseByteSize('MAX_WS_BUFFER_BYTES', 16 * 1024 * 1024, source),
        messageCacheSize: parsePositiveInt('MESSAGE_CACHE_SIZE', 1000, source),
        messageCacheTtlMs: parsePositiveInt('MESSAGE_CACHE_TTL_MS', 5 * 60 * 1000, source)
    };
}

module.exports = {
    loadClientConfig,
    loadServerConfig,
    parseByteSize,
    parsePositiveInt,
    resolveSenderId,
    validatePairedValues
};
