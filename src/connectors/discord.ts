import type { Connector } from './types';

export const connector: Connector = {
  id: 'discord',
  name: 'Discord',
  category: 'Social',
  summary: 'Post to a channel, or - with a real bot - read/summarize activity and manage channels & roles.',
  freeTier: 'Free. Standard Discord API rate limits apply.',
  docsUrl: 'https://discord.com/developers/docs/intro',
  consoleUrl: 'https://discord.com/developers/applications',
  setup: [
    { title: 'Simple mode: a webhook', detail: 'Channel settings -> Integrations -> Webhooks -> New Webhook.', code: 'DISCORD_WEBHOOK_URL=https://discord.com/api/webhooks/...' },
    { title: 'Full mode: a real bot', detail: 'Create an application, add a bot, enable the Message Content and Server Members intents, invite it with View Channels/Send Messages/Embed Links/Read Message History/Manage Channels/Manage Roles only.', code: 'DISCORD_BOT_TOKEN=...' },
  ],
  caveat: 'Deliberately never requests Kick Members, Ban Members, Manage Server, or Administrator - channel/role deletion is not exposed either, since Discord has no undo for either.',
};
