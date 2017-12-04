const LRU = require('lru-cache')
const BaseService = require('../../service')
const Encoding = require('./encoding')

class TimestampService extends BaseService {
  constructor(options) {
    super(options)
    this._db = this.node.services.get('db')
    this._lastBlockTimestamp = 0
    this._cache = LRU(10)
  }

  static get dependencies() {
    return ['db']
  }

  get APIMethods() {
    return [
      ['getBlockHashesByTimestamp', this.getBlockHashesByTimestamp.bind(this), 2]
    ]
  }

  getBlockHashesByTimestamp(high, low, limit) {
    let result = []
    let start = this._encoding.encodeTimestampBlockKey(low)
    let end = this._encoding.encodeTimestampBlockKey(high)
    let criteria = {gte: start, lte: end, reverse: true, limit}

    return new Promise((resolve, reject) => {
      let tsStream = this._db.createReadStream(criteria)
      tsStream.on('data', data => result.push(this._encoding.decodeTimestampBlockValue(data.value)))
      tsStream.on('end', () => resolve(result))
      tsStream.on('error', reject)
    })
  }

  async start() {
    this._prefix = await this._db.getPrefix(this.name)
    this._encoding = new Encoding(this._prefix)
  }

  onBlock(block) {
    let hash = block.hash
    let ts = Math.max(this._lastBlockTimestamp + 1, block.header.timestamp)
    this._cache.set(hash, ts)
    this._lastBlockTimestamp = ts

    return [
      {
        type: 'put',
        key: this._encoding.encodeTimestampBlockKey(ts),
        value: this._encoding.encodeTimestampBlockValue(hash)
      },
      {
        type: 'put',
        key: this._encoding.encodeBlockTimestampKey(hash),
        value: this._encoding.encodeBlockTimestampValue(ts)
      }
    ]
  }

  async onReorg([commonAncestorHash, oldBlockList]) {
    let removalOperations = []
    for (let block of oldBlockList) {
      removalOperations.push(
        {type: 'del', key: this._encoding.encodeTimestampBlockKey(block.header.timestamp)},
        {type: 'del', key: this._encoding.encodeBlockTimestampKey(block.hash)}
      )
    }
    this._lastBlockTimestamp = await this.getTimestamp(commonAncestorHash)
    return removalOperations
  }

  getTimestampSync(hash) {
    return this._cache.get(hash)
  }

  async getTimestamp(hash) {
    let data = await this._db.get(this._encoding.encodeBlockTimestampKey(hash))
    if (data) {
      return this._encoding.decodeBlockTimestampValue(data)
    }
  }

  async getHash(timestamp) {
    let data = await this._db.get(this._encoding.encodeTimestampBlockKey(timestamp))
    return this._encoding.decodeTimestampBlockValue(data)
  }
}

module.exports = TimestampService
