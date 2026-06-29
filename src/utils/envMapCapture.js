import * as THREE from "three";
import { flipPixels, pixelsToPngUrl, SplatMesh } from "@sparkjsdev/spark";

const FACE_NAMES = ["px", "nx", "py", "ny", "pz", "nz"];
const CUBE_FACES = [
  {
    name: "px",
    direction: new THREE.Vector3(1, 0, 0),
    up: new THREE.Vector3(0, -1, 0),
  },
  {
    name: "nx",
    direction: new THREE.Vector3(-1, 0, 0),
    up: new THREE.Vector3(0, -1, 0),
  },
  {
    name: "py",
    direction: new THREE.Vector3(0, 1, 0),
    up: new THREE.Vector3(0, 0, 1),
  },
  {
    name: "ny",
    direction: new THREE.Vector3(0, -1, 0),
    up: new THREE.Vector3(0, 0, -1),
  },
  {
    name: "pz",
    direction: new THREE.Vector3(0, 0, 1),
    up: new THREE.Vector3(0, -1, 0),
  },
  {
    name: "nz",
    direction: new THREE.Vector3(0, 0, -1),
    up: new THREE.Vector3(0, -1, 0),
  },
];

let crcTable = null;

function getCrcTable() {
  if (crcTable) return crcTable;
  crcTable = new Uint32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) {
      c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
    crcTable[n] = c >>> 0;
  }
  return crcTable;
}

