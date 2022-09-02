import {assertNotNull, def, last, unexpectedCase, wait} from "@subsquid/util-internal"
import {Output} from "@subsquid/util-internal-code-printer"
import assert from "assert"
import type {Batch} from "./batch/generic"
import {BatchRequest} from "./batch/request"
import * as gw from "./interfaces/gateway"
import {EvmBlock, EvmLog, EvmTransaction} from "./interfaces/evm"
import {printGqlArguments} from "./util/gql"
import {addErrorContext, withErrorContext} from "./util/misc"
import {Range, rangeEnd} from "./util/range"


export type Item = {
    kind: 'log'
    address: string
    log: EvmLog
}


export interface BlockData {
    header: EvmBlock
    items: Item[]
}


export interface DataBatch<R> {
    /**
     * This is roughly the range of scanned blocks
     */
    range: {from: number, to: number}
    request: R
    blocks: BlockData[]
    fetchStartTime: bigint
    fetchEndTime: bigint
}


export interface IngestOptions<R> {
    archiveRequest<T>(query: string): Promise<T>
    archivePollIntervalMS?: number
    batches: Batch<R>[]
    batchSize: number
}


export class Ingest<R extends BatchRequest> {
    private archiveHeight = -1
    private readonly limit: number // maximum number of blocks in a single batch
    private readonly batches: Batch<R>[]
    private readonly maxQueueSize = 3
    private queue: Promise<DataBatch<R>>[] = []
    private fetchLoopIsStopped = true

    constructor(private options: IngestOptions<R>) {
        this.batches = options.batches.slice()
        this.limit = this.options.batchSize
        assert(this.limit > 0)
    }

    @def
    async *getBlocks(): AsyncGenerator<DataBatch<R>> {
        while (this.batches.length) {
            if (this.fetchLoopIsStopped) {
                this.fetchLoop().catch()
            }
            yield await assertNotNull(this.queue[0])
            this.queue.shift()
        }
    }

    private async fetchLoop(): Promise<void> {
        assert(this.fetchLoopIsStopped)
        this.fetchLoopIsStopped = false
        while (this.batches.length && this.queue.length < this.maxQueueSize) {
            let batch = this.batches[0]
            let ctx: {
                batchRange: Range,
                batchBlocksFetched?: number
                archiveHeight?: number
                archiveQuery?: string,
            } = {
                batchRange: batch.range
            }

            let promise = this.waitForHeight(batch.range.from)
                .then(async archiveHeight => {
                    ctx.archiveHeight = archiveHeight
                    ctx.archiveQuery = this.buildBatchQuery(batch, archiveHeight)

                    let fetchStartTime = process.hrtime.bigint()

                    let response: {
                        status: gw.StatusRequest
                        batch: gw.BatchItem[]
                    } = await this.options.archiveRequest(ctx.archiveQuery)

                    let fetchEndTime = process.hrtime.bigint()

                    ctx.batchBlocksFetched = response.batch.length

                    assert(response.status.dbMaxBlockNumber >= archiveHeight)
                    this.setArchiveHeight(response)

                    let blocks = convertGateWayItemsToBlocks(response.batch).map(mapGatewayBlock).sort((a, b) => Number(a.header.number - b.header.number))
                    if (blocks.length) {
                        assert(blocks.length <= this.limit)
                        assert(batch.range.from <= blocks[0].header.number)
                        assert(rangeEnd(batch.range) >= last(blocks).header.number)
                        assert(archiveHeight >= last(blocks).header.number)
                    }

                    let from = batch.range.from
                    let to: number
                    if (last(blocks).header.number < rangeEnd(batch.range)) {
                        to = Number(last(blocks).header.number)
                        this.batches[0] = {
                            range: {from: to + 1, to: batch.range.to},
                            request: batch.request
                        }
                    } else if (archiveHeight < rangeEnd(batch.range)) {
                        to = archiveHeight
                        this.batches[0] = {
                            range: {from: to + 1, to: batch.range.to},
                            request: batch.request
                        }
                    } else {
                        to = assertNotNull(batch.range.to)
                        this.batches.shift()
                    }

                    return {
                        blocks,
                        range: {from, to},
                        request: batch.request,
                        fetchStartTime,
                        fetchEndTime
                    }
                }).catch(withErrorContext(ctx))

            this.queue.push(promise)

            let result = await promise.catch((err: unknown) => {
                assert(err instanceof Error)
                return err
            })

            if (result instanceof Error) {
                return
            }
        }
        this.fetchLoopIsStopped = true
    }

