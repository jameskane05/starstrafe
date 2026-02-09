import * as THREE from "three";
import { TransformControls } from "three/addons/controls/TransformControls.js";

class GizmoManager {
  constructor(scene, camera, renderer) {
    this.scene = scene;
    this.camera = camera;
    this.renderer = renderer;
    this.enabled = false;
    this.objects = [];
    this.controls = new Map();
    this.controlHelpers = new Map();
    this.isGizmoDragging = false;
    this.isGizmoHovering = false;
    this.isVisible = true;
    this.currentMode = "translate";
    this.currentSpace = "world";
    this.activeObject = null;
    this.spawnedGizmoCounter = 0;
    this.currentGizmoIndex = 0;

    const urlParams = new URLSearchParams(window.location.search);
    this.hasGizmoURLParam = urlParams.has("gizmo");

    if (this.hasGizmoURLParam) {
      this.enable();
    }
  }

  enable() {
    if (this.enabled) return;
    this.enabled = true;
    this.setupEventListeners();
    console.log("[GizmoManager] Enabled");
  }

  disable() {
    if (!this.enabled) return;
    this.enabled = false;
    for (const control of this.controls.values()) control.dispose();
    this.controls.clear();
    for (const helper of this.controlHelpers.values()) {
      if (helper?.parent) helper.parent.remove(helper);
    }
    this.controlHelpers.clear();
    this.removeEventListeners();
  }

  registerObject(object, id = null, type = "object") {
    if (!object) return;
    if (!this.enabled) this.enable();

    const item = { object, id: id || object.name || "unnamed", type };
    this.objects.push(item);

    const control = new TransformControls(this.camera, this.renderer.domElement);
    control.setMode(this.currentMode);
    control.setSpace(this.currentSpace);
    control.attach(object);

    if (typeof control.getHelper === "function") {
      const helper = control.getHelper();
      if (helper) {
        this.scene.add(helper);
        helper.visible = this.isVisible;
        this.controlHelpers.set(object, helper);
      }
    }

    control.addEventListener("dragging-changed", (event) => {
      this.isGizmoDragging = event.value;
      if (event.value) {
        this.activeObject = item;
      } else {
        this.logObjectTransform(item);
      }
    });

    control.addEventListener("hoveron", () => { this.isGizmoHovering = true; });
    control.addEventListener("hoveroff", () => { this.isGizmoHovering = false; });

    this.controls.set(object, control);
    console.log(`[GizmoManager] Registered "${item.id}" (${type})`);
  }

  unregisterObject(object) {
    const index = this.objects.findIndex((item) => item.object === object);
    if (index !== -1) this.objects.splice(index, 1);
    const control = this.controls.get(object);
    if (control) { control.dispose(); this.controls.delete(object); }
    const helper = this.controlHelpers.get(object);
    if (helper?.parent) helper.parent.remove(helper);
    this.controlHelpers.delete(object);
  }

  setupEventListeners() {
    this.onKeyDown = this.handleKeyDown.bind(this);
    window.addEventListener("keydown", this.onKeyDown);
  }

  removeEventListeners() {
    if (this.onKeyDown) window.removeEventListener("keydown", this.onKeyDown);
  }

  isPointerOverGizmo() {
    return this.isGizmoHovering || this.isGizmoDragging;
  }

  handleKeyDown(event) {
    if (!this.enabled) return;
    if (document.activeElement.tagName === "INPUT" || document.activeElement.tagName === "TEXTAREA") return;

    switch (event.key) {
      case "p": case "P":
        if (this.hasGizmoURLParam) this.spawnGizmoInFrontOfCamera();
        break;
      case "g": case "G":
        if (this.controls.size === 0) return;
        this.currentMode = "translate";
        for (const c of this.controls.values()) c.setMode("translate");
        console.log("[GizmoManager] Mode = Translate");
        break;
      case "r": case "R":
        if (this.controls.size === 0) return;
        this.currentMode = "rotate";
        for (const c of this.controls.values()) c.setMode("rotate");
        console.log("[GizmoManager] Mode = Rotate");
        break;
      case "x": case "X":
        if (this.controls.size === 0) return;
        this.currentMode = "scale";
        for (const c of this.controls.values()) c.setMode("scale");
        console.log("[GizmoManager] Mode = Scale");
        break;
      case " ":
        if (this.controls.size === 0) return;
        this.currentSpace = this.currentSpace === "world" ? "local" : "world";
        for (const c of this.controls.values()) c.setSpace(this.currentSpace);
        console.log(`[GizmoManager] Space = ${this.currentSpace}`);
        event.preventDefault();
        break;
      case "h": case "H":
        if (this.controls.size === 0) return;
        this.setVisible(!this.isVisible);
        break;
      case "u": case "U":
        this.cycleAndTeleportToNextGizmo();
        break;
    }
  }

  spawnGizmoInFrontOfCamera() {
    const geo = new THREE.SphereGeometry(0.1, 16, 16);
    const mat = new THREE.MeshBasicMaterial({ color: 0xff00ff, wireframe: true });
    const sphere = new THREE.Mesh(geo, mat);

    const dir = new THREE.Vector3();
    this.camera.getWorldDirection(dir);
    sphere.position.copy(this.camera.position).addScaledVector(dir, 10);
    this.scene.add(sphere);

    this.spawnedGizmoCounter++;
    this.registerObject(sphere, `spawned-gizmo-${this.spawnedGizmoCounter}`, "spawned");
    console.log(`[GizmoManager] Spawned gizmo at`, sphere.position);
  }

  cycleAndTeleportToNextGizmo() {
    if (this.objects.length === 0) return;
    this.currentGizmoIndex = (this.currentGizmoIndex + 1) % this.objects.length;
    const item = this.objects[this.currentGizmoIndex];
    this.activeObject = item;

    const obj = item.object;
    const forward = new THREE.Vector3(0, 0, -1).applyQuaternion(obj.quaternion).normalize();
    const teleportPos = obj.position.clone().addScaledVector(forward, 8);

    this.camera.position.copy(teleportPos);
    this.camera.lookAt(obj.position);
    console.log(`[GizmoManager] Teleported to "${item.id}"`);
  }

  setVisible(visible) {
    this.isVisible = !!visible;
    for (const helper of this.controlHelpers.values()) {
      if (helper) helper.visible = this.isVisible;
    }
    for (const control of this.controls.values()) {
      if (control) control.enabled = this.isVisible;
    }
    console.log(`[GizmoManager] ${this.isVisible ? "Shown" : "Hidden"}`);
  }

  logObjectTransform(item = null) {
    const target = item || this.activeObject;
    if (!target) return;
    const obj = target.object;
    const p = obj.position;
    const r = obj.rotation;
    const s = obj.scale;
    console.log(
      `[GizmoManager] "${target.id}"\n` +
      `  position: {x: ${p.x.toFixed(2)}, y: ${p.y.toFixed(2)}, z: ${p.z.toFixed(2)}}\n` +
      `  rotation: {x: ${r.x.toFixed(4)}, y: ${r.y.toFixed(4)}, z: ${r.z.toFixed(4)}}\n` +
      `  scale: {x: ${s.x.toFixed(2)}, y: ${s.y.toFixed(2)}, z: ${s.z.toFixed(2)}}`
    );
  }

  update(dt) {
    // TransformControls handles its own rendering
  }

  destroy() {
    this.disable();
    this.objects = [];
  }
}

export default GizmoManager;
