function createMessageOrderTracker(options = {}) {
    const {
        maxEntries = 1000,
        ttlMs = 5 * 60 * 1000,
        now = () => Date.now()
    } = options;

    const senderTimestamps = new Map();
    const streamSequences = new Map();

    function pruneMap(map) {
        const cutoff = now() - ttlMs;

        for (const [key, entry] of map) {
            if (entry.seenAt < cutoff) {
                map.delete(key);
            }
        }

        while (map.size > maxEntries) {
            const oldestKey = map.keys().next().value;
            if (!oldestKey) {
                break;
            }

            map.delete(oldestKey);
        }
    }

    function prune() {
        pruneMap(senderTimestamps);
        pruneMap(streamSequences);
    }

    function getStreamKey(message) {
        return `${message.senderId}::${message.sessionId}`;
    }

    function shouldAccept(message) {
        prune();

        const senderEntry = senderTimestamps.get(message.senderId);
        if (senderEntry && message.timestamp < senderEntry.timestamp) {
            return false;
        }

        const streamEntry = streamSequences.get(getStreamKey(message));
        if (streamEntry && message.sequence <= streamEntry.sequence) {
            return false;
        }

        return true;
    }

    function mark(message) {
        const seenAt = now();
        const senderEntry = senderTimestamps.get(message.senderId);
        if (!senderEntry || message.timestamp >= senderEntry.timestamp) {
            senderTimestamps.set(message.senderId, {
                timestamp: message.timestamp,
                seenAt
            });
        }

        const streamKey = getStreamKey(message);
        const streamEntry = streamSequences.get(streamKey);
        if (!streamEntry || message.sequence >= streamEntry.sequence) {
            streamSequences.set(streamKey, {
                sequence: message.sequence,
                seenAt
            });
        }

        prune();
    }

    function observe(message) {
        if (!shouldAccept(message)) {
            return false;
        }

        mark(message);
        return true;
    }

    return {
        mark,
        observe,
        shouldAccept
    };
}

module.exports = {
    createMessageOrderTracker
};
