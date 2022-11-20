import {
    BatchHandlerContext,
    BatchProcessorItem,
    EvmBatchProcessor,
    EvmBlock,
    LogHandlerContext,
} from '@subsquid/evm-processor'
import {Store, TypeormDatabase} from '@subsquid/typeorm-store'
import {In} from 'typeorm'
import * as erc20 from './erc20'
import {Account, Token, Transfer} from './model'

const processor = new EvmBatchProcessor().addLog('0xdac17f958d2ee523a2206206994597c13d831ec7', {
    range: {from: 5_000_000},
    filter: [[erc20.events['Transfer(address,address,uint256)'].topic]],
    data: {
        evmLog: {
            topics: true,
            data: true,
        },
        transaction: {
            gas: true,
            hash: true,
        },
    },
})

processor.setDataSource({
    archive: 'https://eth-stage1.archive.subsquid.io',
    chain: 'wss://mainnet.infura.io/ws/v3/c8458927a73148cfab30014f6e422bb3',
})

type Item = BatchProcessorItem<typeof processor>
type Ctx = BatchHandlerContext<Store, Item>

processor.run(new TypeormDatabase(), async (ctx) => {
    let transfersData = getTransfers(ctx)

    let accountIds = new Set<string>()
    let tokenIds = new Set<string>()
    for (let t of transfersData) {
        accountIds.add(t.fromId)
        accountIds.add(t.toId)
        tokenIds.add(t.tokenId)
    }

    let accounts = new Map<string, Account>()
    for (let accountIdsBatch of splitIntoBatches([...accountIds], 10000)) {
        await ctx.store.findBy(Account, {id: In(accountIdsBatch)}).then((as) => {
            as.forEach((a) => accounts.set(a.id, a))
        })
    }

    let tokens = await ctx.store.findBy(Token, {id: In([...tokenIds])}).then((tokens) => {
        return new Map(tokens.map((t) => [t.id, t]))
    })

    let transfers: Transfer[] = []

    for (let t of transfersData) {
        let {id, block, blockHash, timestamp, txHash, amount, gas} = t

        let from = getAccount(accounts, t.fromId)
        let to = getAccount(accounts, t.toId)
        let token = tokens.get(t.tokenId)
        if (!token) {
            let contract = new erc20.Contract(ctx, blockHash, t.tokenId)
            token = new Token({
                id: t.tokenId,
                symbol: await contract.symbol(),
                decimals: await contract.decimals(),
            })
            tokens.set(token.id, token)
        }

        transfers.push(
            new Transfer({
                id,
                blockNumber: block,
                timestamp: timestamp,
                txHash,
                from,
                to,
                amount,
                gas,
            })
        )
    }

    await ctx.store.save(Array.from(accounts.values()))
    await ctx.store.save(Array.from(tokens.values()))
    await ctx.store.insert(transfers)
})

interface TransferEvent {
    id: string
    block: number
    blockHash: string
    timestamp: Date
    txHash: string
    fromId: string
    toId: string
    amount: bigint
    gas: bigint
    tokenId: string
}

function getTransfers(ctx: Ctx): TransferEvent[] {
    let transfers: TransferEvent[] = []
    for (let block of ctx.blocks) {
        for (let item of block.items) {
            if (item.kind === 'evmLog' && item.address === '0xdac17f958d2ee523a2206206994597c13d831ec7') {
                const log = item.evmLog
                const transaction = item.transaction

                if (log.topics[0] === erc20.events['Transfer(address,address,uint256)'].topic) {
                    const data = erc20.events['Transfer(address,address,uint256)'].decode(log)
                    transfers.push({
                        id: log.id,
                        block: block.header.height,
                        blockHash: block.header.hash,
                        timestamp: new Date(block.header.timestamp),
                        txHash: transaction.hash,
                        fromId: data.from,
                        toId: data.to,
                        amount: data.value.toBigInt(),
                        gas: transaction.gas,
                        tokenId: log.address,
                    })
                }
            }
        }
    }
    return transfers
}

function getAccount(m: Map<string, Account>, id: string): Account {
    let acc = m.get(id)
    if (acc == null) {
        acc = new Account()
        acc.id = id
        m.set(id, acc)
    }
    return acc
}

function* splitIntoBatches<T>(list: T[], maxBatchSize: number): Generator<T[]> {
    if (list.length <= maxBatchSize) {
        yield list
    } else {
        let offset = 0
        while (list.length - offset > maxBatchSize) {
            yield list.slice(offset, offset + maxBatchSize)
            offset += maxBatchSize
        }
        yield list.slice(offset)
    }
}
