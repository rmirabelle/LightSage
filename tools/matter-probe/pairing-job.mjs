export class PairingJob {
  status = { state: 'idle' };
  constructor(lighting, { timeoutMs = 20000, onTimeout = () => {} } = {}) {
    this.lighting = lighting;
    this.timeoutMs = timeoutMs;
    this.onTimeout = onTimeout;
  }
  start(input) {
    if (this.status.state === 'pairing' || this.status.recovering) throw new Error('A light is already being paired or the controller is recovering.');
    const validated = this.lighting.pairInput(input);
    const startedAt = new Date().toISOString();
    this.status = { state: 'pairing', message: 'Searching the local network and pairing…', startedAt };
    let settled = false;
    let stage = 'Waiting for earlier controller work';
    const progress = value => {
      if (settled) return;
      stage = value;
      this.status.stage = stage;
      console.log(`Pairing stage: ${stage}`);
    };
    progress(stage);
    const timer = setTimeout(() => {
      settled = true;
      this.status = { state: 'failed', recovering: true, startedAt, stage,
        message: `Pairing timed out during: ${stage}. The controller is restarting to recover. Check the lights list for a newly added light before retrying.` };
      console.warn(`Pairing deadline reached during: ${stage}`);
      void Promise.resolve().then(() => this.onTimeout(this.status)).catch(error => console.error('Pairing recovery failed:', error.message));
    }, this.timeoutMs);
    void this.lighting.serial(() => {
      if (settled) throw new Error('Pairing expired before it could start.');
      return this.lighting.pair(validated, progress);
    }).then(
      result => {
        if (settled) return;
        settled = true; clearTimeout(timer);
        this.status = { state: 'succeeded', startedAt, ...result, message: 'Light paired. You can now identify it or edit its room.' };
      },
      error => {
        if (settled) return;
        settled = true; clearTimeout(timer);
        this.status = { state: 'failed', startedAt, stage, message: `${error.message} Stage: ${stage}.` };
      },
    );
    return this.status;
  }
}
