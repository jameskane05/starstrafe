import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { checkSphereCollision, castSphere } from "../physics/Physics.js";

const _right = new THREE.Vector3();
const _up = new THREE.Vector3();
const _forward = new THREE.Vector3();
const _accel = new THREE.Vector3();
const _pitchQuat = new THREE.Quaternion();
const _yawQuat = new THREE.Quaternion();
const _rollQuat = new THREE.Quaternion();

export class Player {
  constructor(camera, input, level, scene, options = {}) {
    this.camera = camera;
    this.input = input;
    this.level = level;
    this.scene = scene;

    this.health = options.health || 100;
    this.maxHealth = options.maxHealth || 100;
    this.missiles = options.missiles || 6;
    this.maxMissiles = options.maxMissiles || 6;
    this.hasLaserUpgrade = false;
    
    this.lastDamageTime = 0;
    this.shieldRegenDelay = 5;
    this.shieldRegenRate = 15;

    this.boostFuel = 100;
    this.maxBoostFuel = 100;
    this.boostDrainRate = 20; // depletes in 5 seconds (100 / 20 = 5)
    this.boostRegenRate = 100; // refills in 1 second
    this.boostRegenDelay = 1;
    this.lastBoostTime = 0;
    this.boostMultiplier = 2.5;
    this.isBoosting = false;

    this.acceleration = options.acceleration || 0.5;
    this.maxSpeed = options.maxSpeed || 1.5;

    this.velocity = new THREE.Vector3();
    this.drag = 0.97;
    this.collisionRadius = 1.5;

    this.rollVelocity = 0;
    this.rollAccel = 6;
    this.rollMaxSpeed = 3;
    this.rollDrag = 0.96;

    this.pitchVelocity = 0;
    this.yawVelocity = 0;
    this.lookAccel = 0.1;
    this.lookMaxSpeed = 2.5;
    this.lookDrag = 0.93;
    this.yawDrag = 0.90;

    this.fireFromLeft = true;
    this.missileFromLeft = true;

    this.camera.position.set(0, 0, 0);
    this.camera.quaternion.identity();

    this.loadCockpit(scene);
  }

  loadCockpit(scene) {
    const loader = new GLTFLoader();
    loader.load(
      "./Heavy_INT_02.glb",
      (gltf) => {
        this.cockpit = gltf.scene;
        this.cockpit.scale.setScalar(1.0);
        
        // Debug: log bounds to find correct seat position
        const box = new THREE.Box3().setFromObject(this.cockpit);
        const size = new THREE.Vector3();
        const center = new THREE.Vector3();
        box.getSize(size);
        box.getCenter(center);
        console.log("[Cockpit] Bounds min:", box.min, "max:", box.max);
        console.log("[Cockpit] Size:", size, "Center:", center);
        
        // Test: place cockpit directly in front of camera at -Z
        this.cockpit.position.set(0, 0, 5.35);
        this.cockpit.rotation.set(0, Math.PI, 0);
        console.log("[Cockpit] Test position: (0, 0, -5), no rotation");
        
        // Log all meshes and make canopy/glass transparent
        this.cockpit.traverse((child) => {
          if (child.isMesh) {
            console.log("[Cockpit] Mesh:", child.name, "visible:", child.visible, "material:", child.material?.type);
          }
        });

        // Cockpit interior light
        const cockpitLight = new THREE.PointLight(0x88aaff, 1, 5);
        cockpitLight.position.set(0, 0.2, 0);
        this.camera.add(cockpitLight);

        // Headlight spotlight - over player's seat, pointing forward
        this.headlight = new THREE.SpotLight(
          0xffffff,
          50,
          150,
          Math.PI / 6,
          0.3,
          1
        );
        this.headlight.position.set(0, 0.5, -0.5);
        this.headlight.target.position.set(0, 0, -10);
        this.camera.add(this.headlight);
        this.camera.add(this.headlight.target);
        this.headlightEnabled = true;

        // Splat cone headlight - visual beam effect
        this.createSplatConeHeadlight();

        this.camera.add(this.cockpit);
        console.log("Cockpit loaded");
      },
      undefined,
      (err) => console.error("Cockpit load error:", err)
    );
  }

