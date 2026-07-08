import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";

const FLEET_PATH = "gltf/drone-fleet.glb";

let fleetLoadPromise = null;
let fleetRoot = null;
let fleetCatalog = null;
let fleetTemplates = [];

function publicUrl(path) {
  const base = (import.meta.env.BASE_URL || "/").replace(/\/$/, "") || "";
  const clean = path.replace(/^\//, "");
  return base ? `${base}/${clean}` : `/${clean}`;
}

function laserColorFromFleetShip(ship) {
  const color = new THREE.Color(ship.secondaryColor || ship.mainColor || "#ff8800");
  return color.getHex();
}

function prepareFleetTemplate(wrapper, ship) {
  wrapper.visible = false;
  wrapper.userData.droneFleetShip = true;
  wrapper.userData.droneFleetId = ship.id;
  wrapper.userData.droneFleetMeta = ship;
  wrapper.userData.cloneMaterials = false;
  wrapper.userData.enemyLaserColor = laserColorFromFleetShip(ship);
  wrapper.userData.enemyLaserIntensity = 8.0;
  return wrapper;
}

export function isDroneFleetActive() {
  return fleetTemplates.length > 0;
}

export function getDroneFleetCatalog() {
  return fleetCatalog;
}

export function getFleetShipIndexById(shipId) {
  if (!shipId || !fleetCatalog?.has(shipId)) return -1;
  const ship = fleetCatalog.get(shipId);
  return fleetTemplates.findIndex(
    (template) => template.userData.droneFleetId === ship.id,
  );
}

export function setupFleetDroneCloneMarkers(enemy, root) {
  enemy.engineMarkers.length = 0;
  enemy.weaponMarkers.length = 0;
  root.traverse((child) => {
    if (!child.isMesh) return;
    const n = child.name?.toLowerCase?.() || "";
    if (n.includes("collider")) {
      child.visible = false;
      return;
    }
    const mats = Array.isArray(child.material)
      ? child.material
      : child.material
        ? [child.material]
        : [];
    if (mats.some((m) => m?.name === "Collider_Invisible")) {
      child.visible = false;
      return;
    }
    if (n.startsWith("thruster_")) {
      child.visible = false;
      enemy.engineMarkers.push(child);
    } else if (
      n.startsWith("weapon_") ||
      n.startsWith("turret_") ||
      n.includes("laser") ||
      n.includes("cannon") ||
      n.includes("muzzle")
    ) {
      enemy.weaponMarkers.push(child);
    }
  });
}

export async function loadDroneFleetModels() {
  if (fleetTemplates.length > 0) {
    return { templates: fleetTemplates, catalog: fleetCatalog, fleetRoot };
  }
  if (fleetLoadPromise) return fleetLoadPromise;

  fleetLoadPromise = (async () => {
    const loader = new GLTFLoader();
    const fleetUrl = publicUrl(FLEET_PATH);
    let gltf;
    try {
      gltf = await loader.loadAsync(fleetUrl);
    } catch (error) {
      console.warn(
        `[Enemy] drone-fleet.glb unavailable (${fleetUrl}), using per-ship GLBs:`,
        error,
      );
      return null;
    }

    const fleetMeta =
      gltf.asset?.extras?.proceduralGeneratorFleet ??
      gltf.parser?.json?.asset?.extras?.proceduralGeneratorFleet;
    if (!fleetMeta || fleetMeta.version !== 1 || !Array.isArray(fleetMeta.ships)) {
      console.warn("[Enemy] drone-fleet.glb missing proceduralGeneratorFleet manifest");
      return null;
    }

    fleetRoot = gltf.scene;
    fleetRoot.visible = false;
    fleetRoot.name = fleetRoot.name || "Fleet_Root";

    fleetCatalog = new Map();
    const templates = [];
    for (const ship of fleetMeta.ships) {
      if (!ship?.id || !ship?.node) continue;
      const wrapper = fleetRoot.getObjectByName(ship.node);
      if (!wrapper) {
        console.warn(`[Enemy] Fleet ship node missing: ${ship.node}`);
        continue;
      }
      fleetCatalog.set(ship.id, ship);
      templates.push(prepareFleetTemplate(wrapper, ship));
    }

    if (templates.length === 0) {
      console.warn("[Enemy] drone-fleet.glb contained no spawnable ships");
      return null;
    }

    fleetTemplates = templates;
    console.log(
      `[Enemy] Loaded ${fleetTemplates.length} ships from drone-fleet.glb (shared textures)`,
    );
    return { templates: fleetTemplates, catalog: fleetCatalog, fleetRoot };
  })()
    .catch((error) => {
      console.warn("[Enemy] Failed to load drone-fleet.glb:", error);
      return null;
    })
    .finally(() => {
      if (fleetTemplates.length === 0) {
        fleetLoadPromise = null;
      }
    });

  return fleetLoadPromise;
}
