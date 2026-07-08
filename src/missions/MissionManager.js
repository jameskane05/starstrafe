import * as THREE from "three";
import { flushRetainedEnemyMeshes, loadSharedShipMaterials } from "../entities/Enemy.js";
import {
  disposeMissionEnemyPool,
  disposePortalSummonEnemyPool,
  spawnEnemiesAtPointsWithPrewarm,
  spawnMissionWaveFromPool,
} from "../game/gameEnemies.js";
import { updateBloomActive } from "../game/gameUpdate.js";
import { MISSIONS } from "./missionsIndex.js";
import {
  allocateCheckpointDissolveBatchSerial,
  beginCheckpointDissolve,
  precookCheckpointDissolveMaterials,
  prewarmCheckpointDissolve,
  stripCheckpointDissolveMaterials,
} from "../vfx/checkpointDissolveWarp.js";
import proceduralAudio from "../audio/ProceduralAudio.js";
import { disposeWeaponPickupTrackers } from "./weaponPickupTracker.js";
import { disposeLevelBarrierTrackers } from "./levelBarrierTracker.js";
/** Beyond this world distance from checkpoint, spokes stay dull (HUD xu ≈ dist * 10). */
const RIM_BLOOM_FAR = 92;
/** Within this world distance, all six spokes reach full bloom (≈70 xu). */
const RIM_BLOOM_NEAR = 7;
/** >1 keeps early spokes dim longer so the chase “finishes” only on final approach. */
const RIM_BLOOM_APPROACH_EXP = 1.22;
const RIM_BLOOM_SMOOTH_RATE = 11;
const RIM_SPOKE_COUNT = 6;
/** Spokes are placed CCW by index i (angle = i / n * 2π). This is clockwise order around the ring. */
const RIM_BLOOM_CW_ORDER = [0, 5, 4, 3, 2, 1];
const RIM_SPOKE_PEAK_GAIN = 4.2;
const RIM_SPOKE_AUDIO_THRESH = 0.38;

/** Pooled gates: must match training `setCheckpointSequence` radius/tube/accent to reuse precompiled materials. */
const CHECKPOINT_POOL_SIZE = 8;
const CHECKPOINT_POOL_RADIUS = 6.5;
const CHECKPOINT_POOL_TUBE = 0.45;
const CHECKPOINT_POOL_COLOR = 0x00e8ff;
const CHECKPOINT_POOL_ACCENT = 0x8affff;

/*
 * --- Checkpoint GPU pipeline (solo campaign pattern) ---
 *
 * 1) POOL BUILD (initCheckpointVisualPool, game init): each slot gets precookCheckpointDissolveMaterials
 *    with the SAME sharedDissolveBatchSerial so identical gates share WebGL programs (see
 *    checkpointDissolveWarp.js header).
 *
 * 2) FIRST-VIEW PREWARM (prewarmCheckpointPoolDuringFirstView): while the splat/cockpit overlay is up,
 *    briefly show all pool meshes, run narrowWarmKeepingSceneRoots(checkpointPoolRoot) — compile +
 *    one composer/render with splats/level hidden — then restore visibilities. Sets
 *    game._checkpointPoolGpuWarmed = true. Wire new campaign features the same way: overlap with
 *    waitForFirstViewReady in gameSolo.js, never full-scene warm (TDR risk on big levels).
 *
 * 3) SPAWN (setCheckpointSequence): narrowWarmCheckpointsForPlay(..., { skipIfPoolPrewarmed: usePool })
 *    skips redundant work if (2) ran. Fallback non-pooled gates still get a narrow warm here.
 *
 * Reuse narrowWarmKeepingSceneRoots(game, [yourPoolRoot]) for other pooled props (holograms, props, …).
 *
 * Mission **enemy** pool: gameEnemies.initTrainingMissionEnemyPool — same shared dissolve batch idea,
 * narrow prewarm via prewarmEnemyMeshesInPlace (camera + spawn placement). No first-view pass today;
 * init runs before PLAYING plus warmGpuProgramsForPlay. See gameEnemies.js header.
 */

const _checkpointWobbleAxis = new THREE.Vector3(0, 0, 1);
const _checkpointWobbleQuat = new THREE.Quaternion();

/** TorusGeometry major ring is in XY; Blender goal empties + glTF Y-up need this to match a vertical hoop. */
const CHECKPOINT_TORUS_CORRECTION = new THREE.Quaternion().setFromEuler(
  new THREE.Euler(-Math.PI / 2, 0, 0, "XYZ"),
);

function composeCheckpointBaseQuaternion(pointQuat) {
  const q = pointQuat ? pointQuat.clone() : new THREE.Quaternion();
  q.multiply(CHECKPOINT_TORUS_CORRECTION);
  return q;
}

