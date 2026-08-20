# Motion proposal: put framer-motion to work

`framer-motion` is a dependency (`^11.11.17`) but almost unused — `.hud-btn`, `.chip`, `.conn-card` rely on plain CSS transitions/`transform: translateY(1px)` on `:active`. No spring physics, no staggered entrances.

## 1. `src/components/hud/MotionButton.tsx`

Wrap `.hud-btn` in a `motion.button` so every button (NewsPanel's Refresh, Overlay's Close, etc.) gets consistent press/hover feel.

```tsx
interface MotionButtonProps extends React.ComponentPropsWithoutRef<'button'> {
  variant?: 'default' | 'danger' | 'active';
}

<motion.button
  className={cx('hud-btn', variant === 'danger' && 'hud-btn--danger', variant === 'active' && 'hud-btn--active')}
  whileHover={{ scale: 1.03 }}
  whileTap={{ scale: 0.94 }}
  transition={{ type: 'spring', stiffness: 500, damping: 30 }}
  {...rest}
/>
```

Props: `variant?: 'default' | 'danger' | 'active'`, plus pass-through `disabled`, `onClick`, `children`, `style`, `title`, `aria-label`. When `disabled`, drop `whileHover`/`whileTap` (spread `{}` conditionally) so disabled buttons don't animate.

## 2. Staggered entrances

**`src/components/AgentGrid.tsx`** (`.conn-card` grid, line ~21-44): wrap `.conn-grid` in `motion.div` with a `staggerChildren: 0.04` container variant, each `.conn-card` becomes `motion.div` with:
```js
const cardVariants = {
  hidden: { opacity: 0, y: 12 },
  visible: { opacity: 1, y: 0, transition: { type: 'spring', stiffness: 340, damping: 26 } },
};
```
Container: `{ hidden: {}, visible: { transition: { staggerChildren: 0.04 } } }`. 40ms between each specialist card.

**`src/components/NewsPanel.tsx`** (`NewsItem` list, line ~290): wrap the `visible.map(...)` output in `AnimatePresence` + give each `motion.div` (replacing the outer `.news-item` div) the same `cardVariants` shape but `y: 16`, stiffness `300`/damping `28`, staggerChildren `0.05` on the parent `.panel-body` list — headlines feel like they're streaming in.

**`src/components/ConnectorGrid.tsx`** (same `.conn-card` pattern as AgentGrid): identical variants/stagger as #1, `0.04` delay — keeps the two grids visually consistent since they share the `.conn-card` class.

## 3. Panel open/close — `Overlay.tsx`

Replace the plain `.overlay` div and `.overlay__card` (`HexPanel`) with `AnimatePresence` + `motion.div`:

```tsx
// backdrop
<motion.div className="overlay" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
  transition={{ duration: 0.18, ease: 'easeOut' }} onMouseDown={...}>
  // card
  <motion.div
    initial={{ opacity: 0, scale: 0.96, y: 8 }}
    animate={{ opacity: 1, scale: 1, y: 0 }}
    exit={{ opacity: 0, scale: 0.97, y: 4 }}
    transition={{ duration: 0.22, ease: [0.16, 1, 0.3, 1] }}
  >
    <HexPanel .../>
  </motion.div>
</motion.div>
```
Backdrop fade: 180ms `easeOut`. Card: 220ms with an "expo-out" custom cubic-bezier `[0.16, 1, 0.3, 1]` for a snappy HUD-panel-deploying feel; exit is faster/subtler (no y-lift on entry needed beyond 8px). Requires whatever renders `<Overlay>` conditionally to be wrapped in `<AnimatePresence>` so `exit` fires.
