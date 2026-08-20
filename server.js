import "dotenv/config";

import express from "express";
import fsp from "node:fs/promises";
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";

import { TelegramClient } from "teleproto";
import { StringSession } from "teleproto/sessions/index.js";


// ============================================================
// CONFIG
// ============================================================

const PORT = Number(
    process.env.PORT || 10000
);


// ============================================================
// TELEGRAM API CREDENTIALS
// ============================================================

const API_ID = Number(
    process.env.TELEGRAM_API_ID ||
    process.env.API_ID ||
    0
);

const API_HASH =
    process.env.TELEGRAM_API_HASH ||
    process.env.API_HASH ||
    "";

const TELEGRAM_SESSION =
    process.env.TELEGRAM_SESSION ||
    "";


// ============================================================
// GOFILE
// ============================================================

const GOFILE_UPLOAD_URL =
    process.env.GOFILE_UPLOAD_URL ||
    "https://upload.gofile.io/uploadfile";


// ============================================================
// TEMP DIRECTORY
// ============================================================

const TEMP_DIR =
    path.resolve(
        process.env.TEMP_DIR || "./tmp"
    );


// ============================================================
// TIMEOUTS
// ============================================================

const TRANSFER_TIMEOUT_MS = Number(
    process.env.TRANSFER_TIMEOUT_MS ||
    90 * 60 * 1000
);

const GOFILE_TIMEOUT_MS = Number(
    process.env.GOFILE_TIMEOUT_MS ||
    90 * 60 * 1000
);


// ============================================================
// VALIDATION
// ============================================================

if (!API_ID) {
    console.error(
        "❌ Telegram API ID is missing."
    );

    console.error(
        "Set either TELEGRAM_API_ID or API_ID."
    );

    process.exit(1);
}


if (!API_HASH) {
    console.error(
        "❌ Telegram API HASH is missing."
    );

    console.error(
        "Set either TELEGRAM_API_HASH or API_HASH."
    );

    process.exit(1);
}


if (!TELEGRAM_SESSION) {
    console.error(
        "❌ TELEGRAM_SESSION is missing."
    );

    console.error(
        "Run login.js first and save the generated session."
    );

    process.exit(1);
}


// ============================================================
// DIRECTORIES
// ============================================================

await fsp.mkdir(
    TEMP_DIR,
    {
        recursive: true
    }
);


// ============================================================
// EXPRESS
// ============================================================

const app = express();

app.use(
    express.json({
        limit: "1mb"
    })
);


// ============================================================
// TELEGRAM CLIENT
// ============================================================

const session =
    new StringSession(
        TELEGRAM_SESSION
    );

const client =
    new TelegramClient(
        session,
        API_ID,
        API_HASH,
        {
            connectionRetries: 5
        }
    );


// ============================================================
// TELEGRAM CONNECTION
// ============================================================

async function connectTelegram() {

    console.log(
        "[TG] Connecting through MTProto..."
    );

    await client.connect();

    const me =
        await client.getMe();

    console.log(
        "[TG] Connected."
    );

    console.log(
        `[TG] Account: ${
            me?.username
                ? "@" + me.username
                : me?.firstName || "unknown"
        }`
    );
}


// ============================================================
// HEALTH
// ============================================================

app.get(
    "/",
    (req, res) => {

        res.json({
            service: "ztgp2",
            status: "online"
        });
    }
);


app.get(
    "/health",
    (req, res) => {

        res.json({
            success: true,
            service: "ztgp2",
            telegram:
                client.connected
                    ? "connected"
                    : "disconnected"
        });
    }
);


// ============================================================
// SAFE FILENAME
// ============================================================

function safeFilename(name) {

    let value =
        String(
            name || "file"
        );

    value =
        path.basename(
            value
        );

    value =
        value.replace(
            /[^a-zA-Z0-9._()\- ]/g,
            "_"
        );

    if (!value) {
        value = "file";
    }

    return value.slice(
        0,
        180
    );
}


