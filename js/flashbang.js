// Easter egg: the first time you ever switch to light mode, someone throws a
// flashbang into the room. Fires once per device, never when the visitor has
// asked for reduced motion, and cleans up after itself.

const RING = true; // set false to make it a silent flashbang

const GRENADE = `
<svg class="fb-nade" viewBox="0 0 64 88" width="64" height="88" aria-hidden="true">
  <defs>
    <linearGradient id="fb-body" x1="0" y1="0" x2="1" y2="0">
      <stop offset="0" stop-color="#8f948f"/>
      <stop offset=".38" stop-color="#e9ebe6"/>
      <stop offset=".72" stop-color="#c3c7c0"/>
      <stop offset="1" stop-color="#7c817c"/>
    </linearGradient>
    <linearGradient id="fb-cap" x1="0" y1="0" x2="1" y2="0">
      <stop offset="0" stop-color="#3a3d44"/>
      <stop offset=".45" stop-color="#5c616b"/>
      <stop offset="1" stop-color="#31343a"/>
    </linearGradient>
  </defs>
  <rect x="17" y="26" width="30" height="52" rx="9" fill="url(#fb-body)"/>
  <rect x="17" y="38" width="30" height="5" fill="#6d726d" opacity=".55"/>
  <rect x="17" y="62" width="30" height="5" fill="#6d726d" opacity=".55"/>
  <rect x="21" y="14" width="22" height="15" rx="4" fill="url(#fb-cap)"/>
  <path d="M43 16c6 1 8 5 7 10l-3 26c-.4 3-4 3-4 0l1-27c.2-4-1.6-6-4-6.6z" fill="#b9bdb8" stroke="#6f746f" stroke-width="1"/>
  <circle cx="17" cy="16" r="6" fill="none" stroke="#b9bdb8" stroke-width="2.6"/>
  <path d="M23 15h-2" stroke="#6f746f" stroke-width="2" stroke-linecap="round"/>
</svg>`;

function bang() {
  if (!RING) return;
  try {
    const Ctx = window.AudioContext || window.webkitAudioContext;
    if (!Ctx) return;
    const ctx = new Ctx();
    const now = ctx.currentTime;

    // the pop
    const noise = ctx.createBuffer(1, ctx.sampleRate * 0.18, ctx.sampleRate);
    const data = noise.getChannelData(0);
    for (let i = 0; i < data.length; i += 1) {
      data[i] = (Math.random() * 2 - 1) * (1 - i / data.length) ** 2;
    }
    const pop = ctx.createBufferSource();
    pop.buffer = noise;
    const popGain = ctx.createGain();
    popGain.gain.value = 0.09;
    pop.connect(popGain).connect(ctx.destination);
    pop.start(now);

    // the ringing that follows you around for the rest of the round
    const ring = ctx.createOscillator();
    ring.type = 'sine';
    ring.frequency.setValueAtTime(4600, now);
    ring.frequency.exponentialRampToValueAtTime(3200, now + 2.4);
    const ringGain = ctx.createGain();
    ringGain.gain.setValueAtTime(0.0001, now);
    ringGain.gain.exponentialRampToValueAtTime(0.045, now + 0.06);
    ringGain.gain.exponentialRampToValueAtTime(0.0001, now + 2.6);
    ring.connect(ringGain).connect(ctx.destination);
    ring.start(now);
    ring.stop(now + 2.7);
    ring.onended = () => ctx.close();
  } catch { /* no audio, no problem */ }
}

/** Returns false if it declined to run, so the caller can keep its one shot. */
export function flashbang() {
  if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return false;

  const stage = document.createElement('div');
  stage.className = 'fb';
  stage.setAttribute('aria-hidden', 'true');
  stage.innerHTML = `
    <div class="fb-throw"><div class="fb-hop">${GRENADE}</div></div>
    <div class="fb-burst"></div>
    <div class="fb-white"><p class="fb-caption mono">next time, look away</p></div>`;
  document.body.append(stage);

  const detonation = setTimeout(bang, 940);
  const cleanup = setTimeout(() => stage.remove(), 4400);
  stage.addEventListener('animationcancel', () => {
    clearTimeout(detonation);
    clearTimeout(cleanup);
    stage.remove();
  });

  return true;
}
