export function logInfo(message: string): void {
  console.log(`[INFO] ${message}`);
}

export function logError(message: string, error?: unknown): void {
  console.error(`[ERROR] ${message}`);

  if (error) {
    console.error(error);
  }
}
