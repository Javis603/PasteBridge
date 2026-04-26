require('dotenv').config();

const { loadServerConfig } = require('./src/common/config');
const { startServer } = require('./src/server/app');

async function main() {
    const app = await startServer(loadServerConfig());
    let stopping = false;

    async function shutdown(signal) {
        if (stopping) {
            return;
        }

        stopping = true;
        console.log(`[server] received ${signal}, shutting down`);

        try {
            await app.stop();
            process.exit(0);
        } catch (err) {
            console.error('[server] shutdown failed:', err.message);
            process.exit(1);
        }
    }

    process.on('SIGINT', () => {
        void shutdown('SIGINT');
    });
    process.on('SIGTERM', () => {
        void shutdown('SIGTERM');
    });
}

main().catch((err) => {
    console.error('[server] startup failed:', err.message);
    process.exit(1);
});
