import {Logger} from '@subsquid/logger'
import {Metrics} from './metrics'
import assert from 'assert'
import fetch, {FetchError, RequestInit} from 'node-fetch'
import {def} from '@subsquid/util-internal'
import {QueryResponse, StatusResponse} from './interfaces/gateway'

export interface ArchiveOptions {
    url: string
    log: Logger
    metrics: Metrics
    id: string
}

export class Archive {
    private counter = 0

    constructor(private options: ArchiveOptions) {}

    async query<T>(archiveQuery: string): Promise<QueryResponse> {
        return await this.request({
            url: this.options.url + '/query',
            query: archiveQuery,
            method: 'POST',
        })
    }

    async getStatus(): Promise<StatusResponse> {
        return await this.request({
            url: this.options.url + '/status',
            method: 'GET',
        })
    }

    private async request<T>(req: Request): Promise<T> {
        let log = this.getLogger()
        let url = req.url
        let method = req.method || 'POST'
        let headers: Record<string, string> = {
            accept: 'application/json',
            'accept-encoding': 'gzip, br',
            'x-squid-id': this.options.id,
        }
        let body: string | undefined
        this.counter = (this.counter + 1) % 1000

        log.debug(
            {
                archiveUrl: this.options.url,
                archiveRequestId: this.counter,
                archiveQuery: req.query,
            },
            'request'
        )

        if (method === 'POST') {
            headers['content-type'] = 'application/json; charset=UTF-8'
            body = req.query
        }

        let options = {method, headers, body, timeout: 60_000}

        let backoff = [100, 500, 2000, 5000, 10_000, 20_000]
        let errors = 0
        while (true) {
            let result = await performFetch(url, options).catch((err) => {
                assert(err instanceof Error)
                return err
            })
            if (isRetryableError(result)) {
                let timeout = backoff[Math.min(errors, backoff.length - 1)]
                errors += 1
                this.options.metrics.registerArchiveRetry(this.options.url, errors)
                this.getLogger().warn(
                    {
                        archiveUrl: this.options.url,
                        archiveRequestId: this.counter,
                        archiveQuery: req.query,
                        backoff,
                        reason: result.message,
                    },
                    'retry'
                )
                await wait(timeout)
            } else if (result instanceof Error) {
                throw result
            } else {
                this.options.metrics.registerArchiveResponse(this.options.url)
                log.debug(
                    {
                        archiveUrl: this.options.url,
                        archiveRequestId: this.counter,
                        archiveQuery: req.query,
                        archiveResponse: log.isTrace() ? result : undefined,
                    },
                    'response'
                )
                return result
            }
        }
    }

    @def
    private getLogger() {
        return this.options.log.child('archive', {url: this.options.url})
    }
}

export interface JSONRequestRetryConfig {
    log?: (err: Error, numberOfFailures: number, backoffMS: number) => void
    maxCount?: number
}

export interface Request {
    headers?: Partial<Record<string, string>>
    url: string
    query?: string
    method?: 'GET' | 'POST'
    retry?: boolean | JSONRequestRetryConfig
}

async function performFetch(url: string, init: RequestInit): Promise<any> {
    let response = await fetch(url, init)

    if (!response.ok) {
        let body = await response.text()
        throw new HttpError(response.status, body)
    }

    let result = await response.json()
    if (result.errors?.length) {
        throw new ArchiveResponseError(result.errors)
    }

    return result
}

function isRetryableError(err: unknown): err is Error {
    if (err instanceof HttpError) {
        switch (err.status) {
            case 429:
            case 502:
            case 503:
                return true
            default:
                return false
        }
    }
    if (err instanceof FetchError) {
        switch (err.type) {
            case 'body-timeout':
            case 'request-timeout':
                return true
            case 'system':
                return err.message.startsWith('request to')
            default:
                return false
        }
    }
    return false
}

export class HttpError extends Error {
    constructor(public readonly status: number, public readonly body?: string) {
        super(`Got http ${status}`)
    }
}

export interface JSONError {
    message: string
    path?: (string | number)[]
}

export class ArchiveResponseError extends Error {
    constructor(public readonly errors: JSONError[]) {
        super(`Archive error: ${errors[0].message}`)
    }
}

function wait(ms: number): Promise<void> {
    return new Promise((resolve) => {
        setTimeout(resolve, ms)
    })
}
