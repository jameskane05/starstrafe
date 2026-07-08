import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { VRMLoaderPlugin } from "@pixiv/three-vrm";
import {
  createVRMAnimationClip,
  VRMAnimationLoaderPlugin,
} from "@pixiv/three-vrm-animation";
import proceduralAudio from "../audio/ProceduralAudio.js";

const RT_SIZE = 512;
const FACE_MATRIX_EPS = 1e-8;
const DIALOG_VOICE_WEBAUDIO_FADE_IN_SEC = 1;
const DEFAULT_CAMERA_POSITION = new THREE.Vector3(0, 0, 1.2);

let _dialogVoiceFallbackCtx = null;
/** Prefer SFX context (unlocked with gameplay) — a separate context often stays suspended on iOS Safari. */
function getDialogVoiceAudioContext() {
  const shared = proceduralAudio?.ctx;
  if (shared) return shared;
  if (!_dialogVoiceFallbackCtx) {
    _dialogVoiceFallbackCtx = new (window.AudioContext || window.webkitAudioContext)();
  }
  return _dialogVoiceFallbackCtx;
}

function prepareDialogAudioElement(el) {
  el.loop = false;
  el.setAttribute("playsinline", "");
  el.setAttribute("webkit-playsinline", "");
}

/** WebKit + MediaElementAudioSource often reports success but never advances currentTime; use plain <audio> first. */
function preferDirectDialogPlaybackOnIOSTouch() {
  if (typeof navigator === "undefined") return false;
  return (
    /iPad|iPhone|iPod/.test(navigator.userAgent) ||
    (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1)
  );
}

/** iOS Safari often never fires `canplaythrough`; without a timeout, dialog init hangs forever. */
function waitForDialogAudioElementReady(audioElement, timeoutMs = 12000) {
  return new Promise((resolve, reject) => {
    let done = false;
    const finish = (fn) => {
      if (done) return;
      done = true;
      clearTimeout(tid);
      audioElement.removeEventListener("canplaythrough", onThrough);
      audioElement.removeEventListener("canplay", onCanPlay);
      audioElement.removeEventListener("loadeddata", onLoadedData);
      audioElement.removeEventListener("error", onError);
      fn();
    };
    const onThrough = () => finish(() => resolve());
    const onCanPlay = () => {
      if (audioElement.readyState >= HTMLMediaElement.HAVE_FUTURE_DATA) {
        finish(() => resolve());
      }
    };
    const onLoadedData = () => finish(() => resolve());
    const onError = () =>
      finish(() =>
        reject(audioElement.error ?? new Error("dialog audio load error")),
      );
    const tid = setTimeout(() => finish(() => resolve()), timeoutMs);
    audioElement.addEventListener("canplaythrough", onThrough, { once: true });
    audioElement.addEventListener("canplay", onCanPlay, { once: true });
    audioElement.addEventListener("loadeddata", onLoadedData, { once: true });
    audioElement.addEventListener("error", onError, { once: true });
    audioElement.load();
  });
}

function normalizeMocapFrame(frame, namesLength) {
  if (Array.isArray(frame)) {
    const expected = 1 + namesLength + 16;
    if (frame.length !== expected) {
      throw new Error(
        `Invalid v4 mocap frame: expected ${expected} numbers, got ${frame.length}`,
      );
    }
    const t = frame[0];
    const values = frame.slice(1, 1 + namesLength);
    const faceMatrix = frame.slice(1 + namesLength, 1 + namesLength + 16);
    return { t, values, faceMatrix };
  }
  return {
    t: frame.t,
    values: frame.values,
    faceMatrix: frame.faceMatrix ?? null,
  };
}

function faceMatrixIsUsable(m) {
  if (!m || m.length !== 16) return false;
  for (let i = 0; i < 16; i++) {
    if (Math.abs(m[i]) > FACE_MATRIX_EPS) return true;
  }
  return false;
}

function normalizeFaceDataInPlace(data) {
  const namesLength = data.names.length;
  const normalized = data.frames.map((f) => normalizeMocapFrame(f, namesLength));
  for (const frame of normalized) {
    if (!faceMatrixIsUsable(frame.faceMatrix)) frame.faceMatrix = null;
  }
  data.frames = normalized;
  const fps = typeof data.fps === "number" && data.fps > 0 ? data.fps : 30;
  data.clipDurationSec = normalized.length
    ? normalized[normalized.length - 1].t + 1 / fps
    : 0;
}

function sampleFrames(frames, names, t) {
  if (!frames.length || !names.length) return null;
  if (t <= frames[0].t) return frames[0].values;
  if (t >= frames[frames.length - 1].t) return frames[frames.length - 1].values;
  let i = 0;
  while (i + 1 < frames.length && frames[i + 1].t <= t) i++;
  const a = frames[i];
  const b = frames[i + 1];
  const w = (t - a.t) / (b.t - a.t);
  const out = [];
  for (let j = 0; j < a.values.length; j++) {
    out.push(a.values[j] * (1 - w) + b.values[j] * w);
  }
  return out;
}

const _m4A = new THREE.Matrix4();
const _m4B = new THREE.Matrix4();
const _posA = new THREE.Vector3();
const _posB = new THREE.Vector3();
const _quatA = new THREE.Quaternion();
const _quatB = new THREE.Quaternion();
const _quatC = new THREE.Quaternion();
const _quatD = new THREE.Quaternion();
const _quatE = new THREE.Quaternion();
const _quatF = new THREE.Quaternion();
const _quatG = new THREE.Quaternion();
const _vecA = new THREE.Vector3();
const _vecB = new THREE.Vector3();
const _vecC = new THREE.Vector3();
const _eulerA = new THREE.Euler();
const _quatIdleRestBlend = new THREE.Quaternion();
const _vecIdleRestBlend = new THREE.Vector3();

const FACE_SMOOTHING = 9;
const HEAD_SMOOTHING = 6.5;
const DIALOG_FACE_BLEND = 4;
const DIALOG_POSE_BLEND = 2.8;
/** Lerp from pre-dialog morphs / rig to first mocap frame, and back after audio. */
const DIALOG_CLIP_BLEND_IN = 0.24;
const DIALOG_CLIP_BLEND_OUT = 0.3;
/** Ease back to full idle when dialog ends (no clip blend-out path). */
const IDLE_RETURN_BLEND = 14;
function smoothBlendT(t) {
  const x = Math.min(1, Math.max(0, t));
  return x * x * x * (x * (x * 6 - 15) + 10);
}

