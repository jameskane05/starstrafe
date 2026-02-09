import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";

const STAR_COUNT = 3000;
const SPARKLE_COUNT = 500;
const SPREAD_X = 300;  // Wider spread to fill screen
const SPREAD_Y = 200;
const STAR_SPEED = 60;
// Stars spawn between Z_MIN (far) and Z_MAX (near camera)
const Z_MIN = -1200;  // Further away for depth
const Z_MAX = 10;     // Close to camera

function createGlowTexture(size = 64) {
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d");

  const center = size / 2;
  const gradient = ctx.createRadialGradient(center, center, 0, center, center, center);
  gradient.addColorStop(0, "rgba(255, 255, 255, 1)");
  gradient.addColorStop(0.15, "rgba(255, 255, 255, 0.9)");
  gradient.addColorStop(0.4, "rgba(255, 255, 255, 0.3)");
  gradient.addColorStop(1, "rgba(255, 255, 255, 0)");

  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, size, size);

  return new THREE.CanvasTexture(canvas);
}

export class StartScreenScene {
  constructor() {
    this.scene = null;
    this.camera = null;
    this.renderer = null;
    this.ship = null;
    this.starfield = null;
    this.sparkles = null;
    this.disposed = false;
    this.animationId = null;
    this.clock = new THREE.Clock();
    
    // Ship positioned to the left, in front of camera
    this.shipBaseX = -5;
    this.shipBaseY = -0.5;
    this.shipBaseZ = 5;  // In front of camera (camera is at z=15)
    this.rollPhase = 0;
    this.strafePhase = 0;

    // Mouse orbit
    this.mouseX = 0;
    this.mouseY = 0;
    this.orbitX = 0;
    this.orbitY = 0;
    this.orbitRange = 0.06; // ~3.5 degrees max
    this.orbitSmoothing = 3;
    this.cameraBasePos = new THREE.Vector3(0, 1, 15);
    this.cameraLookTarget = new THREE.Vector3(0, 0, -100);
  }

  async init(container) {
    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x020208);

    this.camera = new THREE.PerspectiveCamera(
      50,
      window.innerWidth / window.innerHeight,
      0.1,
      2000
    );
    // Camera at origin, looking forward into negative Z (into the stars)
    this.camera.position.set(0, 1, 15);
    this.camera.lookAt(0, 0, -100);

