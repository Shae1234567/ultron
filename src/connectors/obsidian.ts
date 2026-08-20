import type { Connector } from './types';

export const connector: Connector = {
  id: 'obsidian',
  name: 'Obsidian Vault',
  category: 'Local',
  summary: 'Read and search a local markdown vault - no network, no account, no API.',
  freeTier: 'Free. Entirely local: it is just a folder of markdown files on this machine.',
  docsUrl: 'https://help.obsidian.md/Files+and+folders/Vaults',
  setup: [
    { title: 'Add the vault folder in the FILES tab', detail: 'Same explicit folder picker the file index uses. Atlas only ever reads folders you add by hand.' },
    { title: 'Markdown files are indexed by name and path', detail: 'Full-text reading of note contents is the next step for this connector.' },
  ],
  caveat: 'This one needs no credentials at all, which makes it the natural first connector to actually implement.',
};
