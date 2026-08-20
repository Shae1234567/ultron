import type { Connector } from './types';

export const connector: Connector = {
  id: 'gmail',
  name: 'Gmail',
  category: 'Mail',
  summary: 'Read and summarise unread mail, surface anything that needs a reply.',
  freeTier: 'Free. Gmail API quota is 1,000,000,000 quota units/day for personal use.',
  docsUrl: 'https://developers.google.com/gmail/api/quickstart/nodejs',
  consoleUrl: 'https://console.cloud.google.com/apis/credentials',
  scopes: ['https://www.googleapis.com/auth/gmail.readonly'],
  setup: [
    { title: 'Create a Google Cloud project', detail: 'Free. No billing account needed for the Gmail API.', link: 'https://console.cloud.google.com/projectcreate' },
    { title: 'Enable the Gmail API for that project', link: 'https://console.cloud.google.com/apis/library/gmail.googleapis.com' },
    { title: 'Create an OAuth 2.0 Client ID', detail: 'Application type: Desktop app. Download the credentials JSON.', link: 'https://console.cloud.google.com/apis/credentials' },
    { title: 'Add yourself as a test user', detail: 'OAuth consent screen -> Audience -> Test users. Without this, sign-in is blocked while the app is unverified.' },
    { title: 'Store the client ID and secret in .env', code: 'GMAIL_CLIENT_ID=...\nGMAIL_CLIENT_SECRET=...' },
  ],
  caveat: 'OAuth for desktop apps needs a local redirect listener in the main process. Read-only scope is strongly recommended.',
};
