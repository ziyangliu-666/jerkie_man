export class AudioManager {
  private static instance: AudioManager;
  private audio: HTMLAudioElement | null = null;
  private volume: number = 0.05;
  private isMuted: boolean = false;
  private currentTrack: number = 1;
  private initialized: boolean = false;

  private constructor() {
    this.loadSettings();
  }

  public static getInstance(): AudioManager {
    if (!this.instance) {
      this.instance = new AudioManager();
    }
    return this.instance;
  }

  private loadSettings() {
    const savedVolume = localStorage.getItem('bgm_volume');
    const savedMuted = localStorage.getItem('bgm_muted');
    const savedTrack = localStorage.getItem('bgm_manual_track'); // Use a specific key for manual selection
    
    if (savedVolume !== null) {
      this.volume = parseFloat(savedVolume);
    }
    if (savedMuted !== null) {
      this.isMuted = savedMuted === 'true';
    }
    if (savedTrack !== null) {
      this.currentTrack = parseInt(savedTrack);
    } else {
      // Default to random if no manual track is saved
      this.currentTrack = Math.floor(Math.random() * 10) + 1;
    }
  }

  private saveSettings() {
    localStorage.setItem('bgm_volume', this.volume.toString());
    localStorage.setItem('bgm_muted', this.isMuted.toString());
    // Note: bgm_manual_track is only saved in setTrack
  }

  public init() {
    if (this.initialized) return;
    
    // Track is already picked in loadSettings (either saved or random)
    
    this.audio = new Audio(`/audio/bgm/bgm${this.currentTrack}.mp3`);
    this.audio.loop = true;
    this.audio.volume = this.isMuted ? 0 : this.volume;
    
    this.initialized = true;
    console.log(`[AudioManager] Initialized with track ${this.currentTrack}, volume ${this.volume}, muted: ${this.isMuted}`);
  }

  public async play() {
    if (!this.audio) this.init();
    if (!this.audio) return;

    try {
      if (!this.isMuted) {
        await this.audio.play();
      }
    } catch (err) {
      console.warn('[AudioManager] Autoplay blocked or file missing. Waiting for user interaction or check console.', err);
    }
  }

  public setVolume(val: number) {
    this.volume = val;
    if (this.audio) {
      this.audio.volume = this.isMuted ? 0 : this.volume;
    }
    this.saveSettings();
  }

  public getVolume(): number {
    return this.volume;
  }

  public toggleMute(): boolean {
    this.isMuted = !this.isMuted;
    if (this.audio) {
      this.audio.volume = this.isMuted ? 0 : this.volume;
      if (this.isMuted) {
        this.audio.pause();
      } else {
        this.audio.play().catch(() => {});
      }
    }
    this.saveSettings();
    return this.isMuted;
  }

  public getMuted(): boolean {
    return this.isMuted;
  }

  public async setTrack(index: number) {
    if (index < 1 || index > 10) return;
    if (this.currentTrack === index && this.initialized) return;

    this.currentTrack = index;
    const wasPlaying = this.audio && !this.audio.paused;

    if (this.audio) {
      this.audio.pause();
      this.audio.src = `/audio/bgm/bgm${this.currentTrack}.mp3`;
    } else {
      this.audio = new Audio(`/audio/bgm/bgm${this.currentTrack}.mp3`);
      this.audio.loop = true;
    }

    this.audio.volume = this.isMuted ? 0 : this.volume;
    localStorage.setItem('bgm_manual_track', this.currentTrack.toString());
    this.saveSettings();

    if (wasPlaying || !this.initialized) {
      try {
        if (!this.isMuted) await this.audio.play();
      } catch (err) {
        console.warn('[AudioManager] Failed to play new track:', err);
      }
    }
    
    this.initialized = true;
  }

  public getCurrentTrack(): number {
    return this.currentTrack;
  }
}
