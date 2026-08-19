import { type FC, useEffect, useRef, useState } from 'react';

const CHARSET = '!<>-_\\/[]{}—=+*^?#$%&@01';

interface ScrambleProps {
  text: string;
  /** ms before the scramble starts */
  delay?: number;
  /** ms per character settle step */
  speed?: number;
  className?: string;
  /** re-scramble on hover */
  hover?: boolean;
  as?: 'span' | 'div';
}

/**
 * Terminal text scramble — characters cycle through glyph noise
 * and settle left-to-right, like a decrypting phosphor readout.
 */
export const Scramble: FC<ScrambleProps> = ({
  text,
  delay = 0,
  speed = 28,
  className = '',
  hover = false,
  as = 'span',
}) => {
  const [display, setDisplay] = useState(text);
  const frameRef = useRef(0);
  const rafRef = useRef(0);
  const runningRef = useRef(false);

  const run = () => {
    if (runningRef.current) return;
    runningRef.current = true;
    const start = performance.now();
    const settleTime = text.length * speed;

    const tick = (now: number) => {
      const t = now - start;
      const settled = Math.floor(t / speed);
      let out = '';
      for (let i = 0; i < text.length; i++) {
        const ch = text[i];
        if (ch === ' ' || i < settled) {
          out += ch;
        } else {
          out += CHARSET[Math.floor(Math.random() * CHARSET.length)];
        }
      }
      setDisplay(out);
      if (t < settleTime + speed) {
        rafRef.current = requestAnimationFrame(tick);
      } else {
        setDisplay(text);
        runningRef.current = false;
      }
    };
    rafRef.current = requestAnimationFrame(tick);
  };

  useEffect(() => {
    frameRef.current = 0;
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (reduced) {
      setDisplay(text);
      return;
    }
    const timer = setTimeout(run, delay);
    return () => {
      clearTimeout(timer);
      cancelAnimationFrame(rafRef.current);
      runningRef.current = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [text]);

  const Tag = as;
  return (
    <Tag
      className={className}
      onMouseEnter={hover ? run : undefined}
      aria-label={text}
    >
      {display}
    </Tag>
  );
};
