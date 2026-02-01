import { Howl, Howler } from "howler";
import { musicTracks, getMusicForState } from "./musicData.js";
import { AudioSettings } from "../game/AudioSettings.js";

class MusicManager {
  constructor() {
    this.tracks = {};
    this.currentTrack = null;
    this.isTransitioning = false;
    this.gameManager = null;
    this.hasUserInteracted = false;
    this.pendingTrack = null;

    this.crossfadeState = {
      active: false,
      fadeOutTrack: null,
      fadeInTrack: null,
      fadeOutStartVolume: 0,
      fadeInTargetVolume: 0,
      duration: 0,
      startTime: 0,
    };

    this.fadeState = {
      active: false,
      trackName: null,
      startVolume: 0,
      targetVolume: 0,
      duration: 0,
      startTime: 0,
    };

    this._initializeTracks();
    this._setupInteractionListeners();

    AudioSettings.onChange(() => this._applyVolumeSettings());
  }

  _initializeTracks() {
    Object.values(musicTracks).forEach((track) => {
      if (track.preload) {
        this._loadTrack(track);
      }
    });
  }

  _loadTrack(trackData) {
    if (this.tracks[trackData.id]) return this.tracks[trackData.id];

    const volume = AudioSettings.getMusicVolume();

    this.tracks[trackData.id] = new Howl({
      src: [trackData.path],
      loop: trackData.loop !== false,
      volume: volume,
      preload: true,
      onload: () => console.log(`[Music] Loaded: ${trackData.id}`),
      onloaderror: (id, error) => console.error(`[Music] Failed to load ${trackData.id}:`, error),
    });

    return this.tracks[trackData.id];
  }

  _setupInteractionListeners() {
    const handleInteraction = () => {
      if (this.hasUserInteracted) return;
      this.hasUserInteracted = true;
      console.log("[Music] User interaction detected, audio unlocked");

      if (this.pendingTrack) {
        this.changeMusic(this.pendingTrack.id, this.pendingTrack.fadeTime || 0);
        this.pendingTrack = null;
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

    gameManager.on("state:changed", (newState, oldState) => {
      const track = getMusicForState(newState);

      if (!track) {
        if (this.currentTrack) {
          this.stopMusic(1.0);
        }
        return;
      }

      if (this.currentTrack !== track.id) {
        this.changeMusic(track.id, track.fadeTime || 0);
      }
    });

    const initialTrack = getMusicForState(gameManager.getState());
    if (initialTrack) {
      if (this.hasUserInteracted) {
        this.changeMusic(initialTrack.id, 0);
      } else {
        this.pendingTrack = initialTrack;
      }
    }
  }

  async changeMusic(trackName, fadeTime = 0) {
    const trackData = musicTracks[trackName];
    if (!trackData) {
      console.warn(`[Music] Track "${trackName}" not found in musicData`);
      return;
    }

    if (!this.hasUserInteracted) {
      this.pendingTrack = trackData;
      return;
    }

    if (!this.tracks[trackName]) {
      this._loadTrack(trackData);
      await new Promise((resolve) => {
        const howl = this.tracks[trackName];
        if (howl.state() === "loaded") {
          resolve();
        } else {
          howl.once("load", resolve);
          howl.once("loaderror", resolve);
        }
      });
    }

    if (this.isTransitioning) return;

    const track = this.tracks[trackName];
    if (!track) return;

    this.isTransitioning = true;
    const previousTrack = this.currentTrack;
    this.currentTrack = trackName;

    const targetVolume = AudioSettings.getMusicVolume();

    if (fadeTime > 0 && previousTrack && this.tracks[previousTrack]?.playing()) {
      const fadeOutStartVolume = this.tracks[previousTrack].volume();
      track.volume(0);
      track.play();

      this.crossfadeState = {
        active: true,
        fadeOutTrack: previousTrack,
        fadeInTrack: trackName,
        fadeOutStartVolume,
        fadeInTargetVolume: targetVolume,
        duration: fadeTime,
        startTime: Date.now(),
      };
    } else if (fadeTime > 0) {
      track.volume(0);
      track.play();
      this._startFadeIn(trackName, targetVolume, fadeTime);
    } else {
      if (previousTrack && this.tracks[previousTrack]) {
        this.tracks[previousTrack].stop();
      }
      track.volume(targetVolume);
      track.play();
      this.isTransitioning = false;
    }
  }

  _startFadeIn(trackName, targetVolume, duration) {
    this.fadeState = {
      active: true,
      trackName,
      startVolume: 0,
      targetVolume,
      duration,
      startTime: Date.now(),
    };
  }

  stopMusic(fadeTime = 0) {
    if (!this.currentTrack || !this.tracks[this.currentTrack]) return;

    if (fadeTime > 0) {
      this.fadeState = {
        active: true,
        trackName: this.currentTrack,
        startVolume: this.tracks[this.currentTrack].volume(),
        targetVolume: 0,
        duration: fadeTime,
        startTime: Date.now(),
        stopAfterFade: true,
      };
    } else {
      this.tracks[this.currentTrack].stop();
    }
    this.currentTrack = null;
  }

  pauseMusic() {
    if (this.currentTrack && this.tracks[this.currentTrack]) {
      this.tracks[this.currentTrack].pause();
    }
  }

  resumeMusic() {
    if (this.currentTrack && this.tracks[this.currentTrack]) {
      this.tracks[this.currentTrack].play();
    }
  }

  _applyVolumeSettings() {
    const volume = AudioSettings.getMusicVolume();
    if (this.currentTrack && this.tracks[this.currentTrack]) {
      this.tracks[this.currentTrack].volume(volume);
    }
  }

  update(dt) {
    if (this.crossfadeState.active) {
      const elapsed = (Date.now() - this.crossfadeState.startTime) / 1000;
      const t = Math.min(elapsed / this.crossfadeState.duration, 1);

      const fadeOutTrack = this.tracks[this.crossfadeState.fadeOutTrack];
      const fadeInTrack = this.tracks[this.crossfadeState.fadeInTrack];

      if (fadeOutTrack) {
        fadeOutTrack.volume(this._lerp(this.crossfadeState.fadeOutStartVolume, 0, t));
      }

      if (fadeInTrack) {
        fadeInTrack.volume(this._lerp(0, this.crossfadeState.fadeInTargetVolume, t));
      }

      if (t >= 1) {
        if (fadeOutTrack) fadeOutTrack.stop();
        this.crossfadeState.active = false;
        this.isTransitioning = false;
      }
    }

    if (!this.crossfadeState.active && this.fadeState.active) {
      const elapsed = (Date.now() - this.fadeState.startTime) / 1000;
      const t = Math.min(elapsed / this.fadeState.duration, 1);
      const track = this.tracks[this.fadeState.trackName];

      if (track) {
        track.volume(this._lerp(this.fadeState.startVolume, this.fadeState.targetVolume, t));

        if (t >= 1) {
          if (this.fadeState.stopAfterFade) {
            track.stop();
          }
          this.fadeState.active = false;
          this.isTransitioning = false;
        }
      }
    }
  }

  _lerp(a, b, t) {
    return a + (b - a) * t;
  }

  getCurrentTrack() {
    return this.currentTrack;
  }

  isPlaying() {
    return this.currentTrack && this.tracks[this.currentTrack]?.playing();
  }

  destroy() {
    Object.values(this.tracks).forEach((track) => track.unload());
    this.tracks = {};
    this.currentTrack = null;
  }
}

export default MusicManager;
