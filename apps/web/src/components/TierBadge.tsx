import { type FC } from 'react';

interface TierBadgeProps {
  tier: string;
}

const tierMap: Record<string, string> = {
  bonded: 'tier-bonded',
  rising: 'tier-rising',
  degen: 'tier-degen',
  blocked: 'tier-blocked',
};

export const TierBadge: FC<TierBadgeProps> = ({ tier }) => {
  const className = tierMap[tier.toLowerCase()] ?? 'tier-blocked';
  const label = tier.charAt(0).toUpperCase() + tier.slice(1).toLowerCase();

  return (
    <span className={`tier-badge ${className}`}>
      <span className="tier-dot" />
      {label}
    </span>
  );
};
