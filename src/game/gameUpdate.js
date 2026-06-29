/**
 * gameUpdate.js - PER-FRAME GAME LOOP AND PLAY STATE UPDATE
 * =============================================================================
 *
 * ROLE: Drives the main tick. Updates physics, player, enemies, projectiles,
 * missiles, explosions, network sync, HUD, and audio. Only runs when game state
 * is PLAYING; menu/loading are handled elsewhere.
 *
 * KEY RESPONSIBILITIES:
 * - Export tick(game, delta, timestamp, frame) called from Game requestAnimationFrame
 * - Step physics (stepWorld), update player and engine audio, handle fire input
 * - Update enemies, projectiles, missiles; collision and combat resolution
 * - Sync remote players and network projectiles in multiplayer; update prediction
 * - Update HUD (health, kills, missiles, boost), damage indicators, depth-of-field
 *
 * RELATED: Physics.js, gameCombat.js, gameEnemies.js, gameNetworkProjectiles.js,
 * gamePlayerLifecycle.js, gameInGameUI.js, EngineAudio.js, ProceduralAudio.js.
 *
 * =============================================================================
 */

import * as THREE from "three";
import { stepWorld } from "../physics/Physics.js";
import { updateDestruction } from "../vfx/ShipDestruction.js";
import NetworkManager from "../network/NetworkManager.js";
import proceduralAudio from "../audio/ProceduralAudio.js";
import engineAudio from "../audio/EngineAudio.js";
import * as gameInGameUI from "./gameInGameUI.js";
import { syncNetworkBotsWithState } from "./gameMultiplayer.js";
import { processDeferredProximityEnemySpawns } from "./gameEnemies.js";
import { updateCharonReactorExplosionFlash, updateCharonReactorCoreHealthBar, updateCoreSplatFx } from "./charonReactorCore.js";
import {
  applyCharonEscapeShakeEndFrame,
  applyCharonEscapeShakeStartFrame,
  updateCharonReactorEscapeSequence,
} from "./charonEscapeSequence.js";
import { updateCockpitEnvZones } from "../utils/cockpitEnvZones.js";

const _audioForward = new THREE.Vector3();
const _audioUp = new THREE.Vector3();
const _unitForward = new THREE.Vector3();
const _networkBotTargetPos = new THREE.Vector3();
const _networkBotTargetQuat = new THREE.Quaternion();

const MISSILE_BOT_POOL_START = 32;

function buildSoloPlayerHomingTarget(game) {
  if (!game._soloPlayerHomingTarget) {
    const o = new THREE.Object3D();
    game._soloPlayerHomingTarget = {
      mesh: o,
      health: 100,
      alive: true,
    };
  }
  const pos =
    game.xrManager?.isPresenting && game.xrManager.rig
      ? game.xrManager.rig.position
      : game.camera.position;
  game._soloPlayerHomingTarget.mesh.position.copy(pos);
  return game._soloPlayerHomingTarget;
}

function buildMissileTargets(game) {
  let mt = game._missileTargetsScratch;
  if (!mt) mt = game._missileTargetsScratch = [];
  mt.length = 0;
  for (let i = 0; i < game.enemies.length; i++) {
    mt.push(game.enemies[i]);
  }
  game.remotePlayers.forEach((remote) => {
    mt.push(remote);
  });
  if (game.isMultiplayer && game.networkBots?.size) {
    const roomState = NetworkManager.getState();
    const bots = roomState?.bots;
    if (!bots) return mt;
    let pool = game._missileBotTargetPool;
    if (!pool) {
      pool = game._missileBotTargetPool = [];
      for (let k = 0; k < MISSILE_BOT_POOL_START; k++) {
        pool.push({ mesh: null, health: 0, alive: true });
      }
    }
    let bi = 0;
    bots.forEach((bot, id) => {
      const entry = game.networkBots.get(id);
      if (!entry?.mesh) return;
      let d = pool[bi];
      if (!d) {
        d = { mesh: null, health: 0, alive: true };
        pool.push(d);
      }
      bi++;
      const h = bot.health ?? 0;
      d.mesh = entry.mesh;
      d.health = h;
      d.alive = h > 0;
      mt.push(d);
    });
  }
  return mt;
}

function restoreBaseCameraLayers(game) {
  if (!game.camera) return;
  if (game._baseCameraLayerMask == null) {
    game._baseCameraLayerMask = game.camera.layers.mask;
  }
  game.camera.layers.mask = game._baseCameraLayerMask;
}

