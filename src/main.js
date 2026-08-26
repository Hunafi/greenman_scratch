import QRCode from 'qrcode';
import { createIcons, Pointer } from 'lucide';
import './styles.css';

createIcons({
  icons: { Pointer },
  attrs: {
    'stroke-width': 2.2,
  },
});

const crop = {
  left: 0.293,
  top: 0.426,
  width: 0.418,
  height: 0.367,
};

const canvas = document.querySelector('#scratch-canvas');
const context = canvas.getContext('2d', { willReadFrequently: true });
const image = document.querySelector('#garden-photo');
const zone = document.querySelector('#scratch-zone');
const stage = document.querySelector('#scratch-stage');
const status = document.querySelector('#scratch-status');
const progressBar = document.querySelector('#progress-bar');
const progressWrap = document.querySelector('.progress-wrap');
const rewardActions = document.querySelector('#reward-actions');
const revealButton = document.querySelector('#reveal-accessible');
const resetButton = document.querySelector('#reset-scratch');
const soundToggle = document.querySelector('#sound-toggle');
const startButton = document.querySelector('#start-scratch');
const rewardDialog = document.querySelector('#reward-dialog');
const dialogClose = document.querySelector('#dialog-close');
const dialogContinue = document.querySelector('#dialog-continue');
const demoCodeValue = document.querySelector('#demo-code-value');
const copyCodeButton = document.querySelector('#copy-code');

let drawing = false;
let revealed = false;
let lastPoint = null;
let lastSoundAt = 0;
let lastHapticAt = 0;
let lastProgressAt = 0;
let soundEnabled = true;
let audioContext = null;
let noiseBuffer = null;
let lastDemoCode = '';
let rewardDialogTimer = null;

function getPixelRatio() {
  return Math.min(window.devicePixelRatio || 1, 2);
}

function sizeCanvas() {
  if (!image.naturalWidth || !zone.clientWidth || revealed) return;

  const ratio = getPixelRatio();
  canvas.width = Math.round(zone.clientWidth * ratio);
  canvas.height = Math.round(zone.clientHeight * ratio);
  canvas.style.width = `${zone.clientWidth}px`;
  canvas.style.height = `${zone.clientHeight}px`;

  context.setTransform(ratio, 0, 0, ratio, 0, 0);
  context.globalCompositeOperation = 'source-over';
  context.clearRect(0, 0, zone.clientWidth, zone.clientHeight);
  context.drawImage(
    image,
    image.naturalWidth * crop.left,
    image.naturalHeight * crop.top,
    image.naturalWidth * crop.width,
    image.naturalHeight * crop.height,
    0,
    0,
    zone.clientWidth,
    zone.clientHeight,
  );
  context.globalCompositeOperation = 'destination-out';
  context.lineCap = 'round';
  context.lineJoin = 'round';
  context.lineWidth = Math.max(34, zone.clientWidth * 0.13);
  zone.classList.add('is-ready');
}

function pointFromEvent(event) {
  const rect = canvas.getBoundingClientRect();
  return {
    x: event.clientX - rect.left,
    y: event.clientY - rect.top,
  };
}

function ensureAudio() {
  if (!soundEnabled) return;
  if (!audioContext) {
    const AudioContext = window.AudioContext || window.webkitAudioContext;
    if (!AudioContext) return;
    audioContext = new AudioContext();
    const frameCount = Math.floor(audioContext.sampleRate * 0.11);
    noiseBuffer = audioContext.createBuffer(1, frameCount, audioContext.sampleRate);
    const channel = noiseBuffer.getChannelData(0);
    for (let i = 0; i < frameCount; i += 1) {
      const envelope = 1 - i / frameCount;
      channel[i] = (Math.random() * 2 - 1) * envelope;
    }
  }
  if (audioContext.state === 'suspended') audioContext.resume();
}

