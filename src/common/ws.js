const { serializeOutgoingMessage } = require('./protocol');

function safeSend(ws, message, options = {}) {
    const {
        label = 'message',
        maxBufferedBytes = 16 * 1024 * 1024,
        logger = console
    } = options;

    if (ws.readyState !== ws.OPEN && ws.readyState !== 1) {
        return false;
    }

    if (ws.bufferedAmount > maxBufferedBytes) {
        logger.warn(`[ws] skipping ${label}; bufferedAmount=${ws.bufferedAmount}`);
        return false;
    }

    try {
        const encoded = serializeOutgoingMessage(message);

        ws.send(encoded.payload, { binary: encoded.isBinary }, (err) => {
            if (err) {
                logger.error(`failed to send ${label}:`, err.message);
            }
        });
        return true;
    } catch (err) {
        logger.error(`failed to queue ${label}:`, err.message);
        return false;
    }
}

module.exports = {
    safeSend
};