/** @returns {{ position: THREE.Vector3, quaternion: THREE.Quaternion | null }[]} */
function normalizeCheckpointEntries(points) {
  if (!Array.isArray(points) || points.length === 0) return [];
  return points
    .map((p) => {
      if (p?.isVector3) {
        return { position: p.clone(), quaternion: null };
      }
      if (p?.position?.isVector3) {
        const q =
          p.quaternion && p.quaternion.isQuaternion
            ? p.quaternion.clone()
            : null;
        return { position: p.position.clone(), quaternion: q };
      }
      return null;
    })
    .filter(Boolean);
}

/** Clones GPU textures so checkpoint teardown / prewarm dispose cannot affect ship materials. */
function cloneTexForCheckpointPanel(baseTex, repeatU, repeatV) {
  if (!baseTex) return null;
  const t = baseTex.clone();
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(repeatU, repeatV);
  t.needsUpdate = true;
  return t;
}

function createCheckpointVisual(
  radius,
  tube,
  color = 0x00e8ff,
  accent = 0x8affff,
  sharedShipTex = null,
) {
  const group = new THREE.Group();
  const hullColor = new THREE.Color(0x11161c);
  const lightColor = new THREE.Color(color).lerp(new THREE.Color(accent), 0.35);

  let hullMaterial;
  if (
    sharedShipTex?.hullLightsDiffuse &&
    sharedShipTex?.hullLightsEmit &&
    sharedShipTex?.normalMap
  ) {
    const hullTint = hullColor.clone().lerp(lightColor, 0.28);
    const emitTint = new THREE.Color(0xffffff).lerp(lightColor, 0.42);
    hullMaterial = new THREE.MeshStandardMaterial({
      color: hullTint,
      map: cloneTexForCheckpointPanel(sharedShipTex.hullLightsDiffuse, 5, 2),
      emissive: emitTint,
      emissiveMap: cloneTexForCheckpointPanel(sharedShipTex.hullLightsEmit, 5, 2),
      emissiveIntensity: 1.35,
      metalness: 0.28,
      roughness: 0.58,
      normalMap: cloneTexForCheckpointPanel(sharedShipTex.normalMap, 5, 2),
      normalScale: new THREE.Vector2(0.9, 0.9),
      side: THREE.DoubleSide,
      depthWrite: true,
      depthTest: true,
    });
  } else {
    hullMaterial = new THREE.MeshStandardMaterial({
      color: hullColor,
      emissive: lightColor.clone().multiplyScalar(0.12),
      emissiveIntensity: 0.85,
      metalness: 0.72,
      roughness: 0.4,
      depthWrite: true,
      depthTest: true,
    });
  }
  const greebleTrimMaterial = new THREE.MeshStandardMaterial({
    color: new THREE.Color(0x1f2b33),
    emissive: new THREE.Color(color).multiplyScalar(0.05),
    emissiveIntensity: 0.32,
    metalness: 0.74,
    roughness: 0.4,
    depthWrite: true,
    depthTest: true,
  });
  const arcGlowMaterial = new THREE.MeshStandardMaterial({
    color: lightColor,
    emissive: lightColor,
    emissiveIntensity: 0.72,
    metalness: 0.15,
    roughness: 0.35,
    depthWrite: true,
    depthTest: true,
  });
  const spokeGlowMaterial = new THREE.MeshStandardMaterial({
    color: lightColor,
    emissive: lightColor,
    emissiveIntensity: 0.08,
    metalness: 0.15,
    roughness: 0.35,
    depthWrite: true,
    depthTest: true,
  });

  const outerRing = new THREE.Mesh(
    new THREE.TorusGeometry(radius, tube, 16, 56),
    hullMaterial,
  );
  group.add(outerRing);

  const midRing = new THREE.Mesh(
    new THREE.TorusGeometry(radius * 0.9, tube * 0.18, 12, 40),
    greebleTrimMaterial,
  );
  group.add(midRing);

  const arcGeometry = new THREE.TorusGeometry(
    radius * 1.12,
    tube * 0.16,
    10,
    36,
    1.55,
  );
  const arcPivotA = new THREE.Group();
  const arcA = new THREE.Mesh(arcGeometry, arcGlowMaterial);
  arcA.rotation.z = 0.45;
  arcPivotA.add(arcA);
  group.add(arcPivotA);

  const arcPivotB = new THREE.Group();
  const arcB = new THREE.Mesh(arcGeometry, arcGlowMaterial);
  arcB.rotation.z = Math.PI + 0.85;
  arcB.rotation.y = Math.PI / 2;
  arcPivotB.add(arcB);
  group.add(arcPivotB);

  const nodeGeometry = new THREE.BoxGeometry(tube * 1.4, tube * 1.4, tube * 3.6);

  const rimBricks = [];
  for (let i = 0; i < RIM_SPOKE_COUNT; i++) {
    const angle = (i / RIM_SPOKE_COUNT) * Math.PI * 2;
    const node = new THREE.Mesh(nodeGeometry, spokeGlowMaterial.clone());
    node.position.set(
      Math.cos(angle) * radius * 0.92,
      Math.sin(angle) * radius * 0.92,
      0,
    );
    node.lookAt(0, 0, 0);
    group.add(node);

    node.userData._rimBloomBase = 0.028;
    node.userData._rimBloomGain = RIM_SPOKE_PEAK_GAIN;

    rimBricks.push({ meshes: [node] });
  }
  group.scale.setScalar(2);

  group.userData.arcPivotA = arcPivotA;
  group.userData.arcPivotB = arcPivotB;
  group.userData.innerRing = null;
  group.userData.rimBricks = rimBricks;
  arcA.userData._pulseEmissiveBase = arcA.material.emissiveIntensity;
  arcB.userData._pulseEmissiveBase = arcB.material.emissiveIntensity;
  group.userData.pulseMeshes = [arcA, arcB];

  group.frustumCulled = false;
  group.traverse((o) => {
    if (o.isMesh) o.frustumCulled = false;
  });

  return group;
}

