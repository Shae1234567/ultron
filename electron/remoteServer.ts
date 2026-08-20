import http, { IncomingMessage, ServerResponse } from 'node:http';
import os from 'node:os';
import QRCode from 'qrcode';

/**
 * Fixed local port for the remote-dashboard HTTP server. Chosen in the
 * high/unassigned range to minimize the chance of colliding with other
 * local dev servers or OS services (Electron dev tooling tends to cluster
 * around 3000/5173/8080/etc, so this deliberately avoids that range).
 */
const REMOTE_SERVER_PORT = 47821;

export interface RemoteServerStatus {
  running: boolean;
  url?: string;
  qrDataUrl?: string;
  error?: string;
}

type CommandHandler = (cmd: { type: string; payload?: unknown }) => void;

let server: http.Server | null = null;
let currentStatus: RemoteServerStatus = { running: false };

/** Finds the first non-internal IPv4 address across all network interfaces. */
function getLanIp(): string | null {
  try {
    const interfaces = os.networkInterfaces();
    for (const name of Object.keys(interfaces)) {
      const addrs = interfaces[name];
      if (!addrs) continue;
      for (const addr of addrs) {
        if (addr.family === 'IPv4' && !addr.internal) {
          return addr.address;
        }
      }
    }
    return null;
  } catch {
    return null;
  }
}

function buildHtmlPage(): string {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1" />
<title>Atlas Remote</title>
<style>
  * { box-sizing: border-box; }
  body {
    margin: 0;
    padding: 24px 16px 48px;
    background: #0b0d10;
    color: #e6e8eb;
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
    min-height: 100vh;
  }
  h1 {
    font-size: 22px;
    letter-spacing: 0.08em;
    text-align: center;
    margin: 8px 0 28px;
    color: #7dd3fc;
  }
  .card {
    max-width: 480px;
    margin: 0 auto 20px;
    background: #14171c;
    border: 1px solid #22262e;
    border-radius: 12px;
    padding: 16px;
  }
  label {
    display: block;
    font-size: 12px;
    text-transform: uppercase;
    letter-spacing: 0.05em;
    color: #9aa4af;
    margin-bottom: 8px;
  }
  input[type="text"] {
    width: 100%;
    padding: 12px;
    font-size: 16px;
    background: #0b0d10;
    color: #e6e8eb;
    border: 1px solid #2a2f37;
    border-radius: 8px;
    margin-bottom: 12px;
  }
  button {
    width: 100%;
    padding: 12px;
    font-size: 15px;
    font-weight: 600;
    color: #0b0d10;
    background: #7dd3fc;
    border: none;
    border-radius: 8px;
    cursor: pointer;
  }
  button.secondary {
    background: #22262e;
    color: #e6e8eb;
    margin-top: 8px;
    border: 1px solid #2a2f37;
  }
  .quick-actions {
    display: flex;
    flex-direction: column;
    gap: 8px;
  }
  #status {
    max-width: 480px;
    margin: 0 auto;
    text-align: center;
    font-size: 13px;
    color: #9aa4af;
    min-height: 18px;
  }
</style>
</head>
<body>
  <h1>ATLAS REMOTE</h1>

  <div class="card">
    <label for="msg">Message</label>
    <input type="text" id="msg" placeholder="Type something to send to Atlas" autocomplete="off" />
    <button id="sendBtn">Send</button>
  </div>

  <div class="card quick-actions">
    <label>Quick Actions</label>
    <button class="secondary" id="statusBtn">Status</button>
    <button class="secondary" id="stopListeningBtn">Stop listening</button>
  </div>

  <div id="status"></div>

  <script>
    var statusEl = document.getElementById('status');

    function showStatus(text) {
      statusEl.textContent = text;
    }

    function sendCommand(type, payload) {
      showStatus('Sending...');
      fetch('/command', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ type: type, payload: payload })
      })
        .then(function (res) {
          if (!res.ok) throw new Error('Request failed: ' + res.status);
          return res.json();
        })
        .then(function () {
          showStatus('Sent.');
        })
        .catch(function (err) {
          showStatus('Error: ' + err.message);
        });
    }

    document.getElementById('sendBtn').addEventListener('click', function () {
      var input = document.getElementById('msg');
      var text = input.value.trim();
      if (!text) {
        showStatus('Type a message first.');
        return;
      }
      sendCommand('message', { text: text });
      input.value = '';
    });

    document.getElementById('msg').addEventListener('keydown', function (e) {
      if (e.key === 'Enter') {
        document.getElementById('sendBtn').click();
      }
    });

    document.getElementById('statusBtn').addEventListener('click', function () {
      sendCommand('status');
    });

    document.getElementById('stopListeningBtn').addEventListener('click', function () {
      sendCommand('stop_listening');
    });
  </script>
