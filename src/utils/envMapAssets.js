import * as THREE from "three";

const ENEMY_ENV_MAPS_BY_LEVEL = {
  saturnalia: {
    id: "gold",
    path: "envmaps/gold",
    intensity: 4,
    ambientIntensityScale: 1,
  },
};

const ENV_MAPS_BY_ID = {
  black: {
    id: "black",
    path: "envmaps/black",
    intensity: 4,
    ambientIntensityScale: 1,
  },
  bluegreen: {
    id: "bluegreen",
    path: "envmaps/bluegreen",
    intensity: 4,
    ambientIntensityScale: 1,
  },
  gold: ENEMY_ENV_MAPS_BY_LEVEL.saturnalia,
  green: {
    id: "green",
    path: "envmaps/green",
    intensity: 4,
    ambientIntensityScale: 1,
  },
};

const _cubeLoader = new THREE.CubeTextureLoader();
const _envMapCache = new Map();
let _pmremGenerator = null;

function assetUrl(path) {
  const base = (import.meta.env.BASE_URL || "/").replace(/\/$/, "") || "";
  return (base ? `${base}/${path}` : `./${path}`).replace(/\/+/g, "/");
}

export function getEnemyEnvMapConfigForLevel(levelId) {
  return ENEMY_ENV_MAPS_BY_LEVEL[levelId] ?? null;
}

export function getEnvironmentMapConfig(id) {
  return ENV_MAPS_BY_ID[id] ?? null;
}

export function applyEnvironmentMapToObject(root, envMap, intensity = 1) {
  if (!root) return;
  root.traverse((child) => {
    if (!child.isMesh || !child.material) return;
    const materials = Array.isArray(child.material)
      ? child.material
      : [child.material];
    for (const material of materials) {
      if (!material || !("envMap" in material)) continue;
      material.envMap = envMap;
      material.envMapIntensity = intensity;
      material.needsUpdate = true;
    }
  });
}

function patchMaterialForEnvMapBlend(material) {
  if (material.userData.envMapBlend) return material.userData.envMapBlend;

  const previousOnBeforeCompile = material.onBeforeCompile;
  const blendState = {
    uniforms: null,
    fromTexture: null,
    toTexture: null,
    factor: 0,
  };

  material.onBeforeCompile = (shader, renderer) => {
    previousOnBeforeCompile?.(shader, renderer);
    shader.uniforms.envMapBlendFromMap = { value: blendState.fromTexture };
    shader.uniforms.envMapBlendToMap = { value: blendState.toTexture };
    shader.uniforms.envMapBlendFactor = { value: blendState.factor };
    blendState.uniforms = shader.uniforms;

    shader.fragmentShader = shader.fragmentShader.replace(
      "uniform float envMapIntensity;",
      "uniform float envMapIntensity;\nuniform sampler2D envMapBlendFromMap;\nuniform sampler2D envMapBlendToMap;\nuniform float envMapBlendFactor;",
    );
    shader.fragmentShader = shader.fragmentShader.replace(
      "return PI * envMapColor.rgb * envMapIntensity;",
      "vec4 envMapBlendFromColor = textureCubeUV( envMapBlendFromMap, envMapRotation * worldNormal, 1.0 );\n\t\t\tvec4 envMapBlendToColor = textureCubeUV( envMapBlendToMap, envMapRotation * worldNormal, 1.0 );\n\t\t\treturn PI * mix( envMapBlendFromColor.rgb, envMapBlendToColor.rgb, envMapBlendFactor ) * envMapIntensity;",
    );
    shader.fragmentShader = shader.fragmentShader.replace(
      "return envMapColor.rgb * envMapIntensity;",
      "vec4 envMapBlendFromColor = textureCubeUV( envMapBlendFromMap, envMapRotation * reflectVec, roughness );\n\t\t\tvec4 envMapBlendToColor = textureCubeUV( envMapBlendToMap, envMapRotation * reflectVec, roughness );\n\t\t\treturn mix( envMapBlendFromColor.rgb, envMapBlendToColor.rgb, envMapBlendFactor ) * envMapIntensity;",
    );
  };

  const previousCacheKey = material.customProgramCacheKey?.bind(material);
  material.customProgramCacheKey = () =>
    `${previousCacheKey?.() ?? ""}|starspeed-env-blend`;
  material.userData.envMapBlend = blendState;
  material.needsUpdate = true;
  return blendState;
}

