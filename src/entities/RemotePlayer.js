import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { Interpolation } from "../network/Interpolation.js";

const SHIP_COLORS = {
  fighter: 0x00f0ff,
  tank: 0xff8800,
  rogue: 0x00ff88,
};

const TEAM_COLORS = {
  1: 0xff4455,
  2: 0x4488ff,
};

let cockpitModel = null;
let cockpitLoading = null;

async function loadCockpitModel() {
  if (cockpitModel) return cockpitModel;
  if (cockpitLoading) return cockpitLoading;
  
  cockpitLoading = new Promise((resolve) => {
    const loader = new GLTFLoader();
    loader.load(
      "./cockpit.glb",
      (gltf) => {
        cockpitModel = gltf.scene;
        resolve(cockpitModel);
      },
      undefined,
      () => {
        resolve(null);
      }
    );
  });
  
  return cockpitLoading;
}

export class RemotePlayer {
  constructor(scene, playerData, teamMode = false) {
    this.scene = scene;
    this.id = playerData.id;
    this.name = playerData.name;
    this.shipClass = playerData.shipClass || "fighter";
    this.team = playerData.team || 0;
    this.health = playerData.health || 100;
    this.maxHealth = playerData.maxHealth || 100;
    this.alive = playerData.alive !== false;
    this.teamMode = teamMode;
    
    this.interpolation = new Interpolation({
      bufferSize: 5,
      interpolationDelay: 100,
    });
    
    this.mesh = new THREE.Group();
    this.mesh.position.set(playerData.x || 0, playerData.y || 0, playerData.z || 0);
    this.mesh.quaternion.set(
      playerData.qx || 0,
      playerData.qy || 0,
      playerData.qz || 0,
      playerData.qw || 1
    );
    
    this.createShipMesh();
    this.createNameLabel();
    
    scene.add(this.mesh);
  }

  async createShipMesh() {
    const model = await loadCockpitModel();
    
    if (model) {
      const clone = model.clone();
      clone.scale.setScalar(0.5);
      
      const color = this.teamMode && this.team > 0
        ? TEAM_COLORS[this.team]
        : SHIP_COLORS[this.shipClass] || 0x00f0ff;
      
      clone.traverse((child) => {
        if (child.isMesh) {
          child.material = child.material.clone();
          child.material.emissive = new THREE.Color(color);
          child.material.emissiveIntensity = 0.3;
        }
      });
      
      this.shipMesh = clone;
      this.mesh.add(clone);
    } else {
      const geo = new THREE.ConeGeometry(0.5, 1.5, 8);
      geo.rotateX(Math.PI / 2);
      
      const color = this.teamMode && this.team > 0
        ? TEAM_COLORS[this.team]
        : SHIP_COLORS[this.shipClass] || 0x00f0ff;
      
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
      this.teamMode && this.team > 0 ? TEAM_COLORS[this.team] : SHIP_COLORS[this.shipClass],
      2,
      8
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
    ctx.fillStyle = this.teamMode && this.team > 0
      ? (this.team === 1 ? "#ff4455" : "#4488ff")
      : "#00f0ff";
    ctx.fillText(this.name, 128, 40);
    
    const texture = new THREE.CanvasTexture(canvas);
    const spriteMat = new THREE.SpriteMaterial({
      map: texture,
      transparent: true,
      depthTest: false,
    });
    
    this.nameSprite = new THREE.Sprite(spriteMat);
    this.nameSprite.scale.set(4, 1, 1);
    this.nameSprite.position.set(0, 2, 0);
    this.mesh.add(this.nameSprite);
  }

  updateFromServer(playerData, timestamp = Date.now()) {
    this.health = playerData.health;
    this.maxHealth = playerData.maxHealth;
    this.alive = playerData.alive;
    this.shipClass = playerData.shipClass;
    this.team = playerData.team;
    
    if (this.alive) {
      this.interpolation.pushState(
        { x: playerData.x, y: playerData.y, z: playerData.z },
        { x: playerData.qx, y: playerData.qy, z: playerData.qz, w: playerData.qw },
        timestamp
      );
    }
    
    this.mesh.visible = this.alive;
  }

  update(delta) {
    if (!this.alive) return;
    
    const { position, rotation } = this.interpolation.getInterpolatedState();
    
    this.mesh.position.copy(position);
    this.mesh.quaternion.copy(rotation);
    
    if (this.nameSprite) {
      this.nameSprite.quaternion.identity();
    }
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
