# Slack Operation

Send messages to Slack from your Directus Flows, as plain text or Block Kit layouts, using an incoming webhook or a Slack bot.

## Features

- Send with an **incoming webhook** (simplest) or a **bot token**
- Message text in Slack markdown, with Directus template values such as `{{ $trigger.payload.title }}`
- **Layouts**: a header, fields and a link button, or your own Block Kit JSON
- **Mentions**: users, `@here` and `@channel`
- **Bot only**: choose the channel, reply in a thread, set a sender name and emoji
- Returns the message details so later steps can use them, e.g. to reply in a thread

## Configuration

A new operation only shows the essentials:

- **Send with**: Webhook or Slack bot. Pick this first; the fields below change with it.
- **Webhook URL**: the incoming webhook URL (webhook only)
- **Bot token** and **Channel**: the bot's `xoxb-…` token and a channel ID such as `C0123456789` (bot only)
- **Message**: e.g. `New article *{{ $trigger.payload.title }}* was published`

Turn on **More options** for mentions, layouts, thread replies, sender name and custom Block Kit JSON.

## Slack Setup

**Webhook**

1. Create an app at [api.slack.com/apps](https://api.slack.com/apps) and turn on **Incoming Webhooks**.
2. Click **Add New Webhook to Workspace**, choose a channel and copy the URL.

**Bot**

1. Create an app at [api.slack.com/apps](https://api.slack.com/apps).
2. Under **OAuth & Permissions → Bot Token Scopes**, add `chat:write`. Add `chat:write.public` to post in public channels without inviting the bot, and `chat:write.customize` to set a sender name or emoji.
3. Install the app to your workspace and copy the **Bot User OAuth Token**.
4. Invite the bot to private channels with `/invite @your-app`.

## Reply in a thread

Post the first message with the bot, then add a second Slack operation and set **Reply in thread** (under **More options**) to `{{ $last.ts }}`.

## Requirements

- Directus 10.10 or later

## Installation

Refer to the official guides for installing the extension from the [Marketplace](https://directus.com/docs/guides/extensions/marketplace) or [manually](https://directus.com/docs/self-hosting/including-extensions).

## Security Considerations

- Treat the webhook URL and bot token like passwords: anyone who has them can post to your Slack.
- Anyone who can edit the flow can see these values.
- The URL and token are never shown in the flow overview, error messages or results.

## Error Handling

If Slack rejects the message, the operation fails with the reason (e.g. `channel_not_found`) and the flow continues on its reject path.