// ============================================================
// SIZE FORMAT
// ============================================================

function formatSize(bytes) {

    if (
        bytes === undefined ||
        bytes === null ||
        Number.isNaN(Number(bytes))
    ) {
        return "Unknown";
    }

    bytes = Number(bytes);

    if (bytes < 1024) {
        return `${bytes} B`;
    }

    if (bytes < 1024 ** 2) {
        return `${(
            bytes / 1024
        ).toFixed(1)} KB`;
    }

    if (bytes < 1024 ** 3) {
        return `${(
            bytes / 1024 ** 2
        ).toFixed(1)} MB`;
    }

    return `${(
        bytes / 1024 ** 3
    ).toFixed(2)} GB`;
}


// ============================================================
// NORMALIZE TELEGRAM MESSAGE ID
// ============================================================

function normalizeMessageId(value) {

    const id =
        Number(value);

    if (
        !Number.isSafeInteger(id) ||
        id <= 0
    ) {
        throw new Error(
            "Invalid Telegram message_id"
        );
    }

    return id;
}


// ============================================================
// NORMALIZE TELEGRAM CHAT ID
// ============================================================

function normalizeChatId(value) {

    if (
        value === undefined ||
        value === null ||
        String(value).trim() === ""
    ) {
        throw new Error(
            "Invalid Telegram chat_id"
        );
    }

    const text =
        String(value).trim();

    if (
        /^-?\d+$/.test(text)
    ) {
        const numeric =
            Number(text);

        if (
            Number.isSafeInteger(
                numeric
            )
        ) {
            return numeric;
        }
    }

    return text;
}


// ============================================================
// DOWNLOAD TELEGRAM MESSAGE
// ============================================================

async function downloadTelegramMessage(
    chatId,
    messageId,
    requestedName
) {

    const normalizedChatId =
        normalizeChatId(
            chatId
        );

    const normalizedMessageId =
        normalizeMessageId(
            messageId
        );

    console.log(
        `[TG] Looking up message ${normalizedMessageId}`
    );

    let messages;

    try {

        messages =
            await client.getMessages(
                normalizedChatId,
                {
                    ids: normalizedMessageId
                }
            );

    } catch (error) {

        console.error(
            "[TG] getMessages failed:",
            error?.message ||
            error
        );

        throw new Error(
            `Telegram message lookup failed: ${
                error?.message ||
                error
            }`
        );
    }


    if (
        !messages ||
        !messages.length ||
        !messages[0]
    ) {

        throw new Error(
            "Telegram message not found"
        );
    }


    const message =
        messages[0];


    if (!message.media) {

        throw new Error(
            "Telegram message has no media"
        );
    }


    const originalName =
        requestedName ||
        message.file?.name ||
        "telegram_file";


    const filename =
        safeFilename(
            originalName
        );


    const uniqueName =
        `${Date.now()}_${
            crypto.randomUUID()
        }_${filename}`;


    const destination =
        path.join(
            TEMP_DIR,
            uniqueName
        );


    console.log(
        `[TG] Downloading: ${filename}`
    );

    console.log(
        `[TG] Destination: ${destination}`
    );


    try {

        await client.downloadMedia(
            message,
            {
                outputFile: destination
            }
        );

    } catch (error) {

        try {

            await fsp.unlink(
                destination
            );

        } catch {
            // File may not exist.
        }

        throw new Error(
            `Telegram download failed: ${
                error?.message ||
                error
            }`
        );
    }


    let stat;

    try {

        stat =
            await fsp.stat(
                destination
            );

    } catch (error) {

        throw new Error(
            `Downloaded file could not be verified: ${
                error?.message ||
                error
            }`
        );
    }


    if (!stat.isFile()) {

        throw new Error(
            "Telegram download did not produce a regular file"
        );
    }


    if (stat.size <= 0) {

        throw new Error(
            "Telegram download produced an empty file"
        );
    }


    console.log(
        `[TG] Download complete: ${
            formatSize(stat.size)
        }`
    );


    return {
        path:
            destination,

        filename:
            filename,

        size:
            stat.size,

        message:
            message
    };
}


