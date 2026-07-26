import test from 'ava'
import createS3Store, { createJsonWrapper } from './index.mjs'

/**
 * Offline unit tests for the write methods' trailing options object:
 *
 *   createObject(key, body, { contentType, metadata })
 *   putObjectIfMatch(key, body, etag, { contentType, metadata })
 *
 * `metadata` becomes S3 user metadata (x-amz-meta-*).
 *
 * These use a fake client that records the command (same pattern as
 * conditional-conflict.test.mjs) rather than a live bucket.
 */

/** A store whose fake client records every command it is asked to send. */
function recordingStore() {
  const sent = []
  const store = createS3Store('test-bucket', {
    client: {
      async send(command) {
        sent.push(command)
        return { ETag: '"etag"' }
      }
    }
  })
  return { store, sent }
}

test('putObjectIfMatch takes contentType and metadata from the options object', async (t) => {
  const { store, sent } = recordingStore()
  await store.putObjectIfMatch('key', 'body', '"e1"', {
    contentType: 'text/plain',
    metadata: { orgid: 'o', userid: 'u' }
  })
  t.is(sent[0].input.ContentType, 'text/plain')
  t.deepEqual(sent[0].input.Metadata, { orgid: 'o', userid: 'u' })
  t.is(sent[0].input.IfMatch, '"e1"')
})

test('createObject takes contentType and metadata from the options object', async (t) => {
  const { store, sent } = recordingStore()
  await store.createObject('key', 'body', {
    contentType: 'application/gzip',
    metadata: { savesource: 'autosave' }
  })
  t.is(sent[0].input.ContentType, 'application/gzip')
  t.deepEqual(sent[0].input.Metadata, { savesource: 'autosave' })
  t.is(sent[0].input.IfNoneMatch, '*')
})

test('contentType defaults to application/json and metadata is omitted', async (t) => {
  const { store, sent } = recordingStore()
  await store.putObjectIfMatch('key', 'body', '"e1"')
  await store.createObject('key2', 'body')

  for (const command of sent) {
    t.is(command.input.ContentType, 'application/json')
    t.is(command.input.Metadata, undefined, 'no Metadata sent when none is supplied')
  }
})

test('json wrapper forwards metadata and keeps the json content type', async (t) => {
  const { store, sent } = recordingStore()
  const json = createJsonWrapper(store)

  await json.putObjectIfMatch('key', { hello: 'world' }, '"e1"', { metadata: { orgid: 'o' } })
  await json.createObject('key2', { hello: 'world' }, { metadata: { userid: 'u' } })

  t.deepEqual(sent[0].input.Metadata, { orgid: 'o' })
  t.deepEqual(sent[1].input.Metadata, { userid: 'u' })
  t.is(sent[0].input.ContentType, 'application/json')
  t.is(sent[1].input.ContentType, 'application/json')
})

test('write methods work with no options at all', async (t) => {
  const { store, sent } = recordingStore()
  const json = createJsonWrapper(store)

  await json.putObjectIfMatch('key', { hello: 'world' }, '"e1"')
  await json.createObject('key2', { hello: 'world' })

  for (const command of sent) {
    t.is(command.input.ContentType, 'application/json')
    t.is(command.input.Metadata, undefined)
  }
})
