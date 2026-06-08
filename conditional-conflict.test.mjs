import test from 'ava'
import createS3Store, { ConcurrentWriteConflictError } from './index.mjs'

/**
 * Offline unit tests for 409 ConditionalRequestConflict wrapping.
 *
 * S3 answers a conditional write (If-None-Match / If-Match) with HTTP 409
 * `ConditionalRequestConflict` when another conditional write to the same key is
 * in flight at the same instant — distinct from the 412 `PreconditionFailed`
 * returned for a merely-stale etag. A 409 cannot be reproduced deterministically
 * against real S3 (it needs two genuinely simultaneous in-flight writes), so these
 * tests inject a fake client whose `send` throws the raw 409 the AWS SDK would.
 *
 * The store must wrap that raw error into the typed `ConcurrentWriteConflictError`
 * (preserving the raw error on `.originalError`) so callers can recognize and retry
 * it without sniffing AWS SDK internals.
 */

/** Mirror the AWS SDK v3 shape for a 409 conflict. */
function conditionalRequestConflict() {
  return Object.assign(
    new Error('The conditional request cannot succeed due to a conflicting operation against this resource.'),
    {
      name: 'ConditionalRequestConflict',
      Code: 'ConditionalRequestConflict',
      $metadata: { httpStatusCode: 409 }
    }
  )
}

/** A store whose underlying S3 client always throws the given error on send. */
function storeThatThrows(err) {
  return createS3Store('test-bucket', {
    client: {
      send: async () => {
        throw err
      }
    }
  })
}

test('createObject wraps a 409 into ConcurrentWriteConflictError', async (t) => {
  const store = storeThatThrows(conditionalRequestConflict())
  const error = await t.throwsAsync(() => store.createObject('key', 'body'), {
    instanceOf: ConcurrentWriteConflictError,
    message: /create conflicted with a concurrent write/
  })
  t.is(error.originalError.Code, 'ConditionalRequestConflict', 'raw AWS error preserved on .originalError')
})

test('putObjectIfMatch wraps a 409 into ConcurrentWriteConflictError', async (t) => {
  const store = storeThatThrows(conditionalRequestConflict())
  const error = await t.throwsAsync(() => store.putObjectIfMatch('key', 'body', '"etag"'), {
    instanceOf: ConcurrentWriteConflictError,
    message: /update conflicted with a concurrent write/
  })
  t.is(error.originalError.Code, 'ConditionalRequestConflict')
})

test('getObjectIfMatch wraps a 409 into ConcurrentWriteConflictError', async (t) => {
  const store = storeThatThrows(conditionalRequestConflict())
  const error = await t.throwsAsync(() => store.getObjectIfMatch('key', '"etag"'), {
    instanceOf: ConcurrentWriteConflictError,
    message: /conditional read conflicted with a concurrent write/
  })
  t.is(error.originalError.Code, 'ConditionalRequestConflict')
})

test('deleteObjectIfMatch wraps a 409 into ConcurrentWriteConflictError', async (t) => {
  const store = storeThatThrows(conditionalRequestConflict())
  const error = await t.throwsAsync(() => store.deleteObjectIfMatch('key', '"etag"'), {
    instanceOf: ConcurrentWriteConflictError,
    message: /delete conflicted with a concurrent write/
  })
  t.is(error.originalError.Code, 'ConditionalRequestConflict')
})

test('a non-409 error is rethrown raw, not wrapped', async (t) => {
  const raw = Object.assign(new Error('boom'), { name: 'InternalError', Code: 'InternalError' })
  const store = storeThatThrows(raw)
  const error = await t.throwsAsync(() => store.createObject('key', 'body'))
  t.false(error instanceof ConcurrentWriteConflictError, 'unrelated errors must not be misclassified')
  t.is(error.Code, 'InternalError')
})
