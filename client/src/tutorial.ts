/**
 * First-run onboarding — ZIYANG PROTOCOL.
 *
 * Self-contained: injects its own <style>, builds its own DOM, and drives
 * itself from a 100ms poll over read-only accessors handed in by main.ts.
 * It never registers a keyboard listener, so it cannot fight InputManager
 * (which captures WASD / Space / R / E / 1-5 with preventDefault).
 *
 * Everything it teaches is checked against the simulation, not the docs:
 *  - extraction is automatic (stand in the zone 5s, leaving resets to 0)
 *  - crates, caches and doors are shot open — E only takes items and loot bags
 *  - pickup reach is 40px, the same radius the HUD prompt uses
 *  - pickups auto-equip a better backpack / armor, or any gun if empty-handed
 *  - death drops the whole kit, equipped slots included, and clears it from the Stash
 *
 * Progress is stored in one localStorage key so a raid, a refresh or a
 * disconnect never replays a step the player already cleared.
 */
import { t, onLocaleChange, itemName, itemDesc, hasKey } from '@ziyang-protocol/shared';

/* ------------------------------------------------------------------ */
/* Public surface                                                      */
/* ------------------------------------------------------------------ */

export type TutorialPhase = 'NAME' | 'HIDEOUT' | 'RAID' | 'RESULT';

/** Only the fields onboarding reads. Structurally satisfied by PLAYER_STATE. */
export interface TutorialPlayerView {
  x: number;
  y: number;
  hp: number;
  isSprinting?: boolean;
  extractProgress?: number;
  inventory?: { items?: ReadonlyArray<{ typeId: string; qty: number }> } | null;
  weaponRuntime?: { ammoInMag: number; reloadingUntilTick: number } | null;
}

/** Satisfied by PlayerProfile. */
export interface TutorialProfileView {
  displayName: string | null;
}

/** Satisfied by InputManager. */
export interface TutorialInputView {
  getShoot(): boolean;
  getSprintHeld(): boolean;
}

export interface TutorialHooks {
  /** Current phase, or null before the first S2C_PROFILE arrives. */
  getPhase: () => TutorialPhase | null;
  /** Server profile, or null before it arrives. */
  getProfile: () => TutorialProfileView | null;
  /** Local operator this frame (predicted or snapshot). Null outside a raid. */
  getLocalPlayer: () => TutorialPlayerView | null;
  /** Debrief payload, so the RESULT card knows extract from KIA. */
  getRaidResult?: () => { result: 'EXTRACTED' | 'DIED' } | null;
  /** InputManager, for non-destructive polling. Never call consume* here. */
  getInput?: () => TutorialInputView | null;
}

export interface TutorialController {
  /** True while a card or the field guide is on screen. */
  isActive(): boolean;
  openFieldGuide(): void;
  closeFieldGuide(): void;
  /** Wipe progress and run the whole thing again from the Hideout. */
  replay(): void;
  /** Dismiss for good. */
  skip(): void;
  destroy(): void;
}

/** localStorage key holding the JSON progress record. */
export const TUTORIAL_STORAGE_KEY = 'zp_tutorial_state';
/** Legacy flag other code may set: '1' means "never show onboarding again". */
export const TUTORIAL_DONE_KEY = 'zp_tutorial_done';

/* ------------------------------------------------------------------ */
/* Progress record                                                     */
/* ------------------------------------------------------------------ */

interface TutorialState {
  v: 1;
  /** Decided once: is this a first-run player at all. */
  armed: boolean;
  /** Set once the arm/no-arm decision has been made, so it is never redone. */
  decided: boolean;
  hubStep: number;
  raidStep: number;
  extractedSeen: boolean;
  kiaSeen: boolean;
  skipped: boolean;
}

function freshState(armed: boolean): TutorialState {
  return {
    v: 1,
    armed,
    decided: armed,
    hubStep: 0,
    raidStep: 0,
    extractedSeen: false,
    kiaSeen: false,
    skipped: false,
  };
}

function loadState(): TutorialState {
  try {
    if (localStorage.getItem(TUTORIAL_DONE_KEY) === '1') {
      const off = freshState(false);
      off.decided = true;
      off.skipped = true;
      return off;
    }
    const raw = localStorage.getItem(TUTORIAL_STORAGE_KEY);
    if (!raw) return freshState(false);
    const parsed = JSON.parse(raw) as Partial<TutorialState>;
    if (!parsed || parsed.v !== 1) return freshState(false);
    return {
      v: 1,
      armed: !!parsed.armed,
      decided: !!parsed.decided,
      hubStep: Number(parsed.hubStep) || 0,
      raidStep: Number(parsed.raidStep) || 0,
      extractedSeen: !!parsed.extractedSeen,
      kiaSeen: !!parsed.kiaSeen,
      skipped: !!parsed.skipped,
    };
  } catch {
    return freshState(false);
  }
}