  createSplatConeHeadlight() {
    // Use Spark SplatEdit system for splat cone headlight
    // Level splats are now editable: true so SplatEdit will affect them
    import("@sparkjsdev/spark").then((spark) => {
      try {
        const { SplatEdit, SplatEditSdf, SplatEditSdfType, SplatEditRgbaBlendMode } = spark;
        
        // Create SplatEdit layer - must be added to scene to affect scene splats
        const layer = new SplatEdit({
          rgbaBlendMode: SplatEditRgbaBlendMode.ADD_RGBA,
          sdfSmooth: 0.1,
          softEdge: 0.75,
        });

        // Create infinite cone SDF (matches Shadow's carHeadlight)
        const splatLight = new SplatEditSdf({
          type: SplatEditSdfType.INFINITE_CONE,
          color: new THREE.Color(0.9, 0.9, 0.9),
          radius: 0.2, // Small radius for tight beam
          opacity: 0.4, // Increased for visibility (matches Shadow's carHeadlight)
        });

        // Position relative to layer (headlight offset from camera)
        // Rotation will be updated each frame to point forward
        splatLight.position.set(0, 0.5, -0.5);
        // Start with Shadow's carHeadlight rotation as reference
        splatLight.rotation.set(0, -Math.PI, 0);

        layer.add(splatLight);
        
        // Add layer to scene - SplatMesh will auto-detect SplatEdit layers in scene
        this.scene.add(layer);
        
        // Verify layer is in scene
        console.log("[Player] SplatEdit layer added to scene:", {
          inScene: this.scene.children.includes(layer),
          layerType: layer.constructor.name,
          sdfType: splatLight.constructor.name,
          sceneChildren: this.scene.children.length
        });
        
        this.splatConeHeadlight = layer;
        this.splatConeHeadlightSdf = splatLight;
        this.splatConeHeadlight.visible = this.headlightEnabled;

        // SplatMesh should auto-detect SplatEdit layers in the scene
        // Try to access the level splat and force a shader rebuild if possible
        // Use a longer delay to ensure level splat is fully loaded
        setTimeout(() => {
          // Try multiple ways to access the level splat
          let levelSplat = null;
          let sceneManager = null;
          
          // Try window.gameManager first (most reliable)
          if (window.gameManager && window.gameManager.sceneManager) {
            sceneManager = window.gameManager.sceneManager;
          } else if (window.game && window.game.sceneManager) {
            sceneManager = window.game.sceneManager;
          } else if (window.sceneManager) {
            sceneManager = window.sceneManager;
          }
          
          if (sceneManager && typeof sceneManager.getObject === 'function') {
            levelSplat = sceneManager.getObject('level');
          }
          
          if (levelSplat) {
            console.log("[Player] Found level splat:", levelSplat.constructor.name);
            // SplatMesh might have a rebuild method or needs shader update
            if (typeof levelSplat.rebuild === 'function') {
              levelSplat.rebuild();
              console.log("[Player] Rebuilt level splat shader to detect SplatEdit");
            } else if (typeof levelSplat.updateShader === 'function') {
              levelSplat.updateShader();
              console.log("[Player] Updated level splat shader");
            } else {
              console.log("[Player] Level splat found but no rebuild method. SplatMesh should auto-detect SplatEdit layers.");
              // SplatMesh should automatically detect SplatEdit layers in the scene
              // No manual rebuild needed - it scans the scene hierarchy
            }
          } else {
            console.warn("[Player] Could not find level splat. SceneManager:", sceneManager ? "found" : "not found");
            // SplatMesh should still auto-detect SplatEdit layers even without manual rebuild
          }
        }, 500); // Longer delay to ensure level is loaded

        console.log("[Player] Created splat cone headlight (SplatEdit)", {
          layerPos: layer.position.clone(),
          sdfPos: splatLight.position.clone(),
          sdfRot: splatLight.rotation.clone(),
          opacity: splatLight.opacity,
          radius: splatLight.radius,
          visible: this.headlightEnabled
        });
      } catch (error) {
        console.warn("[Player] Failed to create splat cone headlight:", error);
        this.splatConeHeadlight = null;
      }
    }).catch((error) => {
      console.warn("[Player] SplatEdit not available, skipping splat cone headlight:", error);
      this.splatConeHeadlight = null;
    });
  }

  getWeaponSpawnPoint() {
    const right = new THREE.Vector3(1, 0, 0).applyQuaternion(
      this.camera.quaternion
    );
    const down = new THREE.Vector3(0, -1, 0).applyQuaternion(
      this.camera.quaternion
    );
    const forward = new THREE.Vector3(0, 0, -1).applyQuaternion(
      this.camera.quaternion
    );

    const sideOffset = this.fireFromLeft ? -0.4 : 0.4;
    this.fireFromLeft = !this.fireFromLeft;

    return this.camera.position
      .clone()
      .add(right.multiplyScalar(sideOffset))
      .add(down.multiplyScalar(0.3))
      .add(forward.multiplyScalar(0.5));
  }

