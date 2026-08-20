import type { Connector } from './types';

export const connector: Connector = {
  id: 'spotify',
  name: 'Spotify',
  category: 'Music',
  summary: 'Show what is playing on the HUD and let Atlas control playback by voice.',
  freeTier: 'Free. The Web API has no cost; playback control requires a Premium account.',
  docsUrl: 'https://developer.spotify.com/documentation/web-api',
  consoleUrl: 'https://developer.spotify.com/dashboard',
  scopes: ['user-read-playback-state', 'user-modify-playback-state', 'user-read-currently-playing'],
  setup: [
    { title: 'Create an app in the Spotify developer dashboard', link: 'https://developer.spotify.com/dashboard' },
    { title: 'Set the redirect URI', detail: 'Use a loopback address that the main process can listen on.', code: 'http://127.0.0.1:8888/callback' },
    { title: 'Copy the Client ID and Client Secret into .env', code: 'SPOTIFY_CLIENT_ID=...\nSPOTIFY_CLIENT_SECRET=...' },
  ],
  caveat: 'Reading playback state works on a free account; skipping and pausing requires Premium.',
};
