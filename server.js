import "dotenv/config";

import express from "express";
import fsp from "node:fs/promises";
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
//
// Supports BOTH naming styles:
//
// TELEGRAM_API_ID / TELEGRAM_API_HASH
// API_ID / API_HASH
//
// TELEGRAM_* takes priority.
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


// ============================================================
// TELEGRAM SESSION
// ============================================================

const TELEGRAM_SESSION =
    process.env.TELEGRAM_SESSION || "";


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

    /*
     * The saved session means the server does not
     * normally need an interactive login.
     */

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


// ============================================================
// TELEGRAM STATUS
// ============================================================

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

    if (!bytes) {
        return "Unknown";
    }


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
// DOWNLOAD TELEGRAM MESSAGE
// ============================================================

async function downloadTelegramMessage(
    chatId,
    messageId,
    requestedName
) {

    console.log(
        `[TG] Looking up message ${messageId}`
    );


    const messages =
        await client.getMessages(
            chatId,
            {
                ids: Number(messageId)
            }
        );


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


    await client.downloadMedia(
        message,
        {
            outputFile: destination
        }
    );


    const stat =
        await fsp.stat(
            destination
        );


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
// GOFILE UPLOAD
// ============================================================

async function uploadToGofile(
    filePath,
    filename
) {

    console.log(
        `[GOFILE] Uploading ${filename}`
    );


    const form =
        new FormData();


    const fileBuffer =
        await fsp.readFile(
            filePath
        );


    const blob =
        new Blob(
            [
                fileBuffer
            ],
            {
                type:
                    "application/octet-stream"
            }
        );


    form.append(
        "file",
        blob,
        filename
    );


    const response =
        await fetch(
            GOFILE_UPLOAD_URL,
            {
                method: "POST",
                body: form
            }
        );


    const text =
        await response.text();


    console.log(
        `[GOFILE] HTTP ${response.status}`
    );


    if (!response.ok) {

        throw new Error(
            `Gofile HTTP ${response.status}: ${
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
}


// ============================================================
// TRANSFER ENDPOINT
// ============================================================
//
// POST /transfer
//
// No BRIDGE_SECRET.
// No Authorization header.
// No BOT_TOKEN.
// No authentication middleware.
//
// The Python bot sends:
//
// {
//     "chat_id": "...",
//     "message_id": 123,
//     "file_name": "example.apk"
// }
//
// ============================================================

app.post(
    "/transfer",
    async (req, res) => {

        let downloadedPath =
            null;


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

                    success: false,

                    error:
                        "chat_id and message_id are required"
                });
            }


            console.log(
                "========================================"
            );


            console.log(
                "[TRANSFER] New request"
            );


            console.log(
                `[TRANSFER] chat_id=${chat_id}`
            );


            console.log(
                `[TRANSFER] message_id=${message_id}`
            );


            // ------------------------------------------------
            // TELEGRAM DOWNLOAD
            // ------------------------------------------------

            const downloaded =
                await downloadTelegramMessage(
                    chat_id,
                    message_id,
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
                gofile.data || {};


            const downloadPage =
                data.downloadPage ||
                data.directLink ||
                null;


            console.log(
                "[TRANSFER] Success"
            );


            console.log(
                `[TRANSFER] URL=${downloadPage}`
            );


            return res.json({

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

            console.error(
                "[TRANSFER] Failed:",
                error
            );


            return res.status(500).json({

                success:
                    false,

                error:
                    String(
                        error?.message ||
                        error ||
                        "Transfer failed"
                    ).slice(
                        0,
                        1000
                    )
            });


        } finally {

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

                    console.error(
                        "[CLEANUP] Failed:",
                        error.message
                    );
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

