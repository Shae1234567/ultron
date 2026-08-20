import type { Connector } from './types';

export const connector: Connector = {
  id: 'notion',
  name: 'Notion',
  category: 'Notes',
  summary: 'Query databases and pages, append notes Atlas captures during a session.',
  freeTier: 'Free. Internal integrations are unlimited on personal plans; rate limit ~3 requests/second.',
  docsUrl: 'https://developers.notion.com/docs/create-a-notion-integration',
  consoleUrl: 'https://www.notion.so/my-integrations',
  setup: [
    { title: 'Create an internal integration', detail: 'Notion -> Settings -> Connections -> Develop or manage integrations -> New integration.', link: 'https://www.notion.so/my-integrations' },
    { title: 'Copy the Internal Integration Secret', detail: 'It starts with ntn_ (older ones start with secret_).' },
    { title: 'Share the pages you want Atlas to see', detail: 'Open the page -> ... menu -> Connections -> pick your integration. Nothing is visible until you share it explicitly.' },
    { title: 'Store the token in .env', code: 'NOTION_TOKEN=ntn_...' },
  ],
  caveat: 'The integration only sees pages you explicitly share with it - that is the model working correctly, not a bug.',
};