function cloneObjectives(objectives = []) {
  return objectives.map((objective, index) => ({
    id: objective.id ?? `objective-${index}`,
    text: objective.text ?? "",
    completed: objective.completed === true,
  }));
}

export class MissionManager {
  constructor(game) {
    this.game = game;
    this.gameManager = game.gameManager;
    this.currentMission = null;
    this.currentStep = null;
    this.currentObjectives = [];
    this.runtime = {};
    this.checkpointGroup = null;
    this.checkpoints = [];
    this.activeCheckpointIndex = 0;
    this._dialogCompleteHandler = (dialog) => {
      this.reportEvent("dialogCompleted", {
        id: dialog?.id ?? null,
        dialog,
      });
    };
    this._dialogMissionMilestoneHandler = (payload) => {
      this.reportEvent("dialogMissionMilestone", payload ?? {});
    };
    this.gameManager.on("dialog:completed", this._dialogCompleteHandler);
    this.gameManager.on(
      "dialog:missionMilestone",
      this._dialogMissionMilestoneHandler,
    );
  }

  async startMission(missionId, options = {}) {
    const mission = MISSIONS[missionId];
    if (!mission) {
      throw new Error(`Unknown mission: ${missionId}`);
    }

    this.stopMission({ preserveState: true });
    this.currentMission = mission;
    this.runtime = {};

    const missionLevelId = options.levelId ?? mission.defaultLevelId ?? null;
    this.gameManager.setState({
      currentMissionId: mission.id,
      missionLevelId,
      missionStatus: "active",
      missionStepId: null,
      missionStepTitle: "",
      currentObjectives: [],
    });

    if (mission.start) {
      await mission.start(this, options);
    }

    const requestedStep = options.debugStepId;
    const stepId =
      typeof requestedStep === "string" &&
      requestedStep.length > 0 &&
      mission.steps?.[requestedStep]
        ? requestedStep
        : mission.startStepId;
    if (
      typeof requestedStep === "string" &&
      requestedStep.length > 0 &&
      stepId !== requestedStep &&
      // Saturnalia `escape` is a start() alias, not a real step key.
      !(missionId === "saturnalia" && requestedStep === "escape")
    ) {
      console.warn(
        `[Mission] Unknown debugStep "${requestedStep}" for mission "${missionId}". Valid steps:`,
        mission.steps ? Object.keys(mission.steps) : [],
      );
    }
    await this.enterStep(stepId);
  }

  stopMission(options = {}) {
    flushRetainedEnemyMeshes(this.game);
    if (!options.preserveState) {
      disposeMissionEnemyPool(this.game);
      disposePortalSummonEnemyPool(this.game);
    }
    this.game._enemyReticleEnemy = null;
    this.game._checkpointDissolvePrewarmed = false;
    this.clearCheckpoints();
    this.clearDirectionalHelperTarget();
    disposeWeaponPickupTrackers(this);
    disposeLevelBarrierTrackers(this);
    this.runtime.cannonTrackerEl?.remove();
    this.currentMission = null;
    this.currentStep = null;
    this.currentObjectives = [];
    this.runtime = {};

    if (!options.preserveState) {
      this.gameManager.clearMissionState();
    }
  }

  destroy() {
    disposeMissionEnemyPool(this.game);
    disposePortalSummonEnemyPool(this.game);
    this.stopMission({ preserveState: true });
    this.gameManager.off("dialog:completed", this._dialogCompleteHandler);
    this.gameManager.off(
      "dialog:missionMilestone",
      this._dialogMissionMilestoneHandler,
    );
  }

  isActive() {
    if (this.currentMission == null) return false;
    const ms = this.gameManager.getState().missionStatus;
    return ms === "active" || ms === "starting";
  }

  shouldSuppressRespawns() {
    return this.isActive();
  }