// ============================================================
// MULTIPART HELPERS
// ============================================================

function multipartEscape(value) {

    return String(
        value || ""
    )
        .replace(
            /\\/g,
            "\\\\"
        )
        .replace(
            /"/g,
            '\\"'
        )
        .replace(
            /\r/g,
            ""
        )
        .replace(
            /\n/g,
            ""
        );
}


// ============================================================
// STREAMING GOFILE UPLOAD
// ============================================================

async function uploadToGofile(
    filePath,
    filename
) {

    console.log(
        `[GOFILE] Uploading ${filename}`
    );


    const stat =
        await fsp.stat(
            filePath
        );


    const boundary =
        `----ZTGP2Boundary${
            crypto.randomBytes(24).toString("hex")
        }`;


    const safeUploadName =
        multipartEscape(
            filename
        );


    const fieldHeader =
        Buffer.from(
            `--${boundary}\r\n` +
            `Content-Disposition: form-data; name="file"; ` +
            `filename="${safeUploadName}"\r\n` +
            `Content-Type: application/octet-stream\r\n` +
            `\r\n`
        );


    const fieldFooter =
        Buffer.from(
            `\r\n--${boundary}--\r\n`
        );


    const contentLength =
        fieldHeader.length +
        stat.size +
        fieldFooter.length;


    console.log(
        `[GOFILE] File size: ${
            formatSize(stat.size)
        }`
    );

    console.log(
        `[GOFILE] Streaming multipart upload...`
    );


    const controller =
        new AbortController();


    const timeout =
        setTimeout(
            () => {
                controller.abort();
            },
            GOFILE_TIMEOUT_MS
        );


    const fileStream =
        fs.createReadStream(
            filePath
        );


    async function* body() {

        yield fieldHeader;

        try {

            for await (
                const chunk
                of fileStream
            ) {

                yield chunk;
            }

        } finally {

            fileStream.destroy();
        }

        yield fieldFooter;
    }


    try {

        const response =
            await fetch(
                GOFILE_UPLOAD_URL,
                {
                    method: "POST",

                    headers: {
                        "Content-Type":
                            `multipart/form-data; boundary=${boundary}`,

                        "Content-Length":
                            String(contentLength)
                    },

                    body:
                        body(),

                    duplex:
                        "half",

                    signal:
                        controller.signal
                }
            );


        const text =
            await response.text();


        console.log(
            `[GOFILE] HTTP ${response.status}`
        );


        console.log(
            `[GOFILE] Response preview: ${
                text.slice(0, 1000)
            }`
        );


        if (!response.ok) {

            throw new Error(
                `Gofile HTTP ${
                    response.status
                }: ${
                    text.slice(0, 500)
                }`
            );
        }


        let result;

        try {

            result =
                JSON.parse(
                    text
                );

        } catch {

            throw new Error(
                "Gofile returned invalid JSON"
            );
        }


        if (
            result.status !== "ok"
        ) {

            throw new Error(
                result.message ||
                result.error ||
                "Gofile upload failed"
            );
        }


        return result;

    } catch (error) {

        if (
            error?.name ===
            "AbortError"
        ) {

            throw new Error(
                "Gofile upload timed out"
            );
        }

        throw error;

    } finally {

        clearTimeout(
            timeout
        );

        fileStream.destroy();
    }
}


// ============================================================
// TRANSFER ENDPOINT
// ============================================================

