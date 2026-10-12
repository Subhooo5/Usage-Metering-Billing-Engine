const { pool } = require('../db/pool');
const jobsRepo = require('../db/jobs');
const alertsRepo = require('../db/alerts');
const handlers = require('./handlers');
const { log } = require('../logger');

async function runOnce() {
  const job = await jobsRepo.claimNext(pool);
  if (!job) {
    return false;
  }

  try {
    const handler = handlers[job.type];
    if (!handler) {
      throw new Error(`No handler for job type ${job.type}`);
    }
    await handler(job.payload);
    await jobsRepo.markDone(pool, job.id);
    log({ event: 'job_done', jobId: job.id, type: job.type, attempt: job.attempts });
  } 
  catch (error) {
    if (job.attempts >= job.max_attempts) {
      await jobsRepo.markFailed(pool, job.id, error.message);
      await alertsRepo.raise(pool, {
        kind: 'job_failed',
        message: `Job ${job.id} of type ${job.type} failed after ${job.attempts} attempts`,
        details: { jobId: job.id, type: job.type, error: error.message }
      });
      log({ event: 'ALERT_job_failed', jobId: job.id, type: job.type, error: error.message });
    } 
    else {
      const delaySeconds = 2 ** job.attempts;
      await jobsRepo.markRetry(pool, job.id, error.message, delaySeconds);
      log({ event: 'job_retry', jobId: job.id, type: job.type, attempt: job.attempts, delaySeconds });
    }
  }
  return true;
}

function startWorker(intervalMs) {
  let running = false;
  const timer = setInterval(async () => {
    if (running) {
      return;
    }
    running = true;
    
    try {
      while (await runOnce()) {}
    } 
    catch (error) {
      log({ event: 'worker_error', message: error.message });
    } 
    finally {
      running = false;
    }
  }, intervalMs);
  return () => clearInterval(timer);
}

module.exports = { runOnce, startWorker };