function playScratchSound() {
  const now = performance.now();
  if (!soundEnabled || !audioContext || !noiseBuffer || now - lastSoundAt < 55) return;
  lastSoundAt = now;

  const source = audioContext.createBufferSource();
  const filter = audioContext.createBiquadFilter();
  const gain = audioContext.createGain();
  filter.type = 'bandpass';
  filter.frequency.value = 1800 + Math.random() * 700;
  filter.Q.value = 0.7;
  gain.gain.setValueAtTime(0.0001, audioContext.currentTime);
  gain.gain.exponentialRampToValueAtTime(0.07, audioContext.currentTime + 0.008);
  gain.gain.exponentialRampToValueAtTime(0.0001, audioContext.currentTime + 0.09);
  source.buffer = noiseBuffer;
  source.playbackRate.value = 0.82 + Math.random() * 0.32;
  source.connect(filter).connect(gain).connect(audioContext.destination);
  source.start();
  source.stop(audioContext.currentTime + 0.11);
}

function scratchAt(point) {
  if (revealed) return;
  context.beginPath();
  if (lastPoint) context.moveTo(lastPoint.x, lastPoint.y);
  else context.moveTo(point.x, point.y);
  context.lineTo(point.x, point.y);
  context.stroke();
  lastPoint = point;
  playScratchSound();

  const now = performance.now();
  if (now - lastProgressAt > 130) {
    updateProgress();
    lastProgressAt = now;
  }
  if ('vibrate' in navigator && now - lastHapticAt > 110) {
    navigator.vibrate(7);
    lastHapticAt = now;
  }
}

function erasedPercentage() {
  const ratio = getPixelRatio();
  const pixels = context.getImageData(0, 0, canvas.width, canvas.height).data;
  const stride = Math.max(4, Math.round(10 * ratio)) * 4;
  let transparent = 0;
  let sampled = 0;

  for (let i = 3; i < pixels.length; i += stride) {
    if (pixels[i] < 80) transparent += 1;
    sampled += 1;
  }
  return sampled ? (transparent / sampled) * 100 : 0;
}

function setProgress(percent) {
  const safePercent = Math.min(100, Math.max(0, percent));
  progressBar.style.width = `${safePercent}%`;
  progressWrap.style.setProperty('--progress', `${safePercent}%`);
}

function generateDemoCode() {
  const letters = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
  const digits = '23456789';
  let code = '';
  do {
    const randomValues = new Uint32Array(8);
    if (globalThis.crypto?.getRandomValues) crypto.getRandomValues(randomValues);
    else randomValues.forEach((_, index) => { randomValues[index] = Math.floor(Math.random() * 2 ** 32); });

    const characters = [
      letters[randomValues[0] % letters.length],
      letters[randomValues[1] % letters.length],
      letters[randomValues[2] % letters.length],
      digits[randomValues[3] % digits.length],
    ];

    for (let index = characters.length - 1; index > 0; index -= 1) {
      const swapIndex = randomValues[4 + index] % (index + 1);
      [characters[index], characters[swapIndex]] = [characters[swapIndex], characters[index]];
    }
    code = characters.join('');
  } while (code === lastDemoCode);
  lastDemoCode = code;
  return code;
}

function openRewardDialog() {
  demoCodeValue.textContent = generateDemoCode();
  copyCodeButton.textContent = 'Kód másolása';
  document.body.classList.add('dialog-open');
  if (!rewardDialog.open) rewardDialog.showModal();
}

function closeRewardDialog() {
  if (rewardDialog.open) rewardDialog.close();
  document.body.classList.remove('dialog-open');
}

function updateProgress(allowReveal = true) {
  if (revealed) return;
  const percent = Math.min(100, erasedPercentage());
  setProgress(percent);
  if (percent > 44 && allowReveal) revealReward();
  else if (percent > 22) status.textContent = 'Már majdnem megvan… kaparj még egy kicsit!';
  else if (percent > 3) status.textContent = 'Jól haladsz — folytasd a kaparást!';
}

