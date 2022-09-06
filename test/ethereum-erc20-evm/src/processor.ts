import {BatchContext, BatchProcessorItem, EvmBatchProcessor, EvmBlock} from "@subsquid/evm-processor"
import {Store, TypeormDatabase} from "@subsquid/typeorm-store"
import {In} from "typeorm"
import * as erc20 from "./erc20"
import {Account, Token, Transfer} from "./model"


const processor = new EvmBatchProcessor()
    .setBatchSize(1000)
    .addLog('0xdac17f958d2ee523a2206206994597c13d831ec7',
        {
            range: {from: 4634748},
            filter: [["0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef"]],
            data: {
                log: {
                    topics: true,
                    data: true,
                    transaction: {
                        gas: true,
                        hash: true,
                    }
                }
            }
        }
    )
    .addLog('0x4fabb145d64652a948d72533023f6e7a623c7c53',
        {
            range: {from: 8493105},
            filter: [["0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef"]],
            data: {
                log: {
                    topics: true,
                    data: true,
                    transaction: {
                        gas: true,
                        hash: true,
                    }
                }
            }
        }
    )


processor.setDataSource({
    archive: 'https://eth-test.archive.subsquid.io',
    chain: 'wss://rinkeby-light.eth.linkpool.io/ws'
})


type Item = BatchProcessorItem<typeof processor>
type Ctx = BatchContext<Store, Item>


processor.run(new TypeormDatabase(), async (ctx) => {
    let transfersData = getTransfers(ctx)

    let accountIds = new Set<string>()
    let tokenIds = new Set<string>()
    for (let t of transfersData) {
        accountIds.add(t.fromId)
        accountIds.add(t.toId)
        tokenIds.add(t.tokenId)
    }

    let accounts = await ctx.store.findBy(Account, {id: In([...accountIds])}).then(accounts => {
        return new Map(accounts.map(a => [a.id, a]))
    })

    let tokens = await ctx.store.findBy(Token, {id: In([...tokenIds])}).then(tokens => {
        return new Map(tokens.map(t => [t.id, t]))
    })

    let transfers: Transfer[] = []

    for (let t of transfersData) {
        let {id, block, txHash, amount, gas} = t

        let from = getAccount(accounts, t.fromId)
        let to = getAccount(accounts, t.toId)
        let token = tokens.get(t.tokenId)
        if (!token) {
            let contract = new erc20.Contract(ctx, {height: Number(block.number)}, t.tokenId)
            token = new Token({
                id: t.tokenId,
                symbol: await contract.symbol(),
                decimals: await contract.decimals(),
            })
            tokens.set(token.id, token)
        }

        transfers.push(new Transfer({
            id,
            blockNumber: Number(block.number),
            timestamp: new Date(block.timestamp),
            txHash,
            from,
            to,
            amount,
            gas
        }))
    }

    await ctx.store.save(Array.from(accounts.values()))
    await ctx.store.save(Array.from(tokens.values()))
    await ctx.store.insert(transfers)
})


interface TransferEvent {
    id: string
    block: EvmBlock
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
                        block: block.header,
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