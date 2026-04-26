const WebSocket = require('ws');
const { URL } = require('url');

const { createLogger } = require('../common/logger');
const { createClipboardState, createMessageFactory, parseIncomingMessage, preview, sameClipboardState } = require('../common/protocol');
const { createMessageOrderTracker } = require('../common/messageOrderTracker');
const { createRecentMessageCache } = require('../common/recentMessageCache');
const { safeSend } = require('../common/ws');
const { createMacClipboard } = require('../platform/macClipboard');
const { createTransportServer } = require('./transportServer');

async function startServer(config, dependencies = {}) {
    const logger = dependencies.logger || createLogger('server');
    const clipboard = dependencies.clipboard || createMacClipboard({
        tempSendPath: config.tempSendPath,
        tempRecvPath: config.tempRecvPath,
        maxTextBytes: config.maxTextBytes,
        maxImageBytes: config.maxImageBytes,
        logger
    });
    const transport = dependencies.transport || createTransportServer(config);
    const transportServer = transport.server;
    const isTls = transport.isTls;
    const wss = new WebSocket.Server({ noServer: true });
    const clients = new Set();
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
    let pollTimer = null;
    let pollInProgress = false;
    let heartbeatTimer = null;
    let stopped = false;

    function setClipboardState(type, data) {
        lastState = createClipboardState(type, data);
    }

    function suppress(ms = config.suppressMs) {
        suppressUntil = Date.now() + ms;
    }

    async function seedLocalClipboardState() {
        const entry = await clipboard.readEntry();
        if (!entry) {
            logger.warn('failed to seed clipboard state; starting without baseline');
            return null;
        }

        lastState = entry.state;
        logger.log(`[seed] initial clipboard type: ${entry.type}`);
        return entry;
    }

    async function maybeSendInitialSnapshot(ws) {
        const entry = await clipboard.readEntry();
        if (!entry) {
            return;
        }

        lastState = entry.state;

        if (entry.type === 'text' && entry.data === '') {
            return;
        }

        const message = messageFactory.next(entry.type, entry.data);
        recentMessages.remember(message);
        messageOrder.mark(message);

        if (safeSend(ws, message, {
            label: `initial ${entry.type} snapshot`,
            maxBufferedBytes: config.maxWsBufferBytes,
            logger
        })) {
            logger.log(`[sync] sent initial ${entry.type} snapshot to new client`);
        }
    }

    function broadcast(message, excludeWs = null) {
        for (const client of clients) {
            if (client !== excludeWs) {
                safeSend(client, message, {
                    label: `broadcast ${message.type}`,
                    maxBufferedBytes: config.maxWsBufferBytes,
                    logger
                });
            }
        }
    }

    function broadcastLocalMessage(type, data) {
        const message = messageFactory.next(type, data);
        recentMessages.remember(message);
        messageOrder.mark(message);
        broadcast(message);
    }

    function scheduleNextPoll() {
        if (stopped) {
            return;
        }

        pollTimer = setTimeout(() => {
            void pollClipboard();
        }, config.pollIntervalMs);
    }

    async function pollClipboard() {
        if (stopped) {
            return;
        }

        if (pollInProgress) {
            scheduleNextPoll();
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
                logger.log('[image] clipboard changed, broadcasting to clients');
            } else {
                logger.log(`[text] clipboard changed: ${preview(entry.data)}...`);
            }

            broadcastLocalMessage(entry.type, entry.data);
        } catch (err) {
            logger.error('clipboard poll failed:', err.message);
        } finally {
            pollInProgress = false;
            scheduleNextPoll();
        }
    }

    function startHeartbeat() {
        heartbeatTimer = setInterval(() => {
            for (const client of clients) {
                if (!client.isAlive) {
                    logger.warn('terminating stale client connection');
                    clients.delete(client);
                    client.terminate();
                    continue;
                }

                client.isAlive = false;
                try {
                    client.ping();
                } catch (err) {
                    logger.error('heartbeat ping failed:', err.message);
                }
            }
        }, config.heartbeatIntervalMs);
    }

    async function handleMessage(ws, raw, isBinary) {
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
            logger.log(`[text] received from client: ${preview(message.data)}...`);
            if (await clipboard.writeText(message.data)) {
                suppress();
                setClipboardState('text', message.data);
            }
        } else if (message.type === 'image') {
            logger.log('[image] received from client');
            const stableState = await clipboard.writeImage(message.data);
            if (stableState) {
                suppress();
                lastState = stableState;
            }
        }

        broadcast(message, ws);
    }

    transportServer.on('upgrade', (req, socket, head) => {
        if (config.authToken) {
            let token = '';

            try {
                const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
                token = url.searchParams.get('token') || '';
            } catch (err) {
                logger.error('failed to parse upgrade URL:', err.message);
            }

            if (token !== config.authToken) {
                socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n');
                socket.destroy();
                return;
            }
        }

        wss.handleUpgrade(req, socket, head, (upgradedWs) => {
            wss.emit('connection', upgradedWs, req);
        });
    });

    wss.on('connection', (ws) => {
        ws.isAlive = true;
        ws.on('pong', () => {
            ws.isAlive = true;
        });

        clients.add(ws);
        logger.log(`client connected, total clients: ${clients.size}`);

        void maybeSendInitialSnapshot(ws).catch((err) => {
            logger.error('failed to send initial snapshot:', err.message);
        });

        ws.on('message', (raw, isBinary) => {
            void handleMessage(ws, raw, isBinary).catch((err) => {
                logger.error('message handling failed:', err.message);
            });
        });

        ws.on('close', () => {
            clients.delete(ws);
            logger.log(`client disconnected, total clients: ${clients.size}`);
        });

        ws.on('error', (err) => {
            logger.error('client error:', err.message);
        });
    });

    transportServer.on('error', (err) => {
        logger.error('transport server error:', err.message);
    });

    await seedLocalClipboardState();
    await new Promise((resolve, reject) => {
        const onError = (err) => {
            transportServer.off('listening', onListening);
            reject(err);
        };
        const onListening = () => {
            transportServer.off('error', onError);
            resolve();
        };

        transportServer.once('error', onError);
        transportServer.once('listening', onListening);
        transportServer.listen(config.port);
    });

    logger.log(`PasteBridge server listening on port ${config.port} (${isTls ? 'wss' : 'ws'})`);
    logger.log(`senderId=${config.senderId}`);
    logger.log(`sessionId=${messageFactory.sessionId}`);
    if (!config.authToken) {
        logger.warn('AUTH_TOKEN is not set; clipboard sync is running without client authentication.');
    } else if (config.authToken.length < 16) {
        logger.warn('AUTH_TOKEN is shorter than 16 characters; use a longer secret for better security.');
    }

    startHeartbeat();
    scheduleNextPoll();

    return {
        async stop() {
            stopped = true;

            if (pollTimer) {
                clearTimeout(pollTimer);
                pollTimer = null;
            }

            if (heartbeatTimer) {
                clearInterval(heartbeatTimer);
                heartbeatTimer = null;
            }

            for (const client of clients) {
                try {
                    client.close();
                } catch (err) {
                    logger.error('failed to close client:', err.message);
                }
            }

            await new Promise((resolve) => {
                wss.close(() => resolve());
            });

            await new Promise((resolve, reject) => {
                transportServer.close((err) => {
                    if (err) {
                        reject(err);
                        return;
                    }

                    resolve();
                });
            });
        }
    };
}

module.exports = {
    startServer
};
