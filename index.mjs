import { S3Client, GetObjectCommand, PutObjectCommand, DeleteObjectCommand, ListObjectsV2Command } from '@aws-sdk/client-s3'

export default function createS3Store(bucket, { client = new S3Client() } = {}) {
  return new S3Store(bucket, { client })
}

class S3Store {
  #client
  #bucket

  constructor(bucket, { client = new S3Client() }) {
    this.#client = client
    this.#bucket = bucket
  }

  createObject(key, body, contentType = 'application/json') {
    const command = new PutObjectCommand({
      Bucket: this.#bucket,
      Key: key,
      Body: body,
      ContentType: contentType,
      IfNoneMatch: '*' // write only if the object does not already exist
    })

    return this.#send(command)
  }

  updateObject(key, body, etag, contentType = 'application/json') {
    const command = new PutObjectCommand({
      Bucket: this.#bucket,
      Key: key,
      Body: body,
      ContentType: contentType,
      IfMatch: etag
    })

    return this.#send(command)
  }

  async getObjectIfMatch(key, etag) {
    const command = new GetObjectCommand({
      Bucket: this.#bucket,
      Key: key,
      IfMatch: etag
    })

    const result = await this.#send(command)
    result.body = async () => result.response.Body.transformToString()
    return result
  }

  // this is here because sometimes our only option is to get the object 
  // without an etag, and it's not really destructive to do so, only
  // to the caller, perhaps, but not to the store
  async getObject(key) {
    const command = new GetObjectCommand({
      Bucket: this.#bucket,
      Key: key
    })

    const result = await this.#send(command)
    result.body = async () => result.response.Body.transformToString()
    return result
  }

  deleteObjectIfMatch(key, etag) {
    const command = new DeleteObjectCommand({
      Bucket: this.#bucket,
      Key: key,
      IfMatch: etag
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

  async #send(command) {
    const response = await this.#client.send(command)
    
    return { etag: response.ETag, response }
  }
}