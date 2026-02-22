const Redis = require('ioredis');

class RedisConfig {
  constructor() {
    this.client = null;
    this.subscriber = null;
    this.isConnected = false;
  }

  async connect() {
    try {
      const redisUrl = process.env.REDIS_URL || 'redis://172.17.80.110:6379';
      
      // Main client for operations
      this.client = new Redis(redisUrl, {
        retryStrategy: (times) => {
          const delay = Math.min(times * 50, 2000);
          return delay;
        },
        maxRetriesPerRequest: 3,
        enableReadyCheck: true,
        lazyConnect: false
      });

      // Subscriber client for pub/sub
      this.subscriber = new Redis(redisUrl);

      // Event handlers
      this.client.on('connect', () => {
        console.log('🔄 Redis: Connecting...');
      });

      this.client.on('ready', () => {
        this.isConnected = true;
        console.log('✅ Redis: Connected successfully');
      });

      this.client.on('error', (error) => {
        this.isConnected = false;
        console.error('❌ Redis: Connection error:', error.message);
      });

      this.client.on('close', () => {
        this.isConnected = false;
        console.log('🔄 Redis: Connection closed');
      });

      this.client.on('reconnecting', () => {
        console.log('🔄 Redis: Reconnecting...');
      });

      // Test connection
      await this.client.ping();
      
      return this.client;
    } catch (error) {
      console.error('❌ Redis: Failed to connect:', error.message);
      throw error;
    }
  }

  getClient() {
    if (!this.client) {
      throw new Error('Redis client not initialized. Call connect() first.');
    }
    return this.client;
  }

  getSubscriber() {
    if (!this.subscriber) {
      throw new Error('Redis subscriber not initialized. Call connect() first.');
    }
    return this.subscriber;
  }

  async disconnect() {
    if (this.client) {
      await this.client.quit();
    }
    if (this.subscriber) {
      await this.subscriber.quit();
    }
    this.isConnected = false;
    console.log('🔄 Redis: Disconnected');
  }

  async healthCheck() {
    try {
      if (!this.client) return false;
      const result = await this.client.ping();
      return result === 'PONG';
    } catch (error) {
      return false;
    }
  }
}

module.exports = new RedisConfig();