function saveState(state: TutorialState): void {
  try {
    localStorage.setItem(TUTORIAL_STORAGE_KEY, JSON.stringify(state));
    if (state.skipped) localStorage.setItem(TUTORIAL_DONE_KEY, '1');
  } catch {
    /* private mode — onboarding just replays next session */
  }
}

/* ------------------------------------------------------------------ */
/* Step tables                                                         */
/* ------------------------------------------------------------------ */

/** Latched signals collected since the current step opened. */
interface Signals {
  moved: number;
  fired: boolean;
  reloaded: boolean;
  sprinted: boolean;
  pickedUp: boolean;
  atExfil: boolean;
}

interface Step {
  /** i18n prefix; `${key}.title`, `${key}.body`, optional `${key}.objective`. */
  key: string;
  /** CSS selector to ring while the step is open. Missing element = no ring. */
  highlight?: string;
  /** Auto-advance predicate. Absent = the player clicks through. */
  done?: (s: Signals) => boolean;
}

const HUB_STEPS: Step[] = [
  { key: 'tutorial.hideout.welcome' },
  { key: 'tutorial.hideout.gear', highlight: '.equipment-area' },
  { key: 'tutorial.hideout.loadout', highlight: '.layout-col-prep' },
  { key: 'tutorial.hideout.market', highlight: '#hideoutTabs [data-tab="shop"]' },
  { key: 'tutorial.hideout.deploy', highlight: '#enterRaidBtn' },
];

const RAID_STEPS: Step[] = [
  { key: 'tutorial.raid.move', done: (s) => s.moved > 120 },
  { key: 'tutorial.raid.fire', done: (s) => s.fired },
  { key: 'tutorial.raid.reload', highlight: '#weaponHud', done: (s) => s.reloaded },
  { key: 'tutorial.raid.sprint', highlight: '#staminaHud', done: (s) => s.sprinted },
  { key: 'tutorial.raid.breach' },
  { key: 'tutorial.raid.loot', done: (s) => s.pickedUp },
  { key: 'tutorial.raid.autoequip' },
  { key: 'tutorial.raid.hotbar', highlight: '#hotbarHud' },
  { key: 'tutorial.raid.extract', done: (s) => s.atExfil },
];

/** Field guide catalog. Names and descriptions come from the item tables. */
const GUIDE_SECTIONS: Array<{ key: string; items: string[] }> = [
  { key: 'medical', items: ['medkit', 'advanced_medkit', 'combat_stim', 'regeneration_serum'] },
  { key: 'ordnance', items: ['frag_grenade', 'flash_grenade', 'smoke_grenade', 'molotov'] },
  { key: 'tactical', items: ['i_disguise', 'i_sentry_turret', 'w_decoy'] },
];

/** Control rows: [action key, literal cap or cap key]. */
const CONTROL_ROWS: Array<[string, string]> = [
  ['tutorial.key.move', 'W A S D'],
  ['tutorial.key.aim', '@tutorial.cap.mouse'],
  ['tutorial.key.fire', '@tutorial.cap.lmb'],
  ['tutorial.key.reload', 'R'],
  ['tutorial.key.sprint', '@tutorial.cap.space'],
  ['tutorial.key.pickup', 'E'],
  ['tutorial.key.hotbar', '1 – 5'],
  ['tutorial.key.throw', '@tutorial.cap.throw'],
  ['tutorial.key.panel', 'F1'],
  ['tutorial.key.music', 'M / N'],
  ['tutorial.key.chat', '/'],
];

const RULE_KEYS = [
  'tutorial.guide.rule.extract',
  'tutorial.guide.rule.breach',
  'tutorial.guide.rule.reach',
  'tutorial.guide.rule.autoequip',
  'tutorial.guide.rule.death',
  'tutorial.guide.rule.armor',
  'tutorial.guide.rule.refresh',
];

/* ------------------------------------------------------------------ */
/* Styles                                                              */
/* ------------------------------------------------------------------ */

const STYLE_ID = 'zpTutorialStyle';

