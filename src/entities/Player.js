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
    this.maxSpeed = options.maxSpeed || 1;

    this.velocity = new THREE.Vector3();
    this.drag = 0.99;
    this.collisionRadius = 1.5;

    this.rollVelocity = 0;
    this.rollAccel = 12;
    this.rollMaxSpeed = 5;
    this.rollDrag = 0.94;

    this.pitchVelocity = 0;
    this.yawVelocity = 0;
    this.lookAccel = 0.2;
    this.lookMaxSpeed = 4;
    this.lookDrag = 0.85;

    this.fireFromLeft = true;
    this.missileFromLeft = true;

    this.camera.position.set(0, 0, 0);
    this.camera.quaternion.identity();

    this.loadCockpit(scene);
  }

  loadCockpit(scene) {
    const loader = new GLTFLoader();
    loader.load(
      "/cockpit.glb",
      (gltf) => {
        this.cockpit = gltf.scene;
        this.cockpit.scale.setScalar(0.5);
        this.cockpit.position.set(0, -0, 0);

        // Cockpit interior light
        const cockpitLight = new THREE.PointLight(0x88aaff, 1, 5);
        cockpitLight.position.set(0, 0.2, 0);
        this.camera.add(cockpitLight);

        // Headlight spotlight - over player's seat, pointing forward
        const headlight = new THREE.SpotLight(
          0xffffff,
          50,
          150,
          Math.PI / 6,
          0.3,
          1
        );
        headlight.position.set(0, 0.5, -0.5);
        headlight.target.position.set(0, 0, -10);
        this.camera.add(headlight);
        this.camera.add(headlight.target);

        this.camera.add(this.cockpit);
        console.log("Cockpit loaded");
      },
      undefined,
      (err) => console.error("Cockpit load error:", err)
    );
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
    this.yawVelocity *= this.lookDrag;

    _pitchQuat.setFromAxisAngle(_right, this.pitchVelocity * delta);
    _yawQuat.setFromAxisAngle(_up, this.yawVelocity * delta);

    // Roll with acceleration
    let rollInput = 0;
    if (useGamepad) {
      if (gp.rollLeft) rollInput -= this.rollAccel * delta;
      if (gp.rollRight) rollInput += this.rollAccel * delta;
    } else {
      if (keys.rollLeft) rollInput -= this.rollAccel * delta;
      if (keys.rollRight) rollInput += this.rollAccel * delta;
    }

    this.rollVelocity += rollInput;
    if (Math.abs(this.rollVelocity) > this.rollMaxSpeed) {
      this.rollVelocity = Math.sign(this.rollVelocity) * this.rollMaxSpeed;
    }
    this.rollVelocity *= this.rollDrag;

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
