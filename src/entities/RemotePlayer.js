/**
 * RemotePlayer.js - NETWORK-SYNCHED REMOTE PLAYER SHIP
 * =============================================================================
 *
 * ROLE: Represents another player in multiplayer. Interpolates position and
 * rotation from server updates; renders exterior ship model and engine trail.
 *
 * KEY RESPONSIBILITIES:
 * - updateFromServer(playerState): push position/rotation/health/boost into interpolator
 * - update(delta): interpolate position and rotation; update engine trail and gun retract
 * - Shared exterior GLTF (Heavy_EXT_02.glb); team/ship class colors
 * - dispose(); used by gameMultiplayer for addRemotePlayer/removeRemotePlayer
 *
 * RELATED: Interpolation.js, EngineTrail.js, gameMultiplayer.js.
 *
 * =============================================================================
 */

import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { Interpolation } from "../network/Interpolation.js";
import { EngineTrail } from "../vfx/EngineTrail.js";

const SHIP_COLORS = {
  fighter: 0x00f0ff,
  tank: 0xff8800,
  rogue: 0x00ff88,
};

const TEAM_COLORS = {
  1: 0xff4455,
  2: 0x4488ff,
};

function trailColorHexFromPlayerData(playerData, teamMode, team, shipClass) {
  const hex = playerData.accentColor;
  if (hex) {
    const c = new THREE.Color();
    try {
      c.set(hex);
      return c.getHex();
    } catch {
      /* fallback below */
    }
  }
  if (teamMode && team > 0) return TEAM_COLORS[team];
  return SHIP_COLORS[shipClass] ?? 0x00f0ff;
}

function nameLabelColorFromPlayerData(playerData, teamMode, team) {
  const hex = playerData.accentColor;
  if (hex) {
    const c = new THREE.Color();
    try {
      c.set(hex);
      return `#${c.getHexString()}`;
    } catch {
      /* fallback below */
    }
  }
  if (teamMode && team > 0) return team === 1 ? "#ff4455" : "#4488ff";
  return "#00f0ff";
}

let exteriorModel = null;
let exteriorLoading = null;

export async function loadMultiplayerShipModel() {
  if (exteriorModel) return exteriorModel;
  if (exteriorLoading) return exteriorLoading;

  exteriorLoading = new Promise((resolve) => {
    const loader = new GLTFLoader();
    loader.load(
      "./Heavy_EXT_02.glb",
      (gltf) => {
        exteriorModel = gltf.scene;
        resolve(exteriorModel);
      },
      undefined,
      () => {
        resolve(null);
      },
    );
  });

  return exteriorLoading;
}

const _engineColorBlack = new THREE.Color(0x000000);
const _white = new THREE.Color(0xffffff);
const _velocity = new THREE.Vector3();
const _enginePos = new THREE.Vector3();
const GUN_RETRACT_AMOUNT = 0.06;
const GUN_RETRACT_RECOVERY = 6;

export class RemotePlayer {
  constructor(scene, playerData, teamMode = false, options = {}) {
    this.scene = scene;
    this.id = playerData.id;
    this.name = playerData.name;
    this.shipClass = playerData.shipClass || "fighter";
    this.team = playerData.team || 0;
    this.health = playerData.health || 100;
    this.maxHealth = playerData.maxHealth || 100;
    this.alive = playerData.alive !== false;
    this.isBoosting = playerData.isBoosting ?? false;
    this.teamMode = teamMode;
    this.engineMarkers = [];
    this.engineTrails = [];
    this.engineMaterials = [];
    this.engineGlowT = 0;
    this.engineGlowTarget = 0;
    this.trailTimer = 0;
    this._lastPosition = new THREE.Vector3();
    this.gunL = null;
    this.gunR = null;
    this.missileL = null;
    this.missileR = null;
    this.gunRetractionL = 0;
    this.gunRetractionR = 0;
    this.fireFromLeft = true;
    this.missileFromLeft = true;
    this.accentColor = playerData.accentColor || "";
    this._engineTintIdle = new THREE.Color();
    this._engineTintBoost = new THREE.Color();
    this._refreshEngineFaceTints();

    this.interpolation = new Interpolation({
      bufferSize: 5,
      interpolationDelay: 100,
    });

    this.mesh = new THREE.Group();
    this.mesh.position.set(
      playerData.x || 0,
      playerData.y || 0,
      playerData.z || 0,
    );
    this.mesh.quaternion.set(
      playerData.qx || 0,
      playerData.qy || 0,
      playerData.qz || 0,
      playerData.qw || 1,
    );

    this.createShipMesh();
    this.createNameLabel();

    scene.add(this.mesh);
  }

  _refreshEngineFaceTints() {
    const hex = trailColorHexFromPlayerData(
      { accentColor: this.accentColor },
      this.teamMode,
      this.team,
      this.shipClass,
    );
    const base = new THREE.Color(hex);
    this._engineTintIdle.copy(base).lerp(_white, 0.48);
    this._engineTintBoost.copy(base).lerp(_white, 0.08);
  }

