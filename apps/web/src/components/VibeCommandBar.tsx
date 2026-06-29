import { type FC, useState, useEffect, useRef, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';

interface VibeCommandBarProps {
  onParsedCommand: (parsed: ParsedCommand) => void;
  onExecute: () => void;
  selectedTokenSymbol?: string;
}

export interface ParsedCommand {
  tokenQuery?: string;
  capitalSol?: number;
  leverage?: number;
  priority?: 'normal' | 'fast' | 'turbo';
  action?: 'long' | 'close' | 'closeall';
}

/**
 * NLP Command Bar — floating at bottom-center of viewport.
 * Parses natural language into structured trade parameters.
 * Cmd+K / Ctrl+K to focus globally.
 */
export const VibeCommandBar: FC<VibeCommandBarProps> = ({
  onParsedCommand,
  onExecute,
  selectedTokenSymbol,
}) => {
  const [value, setValue] = useState('');
  const [focused, setFocused] = useState(false);
  const [lastParsed, setLastParsed] = useState<ParsedCommand>({});
  const inputRef = useRef<HTMLInputElement>(null);

  // Global Cmd+K / Ctrl+K shortcut
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        e.preventDefault();
        inputRef.current?.focus();
      }
      // Escape to blur
      if (e.key === 'Escape' && focused) {
        inputRef.current?.blur();
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [focused]);

  // Parse input into structured command
  const parseCommand = useCallback((input: string): ParsedCommand => {
    const lower = input.toLowerCase().trim();
    const result: ParsedCommand = {};

    // Detect action
    if (lower.startsWith('close all') || lower.startsWith('closeall')) {
      return { action: 'closeall' };
    }
    if (lower.startsWith('close')) {
      return { action: 'close' };
    }
    result.action = 'long';

    // Extract SOL amount: "0.5 sol", "0.5sol", "0.5 SOL"
    const solMatch = lower.match(/(\d+\.?\d*)\s*sol/);
    if (solMatch) {
      result.capitalSol = parseFloat(solMatch[1]);
    }

    // Extract leverage: "7x", "at 7x", "5x lev"
    const levMatch = lower.match(/(\d+)\s*x/);
    if (levMatch) {
      result.leverage = parseInt(levMatch[1], 10);
    }

    // Extract priority
    if (lower.includes('turbo')) result.priority = 'turbo';
    else if (lower.includes('fast')) result.priority = 'fast';
    else if (lower.includes('normal') || lower.includes('slow')) result.priority = 'normal';

    // Extract token — try to find a capitalized word that isn't a keyword
    const keywords = new Set(['long', 'short', 'buy', 'sell', 'sol', 'at', 'on', 'with', 'fast', 'turbo', 'normal', 'close', 'ape']);
    const words = input.split(/\s+/);
    for (const word of words) {
      const clean = word.replace(/[^a-zA-Z]/g, '');
      if (clean.length >= 2 && !keywords.has(clean.toLowerCase())) {
        // Likely a token symbol
        result.tokenQuery = clean.toUpperCase();
        break;
      }
    }

    return result;
  }, []);

  // Parse on every keystroke and push to parent
  useEffect(() => {
    const parsed = parseCommand(value);
    setLastParsed(parsed);
    onParsedCommand(parsed);
  }, [value, parseCommand, onParsedCommand]);

  // Execute on Enter
  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && value.trim()) {
      onExecute();
      setValue('');
    }
  };

  // Build preview chips
  const chips: { label: string; value: string; color: string }[] = [];
  if (lastParsed.action === 'long' || lastParsed.action === undefined) {
    if (lastParsed.tokenQuery) {
      chips.push({ label: 'TOKEN', value: lastParsed.tokenQuery, color: 'var(--primary)' });
    } else if (selectedTokenSymbol) {
      chips.push({ label: 'TOKEN', value: selectedTokenSymbol, color: 'var(--text-2)' });
    }
    if (lastParsed.capitalSol) {
      chips.push({ label: 'SIZE', value: `${lastParsed.capitalSol} SOL`, color: 'var(--cyan)' });
    }
    if (lastParsed.leverage) {
      chips.push({ label: 'LEV', value: `${lastParsed.leverage}x`, color: 'var(--yellow)' });
    }
    if (lastParsed.priority) {
      chips.push({ label: 'FEE', value: lastParsed.priority.toUpperCase(), color: 'var(--text-1)' });
    }
  } else if (lastParsed.action === 'close') {
    chips.push({ label: 'ACTION', value: 'CLOSE', color: 'var(--red)' });
  } else if (lastParsed.action === 'closeall') {
    chips.push({ label: 'ACTION', value: 'CLOSE ALL', color: 'var(--red)' });
  }

  return (
    <motion.div
      className="vibe-bar-wrapper"
      initial={{ y: 20, opacity: 0 }}
      animate={{ y: 0, opacity: 1 }}
      transition={{ delay: 0.3, duration: 0.5, ease: 'easeOut' }}
    >
      <div className={`vibe-bar ${focused ? 'vibe-bar-focused' : ''}`}>
        {/* Prompt prefix */}
        <span className="vibe-bar-prefix">FRONT</span>
        <span className="vibe-bar-caret">&gt;</span>

        {/* Input */}
        <input
          ref={inputRef}
          className="vibe-bar-input"
          type="text"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onFocus={() => setFocused(true)}
          onBlur={() => setFocused(false)}
          onKeyDown={handleKeyDown}
          placeholder={focused ? 'long 0.5 sol on POPCAT at 7x fast' : 'Press Cmd+K to trade...'}
          spellCheck={false}
          autoComplete="off"
        />

        {/* Keyboard hint */}
        {!focused && (
          <kbd className="vibe-bar-kbd">
            {navigator.platform?.includes('Mac') ? '⌘' : 'Ctrl'}K
          </kbd>
        )}
      </div>

      {/* Parsed preview chips */}
      <AnimatePresence>
        {chips.length > 0 && focused && (
          <motion.div
            className="vibe-bar-chips"
            initial={{ opacity: 0, y: 4 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 4 }}
            transition={{ duration: 0.15 }}
          >
            {chips.map((chip) => (
              <span key={chip.label} className="vibe-chip" style={{ borderColor: chip.color }}>
                <span className="vibe-chip-label">{chip.label}</span>
                <span className="vibe-chip-value" style={{ color: chip.color }}>{chip.value}</span>
              </span>
            ))}
            {value.trim() && (
              <span className="vibe-chip-hint">
                Press Enter to execute
              </span>
            )}
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  );
};
