import { ultron } from './bridge';

/**
 * Tool registry for the agentic loop (see agentLoop.ts). Each entry is a plain
 * JSON-schema-shaped description handed to the model, plus a dispatch case in
 * executeTool that calls the matching bridge method. Kept separate from the
 * single-shot path in conversation.ts, which never calls any of this.
 */

export interface ToolDefinition {
  name: string;
  description: string;
  parameters: {
    type: 'object';
    properties: Record<string, { type: string; description: string; enum?: string[] }>;
    required: string[];
  };
  group: 'browser' | 'files' | 'research' | 'google';
}

export const TOOLS: ToolDefinition[] = [
  // browser
  {
    name: 'web_search',
    description: 'Search the web for a query and return a list of results (title, url, snippet).',
    parameters: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'The search query.' },
        limit: { type: 'number', description: 'Maximum number of results to return.' },
      },
      required: ['query'],
    },
    group: 'browser',
  },
  {
    name: 'open_url',
    description: 'Open a URL in the browser and return the resulting page contents.',
    parameters: {
      type: 'object',
      properties: {
        url: { type: 'string', description: 'The URL to open.' },
      },
      required: ['url'],
    },
    group: 'browser',
  },
  {
    name: 'youtube_search',
    description: 'Search YouTube directly and return real video results (title, url, channel) - use this instead of web_search when the operator wants a video.',
    parameters: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'What to search for on YouTube.' },
        limit: { type: 'number', description: 'Maximum number of results to return.' },
      },
      required: ['query'],
    },
    group: 'browser',
  },
  {
    name: 'click_element',
    description: 'Click an element on the currently open page, identified by a CSS selector.',
    parameters: {
      type: 'object',
      properties: {
        selector: { type: 'string', description: 'CSS selector of the element to click.' },
      },
      required: ['selector'],
    },
    group: 'browser',
  },
  {
    name: 'type_text',
    description: 'Type text into an input on the currently open page, identified by a CSS selector, optionally submitting it.',
    parameters: {
      type: 'object',
      properties: {
        selector: { type: 'string', description: 'CSS selector of the input to type into.' },
        text: { type: 'string', description: 'The text to type.' },
        submit: { type: 'boolean', description: 'Whether to submit the form/input after typing.' },
      },
      required: ['selector', 'text'],
    },
    group: 'browser',
  },
  // files
  {
    name: 'list_files',
    description: 'List indexed files, most recent first.',
    parameters: {
      type: 'object',
      properties: {
        limit: { type: 'number', description: 'Maximum number of files to return.' },
      },
      required: [],
    },
    group: 'files',
  },
  {
    name: 'search_files',
    description: 'Search indexed files by name or content for a query string.',
    parameters: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Search query.' },
      },
      required: ['query'],
    },
    group: 'files',
  },
  {
    name: 'read_file',
    description: 'Read the text contents of a file at the given path.',
    parameters: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'Absolute path of the file to read.' },
      },
      required: ['path'],
    },
    group: 'files',
  },
  {
    name: 'write_file',
    description: 'Overwrite the contents of a file at the given path with new text.',
    parameters: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'Absolute path of the file to write.' },
        content: { type: 'string', description: 'New contents for the file.' },
      },
      required: ['path', 'content'],
    },
    group: 'files',
  },
  {
    name: 'rename_file',
    description: 'Rename a file at the given path to a new name.',
    parameters: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'Absolute path of the file to rename.' },
        newName: { type: 'string', description: 'New file name (not a full path).' },
      },
      required: ['path', 'newName'],
    },
    group: 'files',
  },
  {
    name: 'move_file',
    description: 'Move a file at the given path into a destination folder.',
    parameters: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'Absolute path of the file to move.' },
        destFolder: { type: 'string', description: 'Absolute path of the destination folder.' },
      },
      required: ['path', 'destFolder'],
    },
    group: 'files',
  },
  {
    name: 'delete_file',
    description: 'Delete a file at the given path.',
    parameters: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'Absolute path of the file to delete.' },
      },
      required: ['path'],
    },
    group: 'files',
  },
  {
    name: 'create_file',
    description: 'Create a new file with an optional initial content inside a folder.',
    parameters: {
      type: 'object',
      properties: {
        folder: { type: 'string', description: 'Absolute path of the folder to create the file in.' },
        name: { type: 'string', description: 'Name of the new file.' },
        content: { type: 'string', description: 'Initial file contents.' },
      },
      required: ['folder', 'name'],
    },
    group: 'files',
  },
  {
    name: 'create_folder',
    description: 'Create a new subfolder inside an existing folder.',
    parameters: {
      type: 'object',
      properties: {
        folder: { type: 'string', description: 'Absolute path of the parent folder.' },
        name: { type: 'string', description: 'Name of the new subfolder.' },
      },
      required: ['folder', 'name'],
    },
    group: 'files',
  },
  // google - operator's own connected Gmail/Calendar/Drive (see GooglePanel.tsx)
  {
    name: 'gmail_list_unread',
    description: 'List the operator\'s unread Gmail messages. Fails if Google is not connected.',
    parameters: { type: 'object', properties: { limit: { type: 'number', description: 'Max messages.' } }, required: [] },
    group: 'google',
  },
  {
    name: 'gmail_send',
    description: 'Send an email from the operator\'s own Gmail account. Fails if Google is not connected.',
    parameters: {
      type: 'object',
      properties: {
        to: { type: 'string', description: 'Recipient email address.' },
        subject: { type: 'string', description: 'Email subject.' },
        body: { type: 'string', description: 'Plain-text email body.' },
      },
      required: ['to', 'subject', 'body'],
    },
    group: 'google',
  },
  {
    name: 'calendar_list_upcoming',
    description: 'List the operator\'s upcoming Google Calendar events. Fails if Google is not connected.',
    parameters: { type: 'object', properties: { limit: { type: 'number', description: 'Max events.' } }, required: [] },
    group: 'google',
  },
  {
    name: 'calendar_create_event',
    description: 'Create a Google Calendar event for the operator. Fails if Google is not connected.',
    parameters: {
      type: 'object',
      properties: {
        title: { type: 'string', description: 'Event title.' },
        start: { type: 'string', description: 'Start time, ISO 8601.' },
        end: { type: 'string', description: 'End time, ISO 8601.' },
        description: { type: 'string', description: 'Optional event description.' },
      },
      required: ['title', 'start', 'end'],
    },
    group: 'google',
  },
  {
    name: 'drive_search',
    description: 'Search the operator\'s Google Drive by file name. Fails if Google is not connected.',
    parameters: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Text to search for in file names.' },
        limit: { type: 'number', description: 'Max results.' },
      },
      required: ['query'],
    },
    group: 'google',
  },
  // research
  {
    name: 'wikipedia_lookup',
    description: 'Look up a topic on Wikipedia and return its title, extract, and URL.',
    parameters: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Topic to look up.' },
      },
      required: ['query'],
    },
    group: 'research',
  },
  {
    name: 'weather_lookup',
    description: 'Get current live weather conditions for a place.',
    parameters: {
      type: 'object',
      properties: {
        place: { type: 'string', description: 'Place name, e.g. "Calgary, Alberta, Canada".' },
      },
      required: ['place'],
    },
    group: 'research',
  },
];

