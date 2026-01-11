import * as THREE from 'three';

const _v = new THREE.Vector3();
const _m = new THREE.Matrix4();

export class SpaceshipGenerator {
  constructor(seed = null) {
    this.seed = seed ?? Math.random() * 10000;
    this.rng = this.createRNG(this.seed);
  }

  createRNG(seed) {
    return () => {
      seed = (seed * 9301 + 49297) % 233280;
      return seed / 233280;
    };
  }

  random() {
    return this.rng();
  }

  uniform(min, max) {
    return min + this.random() * (max - min);
  }

  randInt(min, max) {
    return Math.floor(this.uniform(min, max + 1));
  }

  generate() {
    const group = new THREE.Group();
    const hullColor = this.generateHullColor();
    const glowColor = this.generateGlowColor();

    // Build main hull segments along X axis
    const segments = this.buildHullSegments();
    
    // Create merged geometry from segments
    const hullGeometry = this.segmentsToGeometry(segments);
    const hullMaterial = new THREE.MeshStandardMaterial({
      color: hullColor,
      metalness: 0.7,
      roughness: 0.3,
    });
    const hullMesh = new THREE.Mesh(hullGeometry, hullMaterial);
    group.add(hullMesh);

    // Add engine exhausts at the rear
    this.addExhausts(group, segments, glowColor);

    // Add asymmetric protrusions
    if (this.random() > 0.3) {
      this.addProtrusions(group, segments, hullColor);
    }

    // Add wing-like structures
    if (this.random() > 0.4) {
      this.addWings(group, segments, hullColor);
    }

    // Center the model
    const box = new THREE.Box3().setFromObject(group);
    const center = box.getCenter(new THREE.Vector3());
    group.children.forEach(child => {
      child.position.sub(center);
    });

    // Normalize scale to roughly unit size
    const size = box.getSize(new THREE.Vector3());
    const maxDim = Math.max(size.x, size.y, size.z);
    const scale = 1.5 / maxDim;
    group.scale.setScalar(scale);

    return { group, hullColor, glowColor };
  }

  generateHullColor() {
    const h = this.random();
    const s = this.uniform(0, 0.3);
    const l = this.uniform(0.15, 0.5);
    return new THREE.Color().setHSL(h, s, l);
  }

  generateGlowColor() {
    const h = this.random();
    const s = this.uniform(0.8, 1);
    const l = this.uniform(0.5, 0.7);
    return new THREE.Color().setHSL(h, s, l);
  }

  buildHullSegments() {
    const segments = [];
    
    // Start with base dimensions
    let baseWidth = this.uniform(0.5, 1.2);
    let baseHeight = this.uniform(0.4, 1.0);
    let x = 0;

    const numSegments = this.randInt(3, 6);
    
    for (let i = 0; i < numSegments; i++) {
      const isFirst = i === 0;
      const isLast = i === numSegments - 1;
      
      const length = this.uniform(0.3, 0.8);
      
      // Vary dimensions
      let widthMult = 1;
      let heightMult = 1;
      
      if (!isFirst && !isLast && this.random() > 0.4) {
        widthMult = this.uniform(0.7, 1.4);
        heightMult = this.uniform(0.7, 1.4);
      }
      
      // Taper at ends
      if (isFirst) {
        widthMult *= this.uniform(0.6, 0.9);
        heightMult *= this.uniform(0.6, 0.9);
      }
      if (isLast) {
        widthMult *= this.uniform(0.5, 0.8);
        heightMult *= this.uniform(0.5, 0.8);
      }

      const width = baseWidth * widthMult;
      const height = baseHeight * heightMult;

      segments.push({
        x: x + length / 2,
        length,
        width,
        height,
        offsetY: isFirst || isLast ? 0 : this.uniform(-0.1, 0.1),
        offsetZ: isFirst || isLast ? 0 : this.uniform(-0.1, 0.1),
      });

      x += length;
      
      // Sometimes add a connector segment
      if (!isLast && this.random() > 0.6) {
        const connectorLength = this.uniform(0.1, 0.2);
        const connectorScale = this.uniform(0.85, 0.95);
        segments.push({
          x: x + connectorLength / 2,
          length: connectorLength,
          width: width * connectorScale,
          height: height * connectorScale,
          offsetY: 0,
          offsetZ: 0,
        });
        x += connectorLength;
      }
    }

    return segments;
  }

  segmentsToGeometry(segments) {
    const geometries = [];

    for (const seg of segments) {
      const geo = new THREE.BoxGeometry(seg.length, seg.height, seg.width);
      geo.translate(seg.x, seg.offsetY, seg.offsetZ);
      geometries.push(geo);
    }

    return this.mergeGeometries(geometries);
  }