    private buildBatchQuery(batch: Batch<R>, archiveHeight: number): string {
        let from = batch.range.from
        let to = Math.min(archiveHeight, from + this.limit)
        assert(from <= to)

        let req = batch.request

        let args: gw.BatchRequest = {
            fromBlock: from,
            toBlock: to,
        }

        args.addresses = req.getAddresses()
        args.fieldSelection = {
            block: gw.FULL_BLOCK_SELECTION,
            log: gw.FULL_LOG_SELECTION,
            transaction: gw.FULL_TRANSACTION_SELECTION
        }

        return JSON.stringify(args)
    }

    private async waitForHeight(minimumHeight: number): Promise<number> {
        while (this.archiveHeight < minimumHeight) {
            await this.fetchArchiveHeight()
            if (this.archiveHeight >= minimumHeight) {
                return this.archiveHeight
            } else {
                await wait(this.options.archivePollIntervalMS || 5000)
            }
        }
        return this.archiveHeight
    }

    async fetchArchiveHeight(): Promise<number> {
        let res: any = await this.options.archiveRequest('')
        this.setArchiveHeight(res)
        return this.archiveHeight
    }

    private setArchiveHeight(res: {status: {dbMaxBlockNumber: number}}): void {
        let height = res.status.dbMaxBlockNumber
        if (height == 0) {
            height = -1
        }
        this.archiveHeight = Math.max(this.archiveHeight, height)
    }

    getLatestKnownArchiveHeight(): number {
        return this.archiveHeight
    }
}


function toGatewayFields(req: any | undefined, shape: Record<string, any> | null): any | undefined {
    if (!req) return undefined
    if (req === true) return shape ? {_all: true} : true
    let fields: any = {}
    for (let key in req) {
        let val = toGatewayFields(req[key], shape?.[key])
        if (val != null) {
            fields[key] = val
        }
    }
    return fields
}


function convertGateWayItemsToBlocks(items: gw.BatchItem[]): gw.BatchBlock[] {
    let blocks = new Map<bigint, gw.BatchBlock>()

    for (let item of items) {
        let block = blocks.get(item.block.number)
        if (!block) {
            block = { header: item.block, logs: [], transactions: []}
            blocks.set(block.header.number, block)
        }

        if (block.transactions.findIndex((t) => t.hash === item.transaction.hash) < 0) {
            block.transactions.push(item.transaction)
        }

        block.logs.push(item.log)
    }

    return [...blocks.values()]
}


function mapGatewayBlock(block: gw.BatchBlock): BlockData {
    try {
        return tryMapGatewayBlock(block)
    } catch(e: any) {
        throw addErrorContext(e, {
            blockHeight: block.header.number,
            blockHash: block.header.hash
        })
    }
}


function tryMapGatewayBlock(block: gw.BatchBlock): BlockData {
    let logs = createObjects<gw.Log, EvmLog>(block.logs, go => {
        let {transactionHash, transactionIndex, blockHash, blockNumber, logIndex: index, ...log} = go
        return {id:  `${blockNumber}-${index}-${blockHash.slice(3, 7)}`, index, ...log}
    })

    let transactions = createObjects<gw.Transaction, EvmTransaction>(block.transactions, go => {
        let {blockHash, blockNumber, transactionIndex: index,...transaction} = go
        return {id:  `${blockNumber}-${index}-${blockHash.slice(3, 7)}`, index, ...transaction}
    })

    let items: Item[] = []

    for (let go of block.logs) {
        let log = assertNotNull(logs.get(go.logIndex)) as EvmLog
        if (go.transactionIndex) {
            log.transaction = assertNotNull(transactions.get(go.transactionIndex)) as EvmTransaction
        }
        items.push({
            kind: 'log',
            address: log.address,
            log
        })
    }

    items.sort((a, b) => Number(a.log.index - b.log.index))


    return {
        header: {id: `${block.header.number}-${block.header.hash.slice(3, 7)}`, ...block.header},
        items: items
    }
}


function createObjects<S, T extends {index: bigint}>(src: S[], f: (s: S) => PartialObj<T>): Map<bigint, PartialObj<T>> {
    let m = new Map<bigint, PartialObj<T>>()
    for (let i = 0; i < src.length; i++) {
        let obj = f(src[i])
        m.set(obj.index, obj)
    }
    return m
}


type PartialObj<T> = Partial<T> & {index: bigint}