function revealReward() {
  if (revealed) return;
  revealed = true;
  drawing = false;
  stage.classList.add('is-revealed');
  canvas.style.pointerEvents = 'none';
  setProgress(100);
  status.textContent = 'Megtaláltad: −15% kedvezmény!';
  revealButton.hidden = true;
  rewardActions.hidden = false;

  if ('vibrate' in navigator) navigator.vibrate([25, 45, 55]);
  window.clearTimeout(rewardDialogTimer);
  rewardDialogTimer = window.setTimeout(openRewardDialog, 520);
}

function resetScratch() {
  revealed = false;
  stage.classList.remove('is-revealed');
  canvas.style.pointerEvents = '';
  setProgress(0);
  status.textContent = 'A címke még érintetlen.';
  revealButton.hidden = false;
  rewardActions.hidden = true;
  window.clearTimeout(rewardDialogTimer);
  closeRewardDialog();
  sizeCanvas();
  canvas.focus({ preventScroll: true });
}

canvas.addEventListener('pointerdown', (event) => {
  if (revealed) return;
  ensureAudio();
  drawing = true;
  lastPoint = pointFromEvent(event);
  scratchAt(lastPoint);
  event.preventDefault();
});

canvas.addEventListener('pointermove', (event) => {
  if (!drawing || revealed) return;
  scratchAt(pointFromEvent(event));
  event.preventDefault();
});

function stopDrawing(event) {
  if (!drawing) return;
  drawing = false;
  lastPoint = null;
  updateProgress();
}

canvas.addEventListener('pointerup', stopDrawing);
canvas.addEventListener('pointercancel', stopDrawing);
window.addEventListener('pointerup', stopDrawing);
window.addEventListener('pointercancel', stopDrawing);
canvas.addEventListener('keydown', (event) => {
  if (event.key === 'Enter' || event.key === ' ') {
    event.preventDefault();
    revealReward();
  }
});

soundToggle.addEventListener('click', () => {
  soundEnabled = !soundEnabled;
  soundToggle.setAttribute('aria-pressed', String(soundEnabled));
  const soundLabel = soundEnabled ? 'Hang bekapcsolva' : 'Hang kikapcsolva';
  soundToggle.setAttribute('aria-label', soundLabel);
  soundToggle.querySelector('span').textContent = soundLabel;
  soundToggle.classList.toggle('is-muted', !soundEnabled);
  if (soundEnabled) ensureAudio();
});

startButton.addEventListener('click', () => {
  canvas.focus({ preventScroll: true });
  stage.scrollIntoView({ behavior: 'smooth', block: 'center' });
});

revealButton.addEventListener('click', revealReward);
resetButton.addEventListener('click', resetScratch);
dialogClose.addEventListener('click', closeRewardDialog);
dialogContinue.addEventListener('click', closeRewardDialog);
rewardDialog.addEventListener('close', () => document.body.classList.remove('dialog-open'));
rewardDialog.addEventListener('click', (event) => {
  if (event.target === rewardDialog) closeRewardDialog();
});
copyCodeButton.addEventListener('click', async () => {
  try {
    await navigator.clipboard.writeText(demoCodeValue.textContent);
    copyCodeButton.textContent = 'Másolva ✓';
  } catch {
    copyCodeButton.textContent = 'Jelöld ki a kódot';
  }
});

if (image.complete) sizeCanvas();
else image.addEventListener('load', sizeCanvas, { once: true });

const resizeObserver = new ResizeObserver(() => {
  window.clearTimeout(resizeObserver.timer);
  resizeObserver.timer = window.setTimeout(sizeCanvas, 100);
});
resizeObserver.observe(zone);

const qrCanvas = document.querySelector('#qr-code');
const qrTarget = new URL('/', window.location.origin).href;
QRCode.toCanvas(qrCanvas, qrTarget, {
  width: 288,
  margin: 2,
  color: {
    dark: '#062b17',
    light: '#ffffff',
  },
  errorCorrectionLevel: 'H',
}).catch(() => {
  qrCanvas.setAttribute('aria-label', 'A QR-kód nem tölthető be.');
});
