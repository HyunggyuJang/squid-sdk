import {BatchContext, BatchProcessorItem, EvmBatchProcessor} from "@subsquid/evm-processor"
import {Store, TypeormDatabase} from "@subsquid/typeorm-store"
import {In} from "typeorm"
import * as erc20 from "./erc20"
import {Account, Token, Transfer} from "./model"


const processor = new EvmBatchProcessor()
    .setBatchSize(1000)
    .addLog('0xdac17f958d2ee523a2206206994597c13d831ec7',
        {range: {from: 4634748}}
    )


processor.setDataSource({
    archive: 'https://eth-test.archive.subsquid.io',
})


type Item = BatchProcessorItem<typeof processor>
type Ctx = BatchContext<Store, Item>


processor.run(new TypeormDatabase(), async ctx => {
    let transfersData = getTransfers(ctx)

    let accountIds = new Set<string>()
    for (let t of transfersData) {
        accountIds.add(t.fromId)
        accountIds.add(t.toId)
    }

    let accounts = await ctx.store.findBy(Account, {id: In([...accountIds])}).then(accounts => {
        return new Map(accounts.map(a => [a.id, a]))
    })

    let transfers: Transfer[] = []

    for (let t of transfersData) {
        let {id, blockNumber, timestamp, txHash, amount, gas} = t

        let from = getAccount(accounts, t.fromId)
        let to = getAccount(accounts, t.toId)

        transfers.push(new Transfer({
            id,
            blockNumber,
            timestamp,
            txHash,
            from,
            to,
            amount,
            gas
        }))
    }

    await ctx.store.save(Array.from(accounts.values()))
    await ctx.store.insert(transfers)
})


interface TransferEvent {
    id: string
    blockNumber: number
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
            if (item.kind === 'log' && item.address === '0xdac17f958d2ee523a2206206994597c13d831ec7') {
                const log = item.log

                if (log.topics[0] === erc20.events["Transfer(address,address,uint256)"].topic) {
                    const data = erc20.events["Transfer(address,address,uint256)"].decode(log)
                    transfers.push({
                        id: log.id,
                        blockNumber: Number(block.header.number),
                        timestamp: new Date(Number(block.header.timestamp)),
                        txHash: log.transaction.hash,
                        fromId: data.from,
                        toId: data.to,
                        amount: data.value.toBigInt(),
                        gas: log.transaction.gas,
                        tokenId: log.address
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