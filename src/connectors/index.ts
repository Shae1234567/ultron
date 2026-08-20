import type { Connector } from './types';

/**
 * Plugin registry. Every `*.ts` file in this folder that exports a `connector`
 * is registered automatically at build time - adding a service means adding
 * one file, with no edits here.
 */
const modules = import.meta.glob<{ connector?: Connector }>('./*.ts', { eager: true });

export const connectors: Connector[] = Object.entries(modules)
  .filter(([p]) => !/\/(index|types)\.ts$/.test(p))
  .map(([, mod]) => mod.connector)
  .filter((c): c is Connector => Boolean(c))
  .sort((a, b) => a.category.localeCompare(b.category) || a.name.localeCompare(b.name));

export const getConnector = (id: string): Connector | undefined =>
  connectors.find((c) => c.id === id);

export type { Connector, SetupStep } from './types';
