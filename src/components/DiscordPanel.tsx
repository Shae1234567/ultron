import { useEffect, useState } from 'react';
import { Overlay } from './Overlay';
import { ultron } from '../services/bridge';
import type {
  DiscordWebhookInfo, DiscordBotIdentity, DiscordGuild, DiscordChannel,
  DiscordMessage, DiscordRole, DiscordMember,
} from '../types';

type Status = 'checking' | 'connected' | 'disconnected' | 'invalid';

/**
 * The real Discord connector - two independent modes:
 *
 *  - Webhook: posts into one channel, cannot read anything back.
 *  - Bot: a real bot invited into the server with a deliberately narrow,
 *    named permission set (view/send/embed/read-history/manage channels/
 *    manage roles). Read, richer posting, and reversible channel/role
 *    management - never kick, ban, delete, or Administrator. See the
 *    reasoning in electron/discord.ts.
 *
 * Every write here is only ever a direct result of a button click - never
 * something the LLM can trigger on its own from a conversation.
 */
export function DiscordPanel({ onClose }: { onClose: () => void }) {
  return (
    <Overlay title="Discord" meta="TWO MODES" onClose={onClose}>
      <WebhookSection />
      <div className="field__hint" style={{ margin: '18px 0', borderTop: '1px solid var(--cyan-15, rgba(0,217,255,0.15))', paddingTop: 14 }}>
        A webhook can only post. For reading channels, richer posting, and reversible
        channel/role management, connect a real bot below.
      </div>
      <BotSection />
    </Overlay>
  );
}

function WebhookSection() {
  const [status, setStatus] = useState<Status>('checking');
  const [info, setInfo] = useState<DiscordWebhookInfo | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [urlDraft, setUrlDraft] = useState('');
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState('');
  const [sendState, setSendState] = useState<'idle' | 'sending' | 'sent' | 'failed'>('idle');

  const checkConnection = async () => {
    setStatus('checking');
    const has = await ultron.discord.hasWebhook();
    if (!has) { setStatus('disconnected'); return; }
    const res = await ultron.discord.verify();
    if (res.ok && res.info) {
      setInfo(res.info);
      setStatus('connected');
      setError(null);
    } else {
      setStatus('invalid');
      setError(res.error ?? 'Webhook could not be verified.');
    }
  };

  useEffect(() => { void checkConnection(); }, []);

  const saveUrl = async () => {
    const value = urlDraft.trim();
    if (!value) return;
    setSaving(true);
    try {
      const res = await ultron.settings.setEnvKey('DISCORD_WEBHOOK_URL', value);
      if (res.ok) {
        setUrlDraft('');
        await checkConnection();
      } else {
        setError(res.error ?? 'Could not save webhook URL.');
      }
    } finally {
      setSaving(false);
    }
  };

  const send = async () => {
    const text = message.trim();
    if (!text) return;
    setSendState('sending');
    const res = await ultron.discord.postMessage(text);
    if (res.ok) {
      setSendState('sent');
      setMessage('');
      setTimeout(() => setSendState('idle'), 2500);
    } else {
      setSendState('failed');
      setError(res.error ?? 'Send failed.');
    }
  };

  return (
    <>
      <div className="field__label" style={{ marginBottom: 6 }}>Webhook (simple posting)</div>

      {status === 'checking' && <div className="empty-note">Checking connection...</div>}

      {(status === 'disconnected' || status === 'invalid') && (
        <>
          <div className={`alert-strip ${status === 'invalid' ? 'alert-strip--warn' : 'alert-strip--info'}`} style={{ marginBottom: 14 }}>
            <span className="dot" />
            {status === 'invalid' ? (error ?? 'Webhook invalid.') : 'Not connected yet - paste a webhook URL below to connect for real.'}
          </div>
          <div className="field">
            <div style={{ display: 'flex', gap: 6 }}>
              <input
                className="hud-input"
                type="password"
                placeholder="https://discord.com/api/webhooks/..."
                value={urlDraft}
                onChange={(e) => setUrlDraft(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter') void saveUrl(); }}
              />
              <button className="hud-btn hud-btn--active" onClick={() => void saveUrl()} disabled={!urlDraft.trim() || saving}>
                {saving ? 'Connecting...' : 'Connect'}
              </button>
            </div>
            <div className="field__hint">
              Channel settings → Integrations → Webhooks → New Webhook, then paste its URL.
              Saved to your local .env.
            </div>
          </div>
        </>
      )}

      {status === 'connected' && info && (
        <>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 12 }}>
            <div>
              <div style={{ color: 'var(--white)', fontWeight: 600 }}>{info.name}</div>
              <span className="mono" style={{ fontSize: 10.5, color: 'var(--dim)' }}>channel {info.channelId}</span>
            </div>
            <button className="hud-btn" style={{ marginLeft: 'auto' }} onClick={() => void checkConnection()}>Refresh</button>
          </div>
          <div className="field">
            <textarea
              className="hud-input"
              style={{ minHeight: 56, width: '100%', resize: 'vertical' }}
              placeholder="Message to post into the channel..."
              value={message}
              onChange={(e) => setMessage(e.target.value)}
            />
            <button
              className="hud-btn hud-btn--active"
              style={{ marginTop: 8 }}
              onClick={() => void send()}
              disabled={!message.trim() || sendState === 'sending'}
            >
              {sendState === 'sending' ? 'Sending...' : sendState === 'sent' ? 'Sent ✓' : 'Send'}
            </button>
            {sendState === 'failed' && error && <div className="field__hint" style={{ color: 'var(--red)' }}>{error}</div>}
          </div>
        </>
      )}
    </>
  );
}

