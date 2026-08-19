import { type FC, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import * as api from '../lib/api';
import { blip } from '../lib/sfx';

interface Command {
  id: string;
  group: 'GOTO' | 'TOKENS';
  icon: string;
  label: string;
  hint?: string;
  action: () => void;
}

/**
 * ⌘K command palette — jump anywhere, trade anything.
 * Disabled on /trade where the SCALE> prompt owns ⌘K.
 */
export const CommandPalette: FC = () => {
  const navigate = useNavigate();
  const location = useLocation();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [selected, setSelected] = useState(0);
  const [tokens, setTokens] = useState<api.TokenInfo[]>([]);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  const onTradePage = location.pathname === '/trade';

  // Global shortcut — ⌘K / Ctrl+K everywhere except /trade
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'k' && !onTradePage) {
        e.preventDefault();
        setOpen((v) => { if (!v) blip('open'); return !v; });
      }
      if (e.key === 'Escape') setOpen(false);
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [onTradePage]);

  // Load listed tokens once when first opened
  useEffect(() => {
    if (!open) return;
    setQuery('');
    setSelected(0);
    setTimeout(() => inputRef.current?.focus(), 10);
    if (tokens.length === 0) {
      api.getListedTokens(30).then(setTokens).catch(() => {});
    }
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps

  const close = useCallback(() => setOpen(false), []);

  const go = useCallback(
    (path: string) => {
      navigate(path);
      setOpen(false);
    },
    [navigate],
  );

  const commands = useMemo<Command[]>(() => {
    const nav: Command[] = [
      { id: 'trade', group: 'GOTO', icon: '▸', label: 'Trade Terminal', hint: '1', action: () => go('/trade') },
      { id: 'explore', group: 'GOTO', icon: '▸', label: 'Token Explorer', hint: '2', action: () => go('/explore') },
      { id: 'screener', group: 'GOTO', icon: '▸', label: 'Market Screener', hint: '3', action: () => go('/screener') },
      { id: 'list', group: 'GOTO', icon: '▸', label: 'List a Token', hint: '4', action: () => go('/list') },
      { id: 'locks', group: 'GOTO', icon: '▸', label: 'Profit Locks', hint: '5', action: () => go('/locks') },
      { id: 'stats', group: 'GOTO', icon: '▸', label: 'Protocol Stats', hint: '6', action: () => go('/stats') },
      { id: 'docs', group: 'GOTO', icon: '▸', label: 'Docs / Manual', hint: '7', action: () => go('/docs') },
      { id: 'account', group: 'GOTO', icon: '▸', label: 'Account / Holdings', hint: '8', action: () => go('/account') },
      { id: 'burns', group: 'GOTO', icon: '▸', label: 'Burn Log', action: () => go('/burns') },
      { id: 'creator', group: 'GOTO', icon: '▸', label: 'Creator Dashboard', action: () => go('/creator') },
    ];


    const tok: Command[] = tokens.map((t) => ({
      id: `tok-${t.address}`,
      group: 'TOKENS' as const,
      icon: '$',
      label: `${t.symbol ?? '???'} — ${t.name ?? 'Unknown'}`,
      hint: `${t.maxLeverage ?? '?'}x`,
      action: () => go(`/trade?token=${t.address}`),
    }));

    return [...nav, ...tok];
  }, [tokens, go]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return commands;
    return commands.filter((c) => c.label.toLowerCase().includes(q));
  }, [commands, query]);

  useEffect(() => {
    setSelected(0);
  }, [query]);

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      blip('click');
      setSelected((s) => Math.min(s + 1, filtered.length - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      blip('click');
      setSelected((s) => Math.max(s - 1, 0));
    } else if (e.key === 'Enter' && filtered[selected]) {
      blip('confirm');
      filtered[selected].action();
    }
  };

  // Keep selection in view
  useEffect(() => {
    const list = listRef.current;
    if (!list) return;
    const el = list.querySelector<HTMLElement>(`[data-idx="${selected}"]`);
    el?.scrollIntoView({ block: 'nearest' });
  }, [selected]);

  if (!open) return null;

  let lastGroup = '';

  return (
    <div className="cmdk-overlay" onMouseDown={close}>
      <div className="cmdk" onMouseDown={(e) => e.stopPropagation()}>
        <div className="cmdk-input-row">
          <span className="cmdk-prompt">SCALE&gt;</span>
          <input
            ref={inputRef}
            className="cmdk-input"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={onKeyDown}
            placeholder="jump to page or token..."
            spellCheck={false}
            autoComplete="off"
          />
          <span className="cmdk-esc">ESC</span>
        </div>

        <div className="cmdk-list" ref={listRef}>
          {filtered.length === 0 && <div className="cmdk-empty">NO MATCHES FOUND</div>}
          {filtered.map((c, i) => {
            const showLabel = c.group !== lastGroup;
            lastGroup = c.group;
            return (
              <div key={c.id}>
                {showLabel && <div className="cmdk-group-label">{c.group}</div>}
                <div
                  data-idx={i}
                  className={`cmdk-item ${i === selected ? 'cmdk-item-active' : ''}`}
                  onMouseEnter={() => setSelected(i)}
                  onClick={c.action}
                >
                  <span className="cmdk-item-icon">{c.icon}</span>
                  <span className="cmdk-item-label">{c.label}</span>
                  {c.hint && <span className="cmdk-item-hint">{c.hint}</span>}
                </div>
              </div>
            );
          })}
        </div>

        <div className="cmdk-footer">
          <span><b>↑↓</b> navigate</span>
          <span><b>↵</b> select</span>
          <span><b>esc</b> close</span>
        </div>
      </div>
    </div>
  );
};