const NECK_ROTATION_WEIGHT = 0.35;
const HEAD_ROTATION_WEIGHT = 0.65;
const LEAN_PITCH_SCALE = 0.032;
const LEAN_YAW_SCALE = 0.04;
const LEAN_MAX_PITCH = THREE.MathUtils.degToRad(18);
const LEAN_MAX_YAW = THREE.MathUtils.degToRad(18);
const SPINE_LEAN_WEIGHT = 0.6;
const CHEST_LEAN_WEIGHT = 0.4;

function sampleFaceMatrix(frames, t) {
  if (!frames.length) return null;
  if (t <= frames[0].t) {
    const m = frames[0].faceMatrix;
    return faceMatrixIsUsable(m) ? m : null;
  }
  if (t >= frames[frames.length - 1].t) {
    const m = frames[frames.length - 1].faceMatrix;
    return faceMatrixIsUsable(m) ? m : null;
  }
  let i = 0;
  while (i + 1 < frames.length && frames[i + 1].t <= t) i++;
  const a = frames[i];
  const b = frames[i + 1];
  const ma = a.faceMatrix;
  const mb = b.faceMatrix;
  if (!faceMatrixIsUsable(ma) || !faceMatrixIsUsable(mb)) return null;
  const w = (t - a.t) / (b.t - a.t);
  _m4A.fromArray(ma);
  _m4B.fromArray(mb);
  _m4A.decompose(_posA, _quatA, new THREE.Vector3());
  _m4B.decompose(_posB, _quatB, new THREE.Vector3());
  _quatA.slerp(_quatB, w);
  _posA.lerp(_posB, w);
  _m4A.compose(_posA, _quatA, new THREE.Vector3(1, 1, 1));
  const out = new Array(16);
  _m4A.toArray(out);
  return out;
}

function getFaceRotation(faceMatrix, outQuat) {
  _vecA.set(-faceMatrix[4], faceMatrix[5], faceMatrix[6]).normalize();
  _vecB.set(-faceMatrix[8], faceMatrix[9], faceMatrix[10]).normalize();
  _vecA.addScaledVector(_vecB, -_vecA.dot(_vecB)).normalize();
  _vecC.crossVectors(_vecA, _vecB).normalize();
  _vecA.crossVectors(_vecB, _vecC).normalize();
  _m4A.makeBasis(_vecC, _vecA, _vecB);
  outQuat.setFromRotationMatrix(_m4A);
  return outQuat;
}

function applyBoneBlend(bone, baseQuat, deltaQuat, weight) {
  if (!bone) return;
  _quatE.identity().slerp(deltaQuat, weight);
  bone.quaternion.copy(baseQuat).premultiply(_quatE);
}

function applyRigPose(vrm, faceMatrix, state) {
  const humanoid = vrm.humanoid;
  if (!humanoid) return;
  const head = humanoid.getNormalizedBoneNode("head");
  const neck = humanoid.getNormalizedBoneNode("neck");
  const spine =
    humanoid.getNormalizedBoneNode("chest") ??
    humanoid.getNormalizedBoneNode("spine");
  const chest = humanoid.getNormalizedBoneNode("upperChest");
  if (!head && !neck && !spine && !chest) return;
  if (faceMatrix && faceMatrix.length === 16) {
    getFaceRotation(faceMatrix, _quatA);
    if (!state.initialized) {
      if (head) state.baseHeadQuaternion.copy(head.quaternion);
      if (neck) state.baseNeckQuaternion.copy(neck.quaternion);
      if (spine) state.baseSpineQuaternion.copy(spine.quaternion);
      if (chest) state.baseChestQuaternion.copy(chest.quaternion);
      state.baseFaceQuaternionInverse.copy(_quatA).invert();
      state.baseTx = faceMatrix[12];
      state.baseTz = faceMatrix[14];
      state.initialized = true;
    }
    _quatC.copy(_quatA).multiply(state.baseFaceQuaternionInverse);
    if (!state.smoothedInitialized) {
      state.smoothedDeltaQuaternion.copy(_quatC);
      state.smoothedLeanEuler.set(0, 0, 0);
      state.smoothedInitialized = true;
    }
    _quatD.copy(state.smoothedDeltaQuaternion).slerp(_quatC, state.smoothingAlpha);
    state.smoothedDeltaQuaternion.copy(_quatD);
    _eulerA.set(
      THREE.MathUtils.clamp(
        -(faceMatrix[14] - state.baseTz) * LEAN_PITCH_SCALE,
        -LEAN_MAX_PITCH,
        LEAN_MAX_PITCH,
      ),
      THREE.MathUtils.clamp(
        (faceMatrix[12] - state.baseTx) * LEAN_YAW_SCALE,
        -LEAN_MAX_YAW,
        LEAN_MAX_YAW,
      ),
      0,
      "XYZ",
    );
    state.smoothedLeanEuler.x = THREE.MathUtils.lerp(
      state.smoothedLeanEuler.x,
      _eulerA.x,
      state.smoothingAlpha,
    );
    state.smoothedLeanEuler.y = THREE.MathUtils.lerp(
      state.smoothedLeanEuler.y,
      _eulerA.y,
      state.smoothingAlpha,
    );
  }
  if (!state.initialized || !state.smoothedInitialized) return;
  const clipMul = state.clipRigMul ?? 1;
  const wPose = state.dialogWeight * clipMul;
  applyBoneBlend(
    neck,
    state.baseNeckQuaternion,
    state.smoothedDeltaQuaternion,
    wPose * NECK_ROTATION_WEIGHT,
  );
  applyBoneBlend(
    head,
    state.baseHeadQuaternion,
    state.smoothedDeltaQuaternion,
    wPose * HEAD_ROTATION_WEIGHT,
  );
  _quatF.setFromEuler(
    _eulerA.set(
      state.smoothedLeanEuler.x * wPose * SPINE_LEAN_WEIGHT,
      state.smoothedLeanEuler.y * wPose * SPINE_LEAN_WEIGHT,
      0,
      "XYZ",
    ),
  );
  _quatG.setFromEuler(
    _eulerA.set(
      state.smoothedLeanEuler.x * wPose * CHEST_LEAN_WEIGHT,
      state.smoothedLeanEuler.y * wPose * CHEST_LEAN_WEIGHT,
      0,
      "XYZ",
    ),
  );
  if (spine) spine.quaternion.copy(state.baseSpineQuaternion).premultiply(_quatF);
  if (chest) chest.quaternion.copy(state.baseChestQuaternion).premultiply(_quatG);
}

