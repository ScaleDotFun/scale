import { type FC, useEffect, useState } from 'react';
import { blip } from '../lib/sfx';

/**
 * Terminal man page — press ? anywhere. The keyboard IS the UI.
 */
const SECTIONS: Array<{ title: string; rows: Array<[string, string]> }> = [
  {
    title: 'NAVIGATION',
    rows: [
      ['1 … 9', 'jump to page'],
      ['⌘K / CTRL+K', 'command palette — pages, tokens, themes'],
      ['?', 'this manual'],
      ['ESC', 'close any overlay'],
    ],
  },
  {
    title: 'TRADING — SCALE> PROMPT (ON /TRADE)',
    rows: [
      ['long 0.5 sol on TEST at 5x', 'parse a full order in one line'],
      ['close', 'close current position'],
      ['close all', 'flatten everything'],
          ],
  },
  {
    title: 'TERMINAL',
    rows: [
      ['SND', 'synthesized terminal audio on/off'],
      ['drag on replay sim', 'move your entry across real history'],
    ],
  },
];

export const HelpOverlay: FC = () => {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement;
      if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable) return;
      if (e.key === '?') {
        e.preventDefault();
        setOpen((v) => { if (!v) blip('open'); return !v; });
      }
      if (e.key === 'Escape') setOpen(false);
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, []);

  if (!open) return null;

  return (
    <div className="man-overlay" onClick={() => setOpen(false)}>
      <div className="man" onClick={(e) => e.stopPropagation()}>
        <div className="man-head">
          <span>SCALE(1) — TERMINAL MANUAL</span>
          <span className="cmdk-esc">ESC</span>
        </div>
        <div className="man-body">
          {SECTIONS.map((s) => (
            <div className="man-sec" key={s.title}>
              <div className="man-sec-title">{s.title}</div>
              {s.rows.map(([k, v]) => (
                <div className="man-row" key={k}>
                  <span className="man-key">{k}</span>
                  <span className="man-desc">{v}</span>
                </div>
              ))}
            </div>
          ))}
        </div>
        <div className="man-foot">EVERY SOUND ON THIS SITE IS SYNTHESIZED LIVE · EVERY CHART IS REAL MARKET DATA</div>
      </div>
    </div>
  );
};
