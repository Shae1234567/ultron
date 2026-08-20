import type { Connector } from './types';

export const connector: Connector = {
  id: 'open-meteo',
  name: 'Open-Meteo Weather',
  category: 'Data',
  summary: 'Local conditions and forecast on the HUD - relevant for outdoor training days.',
  freeTier: 'Free with no API key at all for non-commercial use (under 10,000 calls/day).',
  docsUrl: 'https://open-meteo.com/en/docs',
  setup: [
    { title: 'Nothing to sign up for', detail: 'Open-Meteo needs no key for personal use, which makes it the cheapest connector to wire up first.' },
    { title: 'Set your coordinates in .env', detail: 'Calgary city centre is roughly 51.05 N, -114.07 W.', code: 'WEATHER_LAT=51.0447\nWEATHER_LON=-114.0719' },
    { title: 'Call the forecast endpoint from the main process', code: 'https://api.open-meteo.com/v1/forecast?latitude=51.0447&longitude=-114.0719&current=temperature_2m,wind_speed_10m' },
  ],
};