function applyMorphTargets(vrmScene, names, values) {
  if (!values || values.length !== names.length) return;
  vrmScene.traverse((obj) => {
    if (!obj.isMesh || !obj.morphTargetDictionary) return;
    const dict = obj.morphTargetDictionary;
    const influences = obj.morphTargetInfluences;
    for (let i = 0; i < names.length; i++) {
      const idx = dict[names[i]];
      if (idx !== undefined && influences[idx] !== undefined) {
        influences[idx] = values[i];
      }
    }
  });
}

function clearMorphTargets(vrmScene, names) {
  if (!names?.length) return;
  vrmScene.traverse((obj) => {
    if (!obj.isMesh || !obj.morphTargetDictionary) return;
    const dict = obj.morphTargetDictionary;
    const influences = obj.morphTargetInfluences;
    for (let i = 0; i < names.length; i++) {
      const idx = dict[names[i]];
      if (idx !== undefined && influences[idx] !== undefined) {
        influences[idx] = 0;
      }
    }
  });
}

function smoothFaceValues(values, state, delta) {
  if (!values?.length) return values;
  const alpha = 1 - Math.exp(-FACE_SMOOTHING * delta);
  if (!state.values || state.values.length !== values.length) {
    state.values = values.slice();
    return state.values;
  }
  for (let i = 0; i < values.length; i++) {
    state.values[i] = THREE.MathUtils.lerp(state.values[i], values[i], alpha);
  }
  return state.values;
}

function scaleFaceValues(values, weight, state) {
  if (!values?.length) return null;
  if (!state.values || state.values.length !== values.length) {
    state.values = new Array(values.length);
  }
  for (let i = 0; i < values.length; i++) {
    state.values[i] = values[i] * weight;
  }
  return state.values;
}

/** Bones idle VRMA does not drive (head/face/arms); must match clip filter. */
const IDLE_CLIP_EXCLUDED_BONES = new Set([
  "neck",
  "head",
  "leftEye",
  "rightEye",
  "jaw",
  "leftShoulder",
  "rightShoulder",
  "leftUpperArm",
  "rightUpperArm",
  "leftLowerArm",
  "rightLowerArm",
  "leftHand",
  "rightHand",
  "leftThumbMetacarpal",
  "rightThumbMetacarpal",
  "leftThumbProximal",
  "rightThumbProximal",
  "leftThumbDistal",
  "rightThumbDistal",
  "leftIndexProximal",
  "rightIndexProximal",
  "leftIndexIntermediate",
  "rightIndexIntermediate",
  "leftIndexDistal",
  "rightIndexDistal",
  "leftMiddleProximal",
  "rightMiddleProximal",
  "leftMiddleIntermediate",
  "rightMiddleIntermediate",
  "leftMiddleDistal",
  "rightMiddleDistal",
  "leftRingProximal",
  "rightRingProximal",
  "leftRingIntermediate",
  "rightRingIntermediate",
  "leftRingDistal",
  "rightRingDistal",
  "leftLittleProximal",
  "rightLittleProximal",
  "leftLittleIntermediate",
  "rightLittleIntermediate",
  "leftLittleDistal",
  "rightLittleDistal",
]);

function createHumanoidOnlyClip(vrmAnimation, vrm) {
  const clip = createVRMAnimationClip(vrmAnimation, vrm);
  const allowedTracks = new Set();

  for (const boneName of vrmAnimation.humanoidTracks.rotation.keys()) {
    if (IDLE_CLIP_EXCLUDED_BONES.has(boneName)) continue;
    const nodeName = vrm.humanoid.getNormalizedBoneNode(boneName)?.name;
    if (nodeName) allowedTracks.add(`${nodeName}.quaternion`);
  }

  for (const boneName of vrmAnimation.humanoidTracks.translation.keys()) {
    if (IDLE_CLIP_EXCLUDED_BONES.has(boneName)) continue;
    const nodeName = vrm.humanoid.getNormalizedBoneNode(boneName)?.name;
    if (nodeName) allowedTracks.add(`${nodeName}.position`);
  }

  return new THREE.AnimationClip(
    clip.name,
    clip.duration,
    clip.tracks.filter((track) => allowedTracks.has(track.name)),
  );
}

function applyFaceToExpressionManager(vrm, names, values) {
  const em = vrm.expressionManager;
  if (!em || !names || !values) return;
  const get = (name) => {
    const i = names.indexOf(name);
    return i >= 0 ? values[i] : 0;
  };
  em.setValue("aa", get("jawOpen"));
  em.setValue("ou", get("mouthPucker"));
  em.setValue("oh", Math.max(0, get("mouthFunnel")));
  em.setValue("ee", (get("mouthStretchLeft") + get("mouthStretchRight")) * 0.5);
  em.setValue("ih", (get("mouthUpperUpLeft") + get("mouthUpperUpRight")) * 0.5);
  em.setValue("blink", 0);
  em.setValue("blinkLeft", get("eyeBlinkLeft"));
  em.setValue("blinkRight", get("eyeBlinkRight"));
}

