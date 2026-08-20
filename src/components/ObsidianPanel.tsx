import { useEffect, useState } from 'react';
import { Overlay } from './Overlay';
import { ultron } from '../services/bridge';
import type { VaultFolder, NoteRef } from '../types';

/**
 * The real Obsidian connector - no credentials at all. A vault is just a
 * folder of markdown files, so "connected" means one of the folders already
 * added in the Files tab actually contains .md notes.
 */
export function ObsidianPanel({ onClose }: { onClose: () => void }) {
  const [loading, setLoading] = useState(true);
  const [folders, setFolders] = useState<VaultFolder[]>([]);
  const [notes, setNotes] = useState<NoteRef[]>([]);

  const refresh = async () => {
    setLoading(true);
    try {
      const [f, n] = await Promise.all([ultron.obsidian.folders(), ultron.obsidian.recentNotes(12)]);
      setFolders(f);
      setNotes(n);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { void refresh(); }, []);

  const connected = folders.length > 0;
  const timeAgo = (ms: number): string => {
    const mins = Math.floor((Date.now() - ms) / 60000);
    if (mins < 60) return `${mins}m`;
    const hrs = Math.floor(mins / 60);
    if (hrs < 24) return `${hrs}h`;
    return `${Math.floor(hrs / 24)}d`;
  };

  return (
    <Overlay title="Obsidian Vault" meta={loading ? 'CHECKING' : connected ? 'CONNECTED' : 'NOT CONNECTED'} onClose={onClose}>
      {loading && <div className="empty-note">Scanning indexed folders...</div>}

      {!loading && !connected && (
        <>
          <div className="alert-strip alert-strip--info" style={{ marginBottom: 14 }}>
            <span className="dot" />
            No markdown notes found in any indexed folder yet.
          </div>
          <div className="step">
            <span className="step__n">1</span>
            <div className="step__text">
              Add your vault folder from the Files tab - the same OS folder picker the file
              index already uses. Ultron only ever reads folders you add by hand.
            </div>
          </div>
          <div className="step">
            <span className="step__n">2</span>
            <div className="step__text">
              As soon as that folder contains .md files, this connector shows CONNECTED
              automatically - nothing else to configure.
            </div>
          </div>
        </>
      )}

      {!loading && connected && (
        <>
          <div style={{ display: 'flex', alignItems: 'center', marginBottom: 16 }}>
            <div className="step__text">
              {folders.reduce((sum, f) => sum + f.noteCount, 0)} notes across {folders.length} folder{folders.length === 1 ? '' : 's'}.
            </div>
            <button className="hud-btn" style={{ marginLeft: 'auto' }} onClick={() => void refresh()}>Refresh</button>
          </div>

          <div className="field">
            <span className="field__label">Vault folders</span>
            {folders.map((f) => (
              <div key={f.path} className="folder-row">
                <span className="dot" style={{ color: 'var(--cyan)' }} />
                <span className="folder-row__path" title={f.path}>{f.path}</span>
                <span className="mono" style={{ fontSize: 9.5, color: 'var(--dim)' }}>{f.noteCount} notes</span>
              </div>
            ))}
          </div>

          <div className="field">
            <span className="field__label">Recently modified notes</span>
            {notes.length === 0 ? (
              <div className="empty-note">Nothing recent.</div>
            ) : (
              notes.map((n) => (
                <div key={n.path} className="folder-row" style={{ cursor: 'pointer' }} onClick={() => void ultron.files.reveal(n.path)}>
                  <span className="folder-row__path" title={n.path}>{n.name}</span>
                  <span className="mono" style={{ fontSize: 9.5, color: 'var(--dimmer)' }}>{timeAgo(n.modified)}</span>
                </div>
              ))
            )}
          </div>

          <div className="field__hint" style={{ marginTop: 10 }}>
            These are the same files the Files tab and the file-editing tools already work
            with - Obsidian notes are just markdown, nothing special-cased.
          </div>
        </>
      )}
    </Overlay>
  );
}