    this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false });
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    container.appendChild(this.renderer.domElement);
    this.renderer.domElement.style.position = "fixed";
    this.renderer.domElement.style.top = "0";
    this.renderer.domElement.style.left = "0";
    this.renderer.domElement.style.zIndex = "-1";

    this.createStarfield();
    this.createAmbientLighting();
    await this.loadShip();

    this._onResize = this.onResize.bind(this);
    this._onMouseMove = this.onMouseMove.bind(this);
    window.addEventListener("resize", this._onResize);
    window.addEventListener("mousemove", this._onMouseMove);
    
    this.animate();
  }

  createStarfield() {
    const glowTexture = createGlowTexture(64);
    
    // Main stars
    const starPositions = new Float32Array(STAR_COUNT * 3);
    const starColors = new Float32Array(STAR_COUNT * 3);
    const starSpeeds = new Float32Array(STAR_COUNT);
    
    const baseColor = new THREE.Color(0xffffff);
    const warmColor = new THREE.Color(0xffcc88);
    const coolColor = new THREE.Color(0x88ccff);
    const cyanColor = new THREE.Color(0x00f0ff);
    
    for (let i = 0; i < STAR_COUNT; i++) {
      const i3 = i * 3;
      starPositions[i3] = (Math.random() - 0.5) * SPREAD_X;
      starPositions[i3 + 1] = (Math.random() - 0.5) * SPREAD_Y;
      starPositions[i3 + 2] = Z_MIN + Math.random() * (Z_MAX - Z_MIN);
      
      const colorVar = Math.random();
      let color;
      if (colorVar < 0.1) color = warmColor;
      else if (colorVar < 0.2) color = coolColor;
      else if (colorVar < 0.25) color = cyanColor;
      else color = baseColor;
      
      const brightness = 0.5 + Math.random() * 0.5;
      starColors[i3] = color.r * brightness;
      starColors[i3 + 1] = color.g * brightness;
      starColors[i3 + 2] = color.b * brightness;
      
      // Center stars move faster (hyperspace effect)
      const distFromCenter = Math.sqrt(
        starPositions[i3] * starPositions[i3] + 
        starPositions[i3 + 1] * starPositions[i3 + 1]
      );
      const maxDist = Math.sqrt(SPREAD_X * SPREAD_X + SPREAD_Y * SPREAD_Y) / 2;
      const normalizedDist = Math.min(distFromCenter / maxDist, 1);
      starSpeeds[i] = 0.2 + (1 - normalizedDist) * 1.8;
    }
    
    const starGeometry = new THREE.BufferGeometry();
    starGeometry.setAttribute("position", new THREE.BufferAttribute(starPositions, 3));
    starGeometry.setAttribute("color", new THREE.BufferAttribute(starColors, 3));
    
    const starMaterial = new THREE.PointsMaterial({
      size: 1.2,
      map: glowTexture,
      vertexColors: true,
      transparent: true,
      opacity: 0.9,
      sizeAttenuation: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });
    
    this.starfield = new THREE.Points(starGeometry, starMaterial);
    this.starfield.userData.speeds = starSpeeds;
    this.scene.add(this.starfield);
    
    // Sparkle layer (larger, brighter stars - fewer of them)
    const sparklePositions = new Float32Array(SPARKLE_COUNT * 3);
    const sparkleColors = new Float32Array(SPARKLE_COUNT * 3);
    const sparkleSpeeds = new Float32Array(SPARKLE_COUNT);
    
    for (let i = 0; i < SPARKLE_COUNT; i++) {
      const i3 = i * 3;
      sparklePositions[i3] = (Math.random() - 0.5) * SPREAD_X;
      sparklePositions[i3 + 1] = (Math.random() - 0.5) * SPREAD_Y;
      sparklePositions[i3 + 2] = Z_MIN + Math.random() * (Z_MAX - Z_MIN);
      
      const brightness = 0.8 + Math.random() * 0.2;
      sparkleColors[i3] = brightness;
      sparkleColors[i3 + 1] = brightness;
      sparkleColors[i3 + 2] = brightness;
      
      const distFromCenter = Math.sqrt(
        sparklePositions[i3] * sparklePositions[i3] + 
        sparklePositions[i3 + 1] * sparklePositions[i3 + 1]
      );
      const maxDist = Math.sqrt(SPREAD_X * SPREAD_X + SPREAD_Y * SPREAD_Y) / 2;
      const normalizedDist = Math.min(distFromCenter / maxDist, 1);
      sparkleSpeeds[i] = 0.2 + (1 - normalizedDist) * 1.8;
    }
    
    const sparkleGeometry = new THREE.BufferGeometry();
    sparkleGeometry.setAttribute("position", new THREE.BufferAttribute(sparklePositions, 3));
    sparkleGeometry.setAttribute("color", new THREE.BufferAttribute(sparkleColors, 3));
    
    const sparkleMaterial = new THREE.PointsMaterial({
      size: 2.0,
      map: glowTexture,
      vertexColors: true,
      transparent: true,
      opacity: 0.8,
      sizeAttenuation: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });
    
    this.sparkles = new THREE.Points(sparkleGeometry, sparkleMaterial);
    this.sparkles.userData.speeds = sparkleSpeeds;
    this.scene.add(this.sparkles);
  }

  createAmbientLighting() {
    const ambient = new THREE.AmbientLight(0x404050, 0.6);
    this.scene.add(ambient);
    
    // Key light from front-left (warm white)
    const keyLight = new THREE.DirectionalLight(0xffeedd, 1.5);
    keyLight.position.set(-5, 3, 10);
    this.scene.add(keyLight);
    
    // Fill light from right (subtle warm)
    const fillLight = new THREE.DirectionalLight(0xffaa88, 0.3);
    fillLight.position.set(5, -2, 5);
    this.scene.add(fillLight);
    
    // Rim light from behind (subtle cyan accent)
    const rimLight = new THREE.DirectionalLight(0x66ddff, 0.4);
    rimLight.position.set(0, 2, -10);
    this.scene.add(rimLight);
    
    // Engine glow
    this.engineLight = new THREE.PointLight(0xff6600, 2, 8);
    this.engineLight.position.set(0, 0, 2);
    this.scene.add(this.engineLight);
  }

  async loadShip() {
    const loader = new GLTFLoader();
    
    return new Promise((resolve) => {
      loader.load(
        "./Heavy_EXT_01.glb",
        (gltf) => {
          this.ship = gltf.scene;
          this.ship.scale.setScalar(.8);
          this.ship.position.set(this.shipBaseX, this.shipBaseY, this.shipBaseZ);
          // Rotate to face camera - adjust as needed for new model
          this.ship.rotation.set(0, Math.PI, 0);
          
          // Debug: log bounding box
          const box = new THREE.Box3().setFromObject(this.ship);
          console.log("[StartScreen] Ship bounds:", box.min, box.max);
          
          this.scene.add(this.ship);
          console.log("[StartScreen] Ship loaded successfully");
          resolve();
        },
        undefined,
        (error) => {
          console.error("[StartScreen] Failed to load ship:", error);
          // Fallback geometry if model fails
          const geo = new THREE.ConeGeometry(0.8, 2.5, 8);
          geo.rotateX(Math.PI / 2);
          const mat = new THREE.MeshStandardMaterial({
            color: 0x334455,
            emissive: 0x00f0ff,
            emissiveIntensity: 0.2,
            metalness: 0.8,
            roughness: 0.3,
          });
          this.ship = new THREE.Mesh(geo, mat);
          this.ship.position.set(this.shipBaseX, this.shipBaseY, this.shipBaseZ);
          this.scene.add(this.ship);
          resolve();
        }
      );
    });
  }

  updateStarfield(delta) {
    const updateLayer = (points) => {
      if (!points) return;
      
      const positions = points.geometry.attributes.position.array;
      const speeds = points.userData.speeds;
      const count = positions.length / 3;
      
      for (let i = 0; i < count; i++) {
        const i3 = i * 3;
        // Stars move toward camera (positive Z direction)
        positions[i3 + 2] += STAR_SPEED * speeds[i] * delta;
        
        // When star passes camera, respawn it far away
        if (positions[i3 + 2] > Z_MAX) {
          positions[i3] = (Math.random() - 0.5) * SPREAD_X;
          positions[i3 + 1] = (Math.random() - 0.5) * SPREAD_Y;
          positions[i3 + 2] = Z_MIN + Math.random() * 50;
          
          // Recalculate speed
          const distFromCenter = Math.sqrt(
            positions[i3] * positions[i3] + 
            positions[i3 + 1] * positions[i3 + 1]
          );
          const maxDist = Math.sqrt(SPREAD_X * SPREAD_X + SPREAD_Y * SPREAD_Y) / 2;
          const normalizedDist = Math.min(distFromCenter / maxDist, 1);
          speeds[i] = 0.2 + (1 - normalizedDist) * 1.8;
        }
      }
      
      points.geometry.attributes.position.needsUpdate = true;
    };
    
    updateLayer(this.starfield);
    updateLayer(this.sparkles);
  }

  updateShip(delta) {
    if (!this.ship) return;
    
    const time = this.clock.elapsedTime;
    
    // Gentle roll oscillation
    this.rollPhase += delta * 0.4;
    const roll = Math.sin(this.rollPhase) * 0.12;
    
    // Subtle vertical bob
    const bob = Math.sin(time * 0.8) * 0.15;
    
    // Slow horizontal strafe
    this.strafePhase += delta * 0.25;
    const strafe = Math.sin(this.strafePhase) * 1.5;
    
    // Slight pitch variation
    const pitch = Math.sin(time * 0.5) * 0.03;
    
    this.ship.position.x = this.shipBaseX + strafe;
    this.ship.position.y = this.shipBaseY + bob;
    // Apply roll and pitch animation
    this.ship.rotation.x = pitch;
    this.ship.rotation.z = roll;
    
    // Update engine light position
    if (this.engineLight) {
      this.engineLight.position.set(
        this.ship.position.x,
        this.ship.position.y,
        this.ship.position.z + 2
      );
      // Flicker effect
      this.engineLight.intensity = 2 + Math.sin(time * 20) * 0.3;
    }
  }

  animate() {
    if (this.disposed) return;
    
    this.animationId = requestAnimationFrame(() => this.animate());
    
    // Clamp delta to prevent huge jumps when tabbing back after being away
    // This keeps the starfield smooth instead of resetting all stars at once
    const rawDelta = this.clock.getDelta();
    const delta = Math.min(rawDelta, 0.1);
    
    this.updateStarfield(delta);
    this.updateShip(delta);
    this.updateOrbit(delta);
    
    this.renderer.render(this.scene, this.camera);
  }

  updateOrbit(delta) {
    const targetX = -this.mouseX * this.orbitRange;
    const targetY = -this.mouseY * this.orbitRange;

    const t = 1 - Math.exp(-this.orbitSmoothing * delta);
    this.orbitX += (targetX - this.orbitX) * t;
    this.orbitY += (targetY - this.orbitY) * t;

    this.camera.position.copy(this.cameraBasePos);
    this.camera.lookAt(this.cameraLookTarget);
    this.camera.rotateY(this.orbitX);
    this.camera.rotateX(this.orbitY);
  }

  onMouseMove(e) {
    this.mouseX = (e.clientX / window.innerWidth) * 2 - 1;
    this.mouseY = (e.clientY / window.innerHeight) * 2 - 1;
  }

  onResize() {
    if (this.disposed) return;
    
    this.camera.aspect = window.innerWidth / window.innerHeight;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(window.innerWidth, window.innerHeight);
  }

  dispose() {
    this.disposed = true;
    
    if (this.animationId) {
      cancelAnimationFrame(this.animationId);
    }
    
    window.removeEventListener("resize", this._onResize);
    window.removeEventListener("mousemove", this._onMouseMove);
    
    if (this.starfield) {
      this.starfield.geometry.dispose();
      this.starfield.material.dispose();
    }
    
    if (this.sparkles) {
      this.sparkles.geometry.dispose();
      this.sparkles.material.dispose();
    }
    
    if (this.ship) {
      this.ship.traverse((child) => {
        if (child.geometry) child.geometry.dispose();
        if (child.material) child.material.dispose();
      });
    }
    
    if (this.renderer) {
      this.renderer.dispose();
      this.renderer.domElement.remove();
    }
  }
}
