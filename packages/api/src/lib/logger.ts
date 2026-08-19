import pino from 'pino';

export const logger = pino({
  level: process.env.LOG_LEVEL || 'info',
  transport: process.env.NODE_ENV !== 'production' ? {
    target: 'pino-pretty',
    options: {
      colorize: true,
      translateTime: 'SYS:standard',
      ignore: 'pid,hostname',
    },
  } : undefined,
  // In production, output raw JSON for log aggregation
  ...(process.env.NODE_ENV === 'production' ? {
    formatters: {
      level: (label: string) => ({ level: label }),
    },
  } : {}),
});

export function createChildLogger(name: string) {
  return logger.child({ service: name });
}
