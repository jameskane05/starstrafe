/**
 * MusicManager.js - BACKGROUND MUSIC PLAYBACK AND CROSSFADE
 * =============================================================================
 *
 * ROLE: Plays background music from musicData.js via Howler. Builds shuffled
 * playlist, crossfades between tracks, respects AudioSettings volume and
 * user interaction (audio unlock) and game state transitions.
 *
 * KEY RESPONSIBILITIES:
 * - Load tracks on demand; build playlist from shuffled(musicTracks)
 * - play(), pause(), stop(); crossfade and fade out
 * - React to user interaction (unlock audio); subscribe to AudioSettings
 * - Match playlist: reshuffle when entering MENU (post-match); match entry calls
 *   reshuffleAndPlay during pre-match loading (solo/multi) so PLAYING does not
 *   trigger another shuffle
 *
 * RELATED: musicData.js, AudioSettings.js, gameData.js, gameInit.js.
 *
 * =============================================================================
 */

import { Howl } from "howler";
import { musicTracks, shuffled } from "./musicData.js";
import { AudioSettings } from "../game/AudioSettings.js";
import { GAME_STATES } from "../data/gameData.js";
import {
  DIALOG_DUCK_LEVEL,
  DIALOG_DUCK_RAMP_DOWN_SEC,
  DIALOG_DUCK_RAMP_UP_SEC,
} from "./dialogDuckShared.js";

class MusicManager {
  constructor() {
    this.loaded = {};
    this.playlist = [];
    this.playlistIndex = 0;
    this.currentTrack = null;
    this.currentPath = null;
    this.isTransitioning = false;
    this.hasUserInteracted = false;
    this.pendingPlay = false;

    this.crossfadeState = { active: false };
    this.fadeState = { active: false };

    this._dialogDuckMul = 1;
    this._dialogDuckTarget = 1;
    this._duckRampActive = false;
    this._duckRampFrom = 1;
    this._duckRampElapsed = 0;
    this._duckRampDuration = DIALOG_DUCK_RAMP_DOWN_SEC;

    this._setupInteractionListeners();
    AudioSettings.onChange(() => this._applyVolumeSettings());
  }

  _buildPlaylist() {
    this.playlist = shuffled(musicTracks);
    this.playlistIndex = 0;
  }

  _isMobilePlatform() {
    const state = this.gameManager?.getState?.();
    if (state && (state.isMobile != null || state.isIOS != null)) {
      return !!(state.isMobile || state.isIOS);
    }
    return "ontouchstart" in window || navigator.maxTouchPoints > 0;
  }

  _loadTrack(path) {
    if (this.loaded[path]) return this.loaded[path];

    const volume = AudioSettings.getMusicVolume();
    const howl = new Howl({
      src: [path],
      loop: false,
      volume: volume,
      preload: true,
      // On mobile, stream via HTMLAudioElement instead of decoding the whole
      // track into a Web Audio buffer (~40-50 MB PCM per track).
      html5: this._isMobilePlatform(),
      onend: () => this._onTrackEnd(path),
      onloaderror: (id, error) => console.error(`[Music] Failed to load ${path}:`, error),
    });

    this.loaded[path] = howl;
    return howl;
  }

  /** Free a non-current track's decoded buffer / audio element. */
  _unloadTrack(track) {
    if (!track || track === this.currentTrack) return;
    for (const [path, howl] of Object.entries(this.loaded)) {
      if (howl === track) {
        delete this.loaded[path];
        break;
      }
    }
    track.unload();
  }

  _onTrackEnd(path) {
    if (this.currentPath !== path) return;
    this._playNext(2.0);
  }

  _playNext(fadeTime = 0) {
    this.playlistIndex++;
    if (this.playlistIndex >= this.playlist.length) {
      this._buildPlaylist();
    }
    this._playCurrent(fadeTime);
  }

  _playCurrent(fadeTime = 0, forceTry = false) {
    const path = this.playlist[this.playlistIndex];
    if (!path) return;

    if (!forceTry && !this.hasUserInteracted) {
      this.pendingPlay = true;
      return;
    }

    const track = this._loadTrack(path);
    const previousPath = this.currentPath;
    const previousTrack = this.currentTrack;

    this.currentPath = path;
    this.currentTrack = track;
    this.isTransitioning = true;

    const targetVolume = AudioSettings.getMusicVolume();

    const startNewTrack = () => {
      if (track.state() === "loaded") {
        this._beginPlayback(track, previousTrack, targetVolume, fadeTime);
      } else {
        track.once("load", () => {
          this._beginPlayback(track, previousTrack, targetVolume, fadeTime);
        });
      }
    };

    startNewTrack();
  }

  _beginPlayback(track, previousTrack, targetVolume, fadeTime) {
    if (fadeTime > 0 && previousTrack && previousTrack.playing()) {
      const fadeOutStartVolume = previousTrack.volume();
      track.volume(0);
      track.play();
      this.crossfadeState = {
        active: true,
        fadeOutTrack: previousTrack,
        fadeInTrack: track,
        fadeOutStartVolume,
        fadeInTargetVolume: targetVolume,
        duration: fadeTime,
        startTime: Date.now(),
      };
    } else if (fadeTime > 0) {
      track.volume(0);
      track.play();
      this.fadeState = {
        active: true,
        track,
        startVolume: 0,
        targetVolume,
        duration: fadeTime,
        startTime: Date.now(),
      };
      this.isTransitioning = false;
    } else {
      if (previousTrack && previousTrack !== track) {
        previousTrack.stop();
        this._unloadTrack(previousTrack);
      }
      track.volume(targetVolume);
      track.play();
      this.isTransitioning = false;
    }
  }

  tryAutoplay() {
    this._playCurrent(2.0, true);
  }

