export function audioLevel(samples, sensitivity = 50, previous = 0, elapsedMs = 16) {
  let sum = 0;
  for (const sample of samples) sum += sample * sample;
  const rms = Math.sqrt(sum / Math.max(1, samples.length));
  const gain = 10 ** ((sensitivity - 50) / 35) * 8;
  const desired = Math.min(1, Math.max(0, (rms - 0.002) * gain));
  // Fast attack, short release: beats appear immediately without noisy flicker.
  return desired >= previous ? desired : desired + (previous - desired) * Math.exp(-elapsedMs / 90);
}
