import { type FC } from 'react';

interface StatValueProps {
  label: string;
  value: string;
  color?: 'green' | 'red' | 'yellow';
}

export const StatValue: FC<StatValueProps> = ({ label, value, color }) => {
  return (
    <div className="stat-item">
      <span className="stat-label">{label}</span>
      <span className={`stat-val ${color ?? ''}`}>{value}</span>
    </div>
  );
};