const CSS = `
#zpTutorialRoot {
  position: fixed;
  inset: 0;
  z-index: 99998;
  pointer-events: none;
  font-family: var(--font-ui, 'Rajdhani', sans-serif);
  color: #e8eef0;
}
#zpTutorialRoot[hidden] { display: none; }

.zpt-card {
  position: fixed;
  left: 50%;
  transform: translateX(-50%);
  width: min(520px, 88vw);
  padding: 14px 16px 12px;
  border: 1px solid rgba(120, 200, 220, 0.28);
  border-radius: 8px;
  background: rgba(10, 13, 17, 0.92);
  -webkit-backdrop-filter: blur(10px);
  backdrop-filter: blur(10px);
  box-shadow: 0 10px 30px rgba(0, 0, 0, 0.55), inset 0 0 0 1px rgba(255, 255, 255, 0.02);
  pointer-events: none;
  animation: zptRise 0.22s ease-out;
}
.zpt-card--top { top: 14px; }
.zpt-card--bottom { bottom: 26px; width: min(600px, 90vw); }

@keyframes zptRise {
  from { opacity: 0; transform: translateX(-50%) translateY(8px); }
  to   { opacity: 1; transform: translateX(-50%) translateY(0); }
}

.zpt-head {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 6px;
}
.zpt-badge {
  font-family: var(--font-mono, 'Share Tech Mono', monospace);
  font-size: 10px;
  letter-spacing: 2px;
  color: #0ff;
  border: 1px solid rgba(0, 255, 255, 0.35);
  border-radius: 3px;
  padding: 1px 6px;
  white-space: nowrap;
}
.zpt-title {
  font-family: var(--font-title, 'Orbitron', sans-serif);
  font-size: 15px;
  font-weight: 700;
  letter-spacing: 0.5px;
  color: #fff;
}
.zpt-count {
  margin-left: auto;
  font-family: var(--font-mono, 'Share Tech Mono', monospace);
  font-size: 11px;
  color: rgba(200, 220, 230, 0.5);
  white-space: nowrap;
}
.zpt-body {
  font-size: 15px;
  line-height: 1.45;
  color: rgba(225, 235, 240, 0.9);
}
.zpt-body b, .zpt-obj b { color: #0ff; font-weight: 600; }

.zpt-obj {
  margin-top: 8px;
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 13px;
  color: rgba(200, 220, 230, 0.75);
}
.zpt-obj::before {
  content: '';
  width: 7px;
  height: 7px;
  border-radius: 50%;
  background: #0ff;
  box-shadow: 0 0 8px rgba(0, 255, 255, 0.8);
  animation: zptPulse 1.4s ease-in-out infinite;
  flex: 0 0 auto;
}
@keyframes zptPulse { 0%, 100% { opacity: 1; } 50% { opacity: 0.25; } }

.zpt-foot {
  margin-top: 12px;
  padding-top: 10px;
  border-top: 1px solid rgba(120, 180, 200, 0.14);
  display: flex;
  align-items: center;
  gap: 8px;
}
.zpt-dots { display: flex; gap: 4px; margin-right: auto; }
.zpt-dot {
  width: 14px;
  height: 3px;
  border-radius: 2px;
  background: rgba(140, 180, 195, 0.22);
}
.zpt-dot.is-done { background: rgba(0, 255, 255, 0.4); }
.zpt-dot.is-now { background: #0ff; box-shadow: 0 0 6px rgba(0, 255, 255, 0.7); }

.zpt-btn {
  pointer-events: auto;
  cursor: pointer;
  font-family: var(--font-ui, 'Rajdhani', sans-serif);
  font-size: 13px;
  font-weight: 600;
  letter-spacing: 0.6px;
  padding: 6px 14px;
  border-radius: 4px;
  border: 1px solid rgba(120, 180, 200, 0.3);
  background: rgba(255, 255, 255, 0.04);
  color: rgba(220, 235, 240, 0.85);
  transition: background 0.15s ease, border-color 0.15s ease, color 0.15s ease;
}
.zpt-btn:hover { background: rgba(0, 255, 255, 0.1); border-color: rgba(0, 255, 255, 0.5); color: #fff; }
.zpt-btn--primary {
  border-color: rgba(0, 255, 255, 0.55);
  background: rgba(0, 255, 255, 0.12);
  color: #dffdff;
}
.zpt-btn--quiet {
  border-color: transparent;
  background: transparent;
  color: rgba(190, 210, 220, 0.5);
  padding: 6px 8px;
}
.zpt-btn--quiet:hover { color: #fff; background: transparent; border-color: transparent; text-decoration: underline; }

/* Highlight ring around a live UI element */
.zpt-ring {
  position: fixed;
  border: 2px solid rgba(0, 255, 255, 0.8);
  border-radius: 8px;
  pointer-events: none;
  box-shadow: 0 0 0 1px rgba(0, 0, 0, 0.4), 0 0 18px rgba(0, 255, 255, 0.35);
  animation: zptRing 1.6s ease-in-out infinite;
  transition: top 0.15s ease, left 0.15s ease, width 0.15s ease, height 0.15s ease;
}
@keyframes zptRing { 0%, 100% { opacity: 0.9; } 50% { opacity: 0.35; } }

/* Field guide launcher */
.zpt-launch {
  position: fixed;
  right: 18px;
  bottom: 18px;
  pointer-events: auto;
  cursor: pointer;
  display: flex;
  align-items: center;
  gap: 6px;
  font-family: var(--font-ui, 'Rajdhani', sans-serif);
  font-size: 13px;
  font-weight: 600;
  letter-spacing: 0.6px;
  padding: 8px 14px;
  border-radius: 20px;
  border: 1px solid rgba(120, 200, 220, 0.3);
  background: rgba(10, 13, 17, 0.88);
  -webkit-backdrop-filter: blur(8px);
  backdrop-filter: blur(8px);
  color: rgba(220, 235, 240, 0.85);
}
.zpt-launch:hover { border-color: rgba(0, 255, 255, 0.6); color: #fff; }
.zpt-launch::before { content: '?'; color: #0ff; font-family: var(--font-mono, monospace); }

/* Field guide */
.zpt-modal {
  position: fixed;
  inset: 0;
  pointer-events: auto;
  background: rgba(4, 6, 8, 0.82);
  -webkit-backdrop-filter: blur(6px);
  backdrop-filter: blur(6px);
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 24px;
  animation: zptFade 0.18s ease-out;
}
@keyframes zptFade { from { opacity: 0; } to { opacity: 1; } }

.zpt-sheet {
  width: min(860px, 100%);
  max-height: min(80vh, 720px);
  display: flex;
  flex-direction: column;
  border: 1px solid rgba(120, 200, 220, 0.25);
  border-radius: 10px;
  background: rgba(10, 13, 17, 0.97);
  box-shadow: 0 24px 60px rgba(0, 0, 0, 0.6);
  overflow: hidden;
}
.zpt-sheet-head {
  display: flex;
  align-items: baseline;
  gap: 10px;
  padding: 16px 20px 12px;
  border-bottom: 1px solid rgba(120, 180, 200, 0.16);
}
.zpt-sheet-head h2 {
  font-family: var(--font-title, 'Orbitron', sans-serif);
  font-size: 18px;
  letter-spacing: 1px;
  color: #fff;
}
.zpt-sheet-head p { font-size: 13px; color: rgba(190, 210, 220, 0.55); }
.zpt-sheet-head .zpt-btn { margin-left: auto; }

.zpt-sheet-body { padding: 4px 20px 20px; overflow-y: auto; }
.zpt-sheet-body::-webkit-scrollbar { width: 8px; }
.zpt-sheet-body::-webkit-scrollbar-thumb { background: rgba(120, 180, 200, 0.25); border-radius: 4px; }

.zpt-sec {
  font-family: var(--font-mono, 'Share Tech Mono', monospace);
  font-size: 11px;
  letter-spacing: 2px;
  color: #0ff;
  margin: 18px 0 8px;
  padding-bottom: 4px;
  border-bottom: 1px solid rgba(0, 255, 255, 0.15);
}

.zpt-keys { display: grid; grid-template-columns: repeat(auto-fill, minmax(230px, 1fr)); gap: 4px 18px; }
.zpt-keyrow { display: flex; align-items: center; gap: 10px; font-size: 14px; padding: 3px 0; }
.zpt-keyrow span:first-child {
  font-family: var(--font-mono, 'Share Tech Mono', monospace);
  font-size: 12px;
  color: #dffdff;
  background: rgba(0, 255, 255, 0.08);
  border: 1px solid rgba(0, 255, 255, 0.22);
  border-radius: 3px;
  padding: 2px 8px;
  min-width: 92px;
  text-align: center;
  white-space: nowrap;
}
.zpt-keyrow span:last-child { color: rgba(220, 235, 240, 0.8); }

.zpt-items { display: grid; grid-template-columns: repeat(auto-fill, minmax(340px, 1fr)); gap: 10px; }
.zpt-item {
  border: 1px solid rgba(120, 180, 200, 0.14);
  border-radius: 6px;
  padding: 10px 12px;
  background: rgba(255, 255, 255, 0.02);
}
.zpt-item h4 { font-size: 15px; font-weight: 700; color: #fff; margin-bottom: 3px; }
.zpt-item p { font-size: 13px; line-height: 1.4; color: rgba(210, 225, 232, 0.7); }
.zpt-tip {
  margin-top: 6px;
  font-size: 13px;
  line-height: 1.4;
  color: #ffd479;
  display: flex;
  gap: 6px;
}
.zpt-tip::before { content: '!'; font-family: var(--font-mono, monospace); color: #ffb020; }

.zpt-rules { list-style: none; display: flex; flex-direction: column; gap: 6px; }
.zpt-rules li {
  font-size: 14px;
  line-height: 1.45;
  color: rgba(220, 235, 240, 0.82);
  padding-left: 16px;
  position: relative;
}
.zpt-rules li::before { content: '▸'; position: absolute; left: 0; color: #0ff; }

@media (max-width: 640px) {
  .zpt-card { width: 94vw; }
  .zpt-launch { right: 10px; bottom: 10px; }
}
`;