app.post(
    "/transfer",
    async (req, res) => {

        let downloadedPath =
            null;


        res.setHeader(
            "Content-Type",
            "application/json; charset=utf-8"
        );


        const transferStarted =
            Date.now();


        try {

            const {
                chat_id,
                message_id,
                file_name
            } = req.body || {};


            // ------------------------------------------------
            // VALIDATE REQUEST
            // ------------------------------------------------

            if (
                chat_id === undefined ||
                message_id === undefined
            ) {

                return res.status(400).json({

                    success:
                        false,

                    error:
                        "chat_id and message_id are required"
                });
            }


            const normalizedChatId =
                normalizeChatId(
                    chat_id
                );

            const normalizedMessageId =
                normalizeMessageId(
                    message_id
                );


            console.log(
                "========================================"
            );

            console.log(
                "[TRANSFER] New request"
            );

            console.log(
                `[TRANSFER] chat_id=${normalizedChatId}`
            );

            console.log(
                `[TRANSFER] message_id=${normalizedMessageId}`
            );


            // ------------------------------------------------
            // TELEGRAM DOWNLOAD
            // ------------------------------------------------

            const downloaded =
                await downloadTelegramMessage(
                    normalizedChatId,
                    normalizedMessageId,
                    file_name
                );


            downloadedPath =
                downloaded.path;


            // ------------------------------------------------
            // GOFILE UPLOAD
            // ------------------------------------------------

            const gofile =
                await uploadToGofile(
                    downloaded.path,
                    downloaded.filename
                );


            const data =
                gofile?.data || {};


            const downloadPage =
                data.downloadPage ||
                data.directLink ||
                data.download_page ||
                null;


            if (!downloadPage) {

                throw new Error(
                    "Gofile upload succeeded but no download URL was returned"
                );
            }


            console.log(
                "[TRANSFER] Success"
            );

            console.log(
                `[TRANSFER] URL=${downloadPage}`
            );

            console.log(
                `[TRANSFER] Total time=${
                    ((Date.now() - transferStarted) / 1000).toFixed(1)
                }s`
            );


            return res.status(200).json({

                success:
                    true,

                file_name:
                    downloaded.filename,

                size:
                    downloaded.size,

                size_human:
                    formatSize(
                        downloaded.size
                    ),

                url:
                    downloadPage,

                gofile:
                    data
            });


        } catch (error) {

            const message =
                String(
                    error?.message ||
                    error ||
                    "Transfer failed"
                ).slice(
                    0,
                    1000
                );


            console.error(
                "[TRANSFER] Failed:",
                error
            );


            console.error(
                `[TRANSFER] Total time=${
                    ((Date.now() - transferStarted) / 1000).toFixed(1)
                }s`
            );


            if (
                !res.headersSent
            ) {

                return res.status(500).json({

                    success:
                        false,

                    error:
                        message
                });
            }


            try {

                res.end();

            } catch {
                // Ignore response cleanup failure.
            }
        }


        finally {

            // --------------------------------------------
            // DELETE TEMPORARY FILE
            // --------------------------------------------

            if (downloadedPath) {

                try {

                    await fsp.unlink(
                        downloadedPath
                    );

                    console.log(
                        `[CLEANUP] Deleted ${
                            downloadedPath
                        }`
                    );

                } catch (error) {

                    if (
                        error?.code !==
                        "ENOENT"
                    ) {

                        console.error(
                            "[CLEANUP] Failed:",
                            error?.message ||
                            error
                        );
                    }
                }
            }


            console.log(
                "========================================"
            );
        }
    }
);


// ============================================================
// START SERVER
// ============================================================

async function start() {

    await connectTelegram();


    app.listen(
        PORT,
        "0.0.0.0",
        () => {

            console.log(
                "========================================"
            );

            console.log(
                "🚀 ztgp2 is ONLINE"
            );

            console.log(
                `🌐 Port: ${PORT}`
            );

            console.log(
                "📡 MTProto: connected"
            );

            console.log(
                "☁️ Gofile: streaming upload enabled"
            );

            console.log(
                "📦 Transfer size limit: NONE"
            );

            console.log(
                "🔓 Bridge authentication: DISABLED"
            );

            console.log(
                "========================================"
            );
        }
    );
}


// ============================================================
// START
// ============================================================

start().catch(
    (error) => {

        console.error(
            "❌ Fatal startup error:",
            error
        );

        process.exit(1);
    }
);


