function buildWebSocketUrl({ serverIp, serverPort, useTls, authToken }) {
    const tokenQuery = authToken ? `?token=${encodeURIComponent(authToken)}` : '';
    return `${useTls ? 'wss' : 'ws'}://${serverIp}:${serverPort}${tokenQuery}`;
}

module.exports = {
    buildWebSocketUrl
};