  mergeGeometries(geometries) {
    let totalVerts = 0;
    let totalIndices = 0;

    for (const geo of geometries) {
      totalVerts += geo.attributes.position.count;
      totalIndices += geo.index.count;
    }

    const positions = new Float32Array(totalVerts * 3);
    const normals = new Float32Array(totalVerts * 3);
    const indices = new Uint16Array(totalIndices);

    let vertOffset = 0;
    let indexOffset = 0;
    let vertCount = 0;

    for (const geo of geometries) {
      const pos = geo.attributes.position.array;
      const norm = geo.attributes.normal.array;
      const idx = geo.index.array;

      positions.set(pos, vertOffset * 3);
      normals.set(norm, vertOffset * 3);

      for (let i = 0; i < idx.length; i++) {
        indices[indexOffset + i] = idx[i] + vertCount;
      }

      vertOffset += geo.attributes.position.count;
      indexOffset += idx.length;
      vertCount += geo.attributes.position.count;

      geo.dispose();
    }

    const merged = new THREE.BufferGeometry();
    merged.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    merged.setAttribute('normal', new THREE.BufferAttribute(normals, 3));
    merged.setIndex(new THREE.BufferAttribute(indices, 1));

    return merged;
  }

  addExhausts(group, segments, glowColor) {
    const rearSeg = segments[segments.length - 1];
    const exhaustX = rearSeg.x + rearSeg.length / 2;
    
    const numExhausts = this.randInt(1, 3);
    const spacing = rearSeg.width / (numExhausts + 1);

    for (let i = 0; i < numExhausts; i++) {
      const z = -rearSeg.width / 2 + spacing * (i + 1);
      
      // Exhaust cone
      const coneGeo = new THREE.ConeGeometry(
        this.uniform(0.08, 0.15),
        this.uniform(0.15, 0.3),
        8
      );
      coneGeo.rotateZ(-Math.PI / 2);
      
      const coneMat = new THREE.MeshStandardMaterial({
        color: 0x222222,
        metalness: 0.9,
        roughness: 0.2,
      });
      
      const cone = new THREE.Mesh(coneGeo, coneMat);
      cone.position.set(exhaustX + 0.1, rearSeg.offsetY, z);
      group.add(cone);

      // Glow
      const glowGeo = new THREE.SphereGeometry(this.uniform(0.06, 0.12), 8, 8);
      const glowMat = new THREE.MeshBasicMaterial({
        color: glowColor,
        transparent: true,
        opacity: 0.8,
      });
      const glow = new THREE.Mesh(glowGeo, glowMat);
      glow.position.set(exhaustX + 0.15, rearSeg.offsetY, z);
      group.add(glow);
    }
  }

  addProtrusions(group, segments, hullColor) {
    const numProtrusions = this.randInt(1, 3);
    
    for (let i = 0; i < numProtrusions; i++) {
      const segIndex = this.randInt(1, Math.max(1, segments.length - 2));
      const seg = segments[segIndex];
      
      const side = this.random() > 0.5 ? 1 : -1;
      const vertical = this.random() > 0.5;
      
      const length = this.uniform(0.15, 0.35);
      const width = this.uniform(0.1, 0.2);
      const height = this.uniform(0.1, 0.2);
      
      const geo = new THREE.BoxGeometry(length, height, width);
      const mat = new THREE.MeshStandardMaterial({
        color: hullColor.clone().multiplyScalar(0.8),
        metalness: 0.7,
        roughness: 0.3,
      });
      
      const mesh = new THREE.Mesh(geo, mat);
      
      if (vertical) {
        mesh.position.set(
          seg.x,
          seg.offsetY + (seg.height / 2 + height / 2) * side,
          seg.offsetZ
        );
      } else {
        mesh.position.set(
          seg.x,
          seg.offsetY,
          seg.offsetZ + (seg.width / 2 + width / 2) * side
        );
      }
      
      group.add(mesh);
    }
  }

  addWings(group, segments, hullColor) {
    const segIndex = this.randInt(1, Math.max(1, segments.length - 2));
    const seg = segments[segIndex];
    
    const wingLength = this.uniform(0.3, 0.6);
    const wingWidth = this.uniform(0.4, 0.8);
    const wingThickness = this.uniform(0.04, 0.08);
    
    const wingGeo = new THREE.BoxGeometry(wingWidth, wingThickness, wingLength);
    const wingMat = new THREE.MeshStandardMaterial({
      color: hullColor.clone().multiplyScalar(0.9),
      metalness: 0.7,
      roughness: 0.3,
    });

    // Add wings on both sides (symmetric)
    for (const side of [-1, 1]) {
      const wing = new THREE.Mesh(wingGeo, wingMat);
      wing.position.set(
        seg.x,
        seg.offsetY,
        seg.offsetZ + (seg.width / 2 + wingLength / 2) * side
      );
      
      // Slight angle
      wing.rotation.x = this.uniform(-0.2, 0.2) * side;
      
      group.add(wing);
    }
  }
}

// Cache for generated ship geometries
const shipCache = new Map();

export function generateEnemyShip(seed = null) {
  const generator = new SpaceshipGenerator(seed);
  return generator.generate();
}

export function getOrCreateEnemyShip(seed) {
  if (!shipCache.has(seed)) {
    shipCache.set(seed, generateEnemyShip(seed));
  }
  return shipCache.get(seed);
}

