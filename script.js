'use strict';
const synthSettings = {
  detune: 0, portamento: 0.05,
  envelope: { attack: 0.05, attackCurve: 'exponential', decay: 0.2,
    decayCurve: 'exponential', sustain: 0.2, release: 1.5, releaseCurve: 'exponential' },
  oscillator: { type: 'triangle', phase: 0 },
};
const waveTypes = ['triangle', 'sine', 'square', 'sawtooth'];
const notes = [['C4', 'Eb4', 'G4', 'Bb4', 'G4', 'Eb4', 'F4', 'G4'],
  ['C2', 'C2', 'Eb2', 'Eb2', 'Ab1', 'Ab1', 'Bb1', 'Bb1']];
const drumNames = ['KICK', 'SNARE', 'HAT', 'CLAP'];
const stepCount = 11;
const defaultHits = [[0, 3, 7, 10], [0, 4, 7, 10], [1, 4, 8, 10], [0, 6, 9]];
const effectNames = ['DELAY', 'REVERB', 'DISTORTION', 'CHORUS'];
const $ = selector => document.querySelector(selector);
const $$ = selector => [...document.querySelectorAll(selector)];
const status = message => { $('#status').textContent = message; };
const db = value => value <= 0 ? -Infinity : 20 * Math.log10(value / 100);
const state = {
  voices: [{ wave: 'triangle', coloredWaves: [], volume: 17, pan: -0.45 }, { wave: 'sine', coloredWaves: [], volume: 45, pan: 0.45 }],
  drums: defaultHits.map(hits => Array.from({ length: stepCount }, (_, n) => hits.includes(n))),
  effects: [18, 24, 12, 20].map(amount => ({ amount, enabled: false })),
};
let audio, readyPromise, busy = false, visualGeneration = 0;
function renderControls() {
  $$('.voice').forEach((panel, i) => {
    const voice = state.voices[i];
    panel.querySelectorAll('.wave').forEach(button => {
      button.setAttribute('aria-pressed', button.dataset.wave === voice.wave);
      button.classList.toggle('is-colored', voice.coloredWaves.includes(button.dataset.wave));
    });
    const input = panel.querySelector('.volume');
    input.value = voice.volume;
    input.style.setProperty('--fill', `${(input.offsetWidth - 12) * voice.volume / 100}px`);
  });
  $$('.drum-row').forEach((row, i) => row.querySelectorAll('.step').forEach((button, n) => button.setAttribute('aria-pressed', state.drums[i][n])));
  $$('.effect-toggle').forEach((button, i) => button.setAttribute('aria-pressed', state.effects[i].enabled));
}
function applyAudio() {
  if (!audio) return;
  state.voices.forEach((voice, i) => {
    audio.synths[i].set({ oscillator: { type: voice.wave } });
    audio.voiceChannels[i].volume.rampTo(db(voice.volume), 0.04);
  });
  state.effects.forEach((fx, i) => audio.effects[i].wet.rampTo(fx.enabled ? fx.amount / 100 : 0, 0.04));
}
async function initWebAudio() {
  if (!window.Tone) throw new Error('Tone.js не загрузился.');
  await Tone.start();
  if (!readyPromise) readyPromise = createInstrument().catch(error => { readyPromise = undefined; throw error; });
  return readyPromise;
}
async function createInstrument() {
  const transport = Tone.getTransport();
  transport.bpm.value = 108;
  const delay = new Tone.PingPongDelay({ delayTime: '8n.', feedback: 0.28, wet: 0.18 });
  const reverb = new Tone.Reverb({ decay: 2.4, preDelay: 0.025, wet: 0.24 });
  const distortion = new Tone.Distortion({ distortion: 0.32, wet: 0.12 });
  const chorus = new Tone.Chorus({ frequency: 1.5, delayTime: 3.5, depth: 0.35, wet: 0.2 }).start();
  const master = new Tone.Gain(0.8);
  const limiter = new Tone.Limiter(-1).toDestination();
  const meter = new Tone.Meter({ channelCount: 2, normalRange: true, smoothing: 0.75 });
  delay.chain(reverb, distortion, chorus, master, limiter);
  limiter.connect(meter);
  const voiceChannels = state.voices.map(voice => new Tone.Channel({ volume: db(voice.volume), pan: voice.pan }).connect(delay));
  const synths = [new Tone.Synth(synthSettings), new Tone.Synth({ ...synthSettings,
    oscillator: { type: 'sine' }, envelope: { attack: 0.015, decay: 0.2, sustain: 0.3, release: 0.4 } })];
  synths.forEach((synth, i) => synth.connect(voiceChannels[i]));
  const drumChannels = [0, -0.12, 0.5, -0.4].map((pan, i) => new Tone.Channel({ pan, volume: [-8, -16, -24, -20][i] }).connect(delay));
  const drums = [
    new Tone.MembraneSynth({ pitchDecay: 0.035, octaves: 6, envelope: { attack: 0.001, decay: 0.3, sustain: 0, release: 0.1 } }),
    new Tone.NoiseSynth({ noise: { type: 'white' }, envelope: { attack: 0.001, decay: 0.14, sustain: 0, release: 0.04 } }),
    new Tone.MetalSynth({ frequency: 250, harmonicity: 5.1, modulationIndex: 32, resonance: 4000, octaves: 1.5,
      envelope: { attack: 0.001, decay: 0.045, release: 0.015 } }),
    new Tone.NoiseSynth({ noise: { type: 'pink' }, envelope: { attack: 0.008, decay: 0.12, sustain: 0, release: 0.04 } }),
  ];
  drums.forEach((drum, i) => drum.connect(drumChannels[i]));
  audio = { transport, effects: [delay, reverb, distortion, chorus], master, limiter, meter, synths, voiceChannels, drums, drumChannels };
  await reverb.ready;
  audio.voiceSequences = synths.map((synth, i) => new Tone.Sequence((time, note) => {
    synth.triggerAttackRelease(note, i === 0 ? '16n' : '8n', time, i === 0 ? 0.65 : 0.8);
  }, notes[i], '8n').start(0));
  audio.drumSequence = new Tone.Sequence((time, step) => {
    state.drums.forEach((pattern, i) => { if (pattern[step]) triggerDrum(i, time); });
    const generation = visualGeneration;
    Tone.getDraw().schedule(() => {
      if (generation === visualGeneration && transport.state === 'started') showStep(step);
    }, time);
  }, Array.from({ length: stepCount }, (_, n) => n), '16n').start(0);
  applyAudio(); updateMeters();
}
function triggerDrum(i, time = Tone.now()) {
  if (i === 0) audio.drums[i].triggerAttackRelease('C1', '16n', time, 0.9);
  else if (i === 2) audio.drums[i].triggerAttackRelease('C5', '32n', time, 0.45);
  else audio.drums[i].triggerAttackRelease('32n', time, 0.8);
}
function showStep(step) {
  $$('.drum-row').forEach(row => row.querySelectorAll('.step').forEach((button, n) => button.classList.toggle('current', n === step)));
}
function updateMeters() {
  const values = audio.meter.getValue();
  ['#meter-l', '#meter-r'].forEach((selector, i) => { $(selector).style.width = `${Math.min(100, Math.max(0, values[i] * 260))}%`; });
  requestAnimationFrame(updateMeters);
}
function syncPlay() {
  const playing = audio?.transport.state === 'started';
  $('#play').setAttribute('aria-pressed', !!playing);
  $('#play').setAttribute('aria-label', playing ? 'Пауза' : 'Начать воспроизведение');
  $('#play-icon').classList.toggle('paused-icon', playing);
}
async function togglePlay() {
  if (busy) return;
  busy = true; $('#play').disabled = true;
  try {
    await initWebAudio();
    if (audio.transport.state === 'started') {
      audio.transport.pause(); visualGeneration++; audio.synths.forEach(synth => synth.triggerRelease()); status('Пауза.');
    } else { audio.transport.start(); status('Паттерн играет.'); }
    syncPlay();
  } catch (error) { console.error(error); status(`Не удалось включить звук: ${error.message}`); }
  finally { busy = false; $('#play').disabled = false; }
}
function stopPlayback() {
  if (busy) return;
  visualGeneration++;
  if (audio) { audio.transport.stop(); audio.synths.forEach(synth => synth.triggerRelease()); }
  $$('.current').forEach(element => element.classList.remove('current'));
  syncPlay(); status('Остановлено.');
}
function buildInterface() {
  $$('.voice').forEach((panel, i) => {
    panel.querySelector('.waves').innerHTML = waveTypes.map(type => `<button class="wave" data-wave="${type}" aria-label="${type}" title="${type}" aria-pressed="false">${type === 'sawtooth' ? 'SAW' : type.toUpperCase()}</button>`).join('');
    panel.querySelectorAll('.wave').forEach(button => button.addEventListener('click', () => {
      state.voices[i].wave = button.dataset.wave; if (!state.voices[i].coloredWaves.includes(button.dataset.wave)) state.voices[i].coloredWaves.push(button.dataset.wave); renderControls(); applyAudio();
    }));
    panel.querySelector('.volume').addEventListener('input', event => {
      state.voices[i].volume = Number(event.target.value); renderControls(); applyAudio();
    });
  });
  $('#drum-grid').innerHTML = drumNames.map(name => `<div class="drum-row"><button class="drum-name" aria-label="Сыграть ${name}">${name}</button>${Array.from({ length: stepCount }, (_, n) => `<button class="step${name === 'CLAP' && state.drums[3][n] ? ' preset-hit' : ''}" aria-pressed="false" aria-label="${name}, шаг ${n + 1}"></button>`).join('')}</div>`).join('');
  $$('.drum-row').forEach((row, i) => {
    row.querySelectorAll('.step').forEach((button, n) => button.addEventListener('click', () => {
      state.drums[i][n] = !state.drums[i][n]; button.classList.remove('preset-hit'); renderControls();
    }));
    row.querySelector('.drum-name').addEventListener('click', async event => {
      try { await initWebAudio(); triggerDrum(i); event.target.classList.add('flash'); setTimeout(() => event.target.classList.remove('flash'), 100); }
      catch (error) { status(error.message); }
    });
  });
  $('#effects').innerHTML = effectNames.map(name => `<button class="effect-toggle" aria-label="Включить или выключить ${name}" aria-pressed="false"><span>${name}</span><i aria-hidden="true"></i></button>`).join('');
  $$('.effect-toggle').forEach((button, i) => button.addEventListener('click', () => {
    state.effects[i].enabled = !state.effects[i].enabled; renderControls(); applyAudio();
  }));
  $('#play').addEventListener('click', togglePlay);
  $('#stop').addEventListener('click', stopPlayback);
}
function fitInstrumentToWindow() {
  const scale = Math.min(window.innerHeight / 1194, window.innerWidth / 1920);
  $('.instrument').style.setProperty('--instrument-scale', scale);
}
buildInterface(); renderControls(); fitInstrumentToWindow();
window.addEventListener('resize', fitInstrumentToWindow);
document.fonts.ready.then(() => {
  fitInstrumentToWindow();
  $('.instrument').classList.add('is-ready');
});