export function applyBlendedEnvironmentMapToObject(
  root,
  fromEnv,
  toEnv,
  blendFactor,
) {
  if (!root || !fromEnv?.texture) return;

  const factor = THREE.MathUtils.clamp(blendFactor ?? 0, 0, 1);
  const toTexture = toEnv?.texture ?? fromEnv.texture;
  const intensity = THREE.MathUtils.lerp(
    fromEnv.intensity ?? 1,
    toEnv?.intensity ?? fromEnv.intensity ?? 1,
    factor,
  );

  root.traverse((child) => {
    if (!child.isMesh || !child.material) return;
    const materials = Array.isArray(child.material)
      ? child.material
      : [child.material];
    for (const material of materials) {
      if (!material || !("envMap" in material)) continue;
      const blendState = patchMaterialForEnvMapBlend(material);
      if (!material.envMap) material.envMap = fromEnv.texture;
      material.envMapIntensity = intensity;
      blendState.fromTexture = fromEnv.texture;
      blendState.toTexture = toTexture;
      blendState.factor = factor;
      if (blendState.uniforms) {
        blendState.uniforms.envMapBlendFromMap.value = fromEnv.texture;
        blendState.uniforms.envMapBlendToMap.value = toTexture;
        blendState.uniforms.envMapBlendFactor.value = factor;
      }
      material.needsUpdate = !blendState.uniforms;
    }
  });
}

export function setEnvironmentMapRotationForObject(root, rotation) {
  if (!root || !rotation) return;
  root.traverse((child) => {
    if (!child.isMesh || !child.material) return;
    const materials = Array.isArray(child.material)
      ? child.material
      : [child.material];
    for (const material of materials) {
      if (!material || !("envMapRotation" in material)) continue;
      material.envMapRotation.copy(rotation);
    }
  });
}

function estimateAmbientLightingFromCubeImages(images) {
  const imageList = Array.isArray(images) ? images : [];
  if (imageList.length === 0) return null;

  const canvas = document.createElement("canvas");
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (!ctx) return null;

  let r = 0;
  let g = 0;
  let b = 0;
  let samples = 0;

  for (const image of imageList) {
    const width = image?.naturalWidth || image?.width || 0;
    const height = image?.naturalHeight || image?.height || 0;
    if (!width || !height) continue;

    canvas.width = width;
    canvas.height = height;
    ctx.clearRect(0, 0, width, height);
    ctx.drawImage(image, 0, 0, width, height);

    const data = ctx.getImageData(0, 0, width, height).data;
    const stride = Math.max(1, Math.floor(Math.min(width, height) / 32));
    for (let y = 0; y < height; y += stride) {
      for (let x = 0; x < width; x += stride) {
        const i = (y * width + x) * 4;
        const alpha = data[i + 3] / 255;
        if (alpha < 0.02) continue;

        const sr = data[i] / 255;
        const sg = data[i + 1] / 255;
        const sb = data[i + 2] / 255;
        const luminance = sr * 0.2126 + sg * 0.7152 + sb * 0.0722;
        if (luminance < 0.01) continue;

        const weight = 0.35 + luminance * 1.6;
        r += sr * weight;
        g += sg * weight;
        b += sb * weight;
        samples += weight;
      }
    }
  }

  if (samples <= 0) return null;

  r /= samples;
  g /= samples;
  b /= samples;
  const maxChannel = Math.max(r, g, b, 0.001);
  const luminance = r * 0.2126 + g * 0.7152 + b * 0.0722;

  return {
    ambientColor: new THREE.Color(
      r / maxChannel,
      g / maxChannel,
      b / maxChannel,
    ),
    intensityScale: THREE.MathUtils.clamp(0.75 + luminance * 2.25, 0.75, 2.4),
  };
}

export function applyEnvironmentAmbientToLight(light, loadedEnvMap, config) {
  if (!light || !loadedEnvMap?.lighting?.ambientColor) return;
  light.color.copy(loadedEnvMap.lighting.ambientColor);
  light.intensity *=
    config?.ambientIntensityScale ?? loadedEnvMap.lighting.intensityScale;
}

export async function loadEnvironmentMap(config, renderer) {
  if (!config || !renderer) return null;
  if (_envMapCache.has(config.id)) return _envMapCache.get(config.id);

  const folder = `${config.path.replace(/\/$/, "")}/`;
  const manifestUrl = assetUrl(`${folder}manifest.json`);
  const manifest = await fetch(manifestUrl, { cache: "no-cache" }).then(
    (res) => (res.ok ? res.json() : null),
  );
  const faceOrder = manifest?.faceOrder ?? ["px", "nx", "py", "ny", "pz", "nz"];
  const cubeTexture = await _cubeLoader
    .setPath(assetUrl(folder))
    .loadAsync(faceOrder.map((face) => `${face}.png`));

  cubeTexture.colorSpace = THREE.SRGBColorSpace;
  const lighting = estimateAmbientLightingFromCubeImages(
    cubeTexture.images ?? cubeTexture.image,
  );
  _pmremGenerator ??= new THREE.PMREMGenerator(renderer);
  const target = _pmremGenerator.fromCubemap(cubeTexture);
  cubeTexture.dispose();

  const result = {
    texture: target.texture,
    intensity: config.intensity ?? 1,
    lighting,
    target,
  };
  _envMapCache.set(config.id, result);
  return result;
}
