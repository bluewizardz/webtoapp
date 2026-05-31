import { Queue, Worker, QueueEvents } from 'bullmq';
import Redis from 'ioredis';
import { buildAPK } from './builders/android-builder.js';

const REDIS_HOST = process.env.REDIS_HOST || '127.0.0.1';
const REDIS_PORT = parseInt(process.env.REDIS_PORT || '6379', 10);
const CONCURRENCY = parseInt(process.env.MAX_GRADLE_PARALLEL_BUILDS || '3', 10);

const connectionConfig = {
  host: REDIS_HOST,
  port: REDIS_PORT,
  maxRetriesPerRequest: null,
  connectTimeout: 2000
};

class LocalQueue {
  constructor(concurrency = 3) {
    this.concurrency = concurrency;
    this.pending = [];
    this.active = 0;
  }

  add(fn) {
    return new Promise((resolve, reject) => {
      this.pending.push({ fn, resolve, reject });
      this.next();
    });
  }

  next() {
    if (this.active >= this.concurrency || this.pending.length === 0) {
      return;
    }
    const { fn, resolve, reject } = this.pending.shift();
    this.active++;
    fn()
      .then(resolve)
      .catch(reject)
      .finally(() => {
        this.active--;
        this.next();
      });
  }
}

const localQueue = new LocalQueue(CONCURRENCY);

let useRedis = false;
let gradleBuildQueue = null;
let queueEvents = null;
let worker = null;

async function initQueue() {
  try {
    // Attempt to connect to Redis with a short timeout to check availability
    const isRedisAvailable = await new Promise((resolve) => {
      const client = new Redis({
        ...connectionConfig,
        lazyConnect: false
      });
      client.on('connect', () => {
        client.disconnect();
        resolve(true);
      });
      client.on('error', () => {
        client.disconnect();
        resolve(false);
      });
    });

    if (isRedisAvailable) {
      console.log(`[Queue Manager] Redis is available. Initializing BullMQ with concurrency ${CONCURRENCY}...`);
      
      gradleBuildQueue = new Queue('gradle-builds', {
        connection: new Redis(connectionConfig)
      });
      
      queueEvents = new QueueEvents('gradle-builds', {
        connection: new Redis(connectionConfig)
      });

      worker = new Worker('gradle-builds', async (job) => {
        console.log(`[Queue Worker] Starting Gradle build for Job ${job.id} (${job.data.appName})`);
        const resultPath = await buildAPK(job.data);
        if (!resultPath) {
          throw new Error('APK build failed or was skipped (check build-utils logs)');
        }
        return resultPath;
      }, {
        connection: new Redis(connectionConfig),
        concurrency: CONCURRENCY
      });

      worker.on('failed', (job, err) => {
        console.error(`[Queue Worker] Job ${job ? job.id : 'unknown'} failed:`, err.message);
      });

      useRedis = true;
    } else {
      console.warn(`[Queue Manager] Redis is NOT available. Falling back to local in-memory queue with concurrency ${CONCURRENCY}...`);
    }
  } catch (error) {
    console.error('[Queue Manager] Failed to initialize Redis queue:', error.message);
    console.warn(`[Queue Manager] Falling back to local in-memory queue with concurrency ${CONCURRENCY}...`);
  }
}

// Perform initialization immediately
await initQueue();

// Helper to wait for BullMQ job completion
function waitForJob(jobId) {
  return new Promise((resolve, reject) => {
    if (!queueEvents) {
      return reject(new Error('QueueEvents not initialized'));
    }

    const onCompleted = ({ jobId: completedId, returnvalue }) => {
      if (completedId === jobId) {
        cleanup();
        resolve(returnvalue);
      }
    };

    const onFailed = ({ jobId: failedId, failedReason }) => {
      if (failedId === jobId) {
        cleanup();
        reject(new Error(failedReason || 'Build failed in background worker'));
      }
    };

    const cleanup = () => {
      queueEvents.off('completed', onCompleted);
      queueEvents.off('failed', onFailed);
    };

    queueEvents.on('completed', onCompleted);
    queueEvents.on('failed', onFailed);
  });
}

export async function queueGradleBuild(params) {
  if (useRedis) {
    console.log(`[Queue Manager] Queueing build ${params.buildId} via BullMQ`);
    // Add job to BullMQ
    const job = await gradleBuildQueue.add('build', params, {
      jobId: params.buildId,
      removeOnComplete: true,
      removeOnFail: true
    });
    
    // Wait for the worker to process and complete/fail the job
    return await waitForJob(job.id);
  } else {
    console.log(`[Queue Manager] Queueing build ${params.buildId} via LocalQueue`);
    return await localQueue.add(() => buildAPK(params));
  }
}
