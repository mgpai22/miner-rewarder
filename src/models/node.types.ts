interface PowSolutions {
  pk: string;
  w: string;
  n: string;
  d: number;
}

export interface BlockHeader {
  extensionId: string;
  difficulty: string;
  votes: string;
  timestamp: number;
  size: number;
  stateRoot: string;
  height: number;
  nBits: number;
  version: number;
  id: string;
  adProofsRoot: string;
  transactionsRoot: string;
  extensionHash: string;
  powSolutions: PowSolutions;
  adProofsId: string;
  transactionsId: string;
  parentId: string;
}
