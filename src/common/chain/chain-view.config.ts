/**
 * The minimum a process needs to look at a chain with its *own* eyes: which
 * node to ask, and which token contract a transfer should have come from.
 *
 * It is an interface rather than a concrete config because both the issuers and
 * the relayer verify payments, and they must do it through different endpoints —
 * two verifiers sharing one RPC provider are one verifier wearing two hats.
 */
export interface IChainViewConfig {
  readonly id: string;
  readonly rpcUrl: string;
  tokenAddress(srcChainId: number, token: string): string | null;
}

export const CHAIN_VIEW_CONFIG = Symbol('CHAIN_VIEW_CONFIG');
