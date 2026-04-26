function createRecentMessageCache(options = {}) {
    const {
        maxEntries = 1000,
        ttlMs = 5 * 60 * 1000,
        now = () => Date.now()
    } = options;

    const entries = new Map();

    function prune() {
        const cutoff = now() - ttlMs;

        for (const [id, timestamp] of entries) {
            if (timestamp < cutoff) {
                entries.delete(id);
            }
        }

        while (entries.size > maxEntries) {
            const oldestId = entries.keys().next().value;
            if (!oldestId) {
                break;
            }

            entries.delete(oldestId);
        }
    }

    function has(id) {
        prune();
        return entries.has(id);
    }

    function add(id) {
        entries.set(id, now());
        prune();
    }

    function remember(message) {
        if (!message || typeof message.id !== 'string' || message.id.length === 0) {
            return false;
        }

        if (has(message.id)) {
            return false;
        }

        add(message.id);
        return true;
    }

    return {
        add,
        has,
        remember,
        size() {
            prune();
            return entries.size;
        }
    };
}

module.exports = {
    createRecentMessageCache
};
