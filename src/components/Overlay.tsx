import { useEffect, type ReactNode } from 'react';
import { motion } from 'framer-motion';
import { HexPanel } from './hud/HexPanel';
import { panelTransition } from './hud/motionVariants';

interface Props {
  title: string;
  meta?: string;
  onClose: () => void;
  children: ReactNode;
  footer?: ReactNode;
  /** Wider card, for panels with a big visual (the Memory tab's mind sphere). */
  wide?: boolean;
}

export function Overlay({ title, meta, onClose, children, footer, wide }: Props) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <div className="overlay" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <motion.div
        initial={panelTransition.initial}
        animate={panelTransition.animate}
        transition={panelTransition.transition}
      >
        <HexPanel
          className={`overlay__card${wide ? ' overlay__card--wide' : ''}`}
          title={title}
          meta={meta}
          scroll={false}
          actions={<button className="hud-btn" style={{ marginLeft: 8 }} onClick={onClose}>Close</button>}
        >
          <div className="overlay__body">{children}</div>
          {footer && (
            <div style={{
              display: 'flex', gap: 8, justifyContent: 'flex-end',
              padding: '10px 20px 14px', borderTop: '1px solid var(--cyan-20)',
            }}>
              {footer}
            </div>
          )}
        </HexPanel>
      </motion.div>
    </div>
  );
}
