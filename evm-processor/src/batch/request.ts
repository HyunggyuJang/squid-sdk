import {EvmTopicSet} from '../interfaces/dataHandlers'
import {LogDataRequest, TransactionDataRequest} from '../interfaces/dataSelection'
import {LogFieldSelection, TransactionFieldSelection} from '../interfaces/gateway'


type AddressReq = {
    address: string
    topics: EvmTopicSet
}


export interface BatchRequest {
    getAddresses(): AddressReq[]
    getLogsRequest(): LogDataRequest | undefined
    getTransactionRequest(): TransactionDataRequest | undefined
}


export class PlainBatchRequest implements BatchRequest {
    addresses: AddressReq[] = []
    logsRequest?: LogDataRequest
    transactionsRequest?: TransactionDataRequest

    getAddresses() {
        return this.addresses
    }

    getLogsRequest() {
        return this.logsRequest
    }

    getTransactionRequest() {
        return this.transactionsRequest
    }

    merge(other: PlainBatchRequest): PlainBatchRequest {
        let result = new PlainBatchRequest()
        result.addresses = this.addresses.concat(other.addresses)
        if (this.logsRequest != null || other.logsRequest != null)
            result.logsRequest = Object.assign(this.logsRequest || {}, other.logsRequest)
        if (this.transactionsRequest != null || other.transactionsRequest != null)
            result.transactionsRequest = Object.assign(this.transactionsRequest || {}, other.transactionsRequest)
        return result
    }
}
