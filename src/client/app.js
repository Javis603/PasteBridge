const fs = require('fs');

const WebSocket = require('ws');

const { createLogger } = require('../common/logger');
const { createClipboardState, createMessageFactory, parseIncomingMessage, preview, sameClipboardState } = require('../common/protocol');
const { createMessageOrderTracker } = require('../common/messageOrderTracker');
const { createRecentMessageCache } = require('../common/recentMessageCache');
const { buildWebSocketUrl } = require('../common/url');
const { safeSend } = require('../common/ws');
const { createWindowsClipboard } = require('../platform/windowsClipboard');

async function startClient(config, dependencies = {}) {
    const logger = dependencies.logger || createLogger('client');
    const clipboard = dependencies.clipboard || createWindowsClipboard({
        tempSendPath: config.tempSendPath,
        tempRecvPath: config.tempRecvPath,
        maxTextBytes: config.maxTextBytes,
        maxImageBytes: config.maxImageBytes,
        logger
    });
    const messageFactory = dependencies.messageFactory || createMessageFactory({
        senderId: config.senderId
    });
    const recentMessages = dependencies.recentMessages || createRecentMessageCache({
        maxEntries: config.messageCacheSize,
        ttlMs: config.messageCacheTtlMs
    });
    const messageOrder = dependencies.messageOrder || createMessageOrderTracker({
        maxEntries: config.messageCacheSize,
        ttlMs: config.messageCacheTtlMs
    });

    let lastState = null;
    let suppressUntil = 0;
    let reconnectDelayMs = config.initialReconnectDelayMs;
    let reconnectTimer = null;
    let pollTimer = null;
    let pollInProgress = false;
    let stopped = false;
    let activeSocket = null;

    function setClipboardState(state) {
        lastState = state;
    }

    function suppress(ms = config.suppressMs) {
        suppressUntil = Date.now() + ms;
    }

    async function seedLocalClipboardState() {
        const entry = await clipboard.readEntry();
        if (!entry) {
            logger.warn('failed to seed clipboard state; starting without baseline');
            return;
        }

        lastState = entry.state;
        logger.log(`[seed] initial clipboard type: ${entry.type}`);
    }

    function clearPollTimer() {
        if (pollTimer) {
            clearTimeout(pollTimer);
            pollTimer = null;
        }
    }

    function scheduleNextPoll(ws) {
        if (stopped) {
            return;
        }

        clearPollTimer();
        pollTimer = setTimeout(() => {
            void pollClipboard(ws);
        }, config.pollIntervalMs);
    }

    async function pollClipboard(ws) {
        if (stopped) {
            return;
        }

        if (ws.readyState !== WebSocket.OPEN) {
            scheduleNextPoll(ws);
            return;
        }

        if (pollInProgress) {
            scheduleNextPoll(ws);
            return;
        }

        pollInProgress = true;

        try {
            if (Date.now() < suppressUntil) {
                return;
            }

            const entry = await clipboard.readEntry();
            if (!entry) {
                return;
            }

            if (sameClipboardState(entry.state, lastState)) {
                return;
            }

            lastState = entry.state;
            if (entry.type === 'image') {
                logger.log('[image] clipboard changed, sending to server');
            } else {
                logger.log(`[text] clipboard changed: ${preview(entry.data)}...`);
            }

            const message = messageFactory.next(entry.type, entry.data);
            recentMessages.remember(message);
            messageOrder.mark(message);

            safeSend(ws, message, {
                label: `local ${entry.type}`,
                maxBufferedBytes: config.maxWsBufferBytes,
                logger
            });
        } catch (err) {
            logger.error('clipboard poll failed:', err.message);
        } finally {
            pollInProgress = false;
            scheduleNextPoll(ws);
        }
    }

    function clearReconnectTimer() {
        if (reconnectTimer) {
            clearTimeout(reconnectTimer);
            reconnectTimer = null;
        }
    }

    function scheduleReconnect() {
        if (stopped) {
            return;
        }

        clearReconnectTimer();

        const delay = reconnectDelayMs;
        logger.log(`connection closed, retrying in ${Math.round(delay / 1000)}s`);
        reconnectTimer = setTimeout(() => {
            void connect();
        }, delay);

        reconnectDelayMs = Math.min(reconnectDelayMs * 2, config.maxReconnectDelayMs);
    }

    async function handleMessage(raw, isBinary) {
        const result = parseIncomingMessage(raw, {
            maxTextBytes: config.maxTextBytes,
            maxImageBytes: config.maxImageBytes
        }, {
            isBinary
        });

        if (!result.ok) {
            logger.error('rejected incoming message:', result.error);
            return;
        }

        const { message } = result;
        if (!recentMessages.remember(message)) {
            logger.log(`[ws] duplicate message ignored: ${message.id}`);
            return;
        }

        if (!messageOrder.observe(message)) {
            logger.log(`[ws] stale message ignored: sender=${message.senderId} session=${message.sessionId} sequence=${message.sequence}`);
            return;
        }

        if (message.type === 'text') {
            logger.log(`[text] received from server: ${preview(message.data)}...`);
            if (await clipboard.writeText(message.data)) {
                suppress();
                setClipboardState(createClipboardState('text', message.data));
            }
        } else if (message.type === 'image') {
            logger.log('[image] received from server');
            const stableState = await clipboard.writeImage(message.data);
            if (stableState) {
                suppress();
                lastState = stableState;
                logger.log('[image] wrote image to Windows clipboard');
            }
        }
    }

    function buildSocketOptions() {
        if (!config.useTls || !config.tlsCaPath) {
            return undefined;
        }

        return {
            ca: fs.readFileSync(config.tlsCaPath)
        };
    }

    async function connect() {
        if (!config.serverIp) {
            logger.error('SERVER_IP is not set.');
            return;
        }

        const serverUrl = buildWebSocketUrl({
            serverIp: config.serverIp,
            serverPort: config.serverPort,
            useTls: config.useTls,
            authToken: config.authToken
        });

        logger.log(`connecting to server: ${serverUrl}`);
        const ws = new WebSocket(serverUrl, buildSocketOptions());
        activeSocket = ws;

        ws.on('open', () => {
            reconnectDelayMs = config.initialReconnectDelayMs;
            clearReconnectTimer();
            logger.log('connected to server');
            scheduleNextPoll(ws);
        });

        ws.on('message', (raw, isBinary) => {
            void handleMessage(raw, isBinary).catch((err) => {
                logger.error('message handling failed:', err.message);
            });
        });

        ws.on('close', () => {
            if (activeSocket === ws) {
                activeSocket = null;
            }

            clearPollTimer();
            scheduleReconnect();
        });

        ws.on('error', (err) => {
            logger.error('websocket error:', err.message);
        });
    }

    await seedLocalClipboardState();

    if (!config.authToken) {
        logger.warn('AUTH_TOKEN is not set; clipboard sync is running without client authentication.');
    } else if (config.authToken.length < 16) {
        logger.warn('AUTH_TOKEN is shorter than 16 characters; use a longer secret for better security.');
    }

    if (config.useTls) {
        logger.log('TLS transport enabled');
    }

    logger.log(`senderId=${config.senderId}`);
    logger.log(`sessionId=${messageFactory.sessionId}`);

    await connect();

    return {
        async stop() {
            stopped = true;
            clearPollTimer();
            clearReconnectTimer();

            if (activeSocket) {
                if (activeSocket.readyState === WebSocket.OPEN || activeSocket.readyState === WebSocket.CONNECTING) {
                    await new Promise((resolve) => {
                        activeSocket.once('close', resolve);
                        activeSocket.close();
                    });
                }

                activeSocket = null;
            }
        }
    };
}

module.exports = {
    startClient
};
