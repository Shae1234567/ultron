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
  group: 'browser' | 'files' | 'research' | 'google' | 'system' | 'flights' | 'telegram' | 'vision' | 'utility';
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
  // system - real OS control on the operator's own machine (never shutdown/restart)
  {
    name: 'open_app',
    description: 'Launch an application on the operator\'s computer by name (e.g. "notepad", "chrome", "calc").',
    parameters: { type: 'object', properties: { name: { type: 'string', description: 'App name or path.' } }, required: ['name'] },
    group: 'system',
  },
  {
    name: 'open_google_service',
    description: 'Open a specific Google service in the browser (gmail, compose, calendar, drive, docs, sheets, slides, maps, photos, translate, youtube, search).',
    parameters: { type: 'object', properties: { service: { type: 'string', description: 'Which Google service to open.' } }, required: ['service'] },
    group: 'system',
  },
  {
    name: 'set_volume',
    description: 'Adjust the operator\'s system volume.',
    parameters: {
      type: 'object',
      properties: { direction: { type: 'string', enum: ['up', 'down', 'mute'], description: 'Volume direction.' } },
      required: ['direction'],
    },
    group: 'system',
  },
  {
    name: 'lock_computer',
    description: 'Lock the operator\'s computer (returns to the Windows lock screen). Only do this if explicitly asked.',
    parameters: { type: 'object', properties: {}, required: [] },
    group: 'system',
  },
  {
    name: 'open_file_explorer',
    description: 'Open Windows File Explorer at a given folder path, or the user folder if none given.',
    parameters: { type: 'object', properties: { path: { type: 'string', description: 'Folder path to open.' } }, required: [] },
    group: 'system',
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
  // flights
  {
    name: 'find_flights',
    description: 'Search live Google Flights results for a route and date. Best-effort text extraction, not a guaranteed structured feed.',
    parameters: {
      type: 'object',
      properties: {
        origin: { type: 'string', description: 'Origin city or airport.' },
        destination: { type: 'string', description: 'Destination city or airport.' },
        date: { type: 'string', description: 'Travel date, e.g. "2026-09-10".' },
      },
      required: ['origin', 'destination', 'date'],
    },
    group: 'flights',
  },
  // telegram
  {
    name: 'telegram_send',
    description: 'Send a Telegram message via the operator\'s own bot. Fails if no bot token is configured.',
    parameters: {
      type: 'object',
      properties: {
        chatId: { type: 'string', description: 'Target chat id (from telegram_recent_chats).' },
        text: { type: 'string', description: 'Message text.' },
      },
      required: ['chatId', 'text'],
    },
    group: 'telegram',
  },
  {
    name: 'telegram_recent_chats',
    description: 'List chats the operator\'s Telegram bot has recently seen, to find a chat id before sending.',
    parameters: { type: 'object', properties: {}, required: [] },
    group: 'telegram',
  },
  // vision
  {
    name: 'describe_screen',
    description: 'Capture the operator\'s screen right now and describe what is on it, answering a specific question if given one.',
    parameters: {
      type: 'object',
      properties: {
        question: { type: 'string', description: 'What to look for or answer about the screen.' },
      },
      required: ['question'],
    },
    group: 'vision',
  },
  // utility - calculator, WolframAlpha, notes, jokes, IP/battery, windows, screenshot, hide, geo
  {
    name: 'calculate',
    description: 'Evaluate a plain arithmetic expression (+ - * / ^ % parentheses). Safe, no code execution.',
    parameters: { type: 'object', properties: { expression: { type: 'string', description: 'e.g. "2 + 3 * (4 - 1)"' } }, required: ['expression'] },
    group: 'utility',
  },
  {
    name: 'ask_wolfram_alpha',
    description: 'Ask WolframAlpha a factual/computational question (unit conversions, science facts, general knowledge). Fails if no WolframAlpha app id is configured.',
    parameters: { type: 'object', properties: { query: { type: 'string', description: 'The question.' } }, required: ['query'] },
    group: 'utility',
  },
  {
    name: 'add_note',
    description: 'Save a short quick note (separate from the long-term memory file).',
    parameters: { type: 'object', properties: { text: { type: 'string', description: 'The note text.' } }, required: ['text'] },
    group: 'utility',
  },
  {
    name: 'list_notes',
    description: 'List saved quick notes, most recent last.',
    parameters: { type: 'object', properties: {}, required: [] },
    group: 'utility',
  },
  {
    name: 'tell_joke',
    description: 'Fetch a real random joke.',
    parameters: { type: 'object', properties: {}, required: [] },
    group: 'utility',
  },
  {
    name: 'get_ip_address',
    description: 'Get the operator\'s current public and local IP addresses.',
    parameters: { type: 'object', properties: {}, required: [] },
    group: 'utility',
  },
  {
    name: 'get_battery_status',
    description: 'Get the operator\'s real battery charge/charging status, if this machine has a battery.',
    parameters: { type: 'object', properties: {}, required: [] },
    group: 'utility',
  },
  {
    name: 'switch_window',
    description: 'Bring an open window to the foreground by a partial, case-insensitive title match.',
    parameters: { type: 'object', properties: { titleContains: { type: 'string', description: 'Partial window title.' } }, required: ['titleContains'] },
    group: 'utility',
  },
  {
    name: 'take_screenshot',
    description: 'Capture the screen right now and save it as a PNG file, with an optional custom filename.',
    parameters: { type: 'object', properties: { filename: { type: 'string', description: 'Optional filename, .png added if missing.' } }, required: [] },
    group: 'utility',
  },
  {
    name: 'hide_folder_contents',
    description: 'Hide (Windows hidden attribute) every file/folder directly inside an indexed folder. Only works inside folders already added via the Files tab.',
    parameters: { type: 'object', properties: { folderPath: { type: 'string', description: 'Absolute path of an indexed folder.' } }, required: ['folderPath'] },
    group: 'utility',
  },
  {
    name: 'unhide_folder_contents',
    description: 'Reverse of hide_folder_contents - clears the hidden attribute on everything directly inside an indexed folder.',
    parameters: { type: 'object', properties: { folderPath: { type: 'string', description: 'Absolute path of an indexed folder.' } }, required: ['folderPath'] },
    group: 'utility',
  },
  {
    name: 'geocode_place',
    description: 'Look up a place\'s real coordinates.',
    parameters: { type: 'object', properties: { query: { type: 'string', description: 'Place name.' } }, required: ['query'] },
    group: 'utility',
  },
  {
    name: 'play_youtube_video',
    description: 'Search YouTube for a query and open/click the first matching video to start playing it.',
    parameters: { type: 'object', properties: { query: { type: 'string', description: 'What to search for, e.g. a song or artist.' } }, required: ['query'] },
    group: 'utility',
  },
  {
    name: 'distance_between_places',
    description: 'Get the real great-circle distance in km between two places.',
    parameters: {
      type: 'object',
      properties: {
        from: { type: 'string', description: 'Starting place name.' },
        to: { type: 'string', description: 'Destination place name.' },
      },
      required: ['from', 'to'],
    },
    group: 'utility',
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
      // system
      case 'open_app':
        result = await ultron.system.openApp(args.name as string);
        break;
      case 'open_google_service':
        result = await ultron.system.openGoogleService(args.service as string);
        break;
      case 'set_volume':
        result = await ultron.system.setVolume(args.direction as 'up' | 'down' | 'mute');
        break;
      case 'lock_computer':
        result = await ultron.system.lock();
        break;
      case 'open_file_explorer':
        result = await ultron.system.openExplorer(args.path as string | undefined);
        break;
      // research
      case 'wikipedia_lookup':
        result = await ultron.research.wikipedia(args.query as string);
        break;
      case 'weather_lookup':
        result = await ultron.research.weather(args.place as string);
        break;
      // flights
      case 'find_flights':
        result = await ultron.flights.find(args.origin as string, args.destination as string, args.date as string);
        break;
      // telegram
      case 'telegram_send':
        result = await ultron.telegram.send(args.chatId as string, args.text as string);
        break;
      case 'telegram_recent_chats':
        result = await ultron.telegram.recentChats();
        break;
      // vision - capture happens in main (desktopCapturer), description happens
      // here in the renderer because that's the only process already trusted
      // with a client-side Gemini key (see liveVoiceSession.ts's identical pattern).
      case 'describe_screen': {
        const capture = await ultron.vision.captureScreen();
        if (!capture.ok || !capture.dataUrl) { result = capture; break; }
        const apiKey = await ultron.gemini.getKeyForLiveSession();
        if (!apiKey) { result = { ok: false, error: 'No GEMINI_API_KEY configured.' }; break; }
        const { describeImage } = await import('./vision');
        result = await describeImage(capture.dataUrl, (args.question as string) || 'Describe what is on the screen.', apiKey);
        break;
      }
      // utility
      case 'calculate':
        result = await ultron.calc.evaluate(args.expression as string);
        break;
      case 'ask_wolfram_alpha':
        result = await ultron.wolfram.ask(args.query as string);
        break;
      case 'add_note':
        result = await ultron.notes.add(args.text as string);
        break;
      case 'list_notes':
        result = await ultron.notes.list();
        break;
      case 'tell_joke':
        result = await ultron.joke.random();
        break;
      case 'get_ip_address':
        result = await ultron.ip.info();
        break;
      case 'get_battery_status':
        result = await ultron.battery.info();
        break;
      case 'switch_window':
        result = await ultron.windows.switchTo(args.titleContains as string);
        break;
      case 'take_screenshot':
        result = await ultron.screenshot.take(args.filename as string | undefined);
        break;
      case 'hide_folder_contents':
        result = await ultron.fileVisibility.hide(args.folderPath as string);
        break;
      case 'unhide_folder_contents':
        result = await ultron.fileVisibility.unhide(args.folderPath as string);
        break;
      case 'geocode_place':
        result = await ultron.geo.place(args.query as string);
        break;
      case 'distance_between_places':
        result = await ultron.geo.distance(args.from as string, args.to as string);
        break;
      // Reuses youtube_search's real structured result (a real scraped watch
      // URL, not a guessed click-selector) and just navigates to it directly
      // - far more reliable than clicking a thumbnail on a JS-heavy page.
      case 'play_youtube_video': {
        const search = await ultron.browser.youtubeSearch(args.query as string, 1);
        if (!search.ok || !search.results[0]) { result = { ok: false, error: 'No matching video found.' }; break; }
        result = await (ultron as any).browser.open(search.results[0].url);
        break;
      }
      default:
        return { ok: false, error: 'Unknown tool: ' + name };
    }
    return { ok: true, result };
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    return { ok: false, error: message };
  }
}
