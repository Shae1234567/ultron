import { AGENT_IDS, CORE_AGENT_IDS, type AgentDef, type AgentId, type DepartmentId } from '../brain/types';
import { HEALTH_AGENTS } from './health/agents';
import { SCHOOL_AGENTS } from './school/agents';
import { MEDIA_AGENTS } from './media/agents';
import { HISTORY_AGENTS } from './history/agents';
import { PROJECT_AGENTS } from './projects/agents';

/*
 * The council: Ultron manages, each department has a head and its own experts, and every
 * department borrows the shared team (Athena, Argus, Hermes, Chronos, Hephaestus,
 * Mnemosyne, Daedalus). All five departments are described here from day one - the
 * council chamber shows the ones not built yet as dimmed seats - but only a built
 * department's agents exist and can be given work.
 */

/** A council name. Every name is used once across the whole system. */
export type CouncilName =
  | 'helios'
  | 'asclepius' | 'achilles' | 'heracles' | 'demeter' | 'hypnos'
  | 'prometheus' | 'chiron' | 'sphinx' | 'kratos'
  | 'dionysus' | 'theseus' | 'morpheus' | 'orpheus'
  | 'clio' | 'ares' | 'calliope' | 'atlas'
  | 'odysseus' | 'talos' | 'nike';

export interface Member {
  id: CouncilName;
  name: string;
  /** What they do, in a few words. */
  job: string;
}

export interface Department {
  id: DepartmentId;
  name: string;
  /** Seat number in the chamber, left to right. */
  seat: number;
  head: Member;
  specialists: Member[];
  /** The shared-team members it calls on most (any of them can be borrowed). */
  borrows: AgentId[];
  /** Its one "is it helping?" number, in words. */
  metric: string;
  /** The Greek epithet and root shown on its seat. */
  epithet: string;
  greek: { letter: string; word: string; latin: string; meaning: string };
  /** The build step that brings it (see the council plan). */
  step: number;
  built: boolean;
  /** Holds private data (health, grades, what he watches): its work only runs on brains trusted with it. */
  private: boolean;
}

