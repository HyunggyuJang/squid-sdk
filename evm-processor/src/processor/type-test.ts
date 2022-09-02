import {BatchContext, EvmBatchProcessor} from "./batchProcessor"


const db: any = {}


function getItem<I>(cb: (item: I) => void) {
    return async function(ctx: BatchContext<any, I>) {
    }
}


new EvmBatchProcessor()
.addLog("0xaadsfadfasdfasdfa", {data: {log: {topics: true}}})
.addLog("0xaadsfadfasdfasdfa", {data: {log: true}})
.run(db, getItem(item => {
    if (item.address == '0xaadsfadfasdfasdfa') {
    }
}))
