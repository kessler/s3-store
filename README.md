# @kessler/s3-store

a CRUD+extras layer over s3 that utilizes conditional reads and writes to maintain strong consistency for optimistic concurrency. Loosely based on this [article](https://www.architecture-weekly.com/p/using-s3-but-not-the-way-you-expected)

objects can be created only if they don't exist, otherwise it's an update.

for an update you will need the original's etag. you can also use `getObject()` to do that. it is the only method that do not use s3 conditions.

## installation

```bash
npm install @kessler/s3-store
```

## usage

```javascript
import createS3Store from '@kessler/s3-store'

const store = createS3Store('my-bucket', /* { client: optionally provide your own s3 client} */)
const key = 'test-object'
const body = JSON.stringify({ hello: 'world' })
const contentType = 'application/json'

// Create object
const create = await store.createObject(key, body, contentType)
//create.response === AWS response

const update = await store.updateObject(key, updateBody, create.etag, contentType)
//update.response === AWS response

// Get object with etag
const getIfMatch = await store.getObjectIfMatch(key, update.etag)
const getBody = await getIfMatch.body()
//getIfMatch.response === AWS response

```