export class VRMAvatarRenderer {
  constructor(options = {}) {
    this.vrmUrl = options.vrmUrl ?? "./vrm/alcair-opt.vrm";
    /** Optional VRMA idle clip URL; omit or pass null to skip (no network fetch). */
    this.idleUrl = options.idleUrl ?? null;
    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(28, 1, 0.1, 10);
    this._cameraOffset = new THREE.Vector3(0, 0, 0);
    this.camera.position.copy(DEFAULT_CAMERA_POSITION);
    this.camera.lookAt(0, 0, 0);
    this.setCameraOffset(options.cameraOffset);
    this.renderTarget = new THREE.WebGLRenderTarget(RT_SIZE, RT_SIZE, {
      minFilter: THREE.LinearFilter,
      magFilter: THREE.LinearFilter,
      format: THREE.RGBAFormat,
      type: THREE.UnsignedByteType,
    });
    const light = new THREE.DirectionalLight(0xffffff, 1);
    light.position.set(0.5, 0.5, 1);
    this.scene.add(light);
    this.scene.add(new THREE.AmbientLight(0xffffff, 0.6));

    this.vrm = null;
    this.faceData = null;
    this.audioElement = null;
    this._ready = false;
    this._playing = false;
    this._placeholderPlaying = false;
    this._placeholderDuration = 0;
    this._placeholderStartTime = 0;
    this._dialogFaceWeight = 0;
    this._dialogPoseWeight = 0;
    this.idleMixer = null;
    this.idleAction = null;
    this._idleBlendWeight = 1;
    /** @type {{ node: THREE.Object3D; restQuat: THREE.Quaternion; restPos: THREE.Vector3 | null; hasPos: boolean }[] | null} */
    this._idleBodyRestTargets = null;
    this._headPoseState = {
      dialogWeight: 0,
      clipRigMul: 1,
      initialized: false,
      smoothedInitialized: false,
      smoothingAlpha: 1,
      baseHeadQuaternion: new THREE.Quaternion(),
      baseNeckQuaternion: new THREE.Quaternion(),
      baseSpineQuaternion: new THREE.Quaternion(),
      baseChestQuaternion: new THREE.Quaternion(),
      baseFaceQuaternionInverse: new THREE.Quaternion(),
      smoothedDeltaQuaternion: new THREE.Quaternion(),
      smoothedLeanEuler: new THREE.Euler(),
      baseTx: 0,
      baseTz: 0,
    };
    this._faceSmoothingState = { values: null };
    this._weightedFaceState = { values: null };
    this._clipBlendInActive = false;
    this._clipBlendInElapsed = 0;
    this._clipBlendOutActive = false;
    this._clipBlendOutElapsed = 0;
    this._faceSnapFrom = null;
    this._faceFirstFrameArr = null;
    this._faceOutFrom = null;
    this._faceBlendScratch = null;
    this._frozenFaceMatrix = null;
    this._hadStartedFaceDialog = false;
    this._prevAudioPlaying = false;
    this._lastFaceMatrix = null;
    this._dialogMediaSource = null;
    this._dialogOutputGain = null;
    /** iOS: decode+BufferSource on shared SFX context (no per-line HTMLAudioElement autoplay). */
    this._dialogBufSource = null;
    this._dialogBufGain = null;
    this._dialogBufferPlaybackStart = 0;
    this._dialogBufferDuration = 0;
    this._iosPooledDialogAudio = null;
    this._placeholderTexture = new THREE.DataTexture(
      new Uint8Array([0, 0, 0, 0]),
      1,
      1,
    );
    this._placeholderTexture.needsUpdate = true;
  }

  setCameraOffset(cameraOffset) {
    const x = Number(cameraOffset?.x ?? 0);
    const y = Number(cameraOffset?.y ?? 0);
    const z = Number(cameraOffset?.z ?? 0);
    this._cameraOffset.set(
      Number.isFinite(x) ? x : 0,
      Number.isFinite(y) ? y : 0,
      Number.isFinite(z) ? z : 0,
    );
    this.camera.position.copy(DEFAULT_CAMERA_POSITION).add(this._cameraOffset);
  }

  getTexture() {
    return this._ready ? this.renderTarget.texture : this._placeholderTexture;
  }

  getCurrentTime() {
    if (this._dialogBufSource && this._playing && proceduralAudio.ctx) {
      return Math.max(
        0,
        proceduralAudio.ctx.currentTime - this._dialogBufferPlaybackStart,
      );
    }
    if (this.audioElement) return this.audioElement.currentTime ?? 0;
    if (this._placeholderPlaying) {
      return performance.now() / 1000 - this._placeholderStartTime;
    }
    return 0;
  }

  isPlaying() {
    if (this._clipBlendOutActive) return true;
    if (this._placeholderPlaying) {
      return performance.now() / 1000 - this._placeholderStartTime <
        this._placeholderDuration;
    }
    if (
      this._playing &&
      this._dialogBufSource &&
      proceduralAudio.ctx &&
      this._dialogBufferDuration > 0
    ) {
      const elapsed =
        proceduralAudio.ctx.currentTime - this._dialogBufferPlaybackStart;
      return elapsed < this._dialogBufferDuration - 0.04;
    }
    return this._playing && this.audioElement && !this.audioElement.ended;
  }

  async loadVRM() {
    const loader = new GLTFLoader();
    loader.register((parser) => new VRMLoaderPlugin(parser));
    return new Promise((resolve, reject) => {
      loader.load(
        this.vrmUrl,
        async (gltf) => {
          this.vrm = gltf.userData.vrm;
          if (!this.vrm) {
            reject(new Error("No VRM in gltf.userData.vrm"));
            return;
          }
          this.scene.add(this.vrm.scene);
          this.vrm.scene.rotation.order = "ZYX";
          this.vrm.scene.rotation.set(0, Math.PI, -Math.PI / 2);
          this.vrm.scene.position.set(-1.85, 0, 0.475);
          this.vrm.scene.scale.setScalar(1.1);
          this._ready = true;
          try {
            await this.loadIdleAnimation();
          } catch (e) {
            if (this.idleUrl) {
              console.warn("[VRMAvatarRenderer] Idle animation load failed:", e);
            }
          }
          resolve(this.vrm);
        },
        undefined,
        reject,
      );
    });
  }

