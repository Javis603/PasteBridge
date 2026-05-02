const { execFile } = require('child_process');
const fs = require('fs');
const { promisify } = require('util');

const { byteLength, createClipboardState, sanitizeText } = require('../common/protocol');

const execFileAsync = promisify(execFile);
const fsPromises = fs.promises;

function createMacClipboard(options) {
    const {
        tempSendPath,
        tempRecvPath,
        maxTextBytes,
        maxImageBytes,
        logger = console
    } = options;

    async function runOsaScript(lines, args = []) {
        const argv = [];
        for (const line of lines) {
            argv.push('-e', line);
        }

        await execFileAsync('osascript', [...argv, ...args], {
            encoding: 'utf8',
            maxBuffer: maxTextBytes + maxImageBytes
        });
    }

    async function getClipboardText() {
        try {
            const { stdout } = await execFileAsync('pbpaste', [], {
                encoding: 'utf8',
                maxBuffer: maxTextBytes + 1024
            });

            const data = sanitizeText(stdout);
            if (byteLength(data) > maxTextBytes) {
                logger.warn('clipboard text exceeds MAX_TEXT_BYTES; skipping sync');
                return { ok: false, data: null };
            }

            return { ok: true, data };
        } catch (err) {
            logger.error('getClipboardText failed:', err.message);
            return { ok: false, data: null };
        }
    }

    async function getClipboardImage() {
        try {
            await execFileAsync('pngpaste', [tempSendPath], {
                encoding: 'utf8',
                maxBuffer: 64 * 1024
            });

            const buffer = await fsPromises.readFile(tempSendPath);
            if (buffer.length > maxImageBytes) {
                logger.warn('clipboard image exceeds MAX_IMAGE_BYTES; skipping sync');
                return { status: 'error', data: null };
            }

            return { status: 'image', data: buffer };
        } catch (err) {
            if (err.code !== 1) {
                logger.error('getClipboardImage failed:', err.message);
                return { status: 'error', data: null };
            }

            return { status: 'none', data: null };
        }
    }

    async function readEntry() {
        const image = await getClipboardImage();
        if (image.status === 'image') {
            return {
                type: 'image',
                data: image.data,
                state: createClipboardState('image', image.data)
            };
        }

        if (image.status === 'error') {
            return null;
        }

        const text = await getClipboardText();
        if (!text.ok) {
            return null;
        }

        return {
            type: 'text',
            data: text.data,
            state: createClipboardState('text', text.data)
        };
    }

    async function writeText(text) {
        const data = sanitizeText(text);
        try {
            await runOsaScript([
                'on run argv',
                'set the clipboard to item 1 of argv',
                'end run'
            ], [data]);
            return true;
        } catch (err) {
            logger.error('writeText failed:', err.message);
            return false;
        }
    }

    async function writeImage(imageBuffer) {
        try {
            await fsPromises.writeFile(tempRecvPath, imageBuffer);
            await runOsaScript([
                'on run argv',
                'set imagePath to item 1 of argv',
                'set imageData to read POSIX file imagePath as \u00abclass PNGf\u00bb',
                'set the clipboard to imageData',
                'end run'
            ], [tempRecvPath]);
            logger.log('[image] wrote image to macOS clipboard');

            const readBack = await getClipboardImage();
            return createClipboardState('image', readBack.status === 'image' ? readBack.data : imageBuffer);
        } catch (err) {
            logger.error('writeImage failed:', err.message);
            return null;
        }
    }

    return {
        readEntry,
        writeImage,
        writeText
    };
}

module.exports = {
    createMacClipboard
};