export function toolsForGroups(groups: string[]): ToolDefinition[] {
  return TOOLS.filter((t) => groups.includes(t.group));
}

export async function executeTool(name: string, args: Record<string, unknown>): Promise<{ ok: boolean; result?: unknown; error?: string }> {
  const tool = TOOLS.find((t) => t.name === name);
  if (!tool) return { ok: false, error: 'Unknown tool: ' + name };

  try {
    let result: unknown;
    switch (name) {
      // browser - bridge contract landing in parallel, see file header note in agentLoop.ts
      case 'web_search':
        result = await (ultron as any).browser.search(args.query as string, args.limit as number | undefined);
        break;
      case 'open_url':
        result = await (ultron as any).browser.open(args.url as string);
        break;
      case 'youtube_search':
        result = await ultron.browser.youtubeSearch(args.query as string, args.limit as number | undefined);
        break;
      case 'click_element':
        result = await (ultron as any).browser.click(args.selector as string);
        break;
      case 'type_text':
        result = await (ultron as any).browser.type(args.selector as string, args.text as string, args.submit as boolean | undefined);
        break;
      // files
      case 'list_files':
        result = await ultron.files.list(args.limit as number | undefined);
        break;
      case 'search_files':
        result = await ultron.files.search(args.query as string);
        break;
      case 'read_file':
        result = await ultron.files.read(args.path as string);
        break;
      case 'write_file':
        result = await ultron.files.write(args.path as string, args.content as string);
        break;
      case 'rename_file':
        result = await ultron.files.rename(args.path as string, args.newName as string);
        break;
      case 'move_file':
        result = await ultron.files.move(args.path as string, args.destFolder as string);
        break;
      case 'delete_file':
        result = await ultron.files.delete(args.path as string);
        break;
      case 'create_file':
        result = await ultron.files.createFile(args.folder as string, args.name as string, args.content as string | undefined);
        break;
      case 'create_folder':
        result = await ultron.files.createFolder(args.folder as string, args.name as string);
        break;
      // google
      case 'gmail_list_unread':
        result = await ultron.google.gmailListUnread(args.limit as number | undefined);
        break;
      case 'gmail_send':
        result = await ultron.google.gmailSend(args.to as string, args.subject as string, args.body as string);
        break;
      case 'calendar_list_upcoming':
        result = await ultron.google.calendarListUpcoming(args.limit as number | undefined);
        break;
      case 'calendar_create_event':
        result = await ultron.google.calendarCreateEvent(
          args.title as string, args.start as string, args.end as string, args.description as string | undefined,
        );
        break;
      case 'drive_search':
        result = await ultron.google.driveSearch(args.query as string, args.limit as number | undefined);
        break;
      // research
      case 'wikipedia_lookup':
        result = await ultron.research.wikipedia(args.query as string);
        break;
      case 'weather_lookup':
        result = await ultron.research.weather(args.place as string);
        break;
      default:
        return { ok: false, error: 'Unknown tool: ' + name };
    }
    return { ok: true, result };
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    return { ok: false, error: message };
  }
}
