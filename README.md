# @kessler/s3-store

a CRUD+extras layer over s3 that utilizes conditional reads and writes to maintain strong consistency for optimistic concurrency. Loosely based on this [article](https://www.architecture-weekly.com/p/using-s3-but-not-the-way-you-expected)

to create or access object, call `createObject` or `getObject`. Both will return an etag that you can use to `putObjectIfMatch` later. 

The etag is a strong consistency token that you can use to ensure that the object has not been modified since you last read it.

Please note that an `putObjectIfMatch` is a full overwrite of the object.
However, in most cases you should already have a copy of the object in memory, so you can just modify it and call `putObjectIfMatch` with the new object. The call will fail if the object has been modified since you last read it, which is the desired behavior. In that case all you need to do is to read the object again, modify it and call `putObjectIfMatch` again. This is of course a technical action, rather than a product one. In real world use cases you will maybe want to notify the user that the object has been modified and ask them to confirm the changes.

## installation

```bash
npm install @kessler/s3-store
```

## usage

### conveniece / simplified API for json objects

```javascript
import createS3Store, { createJsonWrapper } from '@kessler/s3-store'

const store = createJsonWrapper(createS3Store('my-bucket'))
const key = 'test-object'

const object = { hello: 'world' }
const createTag = await store.createObject(key, object)
const updateTag = await store.putObjectIfMatch(key, {...object, foo: 'bar '}, createTag)

// will only work if the object exists and was not modified
const getResult = await store.getObjectIfMatch(key, updateTag)
// getResult deeply equals { hello: 'world', foo: 'bar' }

// use this if you don't have any etag and want to get the object
// for the first time.
const [getResult1, getTag] = await store.getObject(key)
```

### lower level API any type of objects

```javascript
import createS3Store from '@kessler/s3-store'

const store = createS3Store('my-bucket', /* { client: optionally provide your own s3 client} */)
const key = 'test-object'
const body = JSON.stringify({ hello: 'world' })
const contentType = 'application/json'

// Create object
const createResult = await store.createObject(key, body, contentType)
//createResult.response === AWS sdk response

const updateResult = await store.putObjectIfMatch(key, updateBody, createResult.etag, contentType)
//updateResult.response === AWS sdk response

// Get object with etag
const getIfMatchResult = await store.getObjectIfMatch(key, updateResult.etag)
//getIfMatchResult.response === AWS sdk response
console.log(await getIfMatch.asString())

```