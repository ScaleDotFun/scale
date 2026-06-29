import { type FC, useState } from 'react';

interface ExecutionSettingsProps {
  onMevChange?: (mevProtected: boolean) => void;
  onPriorityChange?: (level: 'normal' | 'fast' | 'turbo') => void;
}

/**
 * Execution settings panel: MEV Protection toggle + Priority Fee selector.
 */
export const ExecutionSettings: FC<ExecutionSettingsProps> = ({
  onMevChange,
  onPriorityChange,
}) => {
  const [mevProtected, setMevProtected] = useState(true);
  const [priority, setPriority] = useState<'normal' | 'fast' | 'turbo'>('fast');

  const handleMevToggle = () => {
    const next = !mevProtected;
    setMevProtected(next);
    onMevChange?.(next);
  };

  const handlePriority = (level: 'normal' | 'fast' | 'turbo') => {
    setPriority(level);
    onPriorityChange?.(level);
  };

  return (
    <div className="exec-settings">
      {/* MEV Protection */}
      <div className="exec-settings-row">
        <div className="exec-settings-left">
          <div className="exec-settings-icon-svg">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="14" height="14">
              <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
            </svg>
          </div>
          <div>
            <span className="exec-settings-label">MEV Protection</span>
            <span className="exec-settings-sub">
              {mevProtected ? 'Secure via Jito' : 'Speed priority'}
            </span>
          </div>
        </div>
        <button
          className={`toggle ${mevProtected ? 'toggle-on' : 'toggle-off'}`}
          onClick={handleMevToggle}
          type="button"
          aria-label="Toggle MEV protection"
        >
          <span className="toggle-knob" />
        </button>
      </div>

      {/* Priority Fee */}
      <div className="exec-settings-row">
        <div className="exec-settings-left">
          <div className="exec-settings-icon-svg">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="14" height="14">
              <polyline points="13 17 18 12 13 7" />
              <polyline points="6 17 11 12 6 7" />
            </svg>
          </div>
          <div>
            <span className="exec-settings-label">Priority Fee</span>
            <span className="exec-settings-sub">
              {priority === 'normal' && '0.0001 SOL'}
              {priority === 'fast' && '0.0005 SOL'}
              {priority === 'turbo' && '0.005 SOL'}
            </span>
          </div>
        </div>
        <div className="priority-btns">
          {(['normal', 'fast', 'turbo'] as const).map((level) => (
            <button
              key={level}
              className={`priority-btn ${priority === level ? 'priority-btn-active' : ''}`}
              onClick={() => handlePriority(level)}
              type="button"
            >
              {level.charAt(0).toUpperCase() + level.slice(1)}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
};
