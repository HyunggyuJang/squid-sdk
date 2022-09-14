import {EvmTopicSet} from "./dataHandlers"


export interface StatusResponse {
    parquetBlockNumber: number
    dbMaxBlockNumber: number
    dbMinBlockNumber: number
}


export interface BatchRequest {
    fromBlock: number
    toBlock?: number
    logs?: LogRequest[]
}


export interface LogRequest {
    address: string
    topics: EvmTopicSet
    fieldSelection: FieldSelection
}

export interface FieldSelection {
    block?: BlockFieldSelection,
    transaction?: TransactionFieldSelection,
    log?: LogFieldSelection,
}

export type BlockFieldSelection = {[P in keyof Block]?: boolean}


export type LogFieldSelection = {[P in keyof Log]?: boolean}


export type TransactionFieldSelection = {[P in keyof Transaction]?: boolean}


export interface Block {
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


export interface Transaction {
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


export interface Log {
    address: string,
    data: string,
    index: bigint,
    removed: boolean,
    topics: string[],
    transactionIndex: bigint,
}


export interface BatchBlock {
    block: Block
    logs: Log[]
    transactions: Transaction[]
}


export const FULL_SELECTION = {
    block: {
        number: true,
        hash: true,
        parentHash: true,
        nonce: true,
        sha3Uncles: true,
        logsBloom: true,
        transactionsRoot: true,
        stateRoot: true,
        receiptsRoot: true,
        miner: true,
        difficulty: true,
        totalDifficulty: true,
        extraData: true,
        size: true,
        gasLimit: true,
        gasUsed: true,
        timestamp: true,
    },
    log: {
        address: true,
        data: true,
        index: true,
        removed: true,
        topics: true,
        transactionIndex: true,
    },
    transaction: {
        source: true,
        gas: true,
        gasPrice: true,
        hash: true,
        input: true,
        nonce: true,
        dest: true,
        index: true,
        value: true,
        kind: true,
        chainId: true,
        v: true,
        r: true,
        s: true,
    }
}

export const DEFAULT_SELECTION: Record<string, any> = {
    block: {
        number: true,
        hash: true,
        parentHash: true,
        nonce: true,
        sha3Uncles: true,
        logsBloom: true,
        transactionsRoot: true,
        stateRoot: true,
        receiptsRoot: true,
        miner: true,
        difficulty: true,
        totalDifficulty: true,
        extraData: true,
        size: true,
        gasLimit: true,
        gasUsed: true,
        timestamp: true,
    },
    log: {
        address: true,
        index: true,
        transactionIndex: true,
    },
    transaction: {
        dest: true,
        index: true,
    }
}
