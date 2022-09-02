import {EvmBatchProcessor} from "@subsquid/evm-processor"
import {TypeormDatabase} from "@subsquid/typeorm-store"
import {contractAddress, createContractEntity, getContractEntity} from "./contract"
import * as erc721 from "./erc721"
import {Owner, Token, Transfer} from "./model"


const processor = new EvmBatchProcessor()
    .setBatchSize(1000)
    .addLog('0xdac17f958d2ee523a2206206994597c13d831ec7',
        {range: {from: 10000555}}
    )


processor.setDataSource({
    archive: 'https://eth-test.archive.subsquid.io',
    chain: 'wss://moonriver-rpc.dwellir.com'
})


processor.run(new TypeormDatabase(), async (ctx) => {
    for (const block of ctx.blocks) {
        for (const item of block.items) {
            // console.dir(item, {depth: 5})
        }
    }
})