  prewarmCheckpointGraphics() {
    const game = this.game;
    if (!game?.renderer?.compile || !game.camera || game._checkpointDissolvePrewarmed) {
      return;
    }
    const schedule = async () => {
      if (game._checkpointDissolvePrewarmed || !game.renderer?.compile || !game.camera) {
        return;
      }
      game._checkpointDissolvePrewarmed = true;
      let sharedTex = null;
      try {
        sharedTex = await loadSharedShipMaterials();
      } catch {
        /* fallback hull in createCheckpointVisual */
      }
      const mesh = createCheckpointVisual(4.5, 0.45, 0x00e8ff, 0x8affff, sharedTex);
      try {
        prewarmCheckpointDissolve(game.renderer, game.camera, mesh);
      } catch (err) {
        game._checkpointDissolvePrewarmed = false;
        console.warn("[Mission] Checkpoint dissolve prewarm failed:", err);
      }
      mesh.traverse((child) => {
        child.geometry?.dispose?.();
        const mats = Array.isArray(child.material)
          ? child.material
          : [child.material];
        for (const m of mats) m?.dispose?.();
      });
    };
    requestAnimationFrame(() => requestAnimationFrame(() => void schedule()));
  }

  async enterStep(stepId) {
    if (!this.currentMission) return;
    const step = this.currentMission.steps?.[stepId];
    if (!step) {
      throw new Error(`Unknown mission step: ${stepId}`);
    }

    this.clearCheckpoints();
    this.currentStep = step;
    this.currentObjectives = [];
    this.runtime.stepId = stepId;

    this.gameManager.setState({
      missionStepId: stepId,
      missionStepTitle: step.title ?? "",
      currentObjectives: [],
    });

    if (step.enter) {
      await step.enter(this);
    }
  }

  update(delta) {
    if (!this.isActive() || !this.gameManager.isPlaying()) return;
    this.updateCheckpoints(delta);
    this.currentStep?.update?.(this, delta);
  }

  reportEvent(type, payload = {}) {
    if (!this.isActive()) return;
    this.currentStep?.onEvent?.(this, type, payload);
  }

  setObjectives(title, objectives = []) {
    this.currentObjectives = cloneObjectives(objectives);
    this.gameManager.setState({
      missionStepTitle: title ?? "",
      currentObjectives: this.currentObjectives,
    });
  }

  updateObjective(id, patch = {}) {
    const objective = this.currentObjectives.find((entry) => entry.id === id);
    if (!objective) return;
    Object.assign(objective, patch);
    this.gameManager.setState({
      currentObjectives: [...this.currentObjectives],
    });
  }

  completeObjective(id) {
    this.updateObjective(id, { completed: true });
  }

  areObjectivesComplete(ids = null) {
    const relevant = ids
      ? this.currentObjectives.filter((entry) => ids.includes(entry.id))
      : this.currentObjectives;
    return relevant.length > 0 && relevant.every((entry) => entry.completed);
  }

  getPlayerPosition() {
    return this.game.xrManager?.isPresenting
      ? this.game.xrManager.rig.position
      : this.game.camera.position;
  }

  setDirectionalHelperTarget(target = null) {
    this.game.directionalHelperTarget = target ?? null;
  }

  clearDirectionalHelperTarget(type = null) {
    if (!type || this.game.directionalHelperTarget?.type === type) {
      this.game.directionalHelperTarget = null;
    }
  }

