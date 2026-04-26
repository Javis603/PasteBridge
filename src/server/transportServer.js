const fs = require('fs');
const http = require('http');
const https = require('https');

function createTransportServer(config) {
    if (!config.tlsCertPath && !config.tlsKeyPath) {
        return {
            server: http.createServer(),
            isTls: false
        };
    }

    return {
        server: https.createServer({
            cert: fs.readFileSync(config.tlsCertPath),
            key: fs.readFileSync(config.tlsKeyPath)
        }),
        isTls: true
    };
}

module.exports = {
    createTransportServer
};
