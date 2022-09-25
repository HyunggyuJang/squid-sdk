import {StatusResponse} from "../interfaces/gateway";

export function statusToHeight(status: StatusResponse) {
    let height = status.parquetBlockNumber > status.dbMinBlockNumber ? status.dbMaxBlockNumber : status.parquetBlockNumber
    if (height == 0) {
        height = -1
    }
    return height
}
