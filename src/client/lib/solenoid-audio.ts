/**
 * Sintetizador de Áudio IoT via Web Audio API (ADR-004 / RF12 / RF13)
 * Responsável Exclusivo: Dev 1 (Frontend — Card FE-04)
 *
 * Gera o som mecânico de destravamento da trava solenoide ("Clack metálico + Zumbido 60Hz")
 * diretamente no navegador do Projetor, sem depender de arquivos .mp3 externos.
 */

let sharedAudioCtx: AudioContext | null = null;

function getAudioContext(): AudioContext | null {
  if (typeof window === 'undefined') return null;
  if (!sharedAudioCtx) {
    const AudioCtxClass =
      window.AudioContext ||
      (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    if (AudioCtxClass) {
      sharedAudioCtx = new AudioCtxClass();
    }
  }
  if (sharedAudioCtx && sharedAudioCtx.state === 'suspended') {
    void sharedAudioCtx.resume();
  }
  return sharedAudioCtx;
}

/**
 * Desbloqueia a política de Autoplay do navegador quando o apresentador clica em "Ativar Som"
 */
export function unlockBrowserAudio(): boolean {
  const ctx = getAudioContext();
  if (!ctx) return false;
  playSolenoidUnlockSound();
  return true;
}

/**
 * Reproduz o som de destravamento mecânico da fechadura solenoide (RF12)
 * // TODO: [FE-04] Dev 1 pode refinar os harmônicos ou adicionar feedback visual sincronizado.
 */
export function playSolenoidUnlockSound(): void {
  const ctx = getAudioContext();
  if (!ctx) return;

  const now = ctx.currentTime;

  // 1. Impacto metálico inicial do pino da solenoide ("CLACK!")
  const clickOsc = ctx.createOscillator();
  const clickGain = ctx.createGain();
  clickOsc.type = 'triangle';
  clickOsc.frequency.setValueAtTime(920, now);
  clickOsc.frequency.exponentialRampToValueAtTime(140, now + 0.065);

  clickGain.gain.setValueAtTime(0.8, now);
  clickGain.gain.exponentialRampToValueAtTime(0.01, now + 0.07);

  clickOsc.connect(clickGain);
  clickGain.connect(ctx.destination);
  clickOsc.start(now);
  clickOsc.stop(now + 0.075);

  // 2. Zumbido eletromagnético da bobina energizada + confirmação aguda
  const buzzOsc = ctx.createOscillator();
  const buzzGain = ctx.createGain();
  buzzOsc.type = 'sawtooth';
  buzzOsc.frequency.setValueAtTime(120, now + 0.05);
  buzzOsc.frequency.setValueAtTime(880, now + 0.18);

  buzzGain.gain.setValueAtTime(0.25, now + 0.05);
  buzzGain.gain.exponentialRampToValueAtTime(0.001, now + 0.38);

  buzzOsc.connect(buzzGain);
  buzzGain.connect(ctx.destination);
  buzzOsc.start(now + 0.05);
  buzzOsc.stop(now + 0.4);
}

/**
 * Reproduz o som físico da porta batendo e trancando (RF13)
 */
export function playDoorCloseSound(): void {
  const ctx = getAudioContext();
  if (!ctx) return;

  const now = ctx.currentTime;
  const thudOsc = ctx.createOscillator();
  const thudGain = ctx.createGain();

  thudOsc.type = 'sine';
  thudOsc.frequency.setValueAtTime(180, now);
  thudOsc.frequency.exponentialRampToValueAtTime(45, now + 0.14);

  thudGain.gain.setValueAtTime(0.7, now);
  thudGain.gain.exponentialRampToValueAtTime(0.01, now + 0.15);

  thudOsc.connect(thudGain);
  thudGain.connect(ctx.destination);
  thudOsc.start(now);
  thudOsc.stop(now + 0.16);
}
