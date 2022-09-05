import {createLogger, Logger} from "@subsquid/logger"
import {last, runProgram} from "@subsquid/util-internal"
import assert from "assert"
import {applyRangeBound, Batch, mergeBatches} from "../batch/generic"
import {PlainBatchRequest} from "../batch/request"
import {Chain} from "../chain"
import {BlockData} from "../ingest"
import {LogOptions} from "../interfaces/dataHandlers"
import type {
    AddLogItem,
    DataSelection,
    LogDataRequest,
    LogItem,
    MayBeDataSelection,
    NoDataSelection,
    TransactionItem
} from "../interfaces/dataSelection"
import type {Database} from "../interfaces/db"
import type {EvmBlock} from "../interfaces/evm"
import {Range} from "../util/range"
import {Config, Options, Runner} from "./runner"


export interface DataSource {
    /**
     * Subsquid substrate archive endpoint URL
     */
    archive: string
    /**
     * Chain node RPC websocket URL
     */
    chain?: string
}


/**
 * A helper to get the resulting type of block item
 *
 * @example
 * const processor = new SubstrateBatchProcessor()
 *  .addEvent('Balances.Transfer')
 *  .addEvent('Balances.Deposit')
 *
 * type BlockItem = BatchProcessorItem<typeof processor>
 */
export type BatchProcessorItem<T> = T extends EvmBatchProcessor<infer I> ? I : never
export type BatchProcessorLogItem<T> = Extract<BatchProcessorItem<T>, {kind: 'event'}>
export type BatchProcessorTransactionItem<T> = Extract<BatchProcessorItem<T>, {kind: 'transaction'}>


export interface BatchContext<Store, Item> {
    /**
     * Not yet public description of chain metadata
     * @internal
     */
    _chain: Chain
    log: Logger
    store: Store
    blocks: BatchBlock<Item>[]
}


export interface BatchBlock<Item> {
    /**
     * Block header
     */
    header: EvmBlock
    /**
     * A unified log of events and calls.
     *
     * All events deposited within a call are placed
     * before the call. All child calls are placed before the parent call.
     * List of block events is a subsequence of unified log.
     */
    items: Item[]
}


/**
 * Provides methods to configure and launch data processing.
 *
 * Unlike {@link SubstrateProcessor}, `SubstrateBatchProcessor` can have
 * only one data handler, which accepts a list of blocks.
 *
 * This gives mapping developers an opportunity to reduce the number of round-trips
 * both to database and chain nodes,
 * thus providing much better performance.
 */
export class EvmBatchProcessor<Item extends {kind: string, address: string} = LogItem<'*'> | TransactionItem<"*">> {
    private batches: Batch<PlainBatchRequest>[] = []
    private options: Options = {}
    private src?: DataSource
    private running = false

    private add(request: PlainBatchRequest, range?: Range): void {
        this.batches.push({
            range: range || {from: 0},
            request
        })
    }


    addLog<A extends string>(
        contractAddress: A,
        options?: LogOptions & NoDataSelection
    ): EvmBatchProcessor<AddLogItem<Item, LogItem<A, true>>>

    addLog<A extends string, R extends LogDataRequest>(
        contractAddress: A,
        options: LogOptions & DataSelection<R>
    ): EvmBatchProcessor<AddLogItem<Item, LogItem<A, R>>>

    addLog(
        contractAddress: string,
        options?: LogOptions & MayBeDataSelection<LogDataRequest>
    ): EvmBatchProcessor<any> {
        this.assertNotRunning()
        let req = new PlainBatchRequest()
        req.addresses.push({
            address: contractAddress.toLowerCase(),
            topics: options?.filter || [],
        })
        req.logsRequest = options?.data || {}
        this.add(req, options?.range)
        return this
    }

    /**
     * Sets the port for a built-in prometheus metrics server.
     *
     * By default, the value of `PROMETHEUS_PORT` environment
     * variable is used. When it is not set,
     * the processor will pick up an ephemeral port.
     */
    setPrometheusPort(port: number | string): this {
        this.assertNotRunning()
        this.options.prometheusPort = port
        return this
    }

    /**
     * Limits the range of blocks to be processed.
     *
     * When the upper bound is specified,
     * the processor will terminate with exit code 0 once it reaches it.
     */
    setBlockRange(range?: Range): this {
        this.assertNotRunning()
        this.options.blockRange = range
        return this
    }

    /**
     * Sets the maximum number of blocks which can be fetched
     * from the data source in a single request.
     *
     * The default is 100.
     */
    setBatchSize(size: number): this {
        assert(size > 0)
        this.assertNotRunning()
        this.options.batchSize = size
        return this
    }

    /**
     * Sets blockchain data source.
     *
     * @example
     * processor.setDataSource({
     *     chain: 'wss://rpc.polkadot.io',
     *     archive: 'https://eth.archive.subsquid.io'
     * })
     */
    setDataSource(src: DataSource): this {
        this.assertNotRunning()
        this.src = src
        return this
    }


    private assertNotRunning(): void {
        if (this.running) {
            throw new Error('Settings modifications are not allowed after start of processing')
        }
    }

    private getArchiveEndpoint(): string {
        let url = this.src?.archive
        if (url == null) {
            throw new Error('use .setDataSource() to specify archive url')
        }
        return url
    }

    private getChainEndpoint(): string {
        let url = this.src?.chain
        if (url == null) {
            throw new Error(`use .setDataSource() to specify chain RPC endpoint`)
        }
        return url
    }

    /**
     * Run data processing.
     *
     * This method assumes full control over the current OS process as
     * it terminates the entire program in case of error or
     * at the end of data processing.
     *
     * @param db - database is responsible for providing storage to data handlers
     * and persisting mapping progress and status.
     *
     * @param handler - The data handler, see {@link BatchContext} for an API available to the handler.
     */
    run<Store>(db: Database<Store>, handler: (ctx: BatchContext<Store, Item>) => Promise<void>): void {
        let logger = createLogger('sqd:processor')
        this.running = true
        runProgram(async () => {
            let batches = mergeBatches(this.batches, (a, b) => a.merge(b))

            let config: Config<Store, PlainBatchRequest> = {
                getDatabase: () => db,
                getArchiveEndpoint: () => this.getArchiveEndpoint(),
                getChainEndpoint: () => this.getChainEndpoint(),
                getLogger: () => logger,
                getOptions: () => this.options,
                createBatches(blockRange: Range): Batch<PlainBatchRequest>[] {
                    return applyRangeBound(batches, blockRange)
                }
            }

            let runner = new Runner(config)

            runner.processBatch = async function(request: PlainBatchRequest, chain: Chain, blocks: BlockData[]) {
                if (blocks.length == 0) return
                let from = Number(blocks[0].header.number)
                let to =  Number(last(blocks).header.number)
                return db.transact(from, to, store => {
                    return handler({
                        _chain: chain,
                        log: logger.child('mapping'),
                        store,
                        blocks: blocks as any,
                    })
                })
            }

            return runner.run()
        }, err => logger.fatal(err))
    }
}