function BotSection() {
  const [status, setStatus] = useState<Status>('checking');
  const [bot, setBot] = useState<DiscordBotIdentity | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [tokenDraft, setTokenDraft] = useState('');
  const [saving, setSaving] = useState(false);

  const [guilds, setGuilds] = useState<DiscordGuild[]>([]);
  const [guildId, setGuildId] = useState('');
  const [channels, setChannels] = useState<DiscordChannel[]>([]);
  const [channelId, setChannelId] = useState('');
  const [roles, setRoles] = useState<DiscordRole[]>([]);
  const [members, setMembers] = useState<DiscordMember[]>([]);

  const [messages, setMessages] = useState<DiscordMessage[]>([]);
  const [loadingMessages, setLoadingMessages] = useState(false);
  const [summary, setSummary] = useState('');
  const [summarizing, setSummarizing] = useState(false);

  const [postText, setPostText] = useState('');
  const [postState, setPostState] = useState<'idle' | 'sending' | 'sent' | 'failed'>('idle');

  const [newChannelName, setNewChannelName] = useState('');
  const [channelActionState, setChannelActionState] = useState<'idle' | 'busy' | 'failed'>('idle');
  const [renameDraft, setRenameDraft] = useState('');

  const [userId, setUserId] = useState('');
  const [roleId, setRoleId] = useState('');
  const [roleActionState, setRoleActionState] = useState<'idle' | 'busy' | 'failed'>('idle');
  const [roleActionMsg, setRoleActionMsg] = useState('');

  const checkConnection = async () => {
    setStatus('checking');
    const has = await ultron.discord.hasBotToken();
    if (!has) { setStatus('disconnected'); return; }
    const res = await ultron.discord.verifyBot();
    if (res.ok && res.bot) {
      setBot(res.bot);
      setStatus('connected');
      setError(null);
    } else {
      setStatus('invalid');
      setError(res.error ?? 'Bot token could not be verified.');
    }
  };

  useEffect(() => { void checkConnection(); }, []);

  useEffect(() => {
    if (status !== 'connected') return;
    void ultron.discord.guilds().then((g) => {
      setGuilds(g);
      if (g.length === 1) setGuildId(g[0].id);
    });
  }, [status]);

  useEffect(() => {
    if (!guildId) { setChannels([]); setRoles([]); setMembers([]); return; }
    void ultron.discord.channels(guildId).then(setChannels);
    void ultron.discord.roles(guildId).then(setRoles);
    void ultron.discord.members(guildId, 100).then(setMembers);
  }, [guildId]);

  const saveToken = async () => {
    const value = tokenDraft.trim();
    if (!value) return;
    setSaving(true);
    try {
      const res = await ultron.settings.setEnvKey('DISCORD_BOT_TOKEN', value);
      if (res.ok) {
        setTokenDraft('');
        await checkConnection();
      } else {
        setError(res.error ?? 'Could not save bot token.');
      }
    } finally {
      setSaving(false);
    }
  };

  const loadMessages = async () => {
    if (!channelId) return;
    setLoadingMessages(true);
    setSummary('');
    try {
      setMessages(await ultron.discord.messages(channelId, 30));
    } finally {
      setLoadingMessages(false);
    }
  };

  const summarize = async () => {
    if (messages.length === 0) return;
    setSummarizing(true);
    setSummary('');
    try {
      const dump = [...messages].reverse().map((m) => `${m.author}: ${m.content || '(no text content)'}`).join('\n');
      const res = await ultron.ollama.once({
        messages: [
          {
            role: 'system',
            content:
              'You summarize Discord channel activity. Below is the complete, real set of ' +
              'recent messages fetched from the channel - nothing else exists. Summarize only ' +
              'what is actually there: who said what, in a few short lines. Do not invent a ' +
              'message, a topic, or a person that is not in the list below.',
          },
          { role: 'user', content: dump },
        ],
        timeoutMs: 30000,
      });
      setSummary(res.ok ? res.text.trim() : `[failed] ${res.error}`);
    } finally {
      setSummarizing(false);
    }
  };

  const post = async () => {
    const text = postText.trim();
    if (!text || !channelId) return;
    setPostState('sending');
    const res = await ultron.discord.postAsBot(channelId, text);
    if (res.ok) {
      setPostState('sent');
      setPostText('');
      setTimeout(() => setPostState('idle'), 2500);
    } else {
      setPostState('failed');
      setError(res.error ?? 'Send failed.');
    }
  };

  const createChannel = async () => {
    if (!newChannelName.trim() || !guildId) return;
    setChannelActionState('busy');
    const res = await ultron.discord.createChannel(guildId, newChannelName);
    if (res.ok) {
      setNewChannelName('');
      setChannelActionState('idle');
      void ultron.discord.channels(guildId).then(setChannels);
    } else {
      setChannelActionState('failed');
      setError(res.error ?? 'Could not create channel.');
    }
  };

  const renameSelectedChannel = async () => {
    if (!renameDraft.trim() || !channelId) return;
    setChannelActionState('busy');
    const res = await ultron.discord.renameChannel(channelId, renameDraft);
    if (res.ok) {
      setRenameDraft('');
      setChannelActionState('idle');
      void ultron.discord.channels(guildId).then(setChannels);
    } else {
      setChannelActionState('failed');
      setError(res.error ?? 'Could not rename channel.');
    }
  };

  const doAssignRole = async (grant: boolean) => {
    if (!userId || !roleId || !guildId) return;
    setRoleActionState('busy');
    setRoleActionMsg('');
    const res = grant
      ? await ultron.discord.assignRole(guildId, userId, roleId)
      : await ultron.discord.removeRole(guildId, userId, roleId);
    if (res.ok) {
      setRoleActionState('idle');
      setRoleActionMsg(grant ? 'Role granted.' : 'Role removed.');
      void ultron.discord.members(guildId, 100).then(setMembers);
    } else {
      setRoleActionState('failed');
      setRoleActionMsg(res.error ?? 'Action failed.');
    }
  };

  return (
    <>
      <div className="field__label" style={{ marginBottom: 6 }}>Bot (read, richer post, roles & channels)</div>

      {status === 'checking' && <div className="empty-note">Checking connection...</div>}

      {(status === 'disconnected' || status === 'invalid') && (
        <>
          <div className={`alert-strip ${status === 'invalid' ? 'alert-strip--warn' : 'alert-strip--info'}`} style={{ marginBottom: 14 }}>
            <span className="dot" />
            {status === 'invalid' ? (error ?? 'Bot token invalid.') : 'Not connected yet - a real bot, invited with a narrow permission set.'}
          </div>

          <div className="step">
            <span className="step__n">1</span>
            <div className="step__text">
              Create an application and add a bot to it.
              <div style={{ marginTop: 5 }}>
                <span className="link-btn" onClick={() => void ultron.app.openExternal('https://discord.com/developers/applications')}>
                  discord.com/developers/applications
                </span>
              </div>
            </div>
          </div>
          <div className="step">
            <span className="step__n">2</span>
            <div className="step__text">
              Bot tab: copy the token, and turn on the <strong>Message Content Intent</strong> and
              <strong> Server Members Intent</strong> toggles (needed to read messages and members).
            </div>
          </div>
          <div className="step">
            <span className="step__n">3</span>
            <div className="step__text">
              OAuth2 → URL Generator: check <strong>bot</strong>, then these permissions only -
              View Channels, Send Messages, Embed Links, Read Message History, Manage Channels,
              Manage Roles. Open the generated URL and invite it to your server.
              <div className="field__hint" style={{ marginTop: 4 }}>
                Deliberately excludes Kick Members, Ban Members, Manage Server, and Administrator -
                this connector never requests those.
              </div>
            </div>
          </div>

          <div className="field" style={{ marginTop: 14 }}>
            <span className="field__label">Paste your bot token</span>
            <div style={{ display: 'flex', gap: 6 }}>
              <input
                className="hud-input"
                type="password"
                placeholder="bot token..."
                value={tokenDraft}
                onChange={(e) => setTokenDraft(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter') void saveToken(); }}
              />
              <button className="hud-btn hud-btn--active" onClick={() => void saveToken()} disabled={!tokenDraft.trim() || saving}>
                {saving ? 'Connecting...' : 'Connect'}
              </button>
            </div>
            <div className="field__hint">Saved to your local .env, same as every other key here.</div>
          </div>
        </>
      )}

      {status === 'connected' && bot && (
        <>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 14 }}>
            {bot.avatarUrl && <img src={bot.avatarUrl} alt="" width={32} height={32} style={{ border: '1px solid var(--cyan-35)' }} />}
            <div style={{ color: 'var(--white)', fontWeight: 600 }}>{bot.username}</div>
            <button className="hud-btn" style={{ marginLeft: 'auto' }} onClick={() => void checkConnection()}>Refresh</button>
          </div>

          <div className="field">
            <span className="field__label">Server</span>
            {guilds.length === 0 ? (
              <div className="empty-note">This bot hasn't been invited into a server yet.</div>
            ) : (
              <select className="hud-input" value={guildId} onChange={(e) => setGuildId(e.target.value)}>
                <option value="">Select a server...</option>
                {guilds.map((g) => <option key={g.id} value={g.id}>{g.name}</option>)}
              </select>
            )}
          </div>

          {guildId && (
            <>
              <div className="field">
                <span className="field__label">Channel</span>
                <select className="hud-input" value={channelId} onChange={(e) => { setChannelId(e.target.value); setMessages([]); setSummary(''); }}>
                  <option value="">Select a channel...</option>
                  {channels.filter((c) => c.type !== 4).map((c) => <option key={c.id} value={c.id}>#{c.name}</option>)}
                </select>
              </div>

              {channelId && (
                <>
                  <div className="field">
                    <span className="field__label">Read & summarize</span>
                    <button className="hud-btn" onClick={() => void loadMessages()} disabled={loadingMessages}>
                      {loadingMessages ? 'Loading...' : 'Load recent messages'}
                    </button>
                    {messages.length > 0 && (
                      <>
                        <div style={{ maxHeight: 140, overflowY: 'auto', marginTop: 8 }}>
                          {[...messages].reverse().map((m) => (
                            <div key={m.id} className="folder-row">
                              <span className="mono" style={{ fontSize: 9.5, color: 'var(--cyan)', flex: '0 0 auto' }}>{m.author}</span>
                              <span className="folder-row__path">{m.content || '(no text content)'}</span>
                            </div>
                          ))}
                        </div>
                        <button className="hud-btn hud-btn--active" style={{ marginTop: 8 }} onClick={() => void summarize()} disabled={summarizing}>
                          {summarizing ? 'Summarizing...' : 'Summarize with Ultron'}
                        </button>
                        {summary && <div className="step__text" style={{ marginTop: 8, color: '#c3dced' }}>{summary}</div>}
                      </>
                    )}
                  </div>

                  <div className="field">
                    <span className="field__label">Post a message</span>
                    <textarea
                      className="hud-input"
                      style={{ minHeight: 56, width: '100%', resize: 'vertical' }}
                      placeholder={`Message to post into #${channels.find((c) => c.id === channelId)?.name ?? ''}...`}
                      value={postText}
                      onChange={(e) => setPostText(e.target.value)}
                    />
                    <button className="hud-btn hud-btn--active" style={{ marginTop: 8 }} onClick={() => void post()} disabled={!postText.trim() || postState === 'sending'}>
                      {postState === 'sending' ? 'Sending...' : postState === 'sent' ? 'Sent ✓' : 'Send'}
                    </button>
                    {postState === 'failed' && error && <div className="field__hint" style={{ color: 'var(--red)' }}>{error}</div>}
                  </div>

                  <div className="field">
                    <span className="field__label">Rename this channel</span>
                    <div style={{ display: 'flex', gap: 6 }}>
                      <input className="hud-input" placeholder="new-channel-name" value={renameDraft} onChange={(e) => setRenameDraft(e.target.value)} />
                      <button className="hud-btn" onClick={() => void renameSelectedChannel()} disabled={!renameDraft.trim() || channelActionState === 'busy'}>Rename</button>
                    </div>
                  </div>
                </>
              )}

              <div className="field">
                <span className="field__label">Create a channel</span>
                <div style={{ display: 'flex', gap: 6 }}>
                  <input className="hud-input" placeholder="new-channel-name" value={newChannelName} onChange={(e) => setNewChannelName(e.target.value)} />
                  <button className="hud-btn" onClick={() => void createChannel()} disabled={!newChannelName.trim() || channelActionState === 'busy'}>Create</button>
                </div>
                {channelActionState === 'failed' && error && <div className="field__hint" style={{ color: 'var(--red)' }}>{error}</div>}
                <div className="field__hint">
                  No delete is offered here - Discord channel deletion has no undo, same reason
                  file deletes in this app go to the Recycle Bin instead.
                </div>
              </div>

              <div className="field">
                <span className="field__label">Roles</span>
                {members.length === 0 || roles.length === 0 ? (
                  <div className="empty-note">Need at least one member and one role loaded for this server.</div>
                ) : (
                  <>
                    <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                      <select className="hud-input" style={{ flex: '1 1 160px' }} value={userId} onChange={(e) => setUserId(e.target.value)}>
                        <option value="">Member...</option>
                        {members.map((m) => <option key={m.userId} value={m.userId}>{m.nick || m.username}</option>)}
                      </select>
                      <select className="hud-input" style={{ flex: '1 1 140px' }} value={roleId} onChange={(e) => setRoleId(e.target.value)}>
                        <option value="">Role...</option>
                        {roles.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
                      </select>
                    </div>
                    <div style={{ display: 'flex', gap: 6, marginTop: 8 }}>
                      <button className="hud-btn hud-btn--active" onClick={() => void doAssignRole(true)} disabled={!userId || !roleId || roleActionState === 'busy'}>Grant role</button>
                      <button className="hud-btn" onClick={() => void doAssignRole(false)} disabled={!userId || !roleId || roleActionState === 'busy'}>Remove role</button>
                    </div>
                    {roleActionMsg && (
                      <div className="field__hint" style={{ color: roleActionState === 'failed' ? 'var(--red)' : 'var(--green)' }}>{roleActionMsg}</div>
                    )}
                    <div className="field__hint">
                      No kick or ban is offered here - only granting/removing a role, which is
                      always reversible.
                    </div>
                  </>
                )}
              </div>
            </>
          )}
        </>
      )}
    </>
  );
}