  async createShipMesh() {
    const model = await loadMultiplayerShipModel();

    if (model) {
      const clone = model.clone();
      clone.scale.setScalar(1);
      clone.rotation.set(0, Math.PI, 0);

      clone.traverse((child) => {
        const n = child.name;
        if (n === "Gun_L") {
          this.gunL = child;
          child.userData.restPosition = child.position.clone();
        } else if (n === "Gun_R") {
          this.gunR = child;
          child.userData.restPosition = child.position.clone();
        } else if (n === "Missile_L") this.missileL = child;
        else if (n === "Missile_R") this.missileR = child;
        if (n === "Engine_L" || n === "Engine_R")
          this.engineMarkers.push(child);
        if (n === "Engine_Center" || n === "Engine_L" || n === "Engine_R") {
          if (child.isMesh && child.material)
            this.engineMaterials.push(child.material);
          else if (child.children) {
            child.traverse((c) => {
              if (c.isMesh && c.material) this.engineMaterials.push(c.material);
            });
          }
        }
      });
      if (this.engineMarkers.length < 2) {
        console.warn(
          "[RemotePlayer] Ship model missing Engine_L and/or Engine_R; trail VFX disabled.",
        );
      } else {
        const trailColor = trailColorHexFromPlayerData(
          { accentColor: this.accentColor },
          this.teamMode,
          this.team,
          this.shipClass,
        );
        this.engineTrails = [
          new EngineTrail(this.scene, {
            maxPoints: 64,
            trailTime: 1.8,
            width: 1,
            color: trailColor,
            emissiveIntensity: 2.8,
          }),
          new EngineTrail(this.scene, {
            maxPoints: 64,
            trailTime: 1.8,
            width: 1,
            color: trailColor,
            emissiveIntensity: 2.8,
          }),
        ];
      }

      this.shipMesh = clone;
      this.mesh.add(clone);
    } else {
      const geo = new THREE.ConeGeometry(0.5, 1.5, 8);
      geo.rotateX(Math.PI / 2);

      const color = trailColorHexFromPlayerData(
        { accentColor: this.accentColor },
        this.teamMode,
        this.team,
        this.shipClass,
      );

      const mat = new THREE.MeshStandardMaterial({
        color: color,
        emissive: color,
        emissiveIntensity: 0.3,
        metalness: 0.8,
        roughness: 0.2,
      });

      this.shipMesh = new THREE.Mesh(geo, mat);
      this.mesh.add(this.shipMesh);
    }

    const engineGlow = new THREE.PointLight(
      trailColorHexFromPlayerData(
        { accentColor: this.accentColor },
        this.teamMode,
        this.team,
        this.shipClass,
      ),
      2,
      8,
    );
    engineGlow.position.set(0, 0, 0.8);
    this.mesh.add(engineGlow);
    this.engineLight = engineGlow;
  }

  createNameLabel() {
    const canvas = document.createElement("canvas");
    canvas.width = 256;
    canvas.height = 64;
    const ctx = canvas.getContext("2d");

    ctx.fillStyle = "rgba(0, 0, 0, 0.5)";
    ctx.fillRect(0, 0, 256, 64);

    ctx.font = "bold 24px Rajdhani, sans-serif";
    ctx.textAlign = "center";
    ctx.fillStyle = nameLabelColorFromPlayerData(
      { accentColor: this.accentColor },
      this.teamMode,
      this.team,
    );
    ctx.fillText(this.name, 128, 40);

    const texture = new THREE.CanvasTexture(canvas);
    const spriteMat = new THREE.SpriteMaterial({
      map: texture,
      transparent: true,
      depthTest: true,
    });

    this.nameSprite = new THREE.Sprite(spriteMat);
    this.nameSprite.scale.set(4, 1, 1);
    this.nameSprite.position.set(0, 2, 0);
    this.mesh.add(this.nameSprite);
  }

  updateFromServer(playerData, timestamp = Date.now()) {
    const prevAccent = this.accentColor;
    const prevTeam = this.team;
    const prevClass = this.shipClass;
    this.health = playerData.health;
    this.maxHealth = playerData.maxHealth;
    this.alive = playerData.alive;
    this.shipClass = playerData.shipClass;
    this.team = playerData.team;
    this.isBoosting = playerData.isBoosting ?? false;
    if (playerData.accentColor !== undefined) {
      this.accentColor = playerData.accentColor || "";
    }
    if (
      this.accentColor !== prevAccent ||
      this.team !== prevTeam ||
      this.shipClass !== prevClass
    ) {
      this._refreshEngineFaceTints();
    }

    if (this.alive) {
      this.interpolation.pushState(
        { x: playerData.x, y: playerData.y, z: playerData.z },
        {
          x: playerData.qx,
          y: playerData.qy,
          z: playerData.qz,
          w: playerData.qw,
        },
        timestamp,
      );
    }

    this.mesh.visible = this.alive;
  }

