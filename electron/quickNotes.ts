import { app } from 'electron';
import fs from 'node:fs';
import path from 'node:path';

/**
 * Quick notes - the operator's spoken-or-typed "note this down" moments.
 * Deliberately separate from the big freeform memory.md file: this is a
 * flat, timestamped list of short jottings, not a place for structured or
 * long-form knowledge.
 */

export interface QuickNote {
  id: string;
  text: string;
  createdAt: number;
}

const FILE_NAME = 'quick-notes.json';
const MAX_NOTES = 500;

function getFilePath(): string {
  return path.join(app.getPath('userData'), FILE_NAME);
}

function readAll(): QuickNote[] {
  try {
    const raw = fs.readFileSync(getFilePath(), 'utf-8');
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    // Missing file, first run, or corrupt JSON - treat as empty.
    return [];
  }
}

function writeAll(notes: QuickNote[]): void {
  // Plain sync write, no atomic temp-file dance: same low-stakes pattern as
  // reminders.ts - this is a small personal notes list, not something that
  // needs crash-safe durability guarantees.
  fs.writeFileSync(getFilePath(), JSON.stringify(notes, null, 2));
}

export function addNote(text: string): QuickNote {
  const cleanText = text.trim();
  const note: QuickNote = {
    id: `n${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`,
    text: cleanText,
    createdAt: Date.now(),
  };

  const notes = readAll();
  notes.push(note);

  // Cap at the most recent MAX_NOTES so this file can't grow unbounded.
  const trimmed = notes.length > MAX_NOTES ? notes.slice(notes.length - MAX_NOTES) : notes;

  writeAll(trimmed);
  return note;
}

export function listNotes(): QuickNote[] {
  try {
    return readAll();
  } catch {
    return [];
  }
}

export function deleteNote(id: string): void {
  const notes = readAll().filter((n) => n.id !== id);
  // Persist regardless of whether the id existed - a no-op delete is not an
  // error.
  writeAll(notes);
}
