import type { Connector } from './types';

export const connector: Connector = {
  id: 'github',
  name: 'GitHub',
  category: 'Code',
  summary: 'Track your repos, open issues and PR review requests.',
  freeTier: 'Free. 5,000 REST requests/hour with a personal access token.',
  docsUrl: 'https://docs.github.com/en/rest/quickstart',
  consoleUrl: 'https://github.com/settings/tokens',
  setup: [
    { title: 'Create a fine-grained personal access token', link: 'https://github.com/settings/personal-access-tokens/new' },
    { title: 'Grant read-only repository access', detail: 'Contents: Read. Issues: Read. Pull requests: Read. Nothing else is needed.' },
    { title: 'Store it in .env', code: 'GITHUB_TOKEN=github_pat_...' },
  ],
};
