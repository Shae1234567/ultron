export interface SetupStep {
  title: string;
  detail?: string;
  code?: string;
  link?: string;
}

/**
 * A connector is a description of how to wire a service up - nothing more.
 * There is deliberately no `connected` state in this type: this build cannot
 * authenticate anything, so it must never claim to have done so.
 *
 * To add a connector, drop a new file in this folder exporting `connector`.
 * It is picked up automatically - see ./index.ts.
 */
export interface Connector {
  id: string;
  name: string;
  category: 'Mail' | 'Calendar' | 'Notes' | 'Code' | 'Music' | 'Social' | 'Data' | 'Local';
  /** Short line describing what Atlas would do with it once wired up. */
  summary: string;
  /** Honest description of the service's free tier, or null if there isn't one. */
  freeTier: string | null;
  docsUrl: string;
  /** Where the user creates credentials, if applicable. */
  consoleUrl?: string;
  /** OAuth scopes or permissions that would be needed. */
  scopes?: string[];
  /** Real, followable steps. No placeholders. */
  setup: SetupStep[];
  /** Any honest caveat the user should know before starting. */
  caveat?: string;
}