  async loadIdleAnimation() {
    if (!this.vrm) return null;
    if (!this.idleUrl) {
      this._idleBodyRestTargets = null;
      return null;
    }
    const loader = new GLTFLoader();
    loader.register((parser) => new VRMAnimationLoaderPlugin(parser));
    return new Promise((resolve, reject) => {
      loader.load(
        this.idleUrl,
        (gltf) => {
          const vrmAnimation = gltf.userData.vrmAnimations?.[0];
          if (!vrmAnimation) {
            this._idleBodyRestTargets = null;
            resolve(null);
            return;
          }
          const clip = createHumanoidOnlyClip(vrmAnimation, this.vrm);
          if (!clip.tracks.length) {
            this._idleBodyRestTargets = null;
            resolve(null);
            return;
          }
          this.vrm.humanoid.resetNormalizedPose();
          const idleBoneNames = new Set();
          for (const boneName of vrmAnimation.humanoidTracks.rotation.keys()) {
            if (!IDLE_CLIP_EXCLUDED_BONES.has(boneName)) idleBoneNames.add(boneName);
          }
          const trans = vrmAnimation.humanoidTracks.translation;
          if (trans) {
            for (const boneName of trans.keys()) {
              if (!IDLE_CLIP_EXCLUDED_BONES.has(boneName)) idleBoneNames.add(boneName);
            }
          }
          this._idleBodyRestTargets = [];
          for (const boneName of idleBoneNames) {
            const node = this.vrm.humanoid.getNormalizedBoneNode(boneName);
            if (!node) continue;
            const hasPos = !!(trans && trans.has(boneName));
            this._idleBodyRestTargets.push({
              node,
              restQuat: node.quaternion.clone(),
              restPos: hasPos ? node.position.clone() : null,
              hasPos,
            });
          }
          this.idleMixer = new THREE.AnimationMixer(this.vrm.scene);
          this.idleAction = this.idleMixer.clipAction(clip);
          this.idleAction.setLoop(THREE.LoopRepeat, Infinity);
          this.idleAction.setEffectiveWeight(this._idleBlendWeight);
          this.idleAction.play();
          resolve(clip);
        },
        undefined,
        reject,
      );
    });
  }

