require('dotenv').config();

const { loadClientConfig } = require('./src/common/config');
const { startClient } = require('./src/client/app');

async function main() {
    const app = await startClient(loadClientConfig());
    let stopping = false;

    async function shutdown(signal) {
        if (stopping) {
            return;
        }

        stopping = true;
        console.log(`[client] received ${signal}, shutting down`);

        try {
            await app.stop();
            process.exit(0);
        } catch (err) {
            console.error('[client] shutdown failed:', err.message);
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
    console.error('[client] startup failed:', err.message);
    process.exit(1);
});
