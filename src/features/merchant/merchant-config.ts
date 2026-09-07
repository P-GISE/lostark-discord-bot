export const PREFERRED_MERCHANT_SERVERS = [
  "아브렐슈드",
  "니나브",
  "아만",
] as const;

const preferredServerSet = new Set<string>(PREFERRED_MERCHANT_SERVERS);

export function isPreferredMerchantServer(server: string): boolean {
  return preferredServerSet.has(server.trim());
}

export function comparePreferredMerchantServers(
  left: string,
  right: string,
): number {
  const leftIndex = PREFERRED_MERCHANT_SERVERS.indexOf(
    left.trim() as (typeof PREFERRED_MERCHANT_SERVERS)[number],
  );
  const rightIndex = PREFERRED_MERCHANT_SERVERS.indexOf(
    right.trim() as (typeof PREFERRED_MERCHANT_SERVERS)[number],
  );

  if (leftIndex >= 0 && rightIndex >= 0) {
    return leftIndex - rightIndex;
  }

  if (leftIndex >= 0) {
    return -1;
  }

  if (rightIndex >= 0) {
    return 1;
  }

  return left.localeCompare(right, "ko-KR");
}
