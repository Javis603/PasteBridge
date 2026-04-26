const { execFile } = require('child_process');
const fs = require('fs');
const { promisify } = require('util');

const clipboardy = require('clipboardy');

const { byteLength, createClipboardState } = require('../common/protocol');

const execFileAsync = promisify(execFile);
const fsPromises = fs.promises;
const CLIPBOARD_RETRY_DELAYS_MS = [40, 120, 250];

function createWindowsClipboard(options) {
    const {
        tempSendPath,
        tempRecvPath,
        maxTextBytes,
        maxImageBytes,
        logger = console
    } = options;

    async function runPowerShell(script, maxBuffer = maxTextBytes + maxImageBytes) {
        const { stdout } = await execFileAsync('powershell', ['-NoProfile', '-Command', script], {
            encoding: 'utf8',
            maxBuffer
        });

        return (stdout || '').trim();
    }

    function psQuote(value) {
        return value.replace(/'/g, "''");
    }

    function sleep(ms) {
        return new Promise((resolve) => {
            setTimeout(resolve, ms);
        });
    }

    function compactErrorMessage(err) {
        return String(err && err.message ? err.message : err)
            .split('\n')
            .map((line) => line.trim())
            .filter(Boolean)
            .slice(0, 2)
            .join(' | ');
    }

    function isRecoverableClipboardReadError(err) {
        const message = String(err && err.message ? err.message : err);
        return (
            message.includes('Access is denied') ||
            message.includes('存取被拒') ||
            message.includes('Element not found') ||
            message.includes('元素找不到') ||
            message.includes('Requested Clipboard operation did not succeed') ||
            message.includes('code: 5') ||
            message.includes('code: 1168')
        );
    }

    async function withClipboardRetries(operation) {
        let lastError = null;

        for (let attempt = 0; attempt <= CLIPBOARD_RETRY_DELAYS_MS.length; attempt += 1) {
            try {
                return await operation();
            } catch (err) {
                lastError = err;

                if (!isRecoverableClipboardReadError(err) || attempt === CLIPBOARD_RETRY_DELAYS_MS.length) {
                    throw err;
                }

                await sleep(CLIPBOARD_RETRY_DELAYS_MS[attempt]);
            }
        }

        throw lastError;
    }

    async function readTextWithPowerShell() {
        const script = `
Add-Type -AssemblyName System.Windows.Forms
if ([System.Windows.Forms.Clipboard]::ContainsText()) {
    [Console]::OutputEncoding = [System.Text.Encoding]::UTF8
    Write-Output ([System.Windows.Forms.Clipboard]::GetText())
}
`.trim();

        try {
            return {
                ok: true,
                data: await withClipboardRetries(() => runPowerShell(script, maxTextBytes + 1024))
            };
        } catch (err) {
            if (isRecoverableClipboardReadError(err)) {
                logger.warn('PowerShell clipboard text read unavailable after retries:', compactErrorMessage(err));
            } else {
                logger.error('PowerShell clipboard text read failed:', compactErrorMessage(err));
            }

            return { ok: false, data: null };
        }
    }

    async function getClipboardText() {
        let textResult = null;

        try {
            textResult = {
                ok: true,
                data: await withClipboardRetries(() => clipboardy.read())
            };
        } catch (err) {
            if (isRecoverableClipboardReadError(err)) {
                logger.warn('clipboardy text read unavailable after retries, trying PowerShell fallback:', compactErrorMessage(err));
            } else {
                logger.error('clipboardy text read failed, trying PowerShell fallback:', compactErrorMessage(err));
            }

            textResult = await readTextWithPowerShell();
        }

        if (!textResult.ok) {
            return { ok: false, data: null };
        }

        if (byteLength(textResult.data) > maxTextBytes) {
            logger.warn('clipboard text exceeds MAX_TEXT_BYTES; skipping sync');
            return { ok: false, data: null };
        }

        return textResult;
    }

    async function getClipboardImage() {
        const script = `
Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing
$image = [System.Windows.Forms.Clipboard]::GetImage()
if ($null -eq $image) {
    Write-Output 'NONE'
    exit 0
}
$image.Save('${psQuote(tempSendPath)}', [System.Drawing.Imaging.ImageFormat]::Png)
$image.Dispose()
Write-Output 'OK'
`.trim();

        try {
            const output = await runPowerShell(script, 64 * 1024);
            if (output !== 'OK') {
                return { status: 'none', data: null };
            }

            const buffer = await fsPromises.readFile(tempSendPath);
            if (buffer.length > maxImageBytes) {
                logger.warn('clipboard image exceeds MAX_IMAGE_BYTES; skipping sync');
                return { status: 'error', data: null };
            }

            return { status: 'image', data: buffer };
        } catch (err) {
            logger.error('getClipboardImage failed:', err.message);
            return { status: 'error', data: null };
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
        try {
            await clipboardy.write(text);
            return true;
        } catch (err) {
            logger.error('writeText failed:', err.message);
            return false;
        }
    }

    async function writeImage(imageBuffer) {
        const script = `
Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing
$image = [System.Drawing.Image]::FromFile('${psQuote(tempRecvPath)}')
[System.Windows.Forms.Clipboard]::SetImage($image)
$image.Dispose()
`.trim();

        try {
            await fsPromises.writeFile(tempRecvPath, imageBuffer);
            await runPowerShell(script);
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
    createWindowsClipboard
};