</body>
</html>`;
}

function handleRequest(onCommand: CommandHandler, req: IncomingMessage, res: ServerResponse): void {
  try {
    const url = req.url || '/';

    if (req.method === 'GET' && url === '/') {
      const html = buildHtmlPage();
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(html);
      return;
    }

    if (req.method === 'POST' && url === '/command') {
      let body = '';
      req.on('data', (chunk) => {
        body += chunk;
        // Basic guard against unbounded bodies from a misbehaving client.
        if (body.length > 1_000_000) {
          req.destroy();
        }
      });
      req.on('end', () => {
        try {
          const parsed = JSON.parse(body || '{}');
          if (!parsed || typeof parsed !== 'object' || typeof parsed.type !== 'string') {
            res.writeHead(400, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ ok: false, error: 'Invalid command body' }));
            return;
          }
          try {
            onCommand({ type: parsed.type, payload: parsed.payload });
          } catch {
            // A misbehaving handler shouldn't take the HTTP response down with it.
          }
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ ok: true }));
        } catch {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ ok: false, error: 'Malformed JSON' }));
        }
      });
      req.on('error', () => {
        try {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ ok: false, error: 'Request error' }));
        } catch {
          // Response may already be closed; nothing more to do.
        }
      });
      return;
    }

    res.writeHead(404, { 'Content-Type': 'text/plain' });
    res.end('Not found');
  } catch {
    try {
      res.writeHead(500, { 'Content-Type': 'text/plain' });
      res.end('Internal error');
    } catch {
      // Socket likely already gone; nothing more to do.
    }
  }
}

/**
 * Starts the remote-dashboard HTTP server bound to 0.0.0.0 so a phone on the
 * same LAN/WiFi can reach it, generates a pairing QR code for the resulting
 * URL, and returns the resulting status.
 *
 * Known tradeoff, not an oversight: this server has no authentication. It is
 * explicitly LAN-only and opt-in (only starts when the operator toggles it
 * on), so anyone on the same network can hit it while it's running.
 */
export async function startRemoteServer(onCommand: CommandHandler): Promise<RemoteServerStatus> {
  try {
    if (server) {
      return currentStatus;
    }

    const lanIp = getLanIp();
    if (!lanIp) {
      currentStatus = { running: false, error: 'No LAN IPv4 address found' };
      return currentStatus;
    }

    await new Promise<void>((resolve, reject) => {
      const s = http.createServer((req, res) => handleRequest(onCommand, req, res));
      s.once('error', (err) => {
        server = null;
        reject(err);
      });
      s.listen(REMOTE_SERVER_PORT, '0.0.0.0', () => {
        server = s;
        resolve();
      });
    });

    const url = `http://${lanIp}:${REMOTE_SERVER_PORT}`;
    const qrDataUrl = await QRCode.toDataURL(url);

    currentStatus = { running: true, url, qrDataUrl };
    return currentStatus;
  } catch (err) {
    server = null;
    currentStatus = {
      running: false,
      error: err instanceof Error ? err.message : 'Failed to start remote server',
    };
    return currentStatus;
  }
}

/** Closes the remote server. Safe to call even if it isn't running. */
export function stopRemoteServer(): void {
  try {
    if (server) {
      server.close();
      server = null;
    }
    currentStatus = { running: false };
  } catch {
    // Best-effort shutdown; server reference is dropped regardless.
    server = null;
    currentStatus = { running: false };
  }
}

export function getRemoteServerStatus(): RemoteServerStatus {
  return currentStatus;
}