  async setCheckpointSequence(points, options = {}) {
    this.clearCheckpoints();
    const entries = normalizeCheckpointEntries(points);
    if (!entries.length) return;

    const color = options.color ?? 0x00e8ff;
    const radius = options.radius ?? 5;
    const tube = options.tube ?? 0.45;
    const accent = options.accentColor ?? 0x8affff;
    const usePool =
      this.game._checkpointVisualPool?.slots &&
      entries.length <= CHECKPOINT_POOL_SIZE &&
      Math.abs(radius - CHECKPOINT_POOL_RADIUS) < 0.001 &&
      Math.abs(tube - CHECKPOINT_POOL_TUBE) < 0.001 &&
      color === CHECKPOINT_POOL_COLOR &&
      accent === CHECKPOINT_POOL_ACCENT;

    this.checkpointGroup = new THREE.Group();
    this.checkpointGroup.renderOrder = 50;
    this.game.scene.add(this.checkpointGroup);

    const yieldFrame = () =>
      new Promise((resolve) => requestAnimationFrame(resolve));

    this.checkpoints = [];
    if (usePool) {
      await this.game._checkpointVisualPoolInitPromise?.catch?.(() => {});
      const { slots } = this.game._checkpointVisualPool;
      for (let index = 0; index < entries.length; index++) {
        const { position: point, quaternion: pointQuat } = entries[index];
        const baseQuaternion = composeCheckpointBaseQuaternion(pointQuat);
        const slot = slots[index];
        slot.inUse = true;
        const mesh = slot.mesh;
        this.game.checkpointPoolRoot.remove(mesh);
        mesh.position.copy(point);
        mesh.quaternion.copy(baseQuaternion);
        mesh.visible = false;
        this.checkpointGroup.add(mesh);
        this.checkpoints.push({
          index,
          position: point.clone(),
          baseQuaternion,
          radius: options.triggerRadius ?? radius + 1.5,
          mesh,
          spawnWarp: null,
          reached: false,
          dissolvePrecooked: slot.dissolvePrecooked,
          poolSlotIndex: slot.poolIndex,
          fromPool: true,
        });
      }
    } else {
      const sharedShipTex = await loadSharedShipMaterials();
      for (let index = 0; index < entries.length; index++) {
        await yieldFrame();
        const { position: point, quaternion: pointQuat } = entries[index];
        const baseQuaternion = composeCheckpointBaseQuaternion(pointQuat);
        const mesh = createCheckpointVisual(
          radius,
          tube,
          color,
          accent,
          sharedShipTex,
        );
        mesh.position.copy(point);
        mesh.quaternion.copy(baseQuaternion);
        mesh.visible = false;
        const dissolvePrecooked = precookCheckpointDissolveMaterials(mesh, {
          edgeColor: 0x8affff,
          edgeColor2: 0x4dffff,
        });
        this.checkpointGroup.add(mesh);
        this.checkpoints.push({
          index,
          position: point.clone(),
          baseQuaternion,
          radius: options.triggerRadius ?? radius + 1.5,
          mesh,
          spawnWarp: null,
          reached: false,
          dissolvePrecooked,
          fromPool: false,
        });
      }
    }

    this.activeCheckpointIndex = 0;
    this._activateCheckpoint(this.checkpoints[0]);
    this.setDirectionalHelperTarget({
      type: "checkpoint",
      getWorldPosition: (out) => {
        const checkpoint = this.checkpoints[this.activeCheckpointIndex];
        if (!checkpoint || checkpoint.reached || !checkpoint.mesh?.visible) {
          return null;
        }
        return out.copy(checkpoint.position);
      },
    });

    // See file header “Checkpoint GPU pipeline”: no-op when pool was prewarmed during first-view load.
    narrowWarmCheckpointsForPlay(this.game, this.checkpointGroup, {
      skipIfPoolPrewarmed: usePool,
    });
  }

  _updateCheckpointRimBloom(
    mesh,
    delta,
    playerPos,
    checkpointWorldPos,
    rimSpokeAudio = false,
  ) {
    const rim = mesh.userData.rimBricks;
    if (!rim?.length) return;
    if (!mesh.userData._rimBloomSmooth) {
      mesh.userData._rimBloomSmooth = new Float32Array(rim.length);
    }
    const smooth = mesh.userData._rimBloomSmooth;
    const dist = playerPos.distanceTo(checkpointWorldPos);
    const tDist = Math.max(
      0,
      1 - THREE.MathUtils.smoothstep(dist, RIM_BLOOM_NEAR, RIM_BLOOM_FAR),
    );
    const approachAmt = Math.pow(tDist, RIM_BLOOM_APPROACH_EXP);
    const n = rim.length;
    const k = 1 - Math.exp(-RIM_BLOOM_SMOOTH_RATE * Math.max(0, delta || 0));

    const cw =
      RIM_BLOOM_CW_ORDER.length === n
        ? RIM_BLOOM_CW_ORDER
        : Array.from({ length: n }, (_, i) => (i === 0 ? 0 : n - i));

    const u = approachAmt * n;

    for (let rank = 0; rank < n; rank++) {
      const brickIdx = cw[rank] ?? rank;
      let targetT = THREE.MathUtils.clamp(u - rank, 0, 1);
      targetT = targetT * targetT * (3 - 2 * targetT);
      smooth[brickIdx] += (targetT - smooth[brickIdx]) * k;
      const t = smooth[brickIdx];
      for (const obj of rim[brickIdx].meshes ?? []) {
        const mat = obj?.material;
        if (!mat) continue;
        const base = obj.userData._rimBloomBase ?? 0;
        const gain = obj.userData._rimBloomGain ?? 0;
        mat.emissiveIntensity = base + gain * t;
      }
    }

    let prevSmooth = mesh.userData._rimBloomPrevSmooth;
    if (!prevSmooth || prevSmooth.length !== n) {
      prevSmooth = new Float32Array(n);
      mesh.userData._rimBloomPrevSmooth = prevSmooth;
    }
    for (let brickIdx = 0; brickIdx < n; brickIdx++) {
      if (
        rimSpokeAudio &&
        smooth[brickIdx] > RIM_SPOKE_AUDIO_THRESH &&
        prevSmooth[brickIdx] <= RIM_SPOKE_AUDIO_THRESH
      ) {
        const rank = cw.indexOf(brickIdx);
        if (rank >= 0) proceduralAudio.checkpointRimSpokePulse(rank);
      }
      prevSmooth[brickIdx] = smooth[brickIdx];
    }
  }

