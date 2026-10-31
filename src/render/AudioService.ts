/**
 * Plays sounds through Phaser's sound manager, applying the player's volume settings.
 *
 * Browsers keep audio suspended until the player interacts with the page. The title
 * screen's buttons call `unlock()` from their click handler (a user gesture), which
 * resumes the Web Audio context; Phaser also unlocks on the first pointer or key press.
 */
import * as Phaser from 'phaser';
import type { Settings } from '../core/settings';
import type { Store } from '../core/Store';
import type { SoundKey } from './assets/manifest';

export class AudioService {
  private readonly game: Phaser.Game;
  private readonly settings: Store<Settings>;
  private readonly unsubscribe: () => void;

  constructor(game: Phaser.Game, settings: Store<Settings>) {
    this.game = game;
    this.settings = settings;
    this.unsubscribe = settings.subscribe(() => this.applyVolume());
    this.applyVolume();
  }

  /** Resume audio. Must be called from inside a user-gesture handler (click, key press). */
  unlock(): void {
    const manager = this.game.sound;
    if (manager instanceof Phaser.Sound.WebAudioSoundManager && manager.context.state === 'suspended') {
      manager.context.resume().catch(() => {
        // Still locked; Phaser retries on the next interaction.
      });
    }
  }

  play(key: SoundKey, volume = 1): void {
    // Synthesized sounds don't exist without Web Audio; skip silently.
    if (!this.game.cache.audio.exists(key)) return;
    const { sfxVolume } = this.settings.get();
    if (sfxVolume <= 0) return;
    this.game.sound.play(key, { volume: sfxVolume * volume });
  }

  destroy(): void {
    this.unsubscribe();
  }

  private applyVolume(): void {
    this.game.sound.volume = this.settings.get().masterVolume;
  }
}
