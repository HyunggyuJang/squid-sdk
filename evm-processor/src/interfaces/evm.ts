export type QualifiedName = string


export interface EvmBlock {
    id: string
    number: bigint
    hash: string
    parentHash: string
    nonce: bigint
    sha3Uncles: string
    logsBloom: string
    transactionsRoot: string
    stateRoot: string
    receiptsRoot: string
    miner: string
    difficulty: string
    totalDifficulty: string
    extraData: string
    size: bigint
    gasLimit: string
    gasUsed: string
    timestamp: number
}


export interface EvmTransaction {
    id: string
    source: string,
    gas: bigint,
    gasPrice: bigint,
    hash: string,
    input: string,
    nonce: bigint,
    dest?: string,
    index: bigint,
    value: string,
    kind: bigint,
    chainId: bigint,
    v: bigint,
    r: string,
    s: string,
}


export interface EvmLog {
    id: string,
    address: string,
    data: string,
    index: bigint,
    removed: boolean,
    topics: string[],
    transaction: EvmTransaction,
    transactionIndex: bigint,
}