function crc32(bytes) {
  const table = getCrcTable();
  let c = 0xffffffff;
  for (let i = 0; i < bytes.length; i += 1) {
    c = table[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
  }
  return (c ^ 0xffffffff) >>> 0;
}

function writeU16(view, offset, value) {
  view.setUint16(offset, value, true);
}

function writeU32(view, offset, value) {
  view.setUint32(offset, value, true);
}

function utf8(value) {
  return new TextEncoder().encode(value);
}

function makeZip(files) {
  const chunks = [];
  const central = [];
  let offset = 0;

  for (const file of files) {
    const nameBytes = utf8(file.name);
    const data = file.data;
    const crc = crc32(data);
    const local = new Uint8Array(30 + nameBytes.length);
    const localView = new DataView(local.buffer);
    writeU32(localView, 0, 0x04034b50);
    writeU16(localView, 4, 20);
    writeU16(localView, 6, 0);
    writeU16(localView, 8, 0);
    writeU16(localView, 10, 0);
    writeU16(localView, 12, 0);
    writeU32(localView, 14, crc);
    writeU32(localView, 18, data.length);
    writeU32(localView, 22, data.length);
    writeU16(localView, 26, nameBytes.length);
    writeU16(localView, 28, 0);
    local.set(nameBytes, 30);
    chunks.push(local, data);

    const centralHeader = new Uint8Array(46 + nameBytes.length);
    const centralView = new DataView(centralHeader.buffer);
    writeU32(centralView, 0, 0x02014b50);
    writeU16(centralView, 4, 20);
    writeU16(centralView, 6, 20);
    writeU16(centralView, 8, 0);
    writeU16(centralView, 10, 0);
    writeU16(centralView, 12, 0);
    writeU16(centralView, 14, 0);
    writeU32(centralView, 16, crc);
    writeU32(centralView, 20, data.length);
    writeU32(centralView, 24, data.length);
    writeU16(centralView, 28, nameBytes.length);
    writeU16(centralView, 30, 0);
    writeU16(centralView, 32, 0);
    writeU16(centralView, 34, 0);
    writeU16(centralView, 36, 0);
    writeU32(centralView, 38, 0);
    writeU32(centralView, 42, offset);
    centralHeader.set(nameBytes, 46);
    central.push(centralHeader);

    offset += local.length + data.length;
  }

  const centralOffset = offset;
  let centralSize = 0;
  for (const entry of central) {
    chunks.push(entry);
    centralSize += entry.length;
  }

  const end = new Uint8Array(22);
  const endView = new DataView(end.buffer);
  writeU32(endView, 0, 0x06054b50);
  writeU16(endView, 8, files.length);
  writeU16(endView, 10, files.length);
  writeU32(endView, 12, centralSize);
  writeU32(endView, 16, centralOffset);
  writeU16(endView, 20, 0);
  chunks.push(end);

  return new Blob(chunks, { type: "application/zip" });
}

function dataUrlToBytes(url) {
  const base64 = url.slice(url.indexOf(",") + 1);
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function toVector3(value, fallback) {
  if (!value) return fallback.clone();
  if (value instanceof THREE.Vector3) return value.clone();
  return new THREE.Vector3(value.x ?? 0, value.y ?? 0, value.z ?? 0);
}

function resolveApplyRoot(game, applyTo) {
  if (!applyTo) return null;
  if (typeof applyTo === "string") {
    return game.sceneManager?.getObject?.(applyTo) ?? null;
  }
  return applyTo;
}

function defaultFilename(game) {
  const level = game.gameManager?.getState?.().currentLevel ?? "scene";
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  return `starspeed-env-${level}-${stamp}.zip`;
}

async function withEnvCaptureSplatSettings(sparkRenderer, options, callback) {
  if (options.disableConeCulling === false) {
    return callback();
  }

  const previous = {
    coneFov0: sparkRenderer.coneFov0,
    coneFov: sparkRenderer.coneFov,
    coneFoveate: sparkRenderer.coneFoveate,
    behindFoveate: sparkRenderer.behindFoveate,
    autoUpdate: sparkRenderer.autoUpdate,
  };
  const splatMeshes = [];
  sparkRenderer.parent?.traverse?.((object) => {
    if (object instanceof SplatMesh) {
      splatMeshes.push({
        object,
        coneFov0: object.coneFov0,
        coneFov: object.coneFov,
        coneFoveate: object.coneFoveate,
        behindFoveate: object.behindFoveate,
      });
    }
  });

  sparkRenderer.coneFov0 = options.coneFov0 ?? 360;
  sparkRenderer.coneFov = options.coneFov ?? 360;
  sparkRenderer.coneFoveate = options.coneFoveate ?? 1;
  sparkRenderer.behindFoveate = options.behindFoveate ?? 1;
  sparkRenderer.autoUpdate = false;
  for (const { object } of splatMeshes) {
    object.coneFov0 = options.coneFov0 ?? 360;
    object.coneFov = options.coneFov ?? 360;
    object.coneFoveate = options.coneFoveate ?? 1;
    object.behindFoveate = options.behindFoveate ?? 1;
  }

  try {
    return await callback();
  } finally {
    Object.assign(sparkRenderer, previous);
    for (const { object, ...meshPrevious } of splatMeshes) {
      Object.assign(object, meshPrevious);
    }
  }
}

function waitForFrames(count) {
  return new Promise((resolve) => {
    const step = (remaining) => {
      if (remaining <= 0) {
        resolve();
        return;
      }
      window.requestAnimationFrame(() => step(remaining - 1));
    };
    step(count);
  });
}

function setCubeFaceCamera(camera, worldCenter, face) {
  camera.position.copy(worldCenter);
  camera.up.copy(face.up);
  camera.lookAt(worldCenter.clone().add(face.direction));
  camera.updateMatrixWorld(true);
}

async function renderCubeFace(game, renderTarget, camera, faceIndex, options) {
  const renderer = game.renderer;
  await game.sparkRenderer.update({ scene: game.scene, camera });
  if (options.faceWarmupFrames > 0) {
    await waitForFrames(options.faceWarmupFrames);
    await game.sparkRenderer.update({ scene: game.scene, camera });
  }
  renderer.setRenderTarget(renderTarget, faceIndex);
  renderer.clear(true, true, true);
  renderer.render(game.scene, camera);
  renderer.setRenderTarget(null);

  const byteSize = renderTarget.width * renderTarget.height * 4;
  const pixels = new Uint8Array(byteSize);
  await renderer.readRenderTargetPixelsAsync(
    renderTarget,
    0,
    0,
    renderTarget.width,
    renderTarget.height,
    pixels,
    faceIndex,
  );
  return pixels;
}

async function prewarmCubeFaces(game, camera, options, worldCenter) {
  for (let cycle = 0; cycle < options.prewarmCycles; cycle += 1) {
    for (const face of CUBE_FACES) {
      setCubeFaceCamera(camera, worldCenter, face);
      await game.sparkRenderer.update({ scene: game.scene, camera });
      if (options.prewarmFrames > 0) {
        await waitForFrames(options.prewarmFrames);
      }
    }
  }
}

async function renderPerFaceEnvMap(game, options, worldCenter, hideObjects) {
  const colorSpace = THREE.LinearSRGBColorSpace ?? THREE.SRGBColorSpace;
  const renderTarget = new THREE.WebGLCubeRenderTarget(options.size, {
    format: THREE.RGBAFormat,
    type: THREE.UnsignedByteType,
    generateMipmaps: true,
    minFilter: THREE.LinearMipMapLinearFilter,
    magFilter: THREE.LinearFilter,
    colorSpace,
  });
  const camera = new THREE.PerspectiveCamera(90, 1, options.near, options.far);
  const renderer = game.renderer;
  const previousRenderTarget = renderer.getRenderTarget();
  const previousXrEnabled = renderer.xr.enabled;
  const objectVisibility = new Map();
  const buffers = [];

  for (const object of hideObjects) {
    objectVisibility.set(object, object.visible);
    object.visible = false;
  }

  renderer.xr.enabled = false;

  try {
    await prewarmCubeFaces(game, camera, options, worldCenter);
    for (let faceIndex = 0; faceIndex < CUBE_FACES.length; faceIndex += 1) {
      const face = CUBE_FACES[faceIndex];
      setCubeFaceCamera(camera, worldCenter, face);
      buffers.push(
        await renderCubeFace(game, renderTarget, camera, faceIndex, options),
      );
    }
  } finally {
    renderer.setRenderTarget(previousRenderTarget);
    renderer.xr.enabled = previousXrEnabled;
    for (const [object, visible] of objectVisibility.entries()) {
      object.visible = visible;
    }
  }

  const pmrem = new THREE.PMREMGenerator(renderer);
  const envMap = pmrem.fromCubemap(renderTarget.texture).texture;
  pmrem.dispose();

  return { envMap, buffers, renderTarget };
}

async function makeCubeAssetFiles(options, center, buffers) {
  const files = buffers.map((pixels, index) => {
    const pngUrl = pixelsToPngUrl(
      flipPixels(pixels.slice(), options.size, options.size),
      options.size,
      options.size,
    );
    return {
      name: `${FACE_NAMES[index]}.png`,
      data: dataUrlToBytes(pngUrl),
    };
  });

  const manifest = {
    type: "starspeed-spark-env-cubemap",
    faceOrder: FACE_NAMES,
    size: options.size,
    near: options.near,
    far: options.far,
    worldCenter: center.toArray(),
    generatedAt: new Date().toISOString(),
    loader: "THREE.CubeTextureLoader().setPath(folder).load(['px.png','nx.png','py.png','ny.png','pz.png','nz.png'])",
  };

  files.push({
    name: "manifest.json",
    data: utf8(`${JSON.stringify(manifest, null, 2)}\n`),
  });

  return files;
}

export function installEnvMapCapture(game) {
  const capture = async (captureOptions = {}) => {
    if (!game?.sparkRenderer || !game.scene || !game.camera) {
      throw new Error("Starspeed scene is not ready for environment capture");
    }

    const options = {
      ...captureOptions,
      size: captureOptions.size ?? 256,
      near: captureOptions.near ?? 0.1,
      far: captureOptions.far ?? 1000,
      download: captureOptions.download ?? true,
      hideCockpit: captureOptions.hideCockpit ?? true,
      update: captureOptions.update ?? true,
      disableConeCulling: captureOptions.disableConeCulling ?? true,
      perFaceUpdate: captureOptions.perFaceUpdate ?? true,
      prewarmCycles: captureOptions.prewarmCycles ?? 2,
      prewarmFrames: captureOptions.prewarmFrames ?? 4,
      faceWarmupFrames: captureOptions.faceWarmupFrames ?? 8,
    };
    const cameraCenter = new THREE.Vector3();
    game.camera.getWorldPosition(cameraCenter);
    const worldCenter = toVector3(options.worldCenter, cameraCenter);
    const hideObjects = [
      ...(options.hideCockpit ? [game.camera] : []),
      ...(options.hideObjects ?? []),
    ].filter(Boolean);

    const captureResult = await withEnvCaptureSplatSettings(
      game.sparkRenderer,
      options,
      async () => {
        if (options.perFaceUpdate) {
          return renderPerFaceEnvMap(game, options, worldCenter, hideObjects);
        }

        const envMap = await game.sparkRenderer.renderEnvMap({
          scene: game.scene,
          worldCenter,
          size: options.size,
          near: options.near,
          far: options.far,
          hideObjects,
          update: options.update,
        });
        return {
          envMap,
          buffers: await game.sparkRenderer.readCubeTargets(),
          renderTarget: null,
        };
      },
    );
    const { envMap, buffers, renderTarget } = captureResult;

    const applyRoot = resolveApplyRoot(game, options.applyTo);
    if (applyRoot) {
      game.sparkRenderer.recurseSetEnvMap(applyRoot, envMap);
    }

    let files = null;
    if (options.download) {
      files = await makeCubeAssetFiles(options, worldCenter, buffers);
      downloadBlob(makeZip(files), options.filename ?? defaultFilename(game));
    }

    const result = {
      envMap,
      files,
      buffers,
      renderTarget,
      worldCenter: worldCenter.clone(),
      applyTo(root) {
        game.sparkRenderer.recurseSetEnvMap(root, envMap);
        return envMap;
      },
    };

    window.starspeedEnvMap.last = result;
    return result;
  };

  window.starspeedEnvMap = {
    ...(window.starspeedEnvMap ?? {}),
    capture,
    last: window.starspeedEnvMap?.last ?? null,
  };
  window.captureStarspeedEnvMap = capture;
  game.captureEnvMap = capture;
}
