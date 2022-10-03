import {Logger} from '@subsquid/logger'
import {Chain} from '../chain'
import {Range} from '../util/range'
import {LogData, LogDataRequest, LogRequest, TransactionDataRequest} from './dataSelection'
import {EvmBlock} from './evm'

export interface CommonHandlerContext<S> {
    /**
     * Not yet public description of chain metadata
     * @internal
     */
    _chain: Chain

    /**
     * A built-in logger to be used in mapping handlers. Supports trace, debug, warn, error, fatal
     * levels.
     */
    log: Logger

    store: S
    block: EvmBlock
}

type BlockLogsRequest = {
    [name in string]: {evmLog: LogRequest}
}

interface BlockItemRequest {
    logs?: boolean | BlockLogsRequest
}

export interface BlockHandlerDataRequest {
    includeAllBlocks?: boolean
    items?: boolean | BlockItemRequest
}

export type LogHandlerContext<S, R extends LogDataRequest = {evmLog: {}}> = CommonHandlerContext<S> & LogData<R>

export interface LogHandler<S, R extends LogDataRequest = {evmLog: {}}> {
    (ctx: LogHandlerContext<S, R>): Promise<void>
}

export type TransactionHandlerContext<
    S,
    R extends TransactionDataRequest = {transaction: {}}
> = CommonHandlerContext<S> & LogData<R>

export interface LogHandler<S, R extends LogDataRequest = {evmLog: {}}> {
    (ctx: LogHandlerContext<S, R>): Promise<void>
}

export interface BlockRangeOption {
    range?: Range
}

export interface LogOptions extends BlockRangeOption {
    /**
     * EVM topic filter as defined by https://docs.ethers.io/v5/concepts/events/#events--filters
     */
    filter?: EvmTopicSet
}

export type EvmTopicSet = string[][]
