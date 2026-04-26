const fs = require('fs');
const path = require('path');

async function main() {
    const testDir = __dirname;
    const files = fs.readdirSync(testDir)
        .filter((file) => file.endsWith('.test.js'))
        .sort();

    let passed = 0;
    let failed = 0;

    for (const file of files) {
        const suite = require(path.join(testDir, file));
        const tests = Array.isArray(suite.tests) ? suite.tests : [];

        for (const test of tests) {
            try {
                await test.run();
                passed += 1;
                console.log(`PASS ${file} - ${test.name}`);
            } catch (err) {
                failed += 1;
                console.error(`FAIL ${file} - ${test.name}`);
                console.error(err.stack || err.message);
            }
        }
    }

    console.log(`\n${passed} passed, ${failed} failed`);
    if (failed > 0) {
        process.exit(1);
    }
}

main().catch((err) => {
    console.error(err.stack || err.message);
    process.exit(1);
});
