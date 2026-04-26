function createLogger(scope) {
    return {
        log: (...args) => console.log(`[${scope}]`, ...args),
        warn: (...args) => console.warn(`[${scope}]`, ...args),
        error: (...args) => console.error(`[${scope}]`, ...args)
    };
}

module.exports = {
    createLogger
};
