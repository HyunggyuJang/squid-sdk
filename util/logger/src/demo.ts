import {createLogger} from "./index"

const log = createLogger('sqd:demo')

log.info('message with severity info')
log.debug('message with severity debug')

log.info({foo: 1, bar: 2}, 'message and some additional attributes')

// info message consisting only of attributes
log.info({a: 1, b: 2, c: 3, array: [4, 5, {a: 1, b: 2, c: {foo: 'foo', bar: 'bar'}}, {a: 3, b: 4}]})

// pass an Error object inplace of attributes
log.warn(new Error('Some error occured'))

// Error together with some other attributes and message
log.error({err: new Error('Another error'), a: 1, b: 2}, 'weird')

// create a child logger instance with namespace `sqd:demo:sql`
// and `req: 1` attribute attached to every log record
const sqlLog = log.child('sql', {req: 1})
sqlLog.debug('connecting to database')
sqlLog.debug({sql: 'SELECT max(id) FROM status'})

log.info(new Map([['a', 1], ['b', 2], ['c', 3]]))
