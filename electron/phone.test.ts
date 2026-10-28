import { describe, expect, it, vi } from 'vitest';

vi.mock('./store', () => ({ getSettings: () => ({}), saveSettings: () => {}, readDoc: (_n: string, f: unknown) => f, writeDoc: () => {} }));
vi.mock('./secrets', () => ({ getSecret: () => '', hasSecret: () => false }));
vi.mock('./discord', () => ({ api: async () => ({}), hasToken: () => false, splitMessage: (t: string) => [t] }));

const { classify } = await import('./discordGateway');
const { fromLabel } = await import('./departments/health/photo');

const dm = (author: string, content = 'slept 11 to 7', extra: Record<string, unknown> = {}) => ({ author: { id: author }, content, ...extra });

describe('who the bot listens to on his phone', () => {
  it('his linked account, in a DM', () => {
    expect(classify(dm('111111111111111111'), '111111111111111111', null)).toBe('owner');
  });

  it('anyone else is ignored - no reply, nothing logged', () => {
    expect(classify(dm('222222222222222222'), '111111111111111111', null)).toBe('ignore');
  });

  it('a server message, or another bot, is never his phone', () => {
    expect(classify(dm('111111111111111111', 'hi', { guild_id: '9' }), '111111111111111111', null)).toBe('ignore');
    expect(classify({ author: { id: '111111111111111111', bot: true }, content: 'x' }, '111111111111111111', null)).toBe('ignore');
  });

  it('links an account only with the code Ultron is showing right now', () => {
    expect(classify(dm('333333333333333333', 'link 4821'), '', '4821')).toBe('link');
    expect(classify(dm('333333333333333333', 'link 4821'), '', null)).toBe('ignore');
    expect(classify(dm('333333333333333333', 'link 1234'), '', '4821')).toBe('ignore');
  });
});

describe('a nutrition label photo', () => {
  it('keeps the numbers a label can really have, and drops the impossible ones', () => {
    const item = fromLabel({ kind: 'label', name: 'Granola bar', serving: '1 bar (35 g)', protein_g: 4, iron_mg: 1.6, calcium_mg: 9000, vitd_ug: -2 });
    expect(item).toMatchObject({ name: 'Granola bar', exact: true, nutrients: { protein_g: 4, iron_mg: 1.6 } });
    expect(item?.nutrients.calcium_mg).toBeUndefined();
    expect(item?.nutrients.vitd_ug).toBeUndefined();
  });

  it('a label with no readable numbers logs nothing', () => {
    expect(fromLabel({ kind: 'label', name: 'Chips' })).toBeNull();
  });
});