  updateCheckpoints(delta = 0) {
    if (!this.checkpoints.length) return;
    const elapsed = this.game.clock?.getElapsedTime?.() ?? performance.now() / 1000;
    const playerPos = this.getPlayerPosition();
    for (const checkpointEntry of this.checkpoints) {
      const mesh = checkpointEntry.mesh;
      checkpointEntry.spawnWarp?.update(delta);
      if (!mesh?.visible) continue;
      if (mesh.userData.arcPivotA) {
        mesh.userData.arcPivotA.rotation.z += delta * 0.9;
      }
      if (mesh.userData.arcPivotB) {
        mesh.userData.arcPivotB.rotation.z -= delta * 1.35;
      }
      mesh.userData.innerRing?.rotation &&
        (mesh.userData.innerRing.rotation.z -= delta * 0.75);
      const wobbleZ =
        Math.sin(elapsed * 1.8 + checkpointEntry.index * 0.7) * 0.08;
      _checkpointWobbleQuat.setFromAxisAngle(_checkpointWobbleAxis, wobbleZ);
      mesh.quaternion
        .copy(checkpointEntry.baseQuaternion)
        .multiply(_checkpointWobbleQuat);
      const pulse = 0.78 + (Math.sin(elapsed * 3.4 + checkpointEntry.index) + 1) * 0.12;
      for (const arc of mesh.userData.pulseMeshes ?? []) {
        const material = arc?.material;
        if (!material) continue;
        const eb = arc.userData._pulseEmissiveBase ?? 1.2;
        material.emissiveIntensity = eb * (0.75 + pulse * 0.46);
      }
      this._updateCheckpointRimBloom(
        mesh,
        delta,
        playerPos,
        checkpointEntry.position,
        checkpointEntry.index === this.activeCheckpointIndex &&
          !checkpointEntry.reached,
      );
    }

    const checkpoint = this.checkpoints[this.activeCheckpointIndex];
    if (!checkpoint || checkpoint.reached) return;

    if (checkpoint.spawnWarp && !checkpoint.spawnWarp.finished) return;

    if (playerPos.distanceTo(checkpoint.position) > checkpoint.radius) return;

    checkpoint.reached = true;
    checkpoint.mesh.visible = false;
    checkpoint.spawnWarp?.dispose?.();
    checkpoint.spawnWarp = null;
    proceduralAudio.checkpointGoalSuccess();
    this.reportEvent("checkpointReached", {
      index: checkpoint.index,
      completed: checkpoint.index + 1,
      total: this.checkpoints.length,
    });

    this.activeCheckpointIndex += 1;
    const nextCheckpoint = this.checkpoints[this.activeCheckpointIndex];
    if (nextCheckpoint) {
      this._activateCheckpoint(nextCheckpoint);
      return;
    }

    this.reportEvent("checkpointSequenceCompleted", {
      total: this.checkpoints.length,
    });
  }

  clearCheckpoints() {
    const hadNonPooled = this.checkpoints.some((c) => !c.fromPool);
    for (const c of this.checkpoints) {
      c.spawnWarp?.dispose?.();
      if (
        c.fromPool &&
        c.poolSlotIndex != null &&
        this.game._checkpointVisualPool?.slots
      ) {
        const slot = this.game._checkpointVisualPool.slots[c.poolSlotIndex];
        slot.inUse = false;
        this.checkpointGroup?.remove(c.mesh);
        c.mesh.visible = false;
        c.mesh.position.set(0, -8000 - slot.poolIndex * 120, 0);
        this.game.checkpointPoolRoot?.add(c.mesh);
      }
    }
    if (this.checkpointGroup) {
      if (hadNonPooled) {
        stripCheckpointDissolveMaterials(this.checkpointGroup);
        this.checkpointGroup.traverse((child) => {
          child.geometry?.dispose?.();
          const mats = child.material;
          if (Array.isArray(mats)) {
            for (const m of mats) m?.dispose?.();
          } else {
            mats?.dispose?.();
          }
        });
      }
      this.game.scene.remove(this.checkpointGroup);
    }
    this.checkpointGroup = null;
    this.checkpoints = [];
    this.activeCheckpointIndex = 0;
    this.clearDirectionalHelperTarget("checkpoint");
  }

  /** Debug: replay checkpoint intro dissolve (key U while playing). */
  debugReplayCheckpointWarp() {
    if (!this.checkpoints.length) return;
    const cp = this.checkpoints[this.activeCheckpointIndex];
    if (!cp?.mesh || cp.reached) return;
    if (cp.spawnWarp && !cp.spawnWarp.disposed) {
      cp.spawnWarp.restart({ hold: false });
      return;
    }
    cp.spawnWarp?.dispose?.();
    cp.spawnWarp = null;
    stripCheckpointDissolveMaterials(cp.mesh);
    cp.dissolvePrecooked = precookCheckpointDissolveMaterials(cp.mesh, {
      edgeColor: 0x8affff,
      edgeColor2: 0x4dffff,
    });
    this._activateCheckpoint(cp);
  }

