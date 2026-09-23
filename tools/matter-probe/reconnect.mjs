// Escalate only an explicit retry. Background polling must never restart the
// service merely because a bulb is powered off. Only a supervised worker can
// safely exit: a standalone controller needs a manual restart.
export async function reconnect(lighting, ids, supervised) {
  const state = await lighting.retryBulbs(ids);
  const requested = state.lights.filter(light => ids.includes(light.id));
  const missing = requested.filter(light => !light.available);
  const restarting = supervised && missing.length > 0;
  return { ...state, recovery: {
    restarting,
    title: restarting ? 'Restarting lighting service' : missing.length ? 'Still unavailable' : 'Connection restored',
    message: restarting
      ? `The light retry did not restore ${missing.map(light => light.name).join(', ')}. Restarting the lighting service to clear stuck connections. All lights will reconnect automatically; active Music and Gradients will stop.`
      : missing.length
        ? `Still unavailable: ${missing.map(light => light.name).join(', ')}. Restart the lighting service to clear stuck connections, then retry.`
        : `Fresh state confirmed for ${requested.map(light => light.name).join(', ')}.`,
  } };
}
