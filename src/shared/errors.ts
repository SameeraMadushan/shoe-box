// Closed set of error codes (ADR section 4). UNSUPPORTED_DATA is an addition for
// extraction failures, which the tool-error set does not cover.
export const ERROR_CODES = [
  'DEVICE_NOT_FOUND',
  'NOT_TRUSTED',
  'DEVICE_LOCKED',
  'WRONG_PASSWORD',
  'DISK_FULL',
  'DRIVERS_MISSING',
  'INTERRUPTED',
  'UNSUPPORTED_DATA',
  'UNKNOWN',
] as const;

export type ErrorCode = (typeof ERROR_CODES)[number];

export class AppError extends Error {
  constructor(
    public readonly code: ErrorCode,
    detail?: string,
  ) {
    super(detail ?? code);
    this.name = 'AppError';
  }
}

export function toErrorCode(e: unknown): ErrorCode {
  if (e instanceof AppError) return e.code;
  // Errors crossing the worker boundary arrive as plain objects.
  const code = (e as { code?: unknown } | null)?.code;
  return (ERROR_CODES as readonly unknown[]).includes(code) ? (code as ErrorCode) : 'UNKNOWN';
}

/** One plain sentence and one next action per code. */
export const ERROR_COPY: Record<ErrorCode, { sentence: string; action: string }> = {
  DEVICE_NOT_FOUND: {
    sentence: 'Your iPhone was not found on Wi-Fi.',
    action: 'Check that it is on the same network, or connect the cable and retry.',
  },
  NOT_TRUSTED: {
    sentence: 'Your iPhone does not trust this computer yet.',
    action: 'Unlock your iPhone, tap Trust, then retry.',
  },
  DEVICE_LOCKED: {
    sentence: 'Your iPhone is locked.',
    action: 'Unlock your iPhone with its passcode, then retry.',
  },
  WRONG_PASSWORD: {
    sentence: 'The backup password is not correct.',
    action: 'Enter the backup password again.',
  },
  DISK_FULL: {
    sentence: 'This computer ran out of disk space.',
    action: 'Free up space or change the archive location, then retry.',
  },
  DRIVERS_MISSING: {
    sentence: 'The Apple device drivers are not installed or not running.',
    action: 'Install the Apple Devices app, then retry.',
  },
  INTERRUPTED: {
    sentence: 'The backup was interrupted.',
    action: 'Keep your iPhone connected and retry.',
  },
  UNSUPPORTED_DATA: {
    sentence: 'The chat data in this backup could not be read. This version of the chat app is not supported yet.',
    action: 'Your existing archive is unchanged. Check the project page for an update.',
  },
  UNKNOWN: {
    sentence: 'The backup failed for an unexpected reason.',
    action: 'Retry. If it keeps failing, see the log folder for details.',
  },
};