  _activateCheckpoint(checkpoint) {
    if (!checkpoint?.mesh) return;
    checkpoint.mesh.userData._rimBloomSmooth = null;
    checkpoint.mesh.userData._rimBloomPrevSmooth = null;
    checkpoint.spawnWarp?.dispose?.();
    checkpoint.mesh.quaternion.copy(checkpoint.baseQuaternion);
    checkpoint.spawnWarp = beginCheckpointDissolve(checkpoint.mesh, this.game, {
      duration: 3.5,
      edgeColor: 0x8affff,
      edgeColor2: 0x4dffff,
      particleColor: 0x8affff,
      particles: false,
      retainDissolveMaterials: checkpoint.fromPool === true,
      dissolvePrecooked: checkpoint.dissolvePrecooked,
    });
    checkpoint.mesh.visible = true;
  }

  /**
   * Uses mission pool when count fits; otherwise async prewarms GPU then activates.
   * @returns {Promise<void>}
   */
  spawnEnemyWave(positions = []) {
    if (!positions.length) return Promise.resolve();
    this.game.enemyRespawnQueue.length = 0;
    if (spawnMissionWaveFromPool(this.game, positions)) {
      return Promise.resolve();
    }
    return spawnEnemiesAtPointsWithPrewarm(this.game, positions);
  }

  refillMissiles() {
    if (!this.game.player) return;
    this.game.player.missiles = this.game.player.maxMissiles;
    this.game.updateHUD();
  }

  completeMission(message = "TRAINING COMPLETE", options = {}) {
    flushRetainedEnemyMeshes(this.game);
    if (!options.preserveEnemyPool) {
      disposeMissionEnemyPool(this.game);
      disposePortalSummonEnemyPool(this.game);
    }
    this.clearCheckpoints();
    this.clearDirectionalHelperTarget();
    this.currentStep = null;
    this.currentObjectives = this.currentObjectives.map((objective) => ({
      ...objective,
      completed: true,
    }));
    this.gameManager.setState({
      missionStatus: "complete",
      missionStepTitle: options.stepTitle ?? "Training Complete",
      currentObjectives: [...this.currentObjectives],
    });
    if (options.missionCompleteOverlay) {
      this.game.showMissionCompleteOverlay?.(options.missionCompleteOverlayOptions);
    } else if (!options.suppressCompleteMessage) {
      this.game.showPickupMessage?.(message);
    }
  }
}

/**
 * Hidden gates + precooked dissolve under checkpointPoolRoot.
 * Do not set a "ready" flag before success — a failed init must leave usePool false (fallback path).
 *
 * sharedDissolveBatchSerial: one allocateCheckpointDissolveBatchSerial() for the entire pool loop so
 * every slot shares dissolve program suffixes with identical layout (campaign GPU note).
 */
export async function initCheckpointVisualPool(game) {
  if (game._checkpointVisualPoolBuilt) return;
  try {
    if (!game.scene) {
      return;
    }
    const sharedShipTex = await loadSharedShipMaterials();
    if (!game.checkpointPoolRoot) {
      const root = new THREE.Group();
      root.name = "CheckpointPoolRoot";
      game.scene.add(root);
      game.checkpointPoolRoot = root;
    }
    const slots = [];
    // Single batch id for all slots — see checkpointDissolveWarp.js “SOLO CAMPAIGN” header.
    const poolDissolveBatchSerial = allocateCheckpointDissolveBatchSerial();
    for (let i = 0; i < CHECKPOINT_POOL_SIZE; i++) {
      const mesh = createCheckpointVisual(
        CHECKPOINT_POOL_RADIUS,
        CHECKPOINT_POOL_TUBE,
        CHECKPOINT_POOL_COLOR,
        CHECKPOINT_POOL_ACCENT,
        sharedShipTex,
      );
      mesh.visible = false;
      mesh.position.set(0, -8000 - i * 120, 0);
      mesh.updateMatrixWorld(true);
      game.checkpointPoolRoot.add(mesh);
      const dissolvePrecooked = precookCheckpointDissolveMaterials(mesh, {
        edgeColor: 0x8affff,
        edgeColor2: 0x4dffff,
        sharedDissolveBatchSerial: poolDissolveBatchSerial,
      });
      slots.push({
        mesh,
        dissolvePrecooked,
        poolIndex: i,
        inUse: false,
      });
    }
    game._checkpointVisualPool = { slots };
    game._checkpointVisualPoolBuilt = true;
  } catch (err) {
    console.warn("[Mission] Checkpoint visual pool failed:", err);
    game._checkpointVisualPool = null;
  }
}

