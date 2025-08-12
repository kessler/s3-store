import { S3Client, DeleteBucketCommand, DeleteObjectsCommand, CreateBucketCommand } from '@aws-sdk/client-s3'
import createS3Store, { createJsonWrapper } from './index.mjs'
import test from 'ava'

const client = new S3Client()

test('create and update and get',async (t) => {
  const bucket = t.context.bucket
  const store = createS3Store(bucket, { client })

  const testObject = { hello: 'world' }
  const key = 'test-object'
  const contentType = 'application/json'

  // Create object
  const createResult = await store.createObject(key, JSON.stringify(testObject), contentType)

  t.truthy(createResult.etag, 'etag should be returned after creating object')
  t.truthy(createResult.response, 'response should be returned after creating object')
  
  const testObject1 = { ...testObject, updated: true }

  // Update object
  const putResult = await store.putObjectIfMatch(key, JSON.stringify(testObject1), createResult.etag, contentType)

  // // Get object with ETag
  const getResult = await store.getObjectIfMatch(key, putResult.etag)
  t.is(getResult.etag, putResult.etag, 'etag should match after getting the updated object')

  const actualObject = await getResult.asJson()

  t.deepEqual(actualObject, testObject1, 'object should match after getting the updated object')
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
  const getBody = await getWithoutEtag.asString()

  t.deepEqual(getBody, body, 'body should match after getting object without etag')
})

test('delete object', async (t) => {
  const bucket = t.context.bucket
  const store = createS3Store(bucket, { client })

  const key = 'test-object'
  const body = JSON.stringify({ hello: 'world' })
  const contentType = 'application/json'

  // Create object
  const createResult = await store.createObject(key, body, contentType)

  // Delete object
  const deleteResult = await store.deleteObjectIfMatch(key, createResult.etag)

  t.truthy(deleteResult.response, 'response should be returned after deleting object')

  // Try to get deleted object
  await t.throwsAsync(() => store.getObjectIfMatch(key, deleteResult.etag), {
    name: 'NoSuchKey',
    message: `The specified key does not exist.`
  })
})

test('createJsonWrapper, create and get if match', async (t) => {
  const bucket = t.context.bucket
  const store = createS3Store(bucket, { client })
  const jsonWrapper = createJsonWrapper(store)

  const key = 'test-json-object'
  const body = { hello: 'json world' }
  
  // Create object using JSON wrapper
  const createTag = await jsonWrapper.createObject(key, body)

  t.truthy(createTag, 'etag should be returned after creating object with JSON wrapper')

  // Get object using JSON wrapper
  const getResponse = await jsonWrapper.getObjectIfMatch(key, createTag)
  t.deepEqual(getResponse, body, 'body should match after getting object with JSON wrapper')
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
