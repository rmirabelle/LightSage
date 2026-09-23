import { audioLevel } from './audio-level.js';

export function musicControls({value, allowed, select, request, alert, changed, ready}) {
  let session, generation = 0, starting = false, sensitivity = 50;
  const $ = id => document.getElementById(id);
  const controls = ['', 'bulb-'].map(prefix => ({prefix,get:name=>$(`${prefix}music-${name}`)}));
  const paint = level => {
    for (const {get} of controls) {
      get('meter').value = level;
      get('meter').setAttribute('aria-valuetext', `${Math.round(level*100)} percent`);
    }
  };
  function release(current) {
    cancelAnimationFrame(current.frame);
    current.stream?.getTracks().forEach(track=>track.stop());
    void current.context?.close().catch(()=>{});
    void current.wake?.release().catch(()=>{});
  }
  async function stop(notify = true) {
    generation++; starting = false;
    const current = session; session = undefined;
    if (current) release(current);
    paint(0); changed(); render();
    if (notify && current?.token) {
      try { await request('/api/music/stop',{token:current.token}); }
      catch { /* The controller also expires a silent microphone session. */ }
    }
  }
  async function send(current) {
    if (session !== current || current.sending || !current.token) return;
    current.sending = true;
    const level = current.level;
    try {
      const result = await request('/api/music/frame',{token:current.token,sequence:++current.sequence,level});
      if (session !== current) return;
      if (!result.bulbs) throw Error(result.errors?.join('\n') || 'No lights are responding to Music.');
      if (result.errors?.length && !current.warned) { current.warned = true; alert(result.errors.join('\n'),'Music'); }
    } catch (error) {
      if (session === current) { await stop(); alert(error.message,'Music stopped'); }
    } finally { current.sending = false; }
  }
  async function start(prefix) {
    const target = value(prefix);
    if (!allowed(target) || starting) return;
    if (window.lightSageDesktop) { alert('Open Music on your iPhone to use its microphone.','Phone microphone'); return; }
    if (!navigator.mediaDevices?.getUserMedia) { alert('Microphone access requires the secure HTTPS address on your iPhone.','Microphone unavailable'); return; }
    await stop();
    const version = ++generation;
    starting = true;
    const current = {target:target.id,sequence:0,level:0,sending:false};
    session = current; select(target.id); render();
    try {
      const Context = window.AudioContext || window.webkitAudioContext;
      current.context = new Context({latencyHint:'interactive'});
      const resume = current.context.resume();
      void resume.catch(()=>{});
      const stream = await navigator.mediaDevices.getUserMedia({audio:{echoCancellation:false,noiseSuppression:false,autoGainControl:false},video:false});
      if (version !== generation) { stream.getTracks().forEach(track=>track.stop()); return; }
      current.stream = stream;
      await resume;
      const source = current.context.createMediaStreamSource(stream);
      const analyser = current.context.createAnalyser(); analyser.fftSize = 1024;
      source.connect(analyser);
      // No connection to speakers and no MediaRecorder: sound stays on this phone.
      const samples = new Float32Array(analyser.fftSize);
      let last = performance.now(), sentAt = 0;
      const measure = now => {
        if (session !== current) return;
        analyser.getFloatTimeDomainData(samples);
        current.level = audioLevel(samples,sensitivity,current.level,now-last); last=now;
        paint(current.level); // Always local; never waits for network or bulbs.
        if (now-sentAt >= 50) { sentAt=now; void send(current); }
        current.frame=requestAnimationFrame(measure);
      };
      current.frame=requestAnimationFrame(measure);
      for (const track of stream.getTracks()) track.onended=()=>{if(session===current){void stop();alert('The phone microphone stopped. Tap Music to listen again.','Microphone stopped');}};
      await ready();
      if (version !== generation) return;
      const response = await request('/api/music/start',{target:target.id});
      if (version !== generation) { void request('/api/music/stop',{token:response.token}).catch(()=>{}); return; }
      current.token=response.token;
      if (navigator.wakeLock) {
        navigator.wakeLock.request('screen').then(wake=>{if(session===current) current.wake=wake;else void wake.release();}).catch(()=>{});
      }
      starting=false; changed(); render();
    } catch (error) {
      if (version !== generation) return;
      await stop();
      alert(error.name==='NotAllowedError' ? 'Allow microphone access for LightSage, then tap Music again.' : error.message,'Microphone');
    }
  }
  function render() {
    for (const {prefix,get} of controls) {
      const target=value(prefix), active=!!session && session.target===target?.id;
      get('listen').textContent=active ? 'Stop listening' : 'Use phone microphone';
      get('listen').disabled=!active && (!allowed(target) || starting);
      get('status').textContent=active ? starting ? 'Connecting lights…' : 'Listening on this phone' : window.lightSageDesktop ? 'Start Music on your iPhone.' : 'Keep LightSage open while listening.';
      get('sensitivity').value=sensitivity; get('sensitivity-value').value=`${sensitivity}%`;
    }
  }
  for (const {prefix,get} of controls) {
    get('mode').onclick=()=>void start(prefix);
    get('listen').onclick=()=>session?.target===value(prefix)?.id ? void stop() : void start(prefix);
    get('sensitivity').oninput=event=>{sensitivity=Number(event.target.value);render();};
  }
  document.addEventListener('visibilitychange',()=>{if(document.hidden) void stop();});
  window.addEventListener('pagehide',()=>{void stop();});
  return {render,stop,get active(){return !!session;},get target(){return session?.target;}};
}
