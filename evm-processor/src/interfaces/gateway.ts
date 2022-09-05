import {EvmTopicSet} from "./dataHandlers"
import {EvmBlock} from "./evm"

export interface StatusResponse {
    parquetBlockNumber: number
    dbMaxBlockNumber: number
    dbMinBlockNumber: number
}


export interface BatchRequest {
    fromBlock?: number
    toBlock?: number
    addresses?: AddressRequest[]
    fieldSelection?: FieldSelection
}


export interface AddressRequest {
    address: string
    topics: EvmTopicSet
}

export interface FieldSelection {
    block?: BlockFieldSelection,
    transaction?: LogFieldSelection,
    log?: TransactionFieldSelection,
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
    timestamp: bigint
}


export interface Transaction {
    blockHash: string,
    blockNumber: bigint
    source: string,
    gas: bigint,
    gasPrice: bigint,
    hash: string,
    input: string,
    nonce: bigint,
    dest?: string,
    transactionIndex: bigint,
    value: string,
    kind: bigint,
    chainId: bigint,
    v: bigint,
    r: string,
    s: string,
}


export interface Log {
    blockHash: string,
    blockNumber: bigint
    address: string,
    data: string,
    logIndex: bigint,
    removed: boolean,
    topics: string[],
    transactionHash: string,
    transactionIndex: bigint,
}


export interface BatchItem {
    block: Block
    transaction: Transaction
    log: Log
}

export interface BatchBlock {
    header: Block
    logs: Log[]
    transactions: Transaction[]
}

export const FULL_BLOCK_SELECTION: Required<BlockFieldSelection> = {
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
}

export const FULL_LOG_SELECTION: Required<LogFieldSelection> = {
    blockHash: true,
    blockNumber: true,
    address: true,
    data: true,
    logIndex: true,
    removed: true,
    topics: true,
    transactionHash: true,
    transactionIndex: true,
}

export const FULL_TRANSACTION_SELECTION: Required<TransactionFieldSelection> = {
    blockHash: true,
    blockNumber: true,
    source: true,
    gas: true,
    gasPrice: true,
    hash: true,
    input: true,
    nonce: true,
    dest: true,
    transactionIndex: true,
    value: true,
    kind: true,
    chainId: true,
    v: true,
    r: true,
    s: true,
}