export const DEPARTMENTS: Department[] = [
  {
    id: 'health', name: 'Health', seat: 2, step: 3, built: true, private: true,
    head: { id: 'asclepius', name: 'Asclepius', job: 'runs Health; owns every pain and injury flag' },
    specialists: [
      { id: 'achilles', name: 'Achilles', job: 'soccer and badminton' },
      { id: 'heracles', name: 'Heracles', job: 'gym and strength' },
      { id: 'demeter', name: 'Demeter', job: 'food and micronutrients' },
      { id: 'hypnos', name: 'Hypnos', job: 'sleep and recovery' },
    ],
    borrows: ['argus', 'chronos'],
    metric: 'nights with 8+ hours of sleep this week; training sessions logged',
    epithet: 'the healer',
    greek: { letter: 'Υ', word: 'ὑγίεια', latin: 'hygieia', meaning: 'where the word hygiene comes from.' },
  },
  {
    id: 'school', name: 'School', seat: 3, step: 4, built: true, private: true,
    head: { id: 'prometheus', name: 'Prometheus', job: 'runs School; plans ahead' },
    specialists: [
      { id: 'chiron', name: 'Chiron', job: 'tutor, from your actual notes' },
      { id: 'sphinx', name: 'Sphinx', job: 'quizzes and practice tests' },
      { id: 'kratos', name: 'Kratos', job: 'focus, and not putting it off' },
    ],
    borrows: ['hermes', 'chronos'],
    metric: 'assignments in on time; grade trend per course',
    epithet: 'his name means forethought',
    greek: { letter: 'Σ', word: 'σχολή', latin: 'scholē', meaning: 'It meant free time spent learning, and became the word school.' },
  },
  {
    id: 'media', name: 'Media', seat: 4, step: 7, built: true, private: true,
    head: { id: 'dionysus', name: 'Dionysus', job: 'runs Media' },
    specialists: [
      { id: 'theseus', name: 'Theseus', job: 'video games' },
      { id: 'morpheus', name: 'Morpheus', job: 'movies, TV and YouTube' },
      { id: 'orpheus', name: 'Orpheus', job: 'music' },
    ],
    borrows: ['argus'],
    metric: 'releases it caught before you heard elsewhere',
    epithet: 'the twice-born',
    greek: { letter: 'Μ', word: 'Μοῦσα', latin: 'mousa', meaning: 'the Muse. Music and museum come from it too.' },
  },
  {
    id: 'history', name: 'History', seat: 1, step: 8, built: true, private: false,
    head: { id: 'clio', name: 'Clio', job: 'runs History; checks accuracy' },
    specialists: [
      { id: 'ares', name: 'Ares', job: 'wars and strategy' },
      { id: 'calliope', name: 'Calliope', job: 'turns it into a story' },
      { id: 'atlas', name: 'Atlas', job: 'maps and timelines' },
    ],
    borrows: ['argus', 'mnemosyne'],
    metric: 'deep-dives finished',
    epithet: 'she who makes things famous',
    greek: { letter: 'Ι', word: 'ἱστορία', latin: 'historia', meaning: 'which first meant finding things out by asking.' },
  },
  {
    id: 'projects', name: 'Projects', seat: 5, step: 9, built: true, private: false,
    head: { id: 'odysseus', name: 'Odysseus', job: 'scopes projects and gets them shipped' },
    specialists: [
      { id: 'talos', name: 'Talos', job: 'builds: code and automation' },
      { id: 'nike', name: 'Nike', job: 'milestones, and calling out a stall' },
    ],
    borrows: ['hephaestus', 'daedalus'],
    metric: 'milestones shipped vs. projects stalled',
    epithet: 'the man of many turns',
    greek: { letter: 'Ε', word: 'ἔργον', latin: 'ergon', meaning: 'work. It is still in energy and ergonomic.' },
  },
];

/** Helios, the background researcher - not a chat agent and not in any department (build step 5). */
export const HELIOS: Member = { id: 'helios', name: 'Helios', job: 'background researcher; feeds every agent' };

/**
 * The AgentDefs of every built department. Each department's own agents file is added here
 * as it is built (and its ids to DEPARTMENT_AGENT_IDS in brain/types.ts).
 */
export const DEPARTMENT_AGENTS: AgentDef[] = [...HEALTH_AGENTS, ...SCHOOL_AGENTS, ...MEDIA_AGENTS, ...HISTORY_AGENTS, ...PROJECT_AGENTS];

/** The shared team every department borrows from. */
export const SHARED_TEAM: AgentId[] = CORE_AGENT_IDS.filter((id) => id !== 'ultron');

export function departmentById(id: string): Department | undefined {
  return DEPARTMENTS.find((d) => d.id === id);
}

export function builtDepartments(list: Department[] = DEPARTMENTS): Department[] {
  return list.filter((d) => d.built);
}

/** Which department an agent works in - undefined for Ultron, the shared team and Helios. */
export function departmentOfAgent(id: string, list: Department[] = DEPARTMENTS): Department | undefined {
  return list.find((d) => d.head.id === id || d.specialists.some((s) => s.id === id));
}

/** True when this council name is an agent that exists right now. */
export function isLiveAgent(id: string): id is AgentId {
  return (AGENT_IDS as readonly string[]).includes(id);
}

/**
 * Who a team run may hand steps to. Without a department: the shared team. For a department:
 * its head and its experts first, then the shared team it borrows from.
 */
export function rosterFor(dept?: Department): AgentId[] {
  if (!dept) return [...SHARED_TEAM];
  const own = [dept.head, ...dept.specialists].map((m): string => m.id).filter(isLiveAgent);
  return [...own, ...SHARED_TEAM];
}
