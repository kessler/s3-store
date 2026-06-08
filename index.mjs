import { S3Client, GetObjectCommand, PutObjectCommand, DeleteObjectCommand, ListObjectsV2Command } from '@aws-sdk/client-s3'

export default function createS3Store(bucket, { client = new S3Client() } = {}) {
  return new S3Store(bucket, { client })
}

export function createJsonWrapper(store) {
  return new JsonS3StoreWrapper(store)
}

class S3Store {
  #client
  #bucket

  constructor(bucket, { client = new S3Client() }) {
    this.#client = client
    this.#bucket = bucket
  }

  async createObject(key, body, contentType = 'application/json') {
    const command = new PutObjectCommand({
      Bucket: this.#bucket,
      Key: key,
      Body: body,
      ContentType: contentType,
      // write only if the object does not already exist
      IfNoneMatch: '*' 
    })

    try {
      return await this.#send(command)
    } catch (err) {
      if (err.Code === 'PreconditionFailed') {
        throw new KeyExistsError('cannot overwrite an existing key', err)
      }

      if (err.Code === 'ConditionalRequestConflict') {
        throw new ConcurrentWriteConflictError('create conflicted with a concurrent write to this key, retry', err)
      }

      throw err
    }
  }

  async putObjectIfMatch(key, body, etag, contentType = 'application/json') {
    const command = new PutObjectCommand({
      Bucket: this.#bucket,
      Key: key,
      Body: body,
      ContentType: contentType,
      IfMatch: etag
    })

    try {
      return await this.#send(command)
    } catch (err) {
      if (err.Code === 'PreconditionFailed') {
        throw new StaleDataError('object was modified concurrently, reload your object first', err)
      }

      if (err.Code === 'ConditionalRequestConflict') {
        throw new ConcurrentWriteConflictError('update conflicted with a concurrent write to this key, retry', err)
      }

      throw err
    }
  }

  async getObjectIfMatch(key, etag) {
    const command = new GetObjectCommand({
      Bucket: this.#bucket,
      Key: key,
      IfMatch: etag
    })

    try {
      return await this.#send(command, GetResponseWrapper)
    } catch (err) {
      if (err.Code === 'PreconditionFailed') {
        throw new StaleDataError('object was modified concurrently, reload your object first. use getObject() instead', err)
      }

      if (err.Code === 'ConditionalRequestConflict') {
        throw new ConcurrentWriteConflictError('conditional read conflicted with a concurrent write to this key, retry', err)
      }

      throw err
    }
  }

  // this is here because in some use cases our only option is to get the object 
  // without an etag, and it's not really destructive to do so, only
  // to the caller, perhaps, but not to the store
  getObject(key) {
    const command = new GetObjectCommand({
      Bucket: this.#bucket,
      Key: key
    })

    return this.#send(command, GetResponseWrapper)
  }

  async deleteObjectIfMatch(key, etag) {
    try {
      const command = new DeleteObjectCommand({
        Bucket: this.#bucket,
        Key: key,
        IfMatch: etag
      })

      return await this.#send(command)
    } catch (error) {
      if (error.code === 'NotImplemented' && error.Header === 'If-Match') {
        throw new UnsupportedBucketOperationError('This bucket does not support If-Match header for delete operations. Only directory buckets support deletion with If-Match.')
      }

      if (error.Code === 'PreconditionFailed') {
        throw new StaleDataError('object was modified concurrently, cannot proceed with deletion', error)
      }

      if (error.Code === 'ConditionalRequestConflict') {
        throw new ConcurrentWriteConflictError('delete conflicted with a concurrent write to this key, retry', error)
      }

      throw error
    }
  }

  deleteObject(key) {
    const command = new DeleteObjectCommand({
      Bucket: this.#bucket,
      Key: key
    })

    return this.#send(command)
  }

  /**
   * creates an async iterator that yields objects in the bucket:
   * 
   * ```js
   * for await (const objects of store.list('some/prefix')) {
   *   console.log(objects)
   * }
   * ```
   * 
   * 
   * @param {string} prefix optional prefix to filter objects by
   * @returns 
   */
  list(prefix) {
    const fetchMore = (continuationToken) => {
      return this.#client.send(new ListObjectsV2Command({ Bucket: this.#bucket, Prefix: prefix, ContinuationToken: continuationToken }))
    }
  
    return {
      async *[Symbol.asyncIterator]() {
        let response = await fetchMore()
  
        while (response.KeyCount > 0) {
          yield response.Contents
  
          if (response.IsTruncated) {
            response = await fetchMore(response.NextContinuationToken)
          } else {
            return
          }
        }
      }
    }
  }

  get bucket() {
    return this.#bucket
  }

  async #send(command, Wrapper = ResponseWrapper) {
    const response = await this.#client.send(command)
    return new Wrapper(response, response.ETag)
  }
}

class ResponseWrapper {
  #response
  #etag

  constructor(response, etag) {
    this.#response = response
    this.#etag = etag
  }

  get etag() {
    return this.#etag
  }

  get response() {
    return this.#response
  }
}

class GetResponseWrapper extends ResponseWrapper {
  constructor(response, etag) {
    super(response, etag)
  }

  async asString() {
    return this.response.Body.transformToString()
  }

  async asByteArray() {
    return this.response.Body.transformToByteArray()
  }

  async asWebStream() {
    return this.response.Body.transformToWebStream()
  }

  async asJson() {
    return JSON.parse(await this.response.Body.transformToString())
  }
}

class JsonS3StoreWrapper {
  #store

  constructor(store) {
    this.#store = store
  }

  async createObject(key, body) {
    const result = await this.#store.createObject(key, JSON.stringify(body), 'application/json')
    return result.etag
  }

  async putObjectIfMatch(key, body, etag) {
    const result = await this.#store.putObjectIfMatch(key, JSON.stringify(body), etag, 'application/json')
    return result.etag
  }

  async getObjectIfMatch(key, etag) {
    const response = await this.#store.getObjectIfMatch(key, etag)
    return await response.asJson()
  }

  async getObject(key) {
    const response = await this.#store.getObject(key)
    return [await response.asJson(), response.etag]
  }
}

export class UnsupportedBucketOperationError extends Error {
  constructor(message) {
    super(message)
    this.name = 'UnsupportedBucketOperationError'
  }
}

export class StaleDataError extends Error {
  constructor(message, originalError) {
    super(message)
    this.name = 'StaleDataError'
    this.originalError = originalError
  }
}

export class KeyExistsError extends Error {
  constructor(message, originalError) {
    super(message)
    this.name = 'KeyExistsError'
    this.originalError = originalError
  }
}

export class ConcurrentWriteConflictError extends Error {
  constructor(message, originalError) {
    super(message)
    this.name = 'ConcurrentWriteConflictError'
    this.originalError = originalError
  }
}
