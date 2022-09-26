import {assertNotNull, def, last, wait} from '@subsquid/util-internal'
import assert from 'assert'
import type {Batch} from './batch/generic'
import {BatchRequest} from './batch/request'
import * as gw from './interfaces/gateway'
import {EvmBlock, EvmLog, EvmTransaction} from './interfaces/evm'
import {addErrorContext, withErrorContext} from './util/misc'
import {Range, rangeEnd} from './util/range'
import {FULL_REQUEST} from './interfaces/dataSelection'
import {Archive} from './archive'
import {statusToHeight} from './util/gateway'

export type Item =
    | {
          kind: 'log'
          address: string
          log: EvmLog
      }
    | {
          kind: 'transaction'
          address: string | undefined
          transaction: EvmTransaction
      }

export interface BlockData {
    header: EvmBlock
    items: Item[]
}

export interface DataBatch<R> {
    /**
     * This is roughly the range of scanned blocks
     */
    range: {from: number; to: number}
    request: R
    blocks: BlockData[]
    fetchStartTime: bigint
    fetchEndTime: bigint
}

export interface IngestOptions<R> {
    archive: Archive
    archivePollIntervalMS?: number
    batches: Batch<R>[]
}

export class Ingest<R extends BatchRequest> {
    private archiveHeight = -1
    private readonly batches: Batch<R>[]
    private readonly maxQueueSize = 3
    private queue: Promise<DataBatch<R>>[] = []
    private fetchLoopIsStopped = true

    constructor(private options: IngestOptions<R>) {
        this.batches = options.batches.slice()
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
                batchRange: Range
                batchBlocksFetched?: number
                archiveHeight?: number
                archiveQuery?: string
            } = {
                batchRange: batch.range,
            }

            let promise = this.waitForHeight(batch.range.from)
                .then(async (archiveHeight) => {
                    ctx.archiveHeight = archiveHeight
                    ctx.archiveQuery = this.buildBatchQuery(batch, archiveHeight)

                    let fetchStartTime = process.hrtime.bigint()

                    console.time('response')
                    let response = await this.options.archive.query(ctx.archiveQuery)
                    console.timeEnd('response')

                    console.log(response.metrics, response.data.length)

                    let fetchEndTime = process.hrtime.bigint()

                    ctx.batchBlocksFetched = response.data.length

                    assert(response.status.dbMaxBlockNumber >= archiveHeight)
                    this.setArchiveHeight(statusToHeight(response.status))

                    let blocks = response.data
                        .map(tryMapGatewayBlock)
                        .sort((a, b) => Number(a.header.height - b.header.height))
                    if (blocks.length) {
                        assert(batch.range.from <= blocks[0].header.height)
                        assert(rangeEnd(batch.range) >= last(blocks).header.height)
                        assert(archiveHeight >= last(blocks).header.height)
                    }

                    let from = batch.range.from
                    let to: number
                    if (
                        (blocks.length === 0 || last(blocks).header.height < rangeEnd(batch.range)) &&
                        archiveHeight < rangeEnd(batch.range)
                    ) {
                        to = response.nextBlock - 1
                        this.batches[0] = {
                            range: {from: response.nextBlock, to: batch.range.to},
                            request: batch.request,
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
                        fetchEndTime,
                    }
                })
                .catch(withErrorContext(ctx))

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
        let to = Math.min(archiveHeight, rangeEnd(batch.range))

        let req = batch.request

        let args: gw.BatchRequest = {
            fromBlock: from,
            // toBlock: to,
        }

        args.logs = req.getLogs().map((l) => ({
            address: l.address,
            topics: l.topics || [],
            fieldSelection: toGatewayFieldSelection({block: gw.DEFAULT_SELECTION.block}, l.data, CONTEXT_NESTING_SHAPE),
        }))

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
        let res: any = await this.options.archive.getStatus()
        this.setArchiveHeight(statusToHeight(res))
        return this.archiveHeight
    }

    private setArchiveHeight(height: number): void {
        this.archiveHeight = Math.max(this.archiveHeight, height)
    }

    getLatestKnownArchiveHeight(): number {
        return this.archiveHeight
    }
}

const CONTEXT_NESTING_SHAPE = (() => {
    let transaction = {}
    return {
        log: {
            transaction,
        },
        transaction,
    }
})()

function toGatewayFieldSelection(
    selection: Record<string, any>,
    req: any | undefined,
    shape: Record<string, any>,
    subfield?: string
): any | undefined {
    for (let key in req) {
        if (shape[key]) {
            if (req[key] === true) req[key] = FULL_REQUEST[key]
            if (selection[key] == null) selection[key] = gw.DEFAULT_SELECTION[key]
            toGatewayFieldSelection(selection, req[key], shape[key], key)
        } else {
            let s = subfield ? selection[subfield] : selection
            s[key] = s[key] || req[key]
        }
    }

    return selection
}

function tryMapGatewayBlock(block: gw.BatchBlock): BlockData {
    try {
        return mapGatewayBlock(block)
    } catch (e: any) {
        throw addErrorContext(e, {
            blockHeight: block.block.number,
            blockHash: block.block.hash,
        })
    }
}

function mapGatewayBlock(block: gw.BatchBlock): BlockData {
    let logs = createObjects<gw.Log, EvmLog>(block.logs, (go) => {
        let {logIndex: index, ...log} = go as any
        return {
            id: `${block.block.number}-${index}-${block.block.hash.slice(3, 7)}`,
            index,
            ...log,
        }
    })

    let transactions = createObjects<gw.Transaction, EvmTransaction>(block.transactions, (go) => {
        let {transactionIndex: index, ...transaction} = go as any
        return {
            id: `${block.block.number}-${index}-${block.block.hash.slice(3, 7)}`,
            index,
            ...transaction,
        }
    })

    let items: Item[] = []

    for (let go of block.logs) {
        let log = assertNotNull(logs.get((go as any).logIndex)) as EvmLog
        log.transaction = transactions.get(go.transactionIndex) as EvmTransaction
        items.push({
            kind: 'log',
            address: log.address,
            log,
        })
    }

    for (let go of block.transactions) {
        let transaction = assertNotNull(transactions.get((go as any).transactionIndex)) as EvmTransaction
        items.push({
            kind: 'transaction',
            address: transaction.dest,
            transaction,
        })
    }

    items.sort((a, b) => {
        if (a.kind === 'log' && b.kind === 'log') {
            return Number(a.log.transactionIndex + a.log.index - b.log.transactionIndex - b.log.index)
        } else if (a.kind === 'transaction' && b.kind === 'transaction') {
            return Number(a.transaction.index - b.transaction.index)
        } else {
            return Number(
                a.kind === 'log' && b.kind === 'transaction'
                    ? a.log.transactionIndex - b.transaction.index
                    : a.kind === 'transaction' && b.kind === 'log'
                    ? a.transaction.index - b.log.transactionIndex
                    : 0
            )
        }
    })

    let {timestamp, number: height, nonce, size, ...hdr} = block.block

    return {
        header: {
            id: `${height}-${block.block.hash.slice(3, 7)}`,
            height,
            timestamp: timestamp * 1000,
            nonce: BigInt(nonce),
            size: BigInt(size),
            ...hdr,
        },
        items: items,
    }
}

function createObjects<S, T extends {index: number}>(src: S[], f: (s: S) => PartialObj<T>): Map<number, PartialObj<T>> {
    let m = new Map<number, PartialObj<T>>()
    for (let i = 0; i < src.length; i++) {
        let obj = f(src[i])
        m.set(obj.index, obj)
    }
    return m
}

type PartialObj<T> = Partial<T> & {index: bigint}
