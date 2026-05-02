const crypto = require('crypto');
const PROTOCOL_VERSION = 2;
const BINARY_HEADER_LENGTH_BYTES = 4;

function hash(value) {
    return crypto.createHash('md5').update(value).digest('hex');
}

function byteLength(value) {
    return Buffer.byteLength(value, 'utf8');
}

function sanitizeText(value) {
    return typeof value === 'string' ? value.replace(/\u0000/g, '') : value;
}

function createClipboardState(type, data) {
    return { type, hash: hash(type === 'text' ? sanitizeText(data) : data) };
}

function generateMessageId() {
    if (typeof crypto.randomUUID === 'function') {
        return crypto.randomUUID();
    }

    return crypto.randomBytes(16).toString('hex');
}

function createSessionId() {
    return generateMessageId();
}

function sameClipboardState(left, right) {
    return Boolean(left && right && left.type === right.type && left.hash === right.hash);
}

function preview(value) {
    if (typeof value !== 'string') {
        return '';
    }

    return value.replace(/\s+/g, ' ').slice(0, 40);
}

function isValidBase64(value) {
    return typeof value === 'string' && /^[A-Za-z0-9+/=\r\n]+$/.test(value);
}

function isValidMessageMetadata(message) {
    return (
        Number.isInteger(message.version) &&
        message.version === PROTOCOL_VERSION &&
        typeof message.id === 'string' &&
        message.id.length > 0 &&
        message.id.length <= 128 &&
        typeof message.senderId === 'string' &&
        message.senderId.length > 0 &&
        message.senderId.length <= 128 &&
        typeof message.sessionId === 'string' &&
        message.sessionId.length > 0 &&
        message.sessionId.length <= 128 &&
        Number.isInteger(message.sequence) &&
        message.sequence > 0 &&
        Number.isInteger(message.timestamp) &&
        message.timestamp > 0
    );
}

function isMessageValid(message, limits) {
    if (!message || typeof message !== 'object') {
        return false;
    }

    if (!isValidMessageMetadata(message)) {
        return false;
    }

    if (message.type === 'text') {
        return typeof message.data === 'string' && byteLength(message.data) <= limits.maxTextBytes;
    }

    if (message.type === 'image') {
        return Buffer.isBuffer(message.data) && message.data.length <= limits.maxImageBytes;
    }

    return false;
}

function normalizeMessage(message) {
    if (message.type !== 'text') {
        return message;
    }

    return {
        ...message,
        data: sanitizeText(message.data)
    };
}

function createMessage({
    senderId,
    sessionId,
    sequence,
    type,
    data,
    timestamp = Date.now(),
    id = generateMessageId()
}) {
    return {
        version: PROTOCOL_VERSION,
        id,
        senderId,
        sessionId,
        sequence,
        timestamp,
        type,
        data: type === 'text' ? sanitizeText(data) : data
    };
}

function createMessageFactory({ senderId, sessionId = createSessionId(), now = () => Date.now() }) {
    let sequence = 0;

    return {
        sessionId,
        next(type, data) {
            sequence += 1;
            return createMessage({
                senderId,
                sessionId,
                sequence,
                type,
                data,
                timestamp: now()
            });
        }
    };
}

function parseIncomingMessage(raw, limits, options = {}) {
    try {
        const { isBinary = false } = options;
        const message = isBinary
            ? parseBinaryEnvelope(raw)
            : JSON.parse(typeof raw === 'string' ? raw : raw.toString());

        if (!message || typeof message !== 'object') {
            return {
                ok: false,
                error: 'invalid JSON payload'
            };
        }

        if (message.version !== PROTOCOL_VERSION) {
            return {
                ok: false,
                error: `unsupported protocol version: ${message.version}`
            };
        }

        const normalizedMessage = normalizeMessage(message);
        if (!isMessageValid(normalizedMessage, limits)) {
            return {
                ok: false,
                error: 'invalid payload'
            };
        }

        return {
            ok: true,
            message: normalizedMessage
        };
    } catch (err) {
        return {
            ok: false,
            error: err.message
        };
    }
}

function parseBinaryEnvelope(buffer) {
    if (!Buffer.isBuffer(buffer) || buffer.length < BINARY_HEADER_LENGTH_BYTES) {
        throw new Error('invalid binary frame');
    }

    const headerLength = buffer.readUInt32BE(0);
    const headerStart = BINARY_HEADER_LENGTH_BYTES;
    const headerEnd = headerStart + headerLength;

    if (headerLength <= 0 || headerEnd > buffer.length) {
        throw new Error('invalid binary frame header');
    }

    const header = JSON.parse(buffer.subarray(headerStart, headerEnd).toString('utf8'));
    return {
        ...header,
        data: buffer.subarray(headerEnd)
    };
}

function serializeOutgoingMessage(message) {
    if (message.type !== 'image') {
        return {
            payload: JSON.stringify(message),
            isBinary: false
        };
    }

    if (!Buffer.isBuffer(message.data)) {
        throw new Error('image messages require Buffer payloads');
    }

    const header = {
        version: message.version,
        id: message.id,
        senderId: message.senderId,
        sessionId: message.sessionId,
        sequence: message.sequence,
        timestamp: message.timestamp,
        type: message.type
    };
    const headerBuffer = Buffer.from(JSON.stringify(header), 'utf8');
    const frame = Buffer.allocUnsafe(BINARY_HEADER_LENGTH_BYTES + headerBuffer.length + message.data.length);

    frame.writeUInt32BE(headerBuffer.length, 0);
    headerBuffer.copy(frame, BINARY_HEADER_LENGTH_BYTES);
    message.data.copy(frame, BINARY_HEADER_LENGTH_BYTES + headerBuffer.length);

    return {
        payload: frame,
        isBinary: true
    };
}

module.exports = {
    PROTOCOL_VERSION,
    BINARY_HEADER_LENGTH_BYTES,
    byteLength,
    createClipboardState,
    createMessageFactory,
    createMessage,
    createSessionId,
    generateMessageId,
    hash,
    isMessageValid,
    isValidMessageMetadata,
    isValidBase64,
    parseBinaryEnvelope,
    parseIncomingMessage,
    preview,
    sanitizeText,
    serializeOutgoingMessage,
    sameClipboardState
};