  _setupInteractionListeners() {
    const handleInteraction = () => {
      if (this.hasUserInteracted) return;
      this.hasUserInteracted = true;

      if (this.pendingPlay && !this.currentTrack?.playing()) {
        this.pendingPlay = false;
        this._playCurrent(0);
      }

      document.removeEventListener("click", handleInteraction);
      document.removeEventListener("keydown", handleInteraction);
      document.removeEventListener("touchstart", handleInteraction);
    };

    document.addEventListener("click", handleInteraction);
    document.addEventListener("keydown", handleInteraction);
    document.addEventListener("touchstart", handleInteraction);
  }

  setGameManager(gameManager) {
    this.gameManager = gameManager;
    this._lastState = null;

    gameManager.on("state:changed", (newState, oldState) => {
      const curr = newState.currentState;
      const prev = oldState.currentState;
      if (curr === prev) return;

      if (curr === GAME_STATES.MENU && prev !== GAME_STATES.MENU) {
        this.reshuffleAndPlay(2.0);
      }
      this._lastState = curr;
    });

    this._buildPlaylist();
    this._playCurrent(0);
  }

  reshuffleAndPlay(fadeTime = 2.0) {
    this._buildPlaylist();
    this._playCurrent(fadeTime);
  }

  stopMusic(fadeTime = 0) {
    if (!this.currentTrack) return;

    if (fadeTime > 0) {
      this.fadeState = {
        active: true,
        track: this.currentTrack,
        startVolume: this.currentTrack.volume(),
        targetVolume: 0,
        duration: fadeTime,
        startTime: Date.now(),
        stopAfterFade: true,
      };
    } else {
      this.currentTrack.stop();
    }
    this.currentTrack = null;
    this.currentPath = null;
  }

  pauseMusic() {
    if (this.currentTrack) this.currentTrack.pause();
  }

  resumeMusic() {
    if (this.currentTrack) this.currentTrack.play();
  }

  _applyVolumeSettings() {
    const volume = AudioSettings.getMusicVolume() * this._dialogDuckMul;
    if (this.currentTrack && this.currentTrack.playing()) {
      this.currentTrack.volume(volume);
    }
  }

  /**
   * While true, music multiplier ramps linearly to DIALOG_DUCK_LEVEL (1s).
   * While false, ramps back to 1 (2s). No-op if already at the requested level.
   */
  setDialogDuck(active) {
    const target = active ? DIALOG_DUCK_LEVEL : 1;
    if (
      !this._duckRampActive &&
      Math.abs(this._dialogDuckMul - target) < 0.005
    ) {
      return;
    }
    this._dialogDuckTarget = target;
    this._duckRampFrom = this._dialogDuckMul;
    this._duckRampDuration = active
      ? DIALOG_DUCK_RAMP_DOWN_SEC
      : DIALOG_DUCK_RAMP_UP_SEC;
    this._duckRampElapsed = 0;
    this._duckRampActive = true;
  }

  _smoothDialogDuck(dt) {
    const d = typeof dt === "number" && dt > 0 ? dt : 1 / 60;
    if (this._duckRampActive) {
      this._duckRampElapsed += d;
      const t = Math.min(1, this._duckRampElapsed / this._duckRampDuration);
      this._dialogDuckMul = this._lerp(
        this._duckRampFrom,
        this._dialogDuckTarget,
        t,
      );
      if (t >= 1) {
        this._dialogDuckMul = this._dialogDuckTarget;
        this._duckRampActive = false;
      }
    }
    return this._dialogDuckMul;
  }

  update(dt) {
    const duckMul = this._smoothDialogDuck(dt);

    if (this.crossfadeState.active) {
      const elapsed = (Date.now() - this.crossfadeState.startTime) / 1000;
      const t = Math.min(elapsed / this.crossfadeState.duration, 1);

      const { fadeOutTrack, fadeInTrack } = this.crossfadeState;

      if (fadeOutTrack) {
        fadeOutTrack.volume(
          this._lerp(this.crossfadeState.fadeOutStartVolume, 0, t) * duckMul,
        );
      }
      if (fadeInTrack) {
        fadeInTrack.volume(
          this._lerp(0, this.crossfadeState.fadeInTargetVolume, t) * duckMul,
        );
      }

      if (t >= 1) {
        if (fadeOutTrack) {
          fadeOutTrack.stop();
          this._unloadTrack(fadeOutTrack);
        }
        this.crossfadeState.active = false;
        this.isTransitioning = false;
      }
    }

    if (!this.crossfadeState.active && this.fadeState.active) {
      const elapsed = (Date.now() - this.fadeState.startTime) / 1000;
      const t = Math.min(elapsed / this.fadeState.duration, 1);
      const { track } = this.fadeState;

      if (track) {
        track.volume(
          this._lerp(this.fadeState.startVolume, this.fadeState.targetVolume, t) *
            duckMul,
        );
        if (t >= 1) {
          if (this.fadeState.stopAfterFade) {
            track.stop();
            this._unloadTrack(track);
          }
          this.fadeState.active = false;
          this.isTransitioning = false;
        }
      }
    }

    if (
      this.currentTrack?.playing() &&
      !this.crossfadeState.active &&
      !this.fadeState.active
    ) {
      this.currentTrack.volume(AudioSettings.getMusicVolume() * duckMul);
    }
  }

  _lerp(a, b, t) {
    return a + (b - a) * t;
  }

  getCurrentTrack() {
    return this.currentPath;
  }

  isPlaying() {
    return this.currentTrack?.playing();
  }

  destroy() {
    Object.values(this.loaded).forEach((track) => track.unload());
    this.loaded = {};
    this.currentTrack = null;
    this.currentPath = null;
  }
}

export default MusicManager;
