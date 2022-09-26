import type {EvmLog, EvmTransaction} from './evm'

type Req<T> = {
    [P in keyof T]?: unknown
}

type PlainReq<T> = {
    [P in keyof T]?: boolean
}

type Select<T, R extends Req<T>> = {
    [P in keyof T as R[P] extends true ? P : P extends 'id' ? P : never]: T[P]
}

export type WithProp<K extends string, V> = [V] extends [never]
    ? {}
    : {
          [k in K]: V
      }

type LogScalars<T = EvmLog> = Omit<T, 'transaction'>

export type TransactionRequest = Omit<PlainReq<EvmTransaction>, 'id' | 'dest' | 'index'>

export type LogRequest = Omit<PlainReq<LogScalars>, 'id' | 'address' | 'index'> & {
    transaction?: TransactionRequest | boolean
}

type TransactionFields<R extends TransactionRequest> = Select<EvmTransaction, R>

export type TransactionType<R> = R extends true
    ? EvmTransaction
    : R extends TransactionRequest
    ? TransactionFields<R>
    : never

type ApplyTransactionFields<R extends LogRequest> = R['transaction'] extends true
    ? {transaction: EvmTransaction}
    : R['transaction'] extends TransactionRequest
    ? {transaction: TransactionFields<R['transaction']>}
    : {}

type LogFields<R extends LogRequest> = Select<LogScalars, R> & ApplyTransactionFields<R>

type LogType<R, A = string> = (R extends true ? EvmLog : R extends LogRequest ? LogFields<R> : never) & {address: A}

export interface LogDataRequest {
    log?: boolean | LogRequest
}

export type LogData<R extends LogDataRequest = {log: true}, A = string> = WithProp<'log', LogType<R['log'], A>>

export interface TransactionDataRequest {
    transaction?: boolean | TransactionDataRequest
}

export type TransactionData<R extends TransactionDataRequest = {transaction: true}> = WithProp<
    'transaction',
    TransactionType<R['transaction']>
>

type SetAddress<T, A> = Omit<T, 'address'> & {address: A}
type SetItemAddress<T, P, A> = P extends keyof T ? Omit<T, P> & {[p in P]: SetAddress<T[P], A>} & {address: A} : never

type WithKind<K, T> = {kind: K} & {
    [P in keyof T]: T[P]
}

export type LogItem<Address, R = false> = WithKind<
    'log',
    SetItemAddress<
        R extends true
            ? LogData<{log: true}, Address>
            : R extends LogDataRequest
            ? LogData<R, Address>
            : LogData<{log: {}}, Address>,
        'log',
        Address
    >
>

export type TransactionItem<Address, R = false> = WithKind<
    'transaction',
    SetItemAddress<
        R extends true
            ? TransactionData
            : R extends TransactionDataRequest
            ? TransactionData<R>
            : TransactionData<{transaction: {}}>,
        'log',
        Address
    >
>

export type ItemMerge<A, B, R> = [A] extends [never]
    ? B
    : [B] extends [never]
    ? A
    : [Exclude<R, undefined | boolean>] extends [never]
    ? A
    : undefined extends A
    ? undefined | ObjectItemMerge<Exclude<A, undefined>, Exclude<B, undefined>, Exclude<R, undefined | boolean>>
    : ObjectItemMerge<A, B, Exclude<R, undefined | boolean>>

type ObjectItemMerge<A, B, R> = {
    [K in keyof A | keyof B]: K extends keyof A
        ? K extends keyof B
            ? K extends keyof R
                ? ItemMerge<A[K], B[K], R[K]>
                : A[K]
            : A[K]
        : K extends keyof B
        ? B[K]
        : never
}

type ItemKind = {
    kind: string
    address: string
}

type AddItem<T extends ItemKind, I extends ItemKind, R> =
    | (T extends Pick<I, 'kind' | 'address'> ? ItemMerge<T, I, R> : T)
    | Exclude<I, Pick<T, 'kind' | 'address'>>

export type AddLogItem<T extends ItemKind, I extends ItemKind> = AddItem<T, I, LogDataRequest>
export type AddTransactionItem<T extends ItemKind, I extends ItemKind> = AddItem<T, I, TransactionDataRequest>

export interface DataSelection<R> {
    data: R
}

export interface NoDataSelection {
    data?: undefined
}

export interface MayBeDataSelection<R> {
    data?: R
}

export const FULL_REQUEST: Record<string, any> = {
    log: {
        data: true,
        removed: true,
        topics: true,
        transaction: true,
    },
    transaction: {
        source: true,
        gas: true,
        gasPrice: true,
        hash: true,
        input: true,
        nonce: true,
        value: true,
        kind: true,
        chainId: true,
        v: true,
        r: true,
        s: true,
    },
}
