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