/* ------------------------------------------------------------------ */
/* Implementation                                                      */
/* ------------------------------------------------------------------ */

const POLL_MS = 100;

function esc(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

/** Renders `**bold**` as an accent span; everything else is escaped. */
function rich(value: string): string {
  return esc(value).replace(/\*\*(.+?)\*\*/g, '<b>$1</b>');
}

function readQueryFlag(): 'replay' | 'guide' | 'off' | null {
  try {
    const value = new URLSearchParams(window.location.search).get('tutorial');
    if (value === '1' || value === 'replay') return 'replay';
    if (value === 'guide') return 'guide';
    if (value === '0' || value === 'off') return 'off';
  } catch {
    /* no URL access */
  }
  return null;
}

class Tutorial implements TutorialController {
  private readonly hooks: TutorialHooks;
  private state: TutorialState;

  private root: HTMLDivElement | null = null;
  private card: HTMLDivElement | null = null;
  private ring: HTMLDivElement | null = null;
  private launcher: HTMLButtonElement | null = null;
  private modal: HTMLDivElement | null = null;

  private timer: number | null = null;
  private unsubscribeLocale: (() => void) | null = null;
  private localeEpoch = 0;

  /** What the card currently shows, so we only rebuild on real changes. */
  private cardSig = '';
  private ringSelector: string | null = null;

  private signals: Signals = { moved: 0, fired: false, reloaded: false, sprinted: false, pickedUp: false, atExfil: false };
  private lastPos: { x: number; y: number } | null = null;
  private lastAmmo: number | null = null;
  private lastReloadTick = 0;
  private reloadTracked = false;
  private lastInvCount: number | null = null;
  private lastPhase: TutorialPhase | null = null;

  /** Set by ?tutorial=1 — ignores stored progress for this session. */
  private forced = false;

  constructor(hooks: TutorialHooks) {
    this.hooks = hooks;
    this.state = loadState();

    const flag = readQueryFlag();
    if (flag === 'off') {
      this.state = freshState(false);
      this.state.decided = true;
      this.state.skipped = true;
    } else if (flag === 'replay') {
      this.forced = true;
      this.state = freshState(true);
      try {
        localStorage.removeItem(TUTORIAL_DONE_KEY);
      } catch {
        /* ignore */
      }
      saveState(this.state);
    }

    this.injectStyle();
    this.mount();

    this.unsubscribeLocale = onLocaleChange(() => {
      this.localeEpoch += 1;
      this.cardSig = '';
      this.clearLauncher();
      if (this.modal) this.renderFieldGuide();
    });

    this.timer = window.setInterval(() => this.tick(), POLL_MS);
    this.tick();

    if (flag === 'guide') this.openFieldGuide();
  }

  /* ---------- DOM ---------- */

  private injectStyle(): void {
    if (document.getElementById(STYLE_ID)) return;
    const style = document.createElement('style');
    style.id = STYLE_ID;
    style.textContent = CSS;
    document.head.appendChild(style);
  }

  private mount(): void {
    const root = document.createElement('div');
    root.id = 'zpTutorialRoot';
    root.hidden = true;
    document.body.appendChild(root);
    this.root = root;
  }

  /** Buttons never take focus — Space must stay a sprint key, not a click. */
  private button(label: string, variant: string, onClick: () => void): HTMLButtonElement {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.tabIndex = -1;
    btn.className = `zpt-btn${variant ? ' ' + variant : ''}`;
    btn.textContent = label;
    btn.addEventListener('mousedown', (e) => e.preventDefault());
    btn.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      btn.blur();
      onClick();
    });
    return btn;
  }

  /* ---------- lifecycle ---------- */

  isActive(): boolean {
    return !!this.modal || !!this.card;
  }

  replay(): void {
    this.forced = true;
    this.state = freshState(true);
    try {
      localStorage.removeItem(TUTORIAL_DONE_KEY);
    } catch {
      /* ignore */
    }
    saveState(this.state);
    this.cardSig = '';
    this.tick();
  }

  skip(): void {
    this.state.skipped = true;
    this.state.decided = true;
    this.forced = false;
    saveState(this.state);
    this.closeFieldGuide();
    this.clearCard();
    this.clearRing();
    this.clearLauncher();
    if (this.root) this.root.hidden = true;
  }

  destroy(): void {
    if (this.timer !== null) window.clearInterval(this.timer);
    this.timer = null;
    if (this.unsubscribeLocale) this.unsubscribeLocale();
    this.unsubscribeLocale = null;
    this.closeFieldGuide();
    this.root?.remove();
    this.root = null;
    document.getElementById(STYLE_ID)?.remove();
  }

  /* ---------- poll ---------- */

  private tick(): void {
    if (!this.root) return;

    // The splash screen owns the viewport until the player presses Start.
    const splash = document.getElementById('startScreen');
    if (splash && splash.style.display !== 'none' && splash.offsetParent !== null) {
      this.root.hidden = true;
      return;
    }

    const phase = this.hooks.getPhase();
    const profile = this.hooks.getProfile();

    if (!this.state.decided) this.decide(profile);
    if (this.state.skipped || (!this.state.armed && !this.forced)) {
      this.root.hidden = true;
      return;
    }

    this.root.hidden = false;
    this.collectSignals(phase);

    if (phase === 'RAID') this.driveRaid();
    else if (phase === 'HIDEOUT') this.driveHub();
    else if (phase === 'RESULT') this.driveResult();
    else this.showNothing();

    this.updateRing();
    this.lastPhase = phase;
  }

  /**
   * A brand-new account reaches the client with `displayName === null` — that
   * is the server's own "never played" marker. Anyone who already has a
   * callsign on their first profile of this session is not a new player.
   */
  private decide(profile: TutorialProfileView | null): void {
    if (!profile) return;
    this.state.armed = profile.displayName === null;
    this.state.decided = true;
    saveState(this.state);
  }

  private collectSignals(phase: TutorialPhase | null): void {
    if (phase !== 'RAID') {
      this.lastPos = null;
      this.lastAmmo = null;
      this.lastInvCount = null;
      this.reloadTracked = false;
      this.lastReloadTick = 0;
      return;
    }
    if (this.lastPhase !== 'RAID') this.resetSignals();
    const player = this.hooks.getLocalPlayer();
    if (!player) return;

    if (this.lastPos) {
      const step = Math.hypot(player.x - this.lastPos.x, player.y - this.lastPos.y);
      // Ignore respawn/teleport jumps.
      if (step < 60) this.signals.moved += step;
    }
    this.lastPos = { x: player.x, y: player.y };

    const input = this.hooks.getInput?.() ?? null;
    if (input?.getShoot()) this.signals.fired = true;
    if (input?.getSprintHeld()) this.signals.sprinted = true;
    if (player.isSprinting) this.signals.sprinted = true;

    const runtime = player.weaponRuntime;
    if (runtime) {
      // A reload either pushes the lockout tick forward or refills the mag.
      if (this.reloadTracked && runtime.reloadingUntilTick > this.lastReloadTick) {
        this.signals.reloaded = true;
      }
      this.lastReloadTick = runtime.reloadingUntilTick;
      this.reloadTracked = true;

      if (this.lastAmmo !== null) {
        if (runtime.ammoInMag < this.lastAmmo) this.signals.fired = true;
        if (runtime.ammoInMag > this.lastAmmo) this.signals.reloaded = true;
      }
      this.lastAmmo = runtime.ammoInMag;
    }

    const items = player.inventory?.items ?? [];
    let count = 0;
    for (const item of items) count += item.qty;
    if (this.lastInvCount !== null && count > this.lastInvCount) this.signals.pickedUp = true;
    this.lastInvCount = count;

    if ((player.extractProgress ?? 0) > 0) this.signals.atExfil = true;
  }

  private resetSignals(): void {
    this.signals = { moved: 0, fired: false, reloaded: false, sprinted: false, pickedUp: false, atExfil: false };
  }

  /* ---------- stages ---------- */

  private driveHub(): void {
    this.showLauncher();
    if (this.state.hubStep >= HUB_STEPS.length) {
      this.clearCard();
      return;
    }
    const step = HUB_STEPS[this.state.hubStep];
    this.renderStep(step, 'bottom', this.state.hubStep, HUB_STEPS.length, () => {
      this.state.hubStep += 1;
      saveState(this.state);
      this.cardSig = '';
    });
  }

  private driveRaid(): void {
    this.clearLauncher();
    if (!this.hooks.getLocalPlayer()) {
      this.clearCard();
      return;
    }
    if (this.state.hubStep < HUB_STEPS.length) {
      // Deployed early — the Hideout brief is no longer relevant this run.
      this.state.hubStep = HUB_STEPS.length;
      saveState(this.state);
    }
    const advance = () => {
      this.state.raidStep += 1;
      saveState(this.state);
      this.resetSignals();
      this.cardSig = '';
    };

    // Clear anything the player already did before the card went up.
    while (this.state.raidStep < RAID_STEPS.length) {
      const candidate = RAID_STEPS[this.state.raidStep];
      if (candidate.done && candidate.done(this.signals)) advance();
      else break;
    }

    if (this.state.raidStep >= RAID_STEPS.length) {
      this.clearCard();
      return;
    }
    const index = this.state.raidStep;
    this.renderStep(RAID_STEPS[index], 'top', index, RAID_STEPS.length, advance);
  }

  private driveResult(): void {
    this.clearLauncher();
    const result = this.hooks.getRaidResult?.() ?? null;
    if (!result) {
      this.clearCard();
      return;
    }
    const extracted = result.result === 'EXTRACTED';
    if ((extracted && this.state.extractedSeen) || (!extracted && this.state.kiaSeen)) {
      this.clearCard();
      return;
    }
    const step: Step = { key: extracted ? 'tutorial.result.extracted' : 'tutorial.result.kia' };
    this.renderStep(step, 'top', -1, 0, () => {
      if (extracted) this.state.extractedSeen = true;
      else this.state.kiaSeen = true;
      saveState(this.state);
      this.cardSig = '';
    });
  }

  private showNothing(): void {
    this.clearCard();
    this.clearLauncher();
  }

  /* ---------- card ---------- */

  private renderStep(step: Step, placement: 'top' | 'bottom', index: number, total: number, onNext: () => void): void {
    const sig = `${step.key}|${placement}|${index}|${this.localeEpoch}`;
    if (sig === this.cardSig && this.card) {
      this.ringSelector = step.highlight ?? null;
      return;
    }
    // clearCard() resets both fields, so claim them after it runs.
    this.clearCard();
    this.cardSig = sig;
    this.ringSelector = step.highlight ?? null;

    const card = document.createElement('div');
    card.className = `zpt-card zpt-card--${placement}`;

    const head = document.createElement('div');
    head.className = 'zpt-head';
    const badge = document.createElement('span');
    badge.className = 'zpt-badge';
    badge.textContent = t('tutorial.badge');
    const title = document.createElement('span');
    title.className = 'zpt-title';
    title.textContent = t(`${step.key}.title`);
    head.append(badge, title);
    if (total > 0) {
      const count = document.createElement('span');
      count.className = 'zpt-count';
      count.textContent = t('tutorial.progress', { current: index + 1, total });
      head.appendChild(count);
    }
    card.appendChild(head);

    const body = document.createElement('div');
    body.className = 'zpt-body';
    body.innerHTML = rich(t(`${step.key}.body`));
    card.appendChild(body);

    const objectiveKey = `${step.key}.objective`;
    if (step.done && hasKey(objectiveKey)) {
      const objective = document.createElement('div');
      objective.className = 'zpt-obj';
      objective.innerHTML = rich(t(objectiveKey));
      card.appendChild(objective);
    }

    const foot = document.createElement('div');
    foot.className = 'zpt-foot';
    if (total > 0) {
      const dots = document.createElement('div');
      dots.className = 'zpt-dots';
      for (let i = 0; i < total; i += 1) {
        const dot = document.createElement('span');
        dot.className = `zpt-dot${i < index ? ' is-done' : i === index ? ' is-now' : ''}`;
        dots.appendChild(dot);
      }
      foot.appendChild(dots);
    } else {
      const spacer = document.createElement('div');
      spacer.className = 'zpt-dots';
      foot.appendChild(spacer);
    }

    foot.appendChild(this.button(t('tutorial.btn.skip'), 'zpt-btn--quiet', () => this.skip()));
    foot.appendChild(this.button(t('tutorial.btn.guide'), '', () => this.openFieldGuide()));
    const isLast = total > 0 && index === total - 1;
    const nextLabel = total <= 0 ? t('tutorial.btn.gotit') : isLast ? t('tutorial.btn.finish') : t('tutorial.btn.next');
    foot.appendChild(this.button(nextLabel, 'zpt-btn--primary', onNext));
    card.appendChild(foot);

    this.root?.appendChild(card);
    this.card = card;
  }

  private clearCard(): void {
    this.card?.remove();
    this.card = null;
    this.cardSig = '';
    this.ringSelector = null;
  }

  /* ---------- highlight ring ---------- */

  private updateRing(): void {
    if (!this.ringSelector || !this.card) {
      this.clearRing();
      return;
    }
    let target: Element | null = null;
    try {
      target = document.querySelector(this.ringSelector);
    } catch {
      target = null;
    }
    if (!target) {
      this.clearRing();
      return;
    }
    const box = target.getBoundingClientRect();
    if (box.width < 2 || box.height < 2) {
      this.clearRing();
      return;
    }
    if (!this.ring) {
      this.ring = document.createElement('div');
      this.ring.className = 'zpt-ring';
      this.root?.appendChild(this.ring);
    }
    const pad = 6;
    this.ring.style.left = `${box.left - pad}px`;
    this.ring.style.top = `${box.top - pad}px`;
    this.ring.style.width = `${box.width + pad * 2}px`;
    this.ring.style.height = `${box.height + pad * 2}px`;
  }

  private clearRing(): void {
    this.ring?.remove();
    this.ring = null;
  }

  /* ---------- field guide ---------- */

  private showLauncher(): void {
    if (this.launcher || !this.root) return;
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.tabIndex = -1;
    btn.className = 'zpt-launch';
    btn.textContent = t('tutorial.guide.launcher');
    btn.addEventListener('mousedown', (e) => e.preventDefault());
    btn.addEventListener('click', (e) => {
      e.preventDefault();
      btn.blur();
      this.openFieldGuide();
    });
    this.root.appendChild(btn);
    this.launcher = btn;
  }

  private clearLauncher(): void {
    this.launcher?.remove();
    this.launcher = null;
  }

  openFieldGuide(): void {
    if (this.modal || !this.root) return;
    const modal = document.createElement('div');
    modal.className = 'zpt-modal';
    modal.addEventListener('click', (e) => {
      if (e.target === modal) this.closeFieldGuide();
    });
    this.root.appendChild(modal);
    this.modal = modal;
    this.root.hidden = false;
    this.renderFieldGuide();
  }

  closeFieldGuide(): void {
    this.modal?.remove();
    this.modal = null;
  }

  private renderFieldGuide(): void {
    const modal = this.modal;
    if (!modal) return;
    modal.textContent = '';

    const sheet = document.createElement('div');
    sheet.className = 'zpt-sheet';

    const head = document.createElement('div');
    head.className = 'zpt-sheet-head';
    const h2 = document.createElement('h2');
    h2.textContent = t('tutorial.guide.title');
    const sub = document.createElement('p');
    sub.textContent = t('tutorial.guide.subtitle');
    head.append(h2, sub, this.button(t('tutorial.btn.close'), '', () => this.closeFieldGuide()));
    sheet.appendChild(head);

    const body = document.createElement('div');
    body.className = 'zpt-sheet-body';

    // Controls
    body.appendChild(this.sectionTitle(t('tutorial.guide.section.controls')));
    const keys = document.createElement('div');
    keys.className = 'zpt-keys';
    for (const [actionKey, cap] of CONTROL_ROWS) {
      const row = document.createElement('div');
      row.className = 'zpt-keyrow';
      const capEl = document.createElement('span');
      capEl.textContent = cap.startsWith('@') ? t(cap.slice(1)) : cap;
      const actionEl = document.createElement('span');
      actionEl.textContent = t(actionKey);
      row.append(capEl, actionEl);
      keys.appendChild(row);
    }
    body.appendChild(keys);

    // Field rules
    body.appendChild(this.sectionTitle(t('tutorial.guide.section.rules')));
    const rules = document.createElement('ul');
    rules.className = 'zpt-rules';
    for (const key of RULE_KEYS) {
      const li = document.createElement('li');
      li.innerHTML = rich(t(key));
      rules.appendChild(li);
    }
    body.appendChild(rules);

    // Gear
    for (const section of GUIDE_SECTIONS) {
      body.appendChild(this.sectionTitle(t(`tutorial.guide.section.${section.key}`)));
      const grid = document.createElement('div');
      grid.className = 'zpt-items';
      for (const id of section.items) {
        grid.appendChild(this.itemCard(id));
      }
      body.appendChild(grid);
    }

    // Salvage has no per-item value worth listing — one card covers all of it.
    body.appendChild(this.sectionTitle(t('tutorial.guide.section.salvage')));
    const salvage = document.createElement('div');
    salvage.className = 'zpt-items';
    const salvageCard = document.createElement('div');
    salvageCard.className = 'zpt-item';
    const salvageTitle = document.createElement('h4');
    salvageTitle.textContent = t('tutorial.guide.salvage.title');
    const salvageBody = document.createElement('p');
    salvageBody.textContent = t('tutorial.guide.salvage.body');
    salvageCard.append(salvageTitle, salvageBody);
    salvage.appendChild(salvageCard);
    body.appendChild(salvage);

    sheet.appendChild(body);
    modal.appendChild(sheet);
  }

  private sectionTitle(label: string): HTMLElement {
    const el = document.createElement('div');
    el.className = 'zpt-sec';
    el.textContent = label;
    return el;
  }

  private itemCard(typeId: string): HTMLElement {
    const card = document.createElement('div');
    card.className = 'zpt-item';

    const name = document.createElement('h4');
    name.textContent = itemName(typeId);
    card.appendChild(name);

    // Item copy is owned by the item catalog — never duplicated here.
    if (hasKey(`item.${typeId}.desc`)) {
      const desc = document.createElement('p');
      desc.textContent = itemDesc(typeId);
      card.appendChild(desc);
    }

    const tipKey = `tutorial.guide.tip.${typeId}`;
    if (hasKey(tipKey)) {
      const tip = document.createElement('div');
      tip.className = 'zpt-tip';
      const text = document.createElement('span');
      text.textContent = t(tipKey);
      tip.appendChild(text);
      card.appendChild(tip);
    }
    return card;
  }
}

/**
 * Boot onboarding. Safe to call once, after the module-level game state in
 * main.ts exists — every hook is read lazily on a 100ms poll.
 */
export function initTutorial(hooks: TutorialHooks): TutorialController {
  return new Tutorial(hooks);
}
