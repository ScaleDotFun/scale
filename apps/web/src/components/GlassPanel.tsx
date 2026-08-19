import { type FC, type ReactNode } from 'react';
import { motion } from 'framer-motion';
import clsx from 'clsx';

interface GlassPanelProps {
  children: ReactNode;
  className?: string;
  animate?: boolean;
  delay?: number;
  style?: React.CSSProperties;
}

/**
 * Container panel — flat dark style (no glassmorphism).
 */
export const GlassPanel: FC<GlassPanelProps> = ({
  children,
  className,
  animate = true,
  delay = 0,
  style,
}) => {
  const content = (
    <div className={clsx('card', className)} style={style}>
      {children}
    </div>
  );

  if (!animate) return content;

  return (
    <motion.div
      className={clsx('card', className)}
      style={style}
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.4, delay, ease: 'easeOut' }}
    >
      {children}
    </motion.div>
  );
};

/**
 * AmbientBackground — removed (no more gradient orbs).
 * Kept as a no-op for backward compatibility.
 */
export const AmbientBackground: FC = () => null;

/**
 * Animated number display.
 */
export const AnimatedNumber: FC<{
  value: number;
  prefix?: string;
  suffix?: string;
  decimals?: number;
  color?: string;
}> = ({ value, prefix = '', suffix = '', decimals = 4, color }) => {
  return (
    <motion.span
      className="mono"
      style={{ color }}
      key={value.toFixed(decimals)}
      initial={{ opacity: 0.6, y: -2 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.25, ease: 'easeOut' }}
    >
      {prefix}{value.toFixed(decimals)}{suffix}
    </motion.span>
  );
};
