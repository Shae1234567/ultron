import type { Specialist } from './types';

/**
 * Plugin registry, same pattern as src/connectors/index.ts - every file in
 * this folder exporting `specialist` is picked up automatically.
 */
const modules = import.meta.glob<{ specialist?: Specialist }>('./*.ts', { eager: true });

export const specialists: Specialist[] = Object.entries(modules)
  .filter(([p]) => !/\/(index|types)\.ts$/.test(p))
  .map(([, mod]) => mod.specialist)
  .filter((s): s is Specialist => Boolean(s));

export const getSpecialist = (id: string): Specialist | undefined =>
  specialists.find((s) => s.id === id);

export type { Specialist } from './types';
