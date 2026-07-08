import * as THREE from "three";

const ENEMY_ENV_MAPS_BY_LEVEL = {
  saturnalia: {
    id: "gold",
    path: "envmaps/gold",
    intensity: 4,
    ambientColor: [1, 0.5072, 0.2677],
    ambientIntensityScale: 1.2872,
  },
  earthdefense: {
    id: "black",
    path: "envmaps/black",
    intensity: 3,
    ambientColor: [1, 0.504, 0.2772],
    ambientIntensityScale: 1.02,
  },
};

const ENV_MAPS_BY_ID = {
  black: {
    id: "black",
    path: "envmaps/black",
    intensity: 4,
    ambientColor: [1, 0.504, 0.2772],
    ambientIntensityScale: 0.8894,
  },
  bluegreen: {
    id: "bluegreen",
    path: "envmaps/bluegreen",
    intensity: 4,
    ambientColor: [0.2163, 0.7642, 1],
    ambientIntensityScale: 1.457,
  },
  gold: ENEMY_ENV_MAPS_BY_LEVEL.saturnalia,
  green: {
    id: "green",
    path: "envmaps/green",
    intensity: 4,
    ambientColor: [0.1728, 1, 0.0166],
    ambientIntensityScale: 1.5218,
  },
  red: {
    id: "red",
    path: "envmaps/red",
    intensity: 4,
    ambientColor: [1, 0.1843, 0.2004],
    ambientIntensityScale: 1.0047,
  },
  "earth-white": {
    id: "earth-white",
    path: "envmaps/earth-white",
    intensity: 4,
    ambientColor: [1, 0.7483, 0.7646],
    ambientIntensityScale: 1.2274,
  },
  "earth-grey": {
    id: "earth-grey",
    path: "envmaps/earth-grey",
    intensity: 4,
    ambientColor: [1, 0.9795, 0.9765],
    ambientIntensityScale: 1.6463,
  },
  "earth-command": {
    id: "earth-command",
    path: "envmaps/earth-command",
    intensity: 4,
    ambientColor: [0.6684, 0.7847, 1],
    ambientIntensityScale: 1.6686,
  },
};

/** GLB EnvMap-* zone ids (e.g. Grey, White.002) → bundled envmaps/* folders. */
const ENV_MAP_ALIASES = {
  grey: "black",
  white: "bluegreen",
  command: "red",
};

const ENV_MAP_ALIASES_BY_LEVEL = {
  earthdefense: {
    grey: "earth-grey",
    white: "earth-white",
    command: "earth-command",
  },
};

function resolveEnvMapId(rawId, levelId) {
  if (!rawId) return null;
  const id = String(rawId).trim().toLowerCase();
  const base = id.replace(/\.\d+$/, "");
  const levelAliases = levelId ? ENV_MAP_ALIASES_BY_LEVEL[levelId] : null;
  return (
    levelAliases?.[id] ??
    levelAliases?.[base] ??
    ENV_MAP_ALIASES[id] ??
    ENV_MAP_ALIASES[base] ??
    id
  );
}

const _cubeLoader = new THREE.CubeTextureLoader();
const _envMapCache = new Map();
let _pmremGenerator = null;

export const LEVELS_WITH_ENV_ZONES = ["earthdefense", "saturnalia"];

export function levelUsesEnvZones(levelId) {
  return LEVELS_WITH_ENV_ZONES.includes(levelId);
}

/**
 * Env maps on enemy bots forced a material recompile every time a bot spawned/streamed in.
 * Disabled for now; cockpit + allied NPC env maps are unaffected.
 */
export const ENEMY_BOT_ENVMAPS_ENABLED = false;

function assetUrl(path) {
  const base = (import.meta.env.BASE_URL || "/").replace(/\/$/, "") || "";
  return (base ? `${base}/${path}` : `./${path}`).replace(/\/+/g, "/");
}

export function getEnemyEnvMapConfigForLevel(levelId) {
  return ENEMY_ENV_MAPS_BY_LEVEL[levelId] ?? null;
}

export function getEnvironmentMapConfig(id, levelId) {
  return ENV_MAPS_BY_ID[resolveEnvMapId(id, levelId)] ?? null;
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
      const fallbackTexture = factor >= 0.999 ? toTexture : fromEnv.texture;
      if (material.envMap !== fallbackTexture) {
        material.envMap = fallbackTexture;
        material.needsUpdate = true;
      }
      material.envMapIntensity = intensity;
      blendState.fromTexture = factor >= 0.999 ? toTexture : fromEnv.texture;
      blendState.toTexture = toTexture;
      blendState.factor = factor;
      if (blendState.uniforms) {
        blendState.uniforms.envMapBlendFromMap.value = blendState.fromTexture;
        blendState.uniforms.envMapBlendToMap.value = toTexture;
        blendState.uniforms.envMapBlendFactor.value = factor;
      }
      material.needsUpdate = material.needsUpdate || !blendState.uniforms;
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

function lightingFromConfig(config) {
  if (!config?.ambientColor) return null;
  return {
    ambientColor: new THREE.Color().fromArray(config.ambientColor),
    intensityScale: config.ambientIntensityScale ?? 1,
  };
}

export function applyEnvironmentAmbientToLight(light, loadedEnvMap, config) {
  if (!light || !loadedEnvMap?.lighting?.ambientColor) return;
  light.color.copy(loadedEnvMap.lighting.ambientColor);
  light.intensity *= loadedEnvMap.lighting.intensityScale ?? 1;
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
  _pmremGenerator ??= new THREE.PMREMGenerator(renderer);
  const target = _pmremGenerator.fromCubemap(cubeTexture);
  cubeTexture.dispose();

  const result = {
    texture: target.texture,
    intensity: config.intensity ?? 1,
    lighting: lightingFromConfig(config),
    target,
  };
  _envMapCache.set(config.id, result);
  return result;
}