function renderCaptionOverlay(game) {
  if (game.hidePilotChrome) return;
  const captionMesh = game.dialogManager?.captionMesh;
  const captionLayer = game.dialogManager?.captionRenderLayer;
  if (!captionMesh?.visible || captionLayer == null) return;

  if (game._baseCameraLayerMask == null) {
    game._baseCameraLayerMask = game.camera.layers.mask;
  }

  const previousCameraMask = game.camera.layers.mask;
  const previousAutoClear = game.renderer.autoClear;
  const previousBackground = game.scene.background;
  const previousBackgroundBlurriness = game.scene.backgroundBlurriness;
  const previousBackgroundIntensity = game.scene.backgroundIntensity;
  try {
    game.camera.layers.set(captionLayer);
    game.renderer.autoClear = false;
    game.scene.background = null;
    game.scene.backgroundBlurriness = 0;
    game.scene.backgroundIntensity = 0;
    game.renderer.clearDepth();
    game.renderer.render(game.scene, game.camera);
  } finally {
    game.camera.layers.mask = previousCameraMask;
    game.renderer.autoClear = previousAutoClear;
    game.scene.background = previousBackground;
    game.scene.backgroundBlurriness = previousBackgroundBlurriness;
    game.scene.backgroundIntensity = previousBackgroundIntensity;
  }
}

