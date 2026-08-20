import type { Connector } from './types';

export const connector: Connector = {
  id: 'google-calendar',
  name: 'Google Calendar',
  category: 'Calendar',
  summary: 'Pull today and tomorrow onto the HUD, flag clashes with training and games.',
  freeTier: 'Free. 1,000,000 requests/day quota on the free tier.',
  docsUrl: 'https://developers.google.com/calendar/api/quickstart/nodejs',
  consoleUrl: 'https://console.cloud.google.com/apis/credentials',
  scopes: ['https://www.googleapis.com/auth/calendar.readonly'],
  setup: [
    { title: 'Reuse the same Google Cloud project as Gmail', detail: 'One project can serve both APIs.' },
    { title: 'Enable the Google Calendar API', link: 'https://console.cloud.google.com/apis/library/calendar-json.googleapis.com' },
    { title: 'Add the calendar.readonly scope to your OAuth consent screen' },
    { title: 'Store credentials in .env', code: 'GCAL_CLIENT_ID=...\nGCAL_CLIENT_SECRET=...' },
  ],
};
