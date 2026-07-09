import { type FC, useEffect, useState } from 'react';
import { sfxEnabled, setSfx, onSfxChange } from '../lib/sfx';

/** Terminal audio on/off — synthesized bleeps, no samples. */
export const SfxToggle: FC = () => {
  const [on, setOn] = useState(sfxEnabled);

  useEffect(() => onSfxChange(setOn), []);

  return (
    <button
      className={`sfx-toggle ${on ? 'sfx-toggle-on' : ''}`}
      onClick={() => setSfx(!on)}
      title={on ? 'Terminal audio: ON (synthesized)' : 'Terminal audio: OFF'}
    >
      SND {on ? '●' : '◦'}
    </button>
  );
};