  async loadFaceData(url) {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`Face data load failed: ${url}`);
    const data = await res.json();
    if (!data.names || !Array.isArray(data.frames))
      throw new Error("Invalid face data");
    normalizeFaceDataInPlace(data);
    this.faceData = data;
    return data;
  }

  _readMorphInfluencesForNames(names) {
    const n = names.length;
    const out = new Float32Array(n);
    if (!this.vrm?.scene) return out;
    const acc = new Float32Array(n);
    const counts = new Int32Array(n);
    this.vrm.scene.traverse((obj) => {
      if (!obj.isMesh || !obj.morphTargetDictionary) return;
      const dict = obj.morphTargetDictionary;
      const inf = obj.morphTargetInfluences;
      for (let i = 0; i < n; i++) {
        const idx = dict[names[i]];
        if (idx !== undefined && inf[idx] !== undefined) {
          acc[i] += inf[idx];
          counts[i]++;
        }
      }
    });
    for (let i = 0; i < n; i++) {
      out[i] = counts[i] > 0 ? acc[i] / counts[i] : 0;
    }
    return out;
  }

  _disconnectDialogVoiceGraph() {
    if (this._dialogMediaSource) {
      try {
        this._dialogMediaSource.disconnect();
      } catch (e) {}
      this._dialogMediaSource = null;
    }
    if (this._dialogOutputGain) {
      try {
        this._dialogOutputGain.disconnect();
      } catch (e) {}
      this._dialogOutputGain = null;
    }
  }

  _disconnectDialogBufferPlayback() {
    if (this._dialogBufSource) {
      try {
        this._dialogBufSource.stop();
      } catch (_) {}
      try {
        this._dialogBufSource.disconnect();
      } catch (_) {}
      this._dialogBufSource = null;
    }
    if (this._dialogBufGain) {
      try {
        this._dialogBufGain.disconnect();
      } catch (_) {}
      this._dialogBufGain = null;
    }
    this._dialogBufferPlaybackStart = 0;
    this._dialogBufferDuration = 0;
  }

  /**
   * iOS/Safari: one unlocked AudioContext (procedural) + BufferSource avoids
   * HTMLMediaElement autoplay limits on every new line and every speaker swap.
   */
  async _playDialogFromBuffer(audioUrl) {
    await proceduralAudio.resume();
    const ctx = proceduralAudio.ctx;
    if (!ctx) return false;
    if (ctx.state === "suspended") await ctx.resume();
    if (ctx.state !== "running") return false;

    let audioBuffer;
    try {
      const resp = await fetch(audioUrl);
      if (!resp.ok) return false;
      const ab = await resp.arrayBuffer();
      audioBuffer = await ctx.decodeAudioData(ab.slice(0));
    } catch (e) {
      console.warn("[VRMAvatarRenderer] Dialog decode failed:", audioUrl, e);
      return false;
    }

    this._disconnectDialogBufferPlayback();

    const source = ctx.createBufferSource();
    const gain = ctx.createGain();
    const when = ctx.currentTime;
    gain.gain.setValueAtTime(0, when);
    gain.gain.linearRampToValueAtTime(
      1,
      when + DIALOG_VOICE_WEBAUDIO_FADE_IN_SEC,
    );
    source.buffer = audioBuffer;
    source.connect(gain);
    gain.connect(ctx.destination);

    this._dialogBufferPlaybackStart = when;
    this._dialogBufferDuration = audioBuffer.duration;
    this._dialogBufSource = source;
    this._dialogBufGain = gain;

    source.onended = () => {
      if (this._dialogBufSource !== source) return;
      this._playing = false;
      this._disconnectDialogBufferPlayback();
    };

    try {
      source.start(when);
    } catch (e) {
      console.warn("[VRMAvatarRenderer] BufferSource.start failed:", e);
      this._disconnectDialogBufferPlayback();
      return false;
    }

    this._playing = true;
    this.audioElement = null;
    return true;
  }

  _applyIdleRestBlend(weight) {
    const targets = this._idleBodyRestTargets;
    if (!targets?.length) return;
    const w = Math.min(1, Math.max(0, weight));
    for (let i = 0; i < targets.length; i++) {
      const { node, restQuat, restPos, hasPos } = targets[i];
      if (w <= 1e-6) {
        node.quaternion.copy(restQuat);
        if (hasPos && restPos) node.position.copy(restPos);
        continue;
      }
      _quatIdleRestBlend.copy(node.quaternion);
      node.quaternion.copy(restQuat).slerp(_quatIdleRestBlend, w);
      if (hasPos && restPos) {
        _vecIdleRestBlend.copy(node.position);
        node.position.copy(restPos).lerp(_vecIdleRestBlend, w);
      }
    }
  }

  _applyStoredRestBones() {
    const humanoid = this.vrm?.humanoid;
    const state = this._headPoseState;
    if (!humanoid || !state.initialized) return;
    const head = humanoid.getNormalizedBoneNode("head");
    const neck = humanoid.getNormalizedBoneNode("neck");
    const spine =
      humanoid.getNormalizedBoneNode("chest") ??
      humanoid.getNormalizedBoneNode("spine");
    const chest = humanoid.getNormalizedBoneNode("upperChest");
    if (neck) neck.quaternion.copy(state.baseNeckQuaternion);
    if (head) head.quaternion.copy(state.baseHeadQuaternion);
    if (spine) spine.quaternion.copy(state.baseSpineQuaternion);
    if (chest) chest.quaternion.copy(state.baseChestQuaternion);
  }

  /** @returns {Promise<boolean>} true if dialog audio is playing; false → use caption-only timing in DialogManager */
  async play(audioUrl, faceDataUrl) {
    const prevNames = this.faceData?.names;
    const morphSnapshot =
      prevNames?.length > 0
        ? this._readMorphInfluencesForNames(prevNames)
        : null;

    this.stop();
    if (!this._ready || !this.vrm) return false;
    let faceData = this.faceData;
    if (faceDataUrl && (!faceData || faceData._url !== faceDataUrl)) {
      await this.loadFaceData(faceDataUrl);
      faceData = this.faceData;
      faceData._url = faceDataUrl;
    }
    if (!faceData?.frames?.length) return false;

    const names = faceData.names;
    const n = names.length;
    const from = new Float32Array(n);
    if (morphSnapshot && morphSnapshot.length === n) {
      from.set(morphSnapshot);
    }
    const firstVals = sampleFrames(faceData.frames, names, 0);
    if (!firstVals?.length) return false;

    this._faceSnapFrom = from;
    this._faceFirstFrameArr = Float32Array.from(firstVals);
    this._clipBlendInActive = true;
    this._clipBlendInElapsed = 0;
    this._clipBlendOutActive = false;
    this._hadStartedFaceDialog = false;
    this._lastFaceMatrix = null;

    const bindEnded = (audioEl) => {
      audioEl.addEventListener(
        "ended",
        () => {
          this._playing = false;
        },
        { once: true },
      );
    };

    if (preferDirectDialogPlaybackOnIOSTouch()) {
      if (await this._playDialogFromBuffer(audioUrl)) {
        this._hadStartedFaceDialog = true;
        return true;
      }
      if (!this._iosPooledDialogAudio) {
        this._iosPooledDialogAudio = document.createElement("audio");
        prepareDialogAudioElement(this._iosPooledDialogAudio);
      }
      const elIOS = this._iosPooledDialogAudio;
      elIOS.pause();
      elIOS.currentTime = 0;
      elIOS.src = audioUrl;
      try {
        await waitForDialogAudioElementReady(elIOS);
        await elIOS.play();
        this.audioElement = elIOS;
        this._playing = true;
        this._hadStartedFaceDialog = true;
        bindEnded(elIOS);
        return true;
      } catch (e) {
        console.warn(
          "[VRMAvatarRenderer] iOS pooled <audio> VO failed, trying Web Audio element path:",
          e?.message || e,
        );
      }
    }

    let el = document.createElement("audio");
    prepareDialogAudioElement(el);
    el.src = audioUrl;
    el.crossOrigin = "anonymous";
    try {
      await waitForDialogAudioElementReady(el);
    } catch (e) {
      console.warn("[VRMAvatarRenderer] Audio load failed:", audioUrl, e);
      this._clipBlendInActive = false;
      this._faceSnapFrom = null;
      this._faceFirstFrameArr = null;
      return false;
    }

    const tryWebAudioPath = async () => {
      await proceduralAudio.resume();
      const ctx = getDialogVoiceAudioContext();
      if (ctx.state === "suspended") await ctx.resume();
      this._disconnectDialogVoiceGraph();
      this._dialogMediaSource = ctx.createMediaElementSource(el);
      this._dialogOutputGain = ctx.createGain();
      this._dialogMediaSource.connect(this._dialogOutputGain);
      this._dialogOutputGain.connect(ctx.destination);
      const t0 = ctx.currentTime;
      this._dialogOutputGain.gain.cancelScheduledValues(t0);
      this._dialogOutputGain.gain.setValueAtTime(0, t0);
      this._dialogOutputGain.gain.linearRampToValueAtTime(
        1,
        t0 + DIALOG_VOICE_WEBAUDIO_FADE_IN_SEC,
      );
      await el.play();
    };

    try {
      await tryWebAudioPath();
      this.audioElement = el;
      this._playing = true;
      this._hadStartedFaceDialog = true;
      bindEnded(el);
      return true;
    } catch (e) {
      console.warn(
        "[VRMAvatarRenderer] Web Audio VO failed; trying direct element:",
        e?.message || e,
      );
      this._disconnectDialogVoiceGraph();
      el = null;

      const el2 = document.createElement("audio");
      prepareDialogAudioElement(el2);
      el2.src = audioUrl;
      try {
        await waitForDialogAudioElementReady(el2);
        await el2.play();
      } catch (e2) {
        console.warn(
          "[VRMAvatarRenderer] Direct audio failed:",
          audioUrl,
          e2?.message || e2,
        );
        this._clipBlendInActive = false;
        this._faceSnapFrom = null;
        this._faceFirstFrameArr = null;
        return false;
      }
      this.audioElement = el2;
      this._playing = true;
      this._hadStartedFaceDialog = true;
      bindEnded(el2);
      return true;
    }
  }

  playPlaceholder(durationSeconds = 0) {
    this.stop();
    if (!this._ready || !this.vrm) return;
    this._clipBlendInActive = false;
    this._clipBlendOutActive = false;
    this._hadStartedFaceDialog = false;
    this._placeholderPlaying = durationSeconds > 0;
    this._placeholderDuration = Math.max(0, durationSeconds);
    this._placeholderStartTime = performance.now() / 1000;
  }

  stop() {
    this._disconnectDialogVoiceGraph();
    this._disconnectDialogBufferPlayback();
    this._playing = false;
    this._placeholderPlaying = false;
    this._placeholderDuration = 0;
    this._placeholderStartTime = 0;
    this._dialogFaceWeight = 0;
    this._dialogPoseWeight = 0;
    this._headPoseState.dialogWeight = 0;

    if (this.vrm) {
      this._applyStoredRestBones();
      if (this.faceData?.names?.length) {
        clearMorphTargets(this.vrm.scene, this.faceData.names);
      }
      this.vrm.expressionManager?.resetValues?.();
    }

    this._headPoseState.initialized = false;
    this._headPoseState.smoothedInitialized = false;
    this._faceSmoothingState.values = null;
    this._weightedFaceState.values = null;

    this._clipBlendInActive = false;
    this._clipBlendInElapsed = 0;
    this._clipBlendOutActive = false;
    this._clipBlendOutElapsed = 0;
    this._faceSnapFrom = null;
    this._faceFirstFrameArr = null;
    this._faceOutFrom = null;
    this._frozenFaceMatrix = null;
    this._hadStartedFaceDialog = false;
    this._prevAudioPlaying = false;
    this._lastFaceMatrix = null;
    this._headPoseState.clipRigMul = 1;

    this._idleBlendWeight = 1;
    if (this.idleAction) {
      this.idleAction.paused = false;
      this.idleAction.setEffectiveWeight(1);
    }

    if (this.audioElement) {
      this.audioElement.pause();
      this.audioElement.currentTime = 0;
      if (this.audioElement === this._iosPooledDialogAudio) {
        this.audioElement.removeAttribute("src");
        this.audioElement.load();
      } else {
        this.audioElement.src = "";
        this.audioElement.load();
      }
      this.audioElement = null;
    }
  }

  update(renderer, delta) {
    if (!this._ready || !this.vrm) return;
    if (
      this._placeholderPlaying &&
      performance.now() / 1000 - this._placeholderStartTime >= this._placeholderDuration
    ) {
      this._placeholderPlaying = false;
    }

    let audioPlaying = false;
    if (this._playing) {
      if (this.audioElement && !this.audioElement.ended) {
        audioPlaying = true;
      } else if (
        this._dialogBufSource &&
        proceduralAudio.ctx &&
        this._dialogBufferDuration > 0
      ) {
        const elapsed =
          proceduralAudio.ctx.currentTime - this._dialogBufferPlaybackStart;
        audioPlaying = elapsed < this._dialogBufferDuration - 0.04;
      }
    }
    const placeholderActive =
      this._placeholderPlaying &&
      performance.now() / 1000 - this._placeholderStartTime <
        this._placeholderDuration;

    const faceDriverForWeights =
      audioPlaying ||
      placeholderActive ||
      this._clipBlendInActive ||
      this._clipBlendOutActive;

    const dialogFaceBlendAlpha = 1 - Math.exp(-DIALOG_FACE_BLEND * delta);
    const dialogPoseBlendAlpha = 1 - Math.exp(-DIALOG_POSE_BLEND * delta);
    this._dialogFaceWeight = THREE.MathUtils.lerp(
      this._dialogFaceWeight,
      faceDriverForWeights ? 1 : 0,
      dialogFaceBlendAlpha,
    );
    if (Math.abs(this._dialogFaceWeight - (faceDriverForWeights ? 1 : 0)) < 0.001) {
      this._dialogFaceWeight = faceDriverForWeights ? 1 : 0;
    }
    this._dialogPoseWeight = THREE.MathUtils.lerp(
      this._dialogPoseWeight,
      faceDriverForWeights ? 1 : 0,
      dialogPoseBlendAlpha,
    );
    if (Math.abs(this._dialogPoseWeight - (faceDriverForWeights ? 1 : 0)) < 0.001) {
      this._dialogPoseWeight = faceDriverForWeights ? 1 : 0;
    }
    this._headPoseState.dialogWeight = this._dialogPoseWeight;

    let t = 0;
    if (audioPlaying) {
      t = this.getCurrentTime();
    } else if (placeholderActive) {
      t = performance.now() / 1000 - this._placeholderStartTime;
    }

    let clipRigMul = 1;
    let faceMatrix = null;

    if (
      this._hadStartedFaceDialog &&
      this.faceData?.frames?.length &&
      this._prevAudioPlaying &&
      !audioPlaying &&
      !placeholderActive &&
      !this._clipBlendOutActive
    ) {
      this._clipBlendInActive = false;
      this._clipBlendOutActive = true;
      this._clipBlendOutElapsed = 0;
      const sm = this._faceSmoothingState.values;
      const n = this.faceData.names.length;
      this._faceOutFrom =
        sm?.length === n
          ? Float32Array.from(sm)
          : new Float32Array(n).fill(0);
      if (this._lastFaceMatrix) {
        this._frozenFaceMatrix = this._lastFaceMatrix.slice();
      } else {
        const fm = sampleFaceMatrix(this.faceData.frames, 0);
        this._frozenFaceMatrix = fm ? fm.slice() : null;
      }
    }

    if (this._clipBlendInActive && this._faceFirstFrameArr && this._faceSnapFrom) {
      this._clipBlendInElapsed += delta;
      let u = Math.min(1, this._clipBlendInElapsed / DIALOG_CLIP_BLEND_IN);
      u = smoothBlendT(u);
      clipRigMul = u;
      this._headPoseState.smoothingAlpha = 1 - Math.exp(-HEAD_SMOOTHING * delta);
      const fr = this._faceSnapFrom;
      const ff = this._faceFirstFrameArr;
      const n = ff.length;
      if (!this._faceBlendScratch || this._faceBlendScratch.length !== n) {
        this._faceBlendScratch = new Float32Array(n);
      }
      const scr = this._faceBlendScratch;
      for (let i = 0; i < n; i++) {
        scr[i] = fr[i] + (ff[i] - fr[i]) * u;
      }
      this._faceSmoothingState.values = scr;
      const t0 = this.faceData.frames[0]?.t ?? 0;
      faceMatrix = sampleFaceMatrix(this.faceData.frames, t0);
      if (u >= 1) {
        this._clipBlendInActive = false;
        this._faceSmoothingState.values = Float32Array.from(scr);
      }
    } else if (this._clipBlendOutActive && this._faceOutFrom) {
      this._clipBlendOutElapsed += delta;
      let u = Math.min(1, this._clipBlendOutElapsed / DIALOG_CLIP_BLEND_OUT);
      u = smoothBlendT(u);
      clipRigMul = 1 - u;
      this._headPoseState.smoothingAlpha = 1 - Math.exp(-HEAD_SMOOTHING * delta);
      const fr = this._faceOutFrom;
      const n = fr.length;
      if (!this._faceBlendScratch || this._faceBlendScratch.length !== n) {
        this._faceBlendScratch = new Float32Array(n);
      }
      const scr = this._faceBlendScratch;
      for (let i = 0; i < n; i++) {
        scr[i] = fr[i] * (1 - u);
      }
      this._faceSmoothingState.values = scr;
      faceMatrix = this._frozenFaceMatrix;
      if (u >= 1) {
        this._clipBlendOutActive = false;
        this._hadStartedFaceDialog = false;
        this._faceOutFrom = null;
        this._frozenFaceMatrix = null;
        this._faceSnapFrom = null;
        this._faceFirstFrameArr = null;
        this._lastFaceMatrix = null;
        if (this.faceData?.names?.length) {
          clearMorphTargets(this.vrm.scene, this.faceData.names);
        }
        this.vrm.expressionManager?.resetValues?.();
        this._headPoseState.initialized = false;
        this._headPoseState.smoothedInitialized = false;
        this._faceSmoothingState.values = null;
        this._weightedFaceState.values = null;
      }
    } else if (
      audioPlaying &&
      this.faceData?.frames?.length &&
      !this._clipBlendInActive
    ) {
      this._headPoseState.smoothingAlpha = 1 - Math.exp(-HEAD_SMOOTHING * delta);
      smoothFaceValues(
        sampleFrames(this.faceData.frames, this.faceData.names, t),
        this._faceSmoothingState,
        delta,
      );
      faceMatrix = sampleFaceMatrix(this.faceData.frames, t);
      if (faceMatrix) {
        this._lastFaceMatrix = faceMatrix.slice();
      }
    }

    this._headPoseState.clipRigMul = clipRigMul;
    this._prevAudioPlaying = audioPlaying;

    if (this.idleAction && this.idleMixer) {
      const inBlendIn =
        this._clipBlendInActive &&
        this._faceFirstFrameArr &&
        this._faceSnapFrom;
      const inBlendOut = this._clipBlendOutActive && this._faceOutFrom;
      if (inBlendIn || inBlendOut) {
        this._idleBlendWeight = 1 - clipRigMul;
      } else if (audioPlaying || placeholderActive) {
        this._idleBlendWeight = 0;
      } else {
        const retAlpha = 1 - Math.exp(-IDLE_RETURN_BLEND * delta);
        this._idleBlendWeight = THREE.MathUtils.lerp(
          this._idleBlendWeight,
          1,
          retAlpha,
        );
        if (this._idleBlendWeight > 0.999) this._idleBlendWeight = 1;
      }
      if (this._idleBlendWeight > 0 && this.idleAction.paused) {
        this.idleAction.paused = false;
      }
      this.idleAction.setEffectiveWeight(this._idleBlendWeight);
      if (this._idleBlendWeight <= 1e-5) {
        this._idleBlendWeight = 0;
        this.idleAction.setEffectiveWeight(0);
        this.idleAction.paused = true;
      }
      if (!this.idleAction.paused && this._idleBlendWeight > 0) {
        this.idleMixer.update(delta);
      }
      this._applyIdleRestBlend(this._idleBlendWeight);
    }

    const weightedFaceValues = scaleFaceValues(
      this._faceSmoothingState.values,
      this._dialogFaceWeight,
      this._weightedFaceState,
    );
    if (weightedFaceValues) {
      applyFaceToExpressionManager(this.vrm, this.faceData.names, weightedFaceValues);
    } else if (this._placeholderPlaying && this.vrm.expressionManager) {
      const mouthOpen = 0.18 + 0.22 * (0.5 + 0.5 * Math.sin(t * 10));
      const mouthRound = 0.04 + 0.08 * (0.5 + 0.5 * Math.sin(t * 6 + 0.8));
      this.vrm.expressionManager.setValue("aa", mouthOpen);
      this.vrm.expressionManager.setValue("oh", mouthRound);
      this.vrm.expressionManager.setValue("ou", mouthRound * 0.6);
      this.vrm.expressionManager.setValue("blink", 0);
    } else if (this.vrm.expressionManager) {
      this.vrm.expressionManager.resetValues();
    }
    if (this.vrm.update) this.vrm.update(delta);
    if (weightedFaceValues) {
      applyMorphTargets(this.vrm.scene, this.faceData.names, weightedFaceValues);
    } else if (this.faceData?.names) {
      clearMorphTargets(this.vrm.scene, this.faceData.names);
    }
    applyRigPose(this.vrm, faceMatrix, this._headPoseState);
    if (this._dialogFaceWeight === 0 && this._dialogPoseWeight === 0) {
      this._headPoseState.initialized = false;
      this._headPoseState.smoothedInitialized = false;
      this._faceSmoothingState.values = null;
      this._weightedFaceState.values = null;
    }
    const oldTarget = renderer.getRenderTarget();
    const oldClearColor = renderer.getClearColor(new THREE.Color());
    const oldClearAlpha = renderer.getClearAlpha();
    renderer.setRenderTarget(this.renderTarget);
    renderer.setClearColor(0x000000, 0);
    renderer.clear();
    renderer.render(this.scene, this.camera);
    renderer.setRenderTarget(oldTarget);
    renderer.setClearColor(oldClearColor);
    renderer.setClearAlpha(oldClearAlpha);
  }

  dispose() {
    this.stop();
    if (this._iosPooledDialogAudio) {
      this._iosPooledDialogAudio.pause();
      this._iosPooledDialogAudio.removeAttribute("src");
      this._iosPooledDialogAudio.load();
      this._iosPooledDialogAudio = null;
    }
    this.idleMixer?.stopAllAction();
    this.renderTarget.dispose();
    this._placeholderTexture.dispose();
    if (this.vrm?.scene) this.scene.remove(this.vrm.scene);
    this.vrm = null;
    this.faceData = null;
    this._idleBodyRestTargets = null;
    this._ready = false;
  }
}
