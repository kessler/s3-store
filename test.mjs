import { S3Client, DeleteBucketCommand, DeleteObjectsCommand, CreateBucketCommand } from '@aws-sdk/client-s3'
import createS3Store from './index.mjs'
import test from 'ava'

const client = new S3Client()

test('create and update and get',async (t) => {
  const bucket = t.context.bucket
  const store = createS3Store(bucket, { client })

  const key = 'test-object'
  const body = JSON.stringify({ hello: 'world' })
  const contentType = 'application/json'

  // Create object
  const create = await store.createObject(key, body, contentType)

  t.truthy(create.etag, 'etag should be returned after creating object')
  t.truthy(create.response, 'response should be returned after creating object')

  const updateBody = JSON.stringify({ hello: 'africa' })
  
  // Update object
  const update = await store.updateObject(key, updateBody, create.etag, contentType)

  // Get object with ETag
  const getIfMatch = await store.getObjectIfMatch(key, update.etag)
  t.is(getIfMatch.etag, update.etag, 'etag should match after updating object')
  const getBody = await getIfMatch.body()

  t.deepEqual(getBody, updateBody, 'body should match after updating object')
})

test('get object without etag', async (t) => {
  const bucket = t.context.bucket
  const store = createS3Store(bucket, { client })

  const key = 'test-object'
  const body = JSON.stringify({ hello: 'world' })
  const contentType = 'application/json'

  // Create object
  await store.createObject(key, body, contentType)

  // Get object without ETag
  const getWithoutEtag = await store.getObject(key)
  const getBody = await getWithoutEtag.response.Body.transformToString()

  t.deepEqual(getBody, body, 'body should match after getting object without etag')
})

test.beforeEach(async t => {
  const bucket = t.context.bucket = `s3store-bucket-${randomString(10)}`
  await createBucket(bucket)
  await sleep(2000)
  console.error('bucket created:', bucket)
})

test.afterEach.always(async t => {
  await safeDeleteBucket(t.context.bucket)
  await sleep(3000)
  console.error('bucket deleted:', t.context.bucket)
})

async function safeDeleteBucket(bucket) {
  try {
    await deleteBucket(bucket)
  } catch (error) {
    if (error.name === 'NoSuchBucket') {
      console.warn(`Bucket ${bucket} does not exist, skipping deletion.`)
      return
    }
    throw error
  }
}

async function deleteBucket(bucket) {
  const input = {
    Bucket: bucket
  }
  const store = createS3Store(bucket, { client })

  for await (const batch of store.list()) {
    await client.send(new DeleteObjectsCommand({ Bucket: bucket, Delete: { Objects: batch.map(({ Key }) => ({ Key })) } }))

    // TODO eeeeeeeek!
    await sleep(1000)
  }
  
  await client.send(new DeleteBucketCommand(input))
}

async function createBucket(bucket) {

  const input = {
    Bucket: bucket
  }

  return client.send(new CreateBucketCommand(input))
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms))
}

function randomString(length = 10) {
  return Math.random().toString(36).substring(2, length + 2)
}