  update(delta) {
    if (!this.alive) return;

    const { position, rotation } = this.interpolation.getInterpolatedState();

    _velocity.set(0, 0, 0);
    if (
      this._lastPosition.x !== position.x ||
      this._lastPosition.y !== position.y ||
      this._lastPosition.z !== position.z
    ) {
      _velocity
        .subVectors(position, this._lastPosition)
        .divideScalar(Math.max(delta, 0.001));
    }
    this._lastPosition.copy(position);

    this.mesh.position.copy(position);
    this.mesh.quaternion.copy(rotation);

    if (this.nameSprite) {
      this.nameSprite.quaternion.identity();
    }

    const speed = _velocity.length();
    const maxSpeed = 2.5;
    this.engineGlowTarget = this.isBoosting ? 1 : Math.min(1, speed / maxSpeed);
    this.engineGlowT +=
      (this.engineGlowTarget - this.engineGlowT) * Math.min(1, delta * 4);
    const boostGlow = this.isBoosting ? 1 : 0;
    for (const mat of this.engineMaterials) {
      if (!mat.color || !mat.emissive) continue;
      const tintEnd =
        boostGlow > 0 ? this._engineTintBoost : this._engineTintIdle;
      mat.color.lerpColors(_engineColorBlack, tintEnd, this.engineGlowT);
      mat.emissive.lerpColors(_engineColorBlack, tintEnd, this.engineGlowT);
      mat.emissiveIntensity =
        boostGlow > 0 ? 2.2 : 0.05 + 0.25 * this.engineGlowT;
    }

    if (this.engineTrails.length >= 2) {
      const t = performance.now() / 1000;
      if (this.isBoosting) {
        for (let i = 0; i < this.engineMarkers.length && i < 2; i++) {
          this.engineMarkers[i].getWorldPosition(_enginePos);
          this.engineTrails[i].addPoint(_enginePos, t);
        }
      }
      this.engineTrails[0].update(t);
      this.engineTrails[1].update(t);
    }

    const gunRecover = 1 - Math.exp(-GUN_RETRACT_RECOVERY * delta);
    if (this.gunL?.userData.restPosition) {
      this.gunRetractionL = Math.max(
        0,
        this.gunRetractionL - this.gunRetractionL * gunRecover,
      );
      this.gunL.position.copy(this.gunL.userData.restPosition);
      this.gunL.position.z -= this.gunRetractionL;
    }
    if (this.gunR?.userData.restPosition) {
      this.gunRetractionR = Math.max(
        0,
        this.gunRetractionR - this.gunRetractionR * gunRecover,
      );
      this.gunR.position.copy(this.gunR.userData.restPosition);
      this.gunR.position.z -= this.gunRetractionR;
    }

    this._lastPosition.copy(position);
  }

  getWeaponSpawnPoint(out = new THREE.Vector3()) {
    if (!this.gunL || !this.gunR) return null;
    const gun = this.fireFromLeft ? this.gunL : this.gunR;
    this.mesh.updateMatrixWorld(true);
    gun.getWorldPosition(out);
    return out;
  }

  getMissileSpawnPoint(out = new THREE.Vector3()) {
    if (!this.missileL || !this.missileR) return null;
    const launcher = this.missileFromLeft ? this.missileL : this.missileR;
    this.missileFromLeft = !this.missileFromLeft;
    this.mesh.updateMatrixWorld(true);
    launcher.getWorldPosition(out);
    return out;
  }

  triggerGunRecoil() {
    const fromLeft = this.fireFromLeft;
    this.fireFromLeft = !this.fireFromLeft;
    if (fromLeft && this.gunL) this.gunRetractionL = GUN_RETRACT_AMOUNT;
    else if (!fromLeft && this.gunR) this.gunRetractionR = GUN_RETRACT_AMOUNT;
  }

  takeDamage(amount) {
    this.health = Math.max(0, this.health - amount);

    if (this.shipMesh) {
      this.shipMesh.traverse((child) => {
        if (child.isMesh && child.material.emissive) {
          child.material.emissiveIntensity = 1.0;
          setTimeout(() => {
            child.material.emissiveIntensity = 0.3;
          }, 100);
        }
      });
    }
  }

  setAlive(alive) {
    this.alive = alive;
    this.mesh.visible = alive;

    if (alive) {
      this.interpolation.reset();
    }
  }

  dispose() {
    this.engineTrails.forEach((t) => t.dispose());
    this.engineTrails.length = 0;
    this.scene.remove(this.mesh);

    this.mesh.traverse((child) => {
      if (child.geometry) child.geometry.dispose();
      if (child.material) {
        if (child.material.map) child.material.map.dispose();
        child.material.dispose();
      }
    });
  }
}
