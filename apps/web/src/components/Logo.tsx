import { type FC } from 'react';

/**
 * The SCALE mark — a phosphor cursor block with the S knocked out.
 * Pure SVG, tinted by the active theme via var(--primary), so the
 * brand degausses with the rest of the tube.
 */
export const Logo: FC<{ size?: number }> = ({ size = 20 }) => (
  <svg
    width={size}
    height={size}
    viewBox="0 0 512 512"
    aria-label="SCALE"
    style={{ display: 'block', filter: 'drop-shadow(0 0 6px rgba(var(--primary-rgb), 0.6))' }}
  >
    <defs>
      <pattern id="scale-scan" width="4" height="18" patternUnits="userSpaceOnUse">
        <rect width="4" height="6" fill="rgba(0,0,0,0.14)" />
      </pattern>
    </defs>
    <rect x="72" y="72" width="368" height="368" fill="var(--primary, #ffb300)" />
    <rect x="72" y="72" width="368" height="368" fill="url(#scale-scan)" />
    {/* blocky S knockout */}
    <g fill="var(--bg-0, #060605)">
      <rect x="196" y="160" width="120" height="40" />
      <rect x="196" y="160" width="44" height="116" />
      <rect x="196" y="236" width="120" height="40" />
      <rect x="272" y="236" width="44" height="116" />
      <rect x="196" y="312" width="120" height="40" />
    </g>
  </svg>
);