  getMissileSpawnPoint() {
    const right = new THREE.Vector3(1, 0, 0).applyQuaternion(
      this.camera.quaternion
    );
    const down = new THREE.Vector3(0, -1, 0).applyQuaternion(
      this.camera.quaternion
    );
    const forward = new THREE.Vector3(0, 0, -1).applyQuaternion(
      this.camera.quaternion
    );

    const sideOffset = this.missileFromLeft ? -0.5 : 0.5;
    this.missileFromLeft = !this.missileFromLeft;

    return this.camera.position
      .clone()
      .add(right.multiplyScalar(sideOffset))
      .add(down.multiplyScalar(0.35))
      .add(forward.multiplyScalar(0.4));
  }

  update(delta, elapsedTime = 0) {
    // Shield regeneration is handled server-side in multiplayer
    // Client just displays the health value received from server
    
    const keys = this.input.keys;
    const gp = this.input.gamepad;
    const useGamepad = this.input.isGamepadMode();
    const mouse = this.input.consumeMouse();

    // Toggle headlight
    if (keys.toggleHeadlightJustPressed) {
      this.headlightEnabled = !this.headlightEnabled;
      if (this.headlight) {
        this.headlight.visible = this.headlightEnabled;
        this.headlight.intensity = this.headlightEnabled ? 50 : 0;
      }
      if (this.splatConeHeadlight) {
        this.splatConeHeadlight.visible = this.headlightEnabled;
      }
      keys.toggleHeadlightJustPressed = false;
    }

    // Update splat cone headlight position/rotation to follow camera
    if (this.splatConeHeadlight && this.splatConeHeadlightSdf && this.headlightEnabled) {
      // Layer follows camera position and rotation
      // The SplatEditSdf position (0, 0.5, -0.5) is relative to the layer,
      // so it will be in camera local space
      this.splatConeHeadlight.position.copy(this.camera.position);
      this.splatConeHeadlight.quaternion.copy(this.camera.quaternion);
      
      // SplatEditSdf rotation is relative to the layer (which now matches camera orientation)
      // INFINITE_CONE extends along +Z by default
      // Camera forward is -Z, so we need to rotate to point forward
      // Rotate -180° around Y to flip from +Z to -Z (forward)
      this.splatConeHeadlightSdf.rotation.set(0, -Math.PI, 0);
    }


    // Rotation - reuse temp vectors
    _right.set(1, 0, 0).applyQuaternion(this.camera.quaternion);
    _up.set(0, 1, 0).applyQuaternion(this.camera.quaternion);
    _forward.set(0, 0, -1).applyQuaternion(this.camera.quaternion);

    // Look input
    if (useGamepad) {
      // Gamepad look (right stick)
      const gpLookSpeed = 4.0;
      this.pitchVelocity += -gp.lookY * gpLookSpeed * delta;
      this.yawVelocity += -gp.lookX * gpLookSpeed * delta;
    } else {
      // Mouse look with acceleration/easing
      this.pitchVelocity += -mouse.y * this.lookAccel;
      this.yawVelocity += -mouse.x * this.lookAccel;

      // Keyboard look (arrow keys)
      const keyLookSpeed = 3.0;
      if (keys.lookUp) this.pitchVelocity += keyLookSpeed * delta;
      if (keys.lookDown) this.pitchVelocity -= keyLookSpeed * delta;
      if (keys.lookLeft) this.yawVelocity += keyLookSpeed * delta;
      if (keys.lookRight) this.yawVelocity -= keyLookSpeed * delta;
    }

    if (Math.abs(this.pitchVelocity) > this.lookMaxSpeed) {
      this.pitchVelocity = Math.sign(this.pitchVelocity) * this.lookMaxSpeed;
    }
    if (Math.abs(this.yawVelocity) > this.lookMaxSpeed) {
      this.yawVelocity = Math.sign(this.yawVelocity) * this.lookMaxSpeed;
    }

    this.pitchVelocity *= this.lookDrag;
    this.yawVelocity *= this.yawDrag;

    // Roll with acceleration
    let rollInput = 0;
    if (useGamepad) {
      // Analog roll from HOTAS twist axis
      if (gp.rollAnalog && Math.abs(gp.rollAnalog) > 0.1) {
        rollInput = gp.rollAnalog * this.rollAccel * delta;
      } else {
        if (gp.rollLeft) rollInput -= this.rollAccel * delta;
        if (gp.rollRight) rollInput += this.rollAccel * delta;
      }
    } else {
      if (keys.rollLeft) rollInput -= this.rollAccel * delta;
      if (keys.rollRight) rollInput += this.rollAccel * delta;
    }

    this.rollVelocity += rollInput;
    if (Math.abs(this.rollVelocity) > this.rollMaxSpeed) {
      this.rollVelocity = Math.sign(this.rollVelocity) * this.rollMaxSpeed;
    }
    this.rollVelocity *= this.rollDrag;

    // Smoothly blend between world up and camera up based on roll amount
    // This minimizes drift when not rolled but follows roll when present
    const worldUp = new THREE.Vector3(0, 1, 0);
    const upHorizontal = _up.clone();
    upHorizontal.y = 0;
    const rollAmount = Math.min(1, upHorizontal.length() * 2 + Math.abs(this.rollVelocity) * 0.5);
    
    // Blend between world up (no drift) and camera up (follows roll)
    const yawAxis = new THREE.Vector3();
    yawAxis.lerpVectors(worldUp, _up, rollAmount).normalize();

    _pitchQuat.setFromAxisAngle(_right, this.pitchVelocity * delta);
    _yawQuat.setFromAxisAngle(yawAxis, this.yawVelocity * delta);

    _rollQuat.setFromAxisAngle(_forward, this.rollVelocity * delta);

    this.camera.quaternion.premultiply(_pitchQuat);
    this.camera.quaternion.premultiply(_yawQuat);
    this.camera.quaternion.premultiply(_rollQuat);
    this.camera.quaternion.normalize();

    // Movement
    _accel.set(0, 0, 0);
    
    if (useGamepad) {
      // Gamepad movement (left stick + d-pad for vertical)
      if (gp.moveY < -0.1) _accel.add(_forward.clone().multiplyScalar(-gp.moveY));
      if (gp.moveY > 0.1) _accel.sub(_forward.clone().multiplyScalar(gp.moveY));
      if (gp.moveX > 0.1) _accel.add(_right.clone().multiplyScalar(gp.moveX));
      if (gp.moveX < -0.1) _accel.sub(_right.clone().multiplyScalar(-gp.moveX));
      if (gp.strafeUp) _accel.add(_up);
      if (gp.strafeDown) _accel.sub(_up);
    } else {
      // Keyboard movement
      if (keys.forward) _accel.add(_forward);
      if (keys.backward) _accel.sub(_forward);
      if (keys.right) _accel.add(_right);
      if (keys.left) _accel.sub(_right);
      if (keys.strafeUp) _accel.add(_up);
      if (keys.strafeDown) _accel.sub(_up);
    }

    // Boost logic
    const wantsBoost = useGamepad ? gp.boost : keys.boost;
    if (wantsBoost && this.boostFuel > 0 && _accel.lengthSq() > 0) {
      this.isBoosting = true;
      this.boostFuel = Math.max(0, this.boostFuel - this.boostDrainRate * delta);
      this.lastBoostTime = elapsedTime;
    } else {
      this.isBoosting = false;
      // Regenerate boost fuel after delay
      if (elapsedTime - this.lastBoostTime >= this.boostRegenDelay) {
        this.boostFuel = Math.min(this.maxBoostFuel, this.boostFuel + this.boostRegenRate * delta);
      }
    }

    if (_accel.lengthSq() > 0) {
      let accelMod = this.acceleration;
      if (this.isBoosting) {
        accelMod *= this.boostMultiplier;
      }
      _accel.normalize().multiplyScalar(accelMod * delta);
      this.velocity.add(_accel);
    }

    if (this.velocity.lengthSq() > this.maxSpeed * this.maxSpeed) {
      this.velocity.normalize().multiplyScalar(this.maxSpeed);
    }

    this.velocity.multiplyScalar(this.drag);

    // Collision detection with Rapier
    const pos = this.camera.position;
    const vel = this.velocity;

    // Try full movement
    const hit = castSphere(
      pos.x,
      pos.y,
      pos.z,
      pos.x + vel.x,
      pos.y + vel.y,
      pos.z + vel.z,
      this.collisionRadius
    );

    if (!hit) {
      this.camera.position.add(vel);
    } else {
      // Slide along walls - try each axis
      const hitX = castSphere(
        pos.x,
        pos.y,
        pos.z,
        pos.x + vel.x,
        pos.y,
        pos.z,
        this.collisionRadius
      );
      const hitY = castSphere(
        pos.x,
        pos.y,
        pos.z,
        pos.x,
        pos.y + vel.y,
        pos.z,
        this.collisionRadius
      );
      const hitZ = castSphere(
        pos.x,
        pos.y,
        pos.z,
        pos.x,
        pos.y,
        pos.z + vel.z,
        this.collisionRadius
      );

      if (!hitX) {
        this.camera.position.x += vel.x;
      } else {
        this.velocity.x = 0;
      }

      if (!hitY) {
        this.camera.position.y += vel.y;
      } else {
        this.velocity.y = 0;
      }

      if (!hitZ) {
        this.camera.position.z += vel.z;
      } else {
        this.velocity.z = 0;
      }
    }
  }
}
