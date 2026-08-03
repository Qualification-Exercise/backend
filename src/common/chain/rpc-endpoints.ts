export class RpcEndpointError extends Error {}

/**
 * The endpoints one process may ask about chains.
 *
 * `single` is shorthand for "the reward chain", kept because most deployments
 * only ever needed one endpoint. It is merged under the reward chain's id
 * rather than used as a fallback for everything: an endpoint that answers about
 * the wrong chain is worse than no endpoint at all, because it answers.
 */
export function buildEndpoints(
  rewardChainId: number,
  single: string,
  map: string,
): Record<string, string> {
  const parsed = JSON.parse(map) as Record<string, string>;
  const endpoints: Record<string, string> = { ...parsed };
  if (single && !endpoints[String(rewardChainId)]) {
    endpoints[String(rewardChainId)] = single;
  }
  return endpoints;
}

export function sameEndpoint(a: string, b: string): boolean {
  if (!a || !b) return false;
  return a.trim().replace(/\/+$/, '') === b.trim().replace(/\/+$/, '');
}

export function assertDistinct(
  mine: Record<string, string>,
  theirs: string[],
  who: string,
  sharingAllowedChains: number[] = [],
): void {
  const allowed = new Set(sharingAllowedChains.map(String));
  const collision = Object.entries(mine)
    .filter(([chainId]) => !allowed.has(chainId))
    .map(([, url]) => url)
    .find((url) => theirs.some((other) => sameEndpoint(other, url)));
  if (collision) {
    throw new RpcEndpointError(
      `${who} must not share an RPC endpoint with the rest of the pipeline`,
    );
  }
}
