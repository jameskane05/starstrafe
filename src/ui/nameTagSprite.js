import * as THREE from "three";

function renderNameTag(state, speaking = false) {
  const { canvas, ctx, label, texture } = state;
  ctx.clearRect(0, 0, canvas.width, canvas.height);

  const border = speaking ? "#38ff7a" : "rgba(0, 240, 255, 0.75)";
  if (speaking) {
    ctx.fillStyle = "rgba(8, 80, 35, 0.82)";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
  }

  ctx.lineWidth = speaking ? 5 : 2;
  ctx.strokeStyle = border;
  ctx.shadowColor = speaking ? "#38ff7a" : "transparent";
  ctx.shadowBlur = speaking ? 18 : 0;
  ctx.strokeRect(4, 4, canvas.width - 8, canvas.height - 8);

  ctx.font = "bold 36px Rajdhani, sans-serif";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.lineWidth = speaking ? 5 : 3;
  ctx.strokeStyle = speaking ? "#38ff7a" : "rgba(0, 0, 0, 0.85)";
  ctx.fillStyle = speaking ? "#d8ffe6" : "#00f0ff";
  ctx.strokeText(label, canvas.width / 2, canvas.height / 2 + 2);
  ctx.fillText(label, canvas.width / 2, canvas.height / 2 + 2);

  texture.needsUpdate = true;
}

export function createNameTagSprite(label, options = {}) {
  const canvas = document.createElement("canvas");
  canvas.width = options.width ?? 256;
  canvas.height = options.height ?? 64;
  const ctx = canvas.getContext("2d");
  const texture = new THREE.CanvasTexture(canvas);
  const state = {
    canvas,
    ctx,
    label,
    texture,
    speaking: false,
  };
  renderNameTag(state, false);

  const material = new THREE.SpriteMaterial({
    map: texture,
    transparent: true,
    depthTest: false,
    depthWrite: false,
  });
  const sprite = new THREE.Sprite(material);
  const scale = options.scale ?? new THREE.Vector3(4, 1, 1);
  sprite.scale.copy(scale);
  sprite.position.copy(options.position ?? new THREE.Vector3(0, 2, 0));
  sprite.renderOrder = options.renderOrder ?? 1000;
  sprite.userData.nameTag = state;
  return sprite;
}

export function setNameTagSpeaking(sprite, speaking) {
  const state = sprite?.userData?.nameTag;
  if (!state || state.speaking === speaking) return;
  state.speaking = speaking;
  renderNameTag(state, speaking);
}

export function disposeNameTagSprite(sprite) {
  const state = sprite?.userData?.nameTag;
  state?.texture?.dispose?.();
  sprite?.material?.dispose?.();
}
