import "dotenv/config";

import express from "express";
import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";

import { TelegramClient } from "teleproto";
import { StringSession } from "teleproto/sessions";


// ============================================================
// CONFIG
// ============================================================

const PORT = Number(process.env.PORT || 10000);

const API_ID = Number(process.env.API_ID || 0);
const API_HASH = process.env.API_HASH || "";

const TELEGRAM_SESSION =
    process.env.TELEGRAM_SESSION || "";

const BOT_TOKEN =
    process.env.BOT_TOKEN || "";

const BRIDGE_SECRET =
    process.env.BRIDGE_SECRET || "";

const GOFILE_UPLOAD_URL =
    process.env.GOFILE_UPLOAD_URL ||
    "https://upload.gofile.io/uploadfile";

const TEMP_DIR =
    path.resolve(process.env.TEMP_DIR || "./tmp");


// ============================================================
// VALIDATION
// ============================================================

if (!API_ID) {
    console.error("❌ API_ID is missing");
    process.exit(1);
}

if (!API_HASH) {
    console.error("❌ API_HASH is missing");
    process.exit(1);
}

if (!TELEGRAM_SESSION) {
    console.error(
        "❌ TELEGRAM_SESSION is missing"
    );

    console.error(
        "Run login.js first."
    );

    process.exit(1);
}

if (!BRIDGE_SECRET) {
    console.error(
        "❌ BRIDGE_SECRET is missing"
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
     * The saved session means we don't normally
     * need an interactive login here.
     *
     * We intentionally don't put the phone number
     * or login code into the server.
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
// AUTH MIDDLEWARE
// ============================================================

function authenticate(req, res, next) {

    const supplied =
        req.get("authorization") || "";

    const expected =
        `Bearer ${BRIDGE_SECRET}`;

    const suppliedBuffer =
        Buffer.from(supplied);

    const expectedBuffer =
        Buffer.from(expected);

    if (
        suppliedBuffer.length !==
        expectedBuffer.length
    ) {

        return res.status(401).json({
            success: false,
            error: "Unauthorized"
        });
    }

    if (
        !crypto.timingSafeEqual(
            suppliedBuffer,
            expectedBuffer
        )
    ) {

        return res.status(401).json({
            success: false,
            error: "Unauthorized"
        });
    }

    next();
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
            telegram: client.connected
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
        String(name || "file");

    value =
        path.basename(value);

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
        path: destination,
        filename,
        size: stat.size,
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
            JSON.parse(text);

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

app.post(
    "/transfer",
    authenticate,
    async (req, res) => {

        let downloadedPath =
            null;

        try {

            const {
                chat_id,
                message_id,
                file_name
            } = req.body || {};

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

            // --------------------------------------------
            // TELEGRAM
            // --------------------------------------------

            const downloaded =
                await downloadTelegramMessage(
                    chat_id,
                    message_id,
                    file_name
                );

            downloadedPath =
                downloaded.path;

            // --------------------------------------------
            // GOFILE
            // --------------------------------------------

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
                success: true,

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
                success: false,
                error:
                    String(
                        error?.message ||
                        error ||
                        "Transfer failed"
                    ).slice(0, 1000)
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
                "========================================"
            );
        }
    );
}


start().catch(
    (error) => {

        console.error(
            "❌ Fatal startup error:",
            error
        );

        process.exit(1);
    }
);

Important

This first version deliberately downloads to disk and then uploads to Gofile. That's simpler and safer for our first end-to-end test. teleproto itself supports writing the download to an output file, and its transfer system uses chunked MTProto requests. 

Once this works with a 300 MB test file, we can optimize the Gofile side so the file isn't unnecessarily loaded into a single Buffer.


---

5. login.js

Run this locally, not as your Render start command.

import "dotenv/config";

import {
    TelegramClient
} from "teleproto";

import {
    StringSession
} from "teleproto/sessions";

import {
    createInterface
} from "node:readline/promises";


// ============================================================
// CONFIG
// ============================================================

const API_ID =
    Number(process.env.API_ID || 0);

const API_HASH =
    process.env.API_HASH || "";


// ============================================================
// VALIDATE
// ============================================================

if (!API_ID) {

    console.error(
        "❌ API_ID missing"
    );

    process.exit(1);
}

if (!API_HASH) {

    console.error(
        "❌ API_HASH missing"
    );

    process.exit(1);
}


// ============================================================
// TERMINAL
// ============================================================

const rl =
    createInterface({
        input: process.stdin,
        output: process.stdout
    });


// ============================================================
// SESSION
// ============================================================

const session =
    new StringSession("");


// ============================================================
// CLIENT
// ============================================================

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
// LOGIN
// ============================================================

try {

    console.log(
        "\n========================================"
    );

    console.log(
        "🔐 ztgp2 Telegram MTProto Login"
    );

    console.log(
        "========================================\n"
    );

    await client.start({

        phoneNumber:
            async () => {

                return await rl.question(
                    "Telegram phone number: "
                );
            },

        password:
            async () => {

                return await rl.question(
                    "2FA password: "
                );
            },

        phoneCode:
            async () => {

                return await rl.question(
                    "Telegram login code: "
                );
            },

        onError:
            (error) => {

                console.error(
                    "Login error:",
                    error
                );
            }
    });


    // ========================================================
    // ACCOUNT
    // ========================================================

    const me =
        await client.getMe();

    console.log(
        "\n✅ Telegram login successful!"
    );

    console.log(
        `👤 User: ${
            me?.firstName || ""
        } ${
            me?.lastName || ""
        }`
    );

    if (me?.username) {

        console.log(
            `📛 Username: @${me.username}`
        );
    }


    // ========================================================
    // SESSION
    // ========================================================

    const saved =
        client.session.save();

    console.log(
        "\n========================================"
    );

    console.log(
        "🔑 TELEGRAM_SESSION"
    );

    console.log(
        "========================================\n"
    );

    console.log(saved);

    console.log(
        "\n========================================"
    );

    console.log(
        "⚠️ Keep this secret."
    );

    console.log(
        "Put it into Render as TELEGRAM_SESSION."
    );

    console.log(
        "Do NOT commit it to GitHub."
    );

    console.log(
        "========================================\n"
    );

} finally {

    rl.close();

    try {
        await client.disconnect();
    } catch {}
}
