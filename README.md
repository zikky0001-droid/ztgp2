# ztgp2

DEV ZIKKY large Telegram media bridge.

## Purpose

ztgp2 is a separate Node.js service that:

1. Receives an authenticated transfer request from the Python bot.
2. Finds the Telegram message through MTProto.
3. Downloads the media.
4. Uploads the file to Gofile.
5. Returns the public Gofile URL.
6. Deletes the temporary local copy.

## Architecture

Python Telegram Bot
        |
        | POST /transfer
        v
ztgp2
        |
        | MTProto
        v
Telegram
        |
        v
Gofile
        |
        v
Public URL

## Required environment variables

API_ID
API_HASH
TELEGRAM_SESSION
BRIDGE_SECRET
PORT

## First-time setup

Install:

npm install

Generate the Telegram session:

node login.js

Copy the printed TELEGRAM_SESSION into your deployment environment.

## Start

npm start

## Health

GET /

GET /health

## Transfer

POST /transfer

Authorization:

Bearer YOUR_BRIDGE_SECRET

JSON:

{
  "chat_id": 123456789,
  "message_id": 123,
  "file_name": "example.apk"
}

## Security

Never commit:

.env

TELEGRAM_SESSION

API_HASH

BRIDGE_SECRET

Bot tokens

The transfer endpoint requires the BRIDGE_SECRET.