export function tick(game, delta, timestamp, frame) {
  game._frameCount++;
  const isPlaying = game.gameManager.isPlaying();

  if (!isPlaying) {
    proceduralAudio.shieldRechargeStop();
    proceduralAudio.boosterRechargeStop();
    game._boostFuelRechargePrev = null;
    if (game.sparkRenderer) {
      game._boostDoFApertureAngle = 0;
      game.sparkRenderer.apertureAngle = 0;
    }
  }

  if (game.xrManager) {
    game.xrManager.update(timestamp, frame);
  }

  game.input.pollGamepad();

  if (isPlaying) {
    game.dynamicSceneElementManager?.update();
    stepWorld();

    const multiplayerDead =
      game.isMultiplayer &&
      NetworkManager.getLocalPlayer() &&
      !NetworkManager.getLocalPlayer().alive;

    if (multiplayerDead) {
      proceduralAudio.shieldRechargeStop();
      proceduralAudio.boosterRechargeStop();
      game._boostFuelRechargePrev = null;
    }

    if (!game._soloRespawning && !multiplayerDead) {
      game.input.update(delta);
      game.handleGamepadFire();

      if (game.player) {
        applyCharonEscapeShakeStartFrame(game);
        game.player.update(delta, game.clock.elapsedTime);
        updateCockpitEnvZones(game, delta);
        game.dialogManager?.update(delta);
        updateCharonReactorExplosionFlash(game, delta);
        updateCoreSplatFx(game, delta);
        updateCharonReactorCoreHealthBar(game);
        if (!game.isMultiplayer) {
          game.levelTriggerManager?.update();
        }
        updateCharonReactorEscapeSequence(game, delta);
        applyCharonEscapeShakeEndFrame(game, delta);
        if (game.isMultiplayer) {
          const localPlayer = NetworkManager.getLocalPlayer();
          if (localPlayer) {
            game.player.boostFuel = localPlayer.boostFuel;
            game.player.maxBoostFuel = localPlayer.maxBoostFuel;
            game.player.isBoosting = localPlayer.isBoosting;
          }
        }
        engineAudio.update(delta, game.player);
        updateBoostDoF(game, delta);
        // Afterburner trail only on remote players (RemotePlayer); local player does not show own trail
        if (!game.isMultiplayer) {
          const p = game.player;
          const elapsed = game.clock.elapsedTime;
          if (
            p.health < p.maxHealth &&
            elapsed - p.lastDamageTime >= p.shieldRegenDelay
          ) {
            p.health = Math.min(
              p.maxHealth,
              p.health + p.shieldRegenRate * delta,
            );
          }
          const isShieldRecharging =
            p.health < p.maxHealth &&
            elapsed - p.lastDamageTime >= p.shieldRegenDelay;
          if (isShieldRecharging) {
            proceduralAudio.shieldRechargeUpdate(p.health / p.maxHealth);
          } else {
            proceduralAudio.shieldRechargeStop();
          }
        } else {
          const p = game.player;
          if (p.health < p.maxHealth) {
            proceduralAudio.shieldRechargeUpdate(p.health / p.maxHealth);
          } else {
            proceduralAudio.shieldRechargeStop();
          }
        }

        const prevBoostFuel = game._boostFuelRechargePrev;
        const fuel = game.player.boostFuel;
        const maxFuel = game.player.maxBoostFuel || 1;
        const boostRecharging =
          prevBoostFuel != null &&
          fuel < maxFuel &&
          fuel > prevBoostFuel;
        if (boostRecharging) {
          proceduralAudio.boosterRechargeUpdate(fuel / maxFuel);
        } else {
          proceduralAudio.boosterRechargeStop();
        }
        game._boostFuelRechargePrev = fuel;
      }
    }

    game.remotePlayers.forEach((remote) => {
      remote.update(delta);
    });

    if (game.isMultiplayer) {
      syncNetworkBotsWithState(game);
      const bots = NetworkManager.getState()?.bots;
      if (bots) {
        const smooth = 1 - Math.exp(-18 * delta);
        bots.forEach((bot, id) => {
          const entry = game.networkBots.get(id);
          if (entry?.mesh) {
            _networkBotTargetPos.set(bot.x, bot.y, bot.z);
            entry.mesh.position.lerp(_networkBotTargetPos, smooth);
            _networkBotTargetQuat.set(bot.qx, bot.qy, bot.qz, bot.qw);
            entry.mesh.quaternion.slerp(_networkBotTargetQuat, smooth);
            entry.spawnWarp?.update?.(delta);
          }
        });
      }
    }

    game.collectibles.forEach((collectible) => {
      collectible.update(delta);
    });

    if (!game.isMultiplayer) {
      const playerPos = game.xrManager?.isPresenting
        ? game.xrManager.rig.position
        : game.camera.position;
      game._checkMissilePickups(playerPos, delta);
    }

    if (!game.isMultiplayer) {
      processDeferredProximityEnemySpawns(game);
      // Respawns before enemy.update so pooled bots get spawnWarp.update() the same frame
      // they become visible (otherwise first paint can miss dissolve / look like a pop-in).
      game.tickEnemyRespawns(delta);
    }

    // Before solo enemy.update: wave spawns (training / mission) run here so new bots get
    // spawnWarp.update(delta) in the same frame they are activated.
    game.missionManager?.update(delta);

    if (!game.isMultiplayer) {
      const cullDist =
        game.gameManager.getPerformanceProfile().enemyCullDistance ?? 200;
      for (let i = 0; i < game.alliedShips.length; i++) {
        game.alliedShips[i].update(
          delta,
          game,
          game.boundFireAlly,
          game._frameCount,
        );
      }
      for (let i = 0; i < game.enemies.length; i++) {
        game.enemies[i].update(
          delta,
          game.camera.position,
          game.boundFireEnemy,
          game._frameCount,
          cullDist,
          game,
        );
      }
    }

    game.projectiles.forEach((proj) => proj.update(delta));

    const missileTargets = buildMissileTargets(game);
    const soloPlayerTarget = buildSoloPlayerHomingTarget(game);
    game.missiles.forEach((m) =>
      m.update(delta, m.enemyOwned ? [soloPlayerTarget] : missileTargets),
    );

    if (game.isMultiplayer) {
      game.localMissileIds.forEach((missile, serverId) => {
        if (missile.disposed || missile.lifetime <= 0) {
          game.localMissileIds.delete(serverId);
        } else {
          NetworkManager.sendMissileUpdate(
            serverId,
            missile.group.position,
            missile.direction,
          );
        }
      });
    }

    game.networkProjectiles.forEach((data, id) => {
      if (data.type === "projectile") {
        data.obj.update(delta);
      } else if (data.type === "missile") {
        const serverProj = NetworkManager.getState()?.projectiles?.get(id);
        if (serverProj && data.targetPosition && data.targetDirection) {
          data.targetPosition.set(serverProj.x, serverProj.y, serverProj.z);
          data.targetDirection.set(serverProj.dx, serverProj.dy, serverProj.dz).normalize();
          const smooth = 1 - Math.exp(-18 * delta);
          data.obj.group.position.lerp(data.targetPosition, smooth);
          data.obj.direction.lerp(data.targetDirection, smooth).normalize();
          _unitForward.set(0, 0, 1);
          data.obj.group.quaternion.setFromUnitVectors(
            _unitForward,
            data.obj.direction,
          );
        } else if (serverProj) {
          data.obj.group.position.set(serverProj.x, serverProj.y, serverProj.z);
          data.obj.direction
            .set(serverProj.dx, serverProj.dy, serverProj.dz)
            .normalize();
          _unitForward.set(0, 0, 1);
          data.obj.group.quaternion.setFromUnitVectors(
            _unitForward,
            data.obj.direction,
          );
        }

        data.obj.lifetime -= delta;
        if (data.obj.particles) {
          data.obj.spawnTimer += delta;
          while (data.obj.spawnTimer >= data.obj.spawnRate) {
            data.obj.spawnTimer -= data.obj.spawnRate;
            data.obj.trailsEffect.emitMissileExhaust(
              data.obj.group.position,
              data.obj.group.quaternion,
              data.obj.direction,
            );
          }
        }
        data.obj.trail.material.opacity = 0.6 + Math.random() * 0.25;
      }
    });

    for (let i = game.explosions.length - 1; i >= 0; i--) {
      if (!game.explosions[i].update(delta)) {
        game.explosions.splice(i, 1);
      }
    }

    for (let i = game.impacts.length - 1; i >= 0; i--) {
      if (!game.impacts[i].update(delta)) {
        game.impacts.splice(i, 1);
      }
    }

    updateDestruction(delta);

    game.checkCollisions();

    game.updateHUD(delta);
    gameInGameUI.updateDirectionalHelper(game, delta);
    gameInGameUI.updateLeaderboardTimer(game);
    game.sendInputToServer(delta);

    if (game.isMultiplayer && game.player) {
      game.prediction.applySmoothCorrection(game.camera.position, delta);
    }

    if (
      game.player &&
      game.player.health <= 0 &&
      !game.isMultiplayer &&
      !game._soloRespawning
    ) {
      game.gameManager.setState({
        deaths: (game.gameManager.getState().deaths || 0) + 1,
      });
      game._startSoloRespawn();
    }
  }

  game.particles?.update(delta);
  game.dynamicLights?.update(delta);
  game.musicManager?.update(delta);
  proceduralAudio.update(delta);
  engineAudio.updateDialogDuck(delta);
  game.gizmoManager?.update(delta);

  if (game.camera && proceduralAudio) {
    _audioForward.set(0, 0, -1).applyQuaternion(game.camera.quaternion);
    _audioUp.set(0, 1, 0).applyQuaternion(game.camera.quaternion);
    proceduralAudio.setListenerPosition(
      game.camera.position,
      _audioForward,
      _audioUp,
    );
  }

  if (game.projectileSplatLayer) {
    game.projectileSplatLayer.updateMatrixWorld(true);
  }

  restoreBaseCameraLayers(game);

  if (game.xrManager?.isPresenting) {
    game.renderer.render(game.scene, game.camera);
    renderCaptionOverlay(game);
  } else if (game._bloomActive) {
    game.composer.render();
    renderCaptionOverlay(game);
  } else {
    game.renderer.render(game.scene, game.camera);
    renderCaptionOverlay(game);
  }
}

export function updateBoostDoF(game, delta) {
  if (!game.sparkRenderer || !game.player) return;
  const target = game.player.isBoosting ? game._boostDoFAngleMax : 0;
  const rate = 6;
  const t = 1 - Math.exp(-rate * delta);
  game._boostDoFApertureAngle += (target - game._boostDoFApertureAngle) * t;
  game.sparkRenderer.apertureAngle = game._boostDoFApertureAngle;
}

export function updateBloomActive(game) {
  game._bloomActive = game.bloomEnabled && game.bloomPass.strength > 0.01;
  game.bloomPass.enabled = game._bloomActive;
  if (game.sparkRenderer) {
    game.sparkRenderer.encodeLinear = game._bloomActive;
  }
}

export function onResize(game) {
  const vp = window.visualViewport;
  const w = vp ? Math.round(vp.width) : window.innerWidth;
  const h = vp ? Math.round(vp.height) : window.innerHeight;
  game.camera.fov = 70;
  game.camera.aspect = w / h;
  game.camera.updateProjectionMatrix();
  game.renderer.setSize(w, h);
  game.composer?.setSize(w, h);
  game.bloomPass?.resolution?.set(w, h);
}