/** Directional/spot targets are often scene.children; keep them visible during narrow warm. */
function collectDirectionalLightTargetRoots(scene) {
  const keepSceneChildren = new Set();
  scene.traverse((o) => {
    if ((o.isDirectionalLight || o.isSpotLight) && o.target) {
      let n = o.target;
      while (n && n !== scene) {
        if (n.parent === scene) keepSceneChildren.add(n);
        n = n.parent;
      }
    }
  });
  return keepSceneChildren;
}

/**
 * “Narrow” GPU warm: hide every scene **top-level** child except `keepRoots`, lights, camera, and
 * light targets, then renderer.compile + one play-path render (composer if bloom).
 *
 * Invisible subtrees are skipped by compile/render — avoids full splat + level cost of warmGpuProgramsForPlay.
 * Use for any pooled campaign asset: pass `[poolRoot]` or `[checkpointGroup]`.
 */
function narrowWarmKeepingSceneRoots(game, keepRoots) {
  if (
    !game?.renderer ||
    !game?.camera ||
    !game?.scene ||
    !keepRoots?.length ||
    game.xrManager?.isPresenting
  ) {
    return;
  }

  const keep = new Set(keepRoots);
  const keepSceneChildren = collectDirectionalLightTargetRoots(game.scene);
  const hidden = [];
  for (const child of game.scene.children) {
    if (keep.has(child)) continue;
    if (child.isLight) continue;
    if (child.isCamera) continue;
    if (keepSceneChildren.has(child)) continue;
    hidden.push({ child, visible: child.visible });
    child.visible = false;
  }

  try {
    updateBloomActive(game);
    if (game.renderer.compile) {
      game.renderer.compile(game.scene, game.camera);
    }
    if (game._bloomActive && game.composer) {
      game.composer.render();
    } else {
      game.renderer.render(game.scene, game.camera);
    }
  } catch (e) {
    console.warn("[Mission] narrowWarmKeepingSceneRoots:", e);
  } finally {
    for (const { child, visible } of hidden) {
      child.visible = visible;
    }
  }
}

/**
 * Narrow-warm the **active** checkpoint group after setCheckpointSequence (fallback / non-pooled).
 * @param {object} [options] — `{ skipIfPoolPrewarmed: true }` when `usePool` and first-view prewarm ran.
 */
export function narrowWarmCheckpointsForPlay(game, checkpointGroup, options = {}) {
  if (options.skipIfPoolPrewarmed && game._checkpointPoolGpuWarmed) return;
  if (!checkpointGroup) return;
  narrowWarmKeepingSceneRoots(game, [checkpointGroup]);
}

/**
 * Run under the first-view loading overlay (see gameSolo.js Promise.all with waitForFirstViewReady).
 * Forces first draws + program finalization for **all** checkpoint pool meshes while splats stream.
 *
 * Sets `game._checkpointPoolGpuWarmed` so setCheckpointSequence can skip duplicate narrow warm.
 * **Campaign:** copy this pattern for other pools — store `game._<feature>GpuWarmed` and pair with
 * narrowWarmKeepingSceneRoots(game, [yourRoot]).
 */
export async function prewarmCheckpointPoolDuringFirstView(game) {
  if (game._checkpointPoolGpuWarmed) return;
  if (!game?.renderer || !game?.camera || !game?.scene || game.xrManager?.isPresenting) {
    return;
  }

  await game._checkpointVisualPoolInitPromise?.catch?.(() => {});
  const root = game.checkpointPoolRoot;
  const pool = game._checkpointVisualPool;
  if (!root || !pool?.slots?.length) return;

  const savedVis = pool.slots.map((s) => s.mesh.visible);
  for (const s of pool.slots) {
    s.mesh.visible = true;
  }
  narrowWarmKeepingSceneRoots(game, [root]);
  for (let i = 0; i < pool.slots.length; i++) {
    pool.slots[i].mesh.visible = savedVis[i];
  }
  game._checkpointPoolGpuWarmed = true;
}

/**
 * Full-scene compile + render (splats, level, everything). OK once at solo start after PLAYING;
 * **do not** use for per-object campaign prewarm — use narrowWarmKeepingSceneRoots + a pool root instead
 * (Chrome/GPU can stall or TDR on huge scenes).
 *
 * `compile()` alone does not run the transmission pass; first real `render()` still hits onFirstUse.
 */
export function warmGpuProgramsForPlay(game) {
  if (!game?.renderer || !game?.camera || !game?.scene) return;
  updateBloomActive(game);
  try {
    if (game.renderer.compile) {
      game.renderer.compile(game.scene, game.camera);
    }
    if (game.xrManager?.isPresenting) {
      game.renderer.render(game.scene, game.camera);
    } else if (game._bloomActive && game.composer) {
      game.composer.render();
    } else {
      game.renderer.render(game.scene, game.camera);
    }
  } catch (e) {
    console.warn("[Mission] warmGpuProgramsForPlay:", e);
  }
}

/** @deprecated Use {@link warmGpuProgramsForPlay} */
export function compileGameSceneShaders(game) {
  warmGpuProgramsForPlay(game);
}

export default MissionManager;
