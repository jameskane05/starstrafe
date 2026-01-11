import * as THREE from "three";
import { createWallCollider } from "../physics/Physics.js";

export class Level {
  constructor(scene) {
    this.scene = scene;
    this.rooms = [];
    this.corridors = [];
    this.wallThickness = 0.3;

    this.wallTexture = this.createPixelatedTexture();
    this.wallMaterial = new THREE.MeshStandardMaterial({
      map: this.wallTexture,
      roughness: 0.75,
      metalness: 0.2,
      side: THREE.DoubleSide,
    });

    this.greenStrip = new THREE.MeshStandardMaterial({
      color: 0x00ffaa,
      emissive: 0x00ffaa,
      emissiveIntensity: 2.0,
    });

    this.redStrip = new THREE.MeshStandardMaterial({
      color: 0xff3366,
      emissive: 0xff3366,
      emissiveIntensity: 2.0,
    });

    this.panelMaterial = new THREE.MeshStandardMaterial({
      color: 0x3a3a4e,
      emissive: 0x111122,
      emissiveIntensity: 0.3,
      roughness: 0.6,
      metalness: 0.4,
      side: THREE.DoubleSide,
    });
  }

  createPixelatedTexture() {
    const size = 64;
    const blockSize = 8;
    const canvas = document.createElement("canvas");
    canvas.width = size;
    canvas.height = size;
    const ctx = canvas.getContext("2d");

    // Fill with base color
    ctx.fillStyle = "#2a2a3e";
    ctx.fillRect(0, 0, size, size);

    // Draw random grey blocks
    for (let y = 0; y < size; y += blockSize) {
      for (let x = 0; x < size; x += blockSize) {
        const brightness = 30 + Math.floor(Math.random() * 40);
        const tint = Math.random() > 0.7 ? 10 : 0; // Occasional blue tint
        const r = brightness;
        const g = brightness;
        const b = brightness + tint;
        ctx.fillStyle = `rgb(${r}, ${g}, ${b})`;
        ctx.fillRect(x, y, blockSize, blockSize);

        // Add subtle edge highlight on some blocks
        if (Math.random() > 0.6) {
          const highlight = brightness + 15;
          ctx.fillStyle = `rgb(${highlight}, ${highlight}, ${highlight + tint})`;
          ctx.fillRect(x, y, blockSize, 1);
          ctx.fillRect(x, y, 1, blockSize);
        }

        // Add subtle shadow on some blocks
        if (Math.random() > 0.6) {
          const shadow = Math.max(0, brightness - 15);
          ctx.fillStyle = `rgb(${shadow}, ${shadow}, ${shadow})`;
          ctx.fillRect(x + blockSize - 1, y, 1, blockSize);
          ctx.fillRect(x, y + blockSize - 1, blockSize, 1);
        }
      }
    }

    // Add some panel lines
    ctx.strokeStyle = "#1a1a2e";
    ctx.lineWidth = 1;
    for (let i = 0; i < 3; i++) {
      const pos = Math.floor(Math.random() * size);
      if (Math.random() > 0.5) {
        ctx.beginPath();
        ctx.moveTo(0, pos);
        ctx.lineTo(size, pos);
        ctx.stroke();
      } else {
        ctx.beginPath();
        ctx.moveTo(pos, 0);
        ctx.lineTo(pos, size);
        ctx.stroke();
      }
    }

    const texture = new THREE.CanvasTexture(canvas);
    texture.wrapS = THREE.RepeatWrapping;
    texture.wrapT = THREE.RepeatWrapping;
    texture.repeat.set(4, 4);
    texture.magFilter = THREE.NearestFilter;
    texture.minFilter = THREE.NearestFilter;
    return texture;
  }

  generate(options = {}) {
    const { skipVisuals = false, skipPhysics = false } = options;
    this.skipVisuals = skipVisuals;
    this.skipPhysics = skipPhysics;

    const startRoom = this.createRoom(0, 0, 0, 25, 12, 25, "green");
    this.rooms.push(startRoom);

    const roomCount = 8 + Math.floor(Math.random() * 5);
    let attempts = 0;
    const maxAttempts = 200;

    while (this.rooms.length < roomCount && attempts < maxAttempts) {
      attempts++;
      const sourceRoom = this.rooms[Math.floor(Math.random() * this.rooms.length)];
      const expanded = this.expandFrom(sourceRoom);
      if (expanded) {
        attempts = Math.max(0, attempts - 10);
      }
    }

    if (this.rooms.length < 4) {
      for (const dir of ["north", "south", "east", "west"]) {
        if (this.rooms.length >= 6) break;
        if (!startRoom.connections[dir]) {
          this.forceExpand(startRoom, dir);
        }
      }
    }

    console.log(`Generated ${this.rooms.length} rooms, ${this.corridors.length} corridors`);

    // Build geometry and colliders (visuals are skipped if skipVisuals is true)
    this.rooms.forEach((room) => this.buildRoom(room));
    this.corridors.forEach((cor) => this.buildCorridor(cor));
    
    if (!skipVisuals) {
      this.addLights();
    }
  }

  createRoom(x, y, z, w, h, d, color) {
    return {
      x, y, z, w, h, d, color,
      minX: x - w / 2, maxX: x + w / 2,
      minY: y - h / 2, maxY: y + h / 2,
      minZ: z - d / 2, maxZ: z + d / 2,
      connections: { north: null, south: null, east: null, west: null },
    };
  }

  expandFrom(source) {
    const directions = ["north", "south", "east", "west"];
    const shuffled = directions.sort(() => Math.random() - 0.5);

    for (const dir of shuffled) {
      if (source.connections[dir]) continue;

      const corridor = this.tryCreateCorridor(source, dir);
      if (!corridor) continue;

      const room = this.tryCreateRoomAtEnd(corridor, dir);
      if (!room) continue;

      // Store corridor reference for opening size calculation
      source.connections[dir] = corridor;
      room.connections[this.oppositeDir(dir)] = corridor;
      this.corridors.push(corridor);
      this.rooms.push(room);
      return true;
    }
    return false;
  }

  tryCreateCorridor(source, dir) {
    const length = 15 + Math.random() * 20;
    const width = 6 + Math.random() * 4;
    const height = 6 + Math.random() * 3;

    let x, y, z, w, h, d;

    if (dir === "north") {
      w = width; h = height; d = length;
      x = source.x; y = source.y; z = source.minZ - length / 2;
    } else if (dir === "south") {
      w = width; h = height; d = length;
      x = source.x; y = source.y; z = source.maxZ + length / 2;
    } else if (dir === "east") {
      w = length; h = height; d = width;
      x = source.maxX + length / 2; y = source.y; z = source.z;
    } else if (dir === "west") {
      w = length; h = height; d = width;
      x = source.minX - length / 2; y = source.y; z = source.z;
    }

    const corridor = { x, y, z, w, h, d, dir };
    if (this.overlapsExisting(corridor, 3)) return null;
    return corridor;
  }

  tryCreateRoomAtEnd(corridor, dir) {
    const w = 18 + Math.random() * 15;
    const h = 10 + Math.random() * 8;
    const d = 18 + Math.random() * 15;
    const color = Math.random() > 0.5 ? "green" : "red";

    let x, y, z;

    if (dir === "north") {
      x = corridor.x; y = corridor.y; z = corridor.z - corridor.d / 2 - d / 2;
    } else if (dir === "south") {
      x = corridor.x; y = corridor.y; z = corridor.z + corridor.d / 2 + d / 2;
    } else if (dir === "east") {
      x = corridor.x + corridor.w / 2 + w / 2; y = corridor.y; z = corridor.z;
    } else if (dir === "west") {
      x = corridor.x - corridor.w / 2 - w / 2; y = corridor.y; z = corridor.z;
    }

    const room = this.createRoom(x, y, z, w, h, d, color);
    if (this.overlapsExisting(room, 5)) return null;
    return room;
  }

  forceExpand(source, dir) {
    const corridor = this.createCorridorInDir(source, dir);
    const room = this.createRoomAtEnd(corridor, dir);
    
    source.connections[dir] = corridor;
    room.connections[this.oppositeDir(dir)] = corridor;
    this.corridors.push(corridor);
    this.rooms.push(room);
  }

  createCorridorInDir(source, dir) {
    const length = 20;
    const width = 8;
    const height = 8;

    let x, y, z, w, h, d;

    if (dir === "north") {
      w = width; h = height; d = length;
      x = source.x; y = source.y; z = source.minZ - length / 2;
    } else if (dir === "south") {
      w = width; h = height; d = length;
      x = source.x; y = source.y; z = source.maxZ + length / 2;
    } else if (dir === "east") {
      w = length; h = height; d = width;
      x = source.maxX + length / 2; y = source.y; z = source.z;
    } else if (dir === "west") {
      w = length; h = height; d = width;
      x = source.minX - length / 2; y = source.y; z = source.z;
    }

    return { x, y, z, w, h, d, dir };
  }

  createRoomAtEnd(corridor, dir) {
    const w = 22, h = 14, d = 22;
    const color = Math.random() > 0.5 ? "green" : "red";
    let x, y, z;

    if (dir === "north") {
      x = corridor.x; y = corridor.y; z = corridor.z - corridor.d / 2 - d / 2;
    } else if (dir === "south") {
      x = corridor.x; y = corridor.y; z = corridor.z + corridor.d / 2 + d / 2;
    } else if (dir === "east") {
      x = corridor.x + corridor.w / 2 + w / 2; y = corridor.y; z = corridor.z;
    } else if (dir === "west") {
      x = corridor.x - corridor.w / 2 - w / 2; y = corridor.y; z = corridor.z;
    }

    return this.createRoom(x, y, z, w, h, d, color);
  }

  overlapsExisting(newBox, margin) {
    const newMin = {
      x: newBox.x - newBox.w / 2 - margin,
      y: newBox.y - newBox.h / 2 - margin,
      z: newBox.z - newBox.d / 2 - margin,
    };
    const newMax = {
      x: newBox.x + newBox.w / 2 + margin,
      y: newBox.y + newBox.h / 2 + margin,
      z: newBox.z + newBox.d / 2 + margin,
    };

    for (const room of this.rooms) {
      if (this.boxesOverlap(newMin, newMax, room)) return true;
    }
    for (const cor of this.corridors) {
      const corRoom = { 
        minX: cor.x - cor.w/2, maxX: cor.x + cor.w/2, 
        minY: cor.y - cor.h/2, maxY: cor.y + cor.h/2, 
        minZ: cor.z - cor.d/2, maxZ: cor.z + cor.d/2 
      };
      if (this.boxesOverlap(newMin, newMax, corRoom)) return true;
    }
    return false;
  }

  boxesOverlap(newMin, newMax, existing) {
    return !(
      newMax.x < existing.minX || newMin.x > existing.maxX ||
      newMax.y < existing.minY || newMin.y > existing.maxY ||
      newMax.z < existing.minZ || newMin.z > existing.maxZ
    );
  }

  oppositeDir(dir) {
    return { north: "south", south: "north", east: "west", west: "east" }[dir];
  }

  // Create a wall plane with optional hole for doorway
  createWallWithHole(width, height, holeWidth, holeHeight, holeOffsetX, holeOffsetY) {
    // If no hole needed, just return a simple plane
    if (!holeWidth || !holeHeight) {
      return new THREE.PlaneGeometry(width, height);
    }

    const shape = new THREE.Shape();
    const hw = width / 2;
    const hh = height / 2;
    
    // Outer rectangle (clockwise)
    shape.moveTo(-hw, -hh);
    shape.lineTo(hw, -hh);
    shape.lineTo(hw, hh);
    shape.lineTo(-hw, hh);
    shape.lineTo(-hw, -hh);

    // Inner hole (counter-clockwise for subtraction)
    const hhw = holeWidth / 2;
    const hhh = holeHeight / 2;
    const hole = new THREE.Path();
    hole.moveTo(holeOffsetX - hhw, holeOffsetY - hhh);
    hole.lineTo(holeOffsetX - hhw, holeOffsetY + hhh);
    hole.lineTo(holeOffsetX + hhw, holeOffsetY + hhh);
    hole.lineTo(holeOffsetX + hhw, holeOffsetY - hhh);
    hole.lineTo(holeOffsetX - hhw, holeOffsetY - hhh);
    shape.holes.push(hole);

    return new THREE.ShapeGeometry(shape);
  }

  buildRoom(room) {
    const { x, y, z, w, h, d, connections, color } = room;
    const hw = w / 2, hh = h / 2, hd = d / 2;
    const t = this.wallThickness;

    // Floor
    if (!this.skipVisuals) {
      const floorGeo = new THREE.PlaneGeometry(w, d);
      const floor = new THREE.Mesh(floorGeo, this.wallMaterial);
      floor.rotation.x = Math.PI / 2;
      floor.position.set(x, y - hh, z);
      this.scene.add(floor);
    }
    if (!this.skipPhysics) createWallCollider(x, y - hh - t/2, z, hw, t/2, hd);

    // Ceiling
    if (!this.skipVisuals) {
      const ceilGeo = new THREE.PlaneGeometry(w, d);
      const ceil = new THREE.Mesh(ceilGeo, this.wallMaterial);
      ceil.rotation.x = -Math.PI / 2;
      ceil.position.set(x, y + hh, z);
      this.scene.add(ceil);
    }
    if (!this.skipPhysics) createWallCollider(x, y + hh + t/2, z, hw, t/2, hd);

    // North wall (-Z)
    const northCor = connections.north;
    if (northCor) {
      // Wall with hole
      const holeW = northCor.w;
      const holeH = northCor.h;
      if (!this.skipVisuals) {
        const geo = this.createWallWithHole(w, h, holeW, holeH, 0, 0);
        const mesh = new THREE.Mesh(geo, this.wallMaterial);
        mesh.position.set(x, y, z - hd);
        this.scene.add(mesh);
      }
      // Colliders around the hole
      if (!this.skipPhysics) {
        const sideW = (w - holeW) / 2;
        if (sideW > 0.1) {
          createWallCollider(x - hw + sideW/2, y, z - hd - t/2, sideW/2, hh, t/2);
          createWallCollider(x + hw - sideW/2, y, z - hd - t/2, sideW/2, hh, t/2);
        }
        const topH = (h - holeH) / 2;
        if (topH > 0.1) {
          createWallCollider(x, y + hh - topH/2, z - hd - t/2, holeW/2, topH/2, t/2);
          createWallCollider(x, y - hh + topH/2, z - hd - t/2, holeW/2, topH/2, t/2);
        }
      }
    } else {
      if (!this.skipVisuals) {
        const geo = new THREE.PlaneGeometry(w, h);
        const mesh = new THREE.Mesh(geo, this.wallMaterial);
        mesh.position.set(x, y, z - hd);
        this.scene.add(mesh);
      }
      if (!this.skipPhysics) createWallCollider(x, y, z - hd - t/2, hw, hh, t/2);
    }

    // South wall (+Z)
    const southCor = connections.south;
    if (southCor) {
      const holeW = southCor.w;
      const holeH = southCor.h;
      if (!this.skipVisuals) {
        const geo = this.createWallWithHole(w, h, holeW, holeH, 0, 0);
        const mesh = new THREE.Mesh(geo, this.wallMaterial);
        mesh.rotation.y = Math.PI;
        mesh.position.set(x, y, z + hd);
        this.scene.add(mesh);
      }
      if (!this.skipPhysics) {
        const sideW = (w - holeW) / 2;
        if (sideW > 0.1) {
          createWallCollider(x - hw + sideW/2, y, z + hd + t/2, sideW/2, hh, t/2);
          createWallCollider(x + hw - sideW/2, y, z + hd + t/2, sideW/2, hh, t/2);
        }
        const topH = (h - holeH) / 2;
        if (topH > 0.1) {
          createWallCollider(x, y + hh - topH/2, z + hd + t/2, holeW/2, topH/2, t/2);
          createWallCollider(x, y - hh + topH/2, z + hd + t/2, holeW/2, topH/2, t/2);
        }
      }
    } else {
      if (!this.skipVisuals) {
        const geo = new THREE.PlaneGeometry(w, h);
        const mesh = new THREE.Mesh(geo, this.wallMaterial);
        mesh.rotation.y = Math.PI;
        mesh.position.set(x, y, z + hd);
        this.scene.add(mesh);
      }
      if (!this.skipPhysics) createWallCollider(x, y, z + hd + t/2, hw, hh, t/2);
    }

    // East wall (+X)
    const eastCor = connections.east;
    if (eastCor) {
      const holeW = eastCor.d; // corridor depth is the hole width for E/W walls
      const holeH = eastCor.h;
      if (!this.skipVisuals) {
        const geo = this.createWallWithHole(d, h, holeW, holeH, 0, 0);
        const mesh = new THREE.Mesh(geo, this.wallMaterial);
        mesh.rotation.y = -Math.PI / 2;
        mesh.position.set(x + hw, y, z);
        this.scene.add(mesh);
      }
      if (!this.skipPhysics) {
        const sideW = (d - holeW) / 2;
        if (sideW > 0.1) {
          createWallCollider(x + hw + t/2, y, z - hd + sideW/2, t/2, hh, sideW/2);
          createWallCollider(x + hw + t/2, y, z + hd - sideW/2, t/2, hh, sideW/2);
        }
        const topH = (h - holeH) / 2;
        if (topH > 0.1) {
          createWallCollider(x + hw + t/2, y + hh - topH/2, z, t/2, topH/2, holeW/2);
          createWallCollider(x + hw + t/2, y - hh + topH/2, z, t/2, topH/2, holeW/2);
        }
      }
    } else {
      if (!this.skipVisuals) {
        const geo = new THREE.PlaneGeometry(d, h);
        const mesh = new THREE.Mesh(geo, this.wallMaterial);
        mesh.rotation.y = -Math.PI / 2;
        mesh.position.set(x + hw, y, z);
        this.scene.add(mesh);
      }
      if (!this.skipPhysics) createWallCollider(x + hw + t/2, y, z, t/2, hh, hd);
    }

    // West wall (-X)
    const westCor = connections.west;
    if (westCor) {
      const holeW = westCor.d;
      const holeH = westCor.h;
      if (!this.skipVisuals) {
        const geo = this.createWallWithHole(d, h, holeW, holeH, 0, 0);
        const mesh = new THREE.Mesh(geo, this.wallMaterial);
        mesh.rotation.y = Math.PI / 2;
        mesh.position.set(x - hw, y, z);
        this.scene.add(mesh);
      }
      if (!this.skipPhysics) {
        const sideW = (d - holeW) / 2;
        if (sideW > 0.1) {
          createWallCollider(x - hw - t/2, y, z - hd + sideW/2, t/2, hh, sideW/2);
          createWallCollider(x - hw - t/2, y, z + hd - sideW/2, t/2, hh, sideW/2);
        }
        const topH = (h - holeH) / 2;
        if (topH > 0.1) {
          createWallCollider(x - hw - t/2, y + hh - topH/2, z, t/2, topH/2, holeW/2);
          createWallCollider(x - hw - t/2, y - hh + topH/2, z, t/2, topH/2, holeW/2);
        }
      }
    } else {
      if (!this.skipVisuals) {
        const geo = new THREE.PlaneGeometry(d, h);
        const mesh = new THREE.Mesh(geo, this.wallMaterial);
        mesh.rotation.y = Math.PI / 2;
        mesh.position.set(x - hw, y, z);
        this.scene.add(mesh);
      }
      if (!this.skipPhysics) createWallCollider(x - hw - t/2, y, z, t/2, hh, hd);
    }

    // Add light strips
    if (!this.skipVisuals) {
      this.addStrips(x, y, z, w, h, d, color === "red" ? this.redStrip : this.greenStrip);
    }
  }

  buildCorridor(cor) {
    const { x, y, z, w, h, d, dir } = cor;
    const hw = w / 2, hh = h / 2, hd = d / 2;
    const t = this.wallThickness;

    // Floor
    if (!this.skipVisuals) {
      const floorGeo = new THREE.PlaneGeometry(w, d);
      const floor = new THREE.Mesh(floorGeo, this.wallMaterial);
      floor.rotation.x = Math.PI / 2;
      floor.position.set(x, y - hh, z);
      this.scene.add(floor);
    }
    if (!this.skipPhysics) createWallCollider(x, y - hh - t/2, z, hw, t/2, hd);

    // Ceiling
    if (!this.skipVisuals) {
      const ceilGeo = new THREE.PlaneGeometry(w, d);
      const ceil = new THREE.Mesh(ceilGeo, this.wallMaterial);
      ceil.rotation.x = -Math.PI / 2;
      ceil.position.set(x, y + hh, z);
      this.scene.add(ceil);
    }
    if (!this.skipPhysics) createWallCollider(x, y + hh + t/2, z, hw, t/2, hd);

    // Side walls (no holes - corridors are open at ends)
    if (dir === "north" || dir === "south") {
      // East wall
      if (!this.skipVisuals) {
        const eastGeo = new THREE.PlaneGeometry(d, h);
        const east = new THREE.Mesh(eastGeo, this.wallMaterial);
        east.rotation.y = -Math.PI / 2;
        east.position.set(x + hw, y, z);
        this.scene.add(east);
      }
      if (!this.skipPhysics) createWallCollider(x + hw + t/2, y, z, t/2, hh, hd);

      // West wall
      if (!this.skipVisuals) {
        const westGeo = new THREE.PlaneGeometry(d, h);
        const west = new THREE.Mesh(westGeo, this.wallMaterial);
        west.rotation.y = Math.PI / 2;
        west.position.set(x - hw, y, z);
        this.scene.add(west);
      }
      if (!this.skipPhysics) createWallCollider(x - hw - t/2, y, z, t/2, hh, hd);
    } else {
      // North wall
      if (!this.skipVisuals) {
        const northGeo = new THREE.PlaneGeometry(w, h);
        const north = new THREE.Mesh(northGeo, this.wallMaterial);
        north.position.set(x, y, z - hd);
        this.scene.add(north);
      }
      if (!this.skipPhysics) createWallCollider(x, y, z - hd - t/2, hw, hh, t/2);

      // South wall
      if (!this.skipVisuals) {
        const southGeo = new THREE.PlaneGeometry(w, h);
        const south = new THREE.Mesh(southGeo, this.wallMaterial);
        south.rotation.y = Math.PI;
        south.position.set(x, y, z + hd);
        this.scene.add(south);
      }
      if (!this.skipPhysics) createWallCollider(x, y, z + hd + t/2, hw, hh, t/2);
    }

    // Light strip along corridor
    if (!this.skipVisuals) {
      this.addCorridorStrip(cor);
    }
  }

  addStrips(x, y, z, w, h, d, mat) {
    const offset = 0.02;
    
    // Ceiling strips - cross pattern
    const stripGeoW = new THREE.PlaneGeometry(w * 0.85, 0.2);
    const stripGeoD = new THREE.PlaneGeometry(0.2, d * 0.85);
    
    const ceilStrip1 = new THREE.Mesh(stripGeoW, mat);
    ceilStrip1.rotation.x = Math.PI / 2;
    ceilStrip1.position.set(x, y + h/2 - offset, z);
    this.scene.add(ceilStrip1);

    const ceilStrip2 = new THREE.Mesh(stripGeoD, mat);
    ceilStrip2.rotation.x = Math.PI / 2;
    ceilStrip2.position.set(x, y + h/2 - offset, z);
    this.scene.add(ceilStrip2);

    // Floor edge strips
    const floorStrip1 = new THREE.Mesh(stripGeoW, mat);
    floorStrip1.rotation.x = -Math.PI / 2;
    floorStrip1.position.set(x, y - h/2 + offset, z);
    this.scene.add(floorStrip1);

    const floorStrip2 = new THREE.Mesh(stripGeoD, mat);
    floorStrip2.rotation.x = -Math.PI / 2;
    floorStrip2.position.set(x, y - h/2 + offset, z);
    this.scene.add(floorStrip2);

    // Wall edge strips (vertical)
    const wallStripGeo = new THREE.PlaneGeometry(0.15, h * 0.8);
    const wallPositions = [
      { px: x - w/2 + offset, pz: z, ry: Math.PI / 2 },
      { px: x + w/2 - offset, pz: z, ry: -Math.PI / 2 },
      { px: x, pz: z - d/2 + offset, ry: 0 },
      { px: x, pz: z + d/2 - offset, ry: Math.PI },
    ];
    wallPositions.forEach(({ px, pz, ry }) => {
      const strip = new THREE.Mesh(wallStripGeo, mat);
      strip.rotation.y = ry;
      strip.position.set(px, y, pz);
      this.scene.add(strip);
    });
  }

  addCorridorStrip(cor) {
    const { x, y, z, w, h, d, dir } = cor;
    const offset = 0.02;
    
    // Ceiling center strip
    let stripW, stripD;
    if (dir === "north" || dir === "south") {
      stripW = 0.2;
      stripD = d * 0.95;
    } else {
      stripW = w * 0.95;
      stripD = 0.2;
    }
    
    const ceilGeo = new THREE.PlaneGeometry(stripW, stripD);
    const ceilStrip = new THREE.Mesh(ceilGeo, this.greenStrip);
    ceilStrip.rotation.x = Math.PI / 2;
    ceilStrip.position.set(x, y + h/2 - offset, z);
    this.scene.add(ceilStrip);

    // Floor center strip
    const floorStrip = new THREE.Mesh(ceilGeo, this.greenStrip);
    floorStrip.rotation.x = -Math.PI / 2;
    floorStrip.position.set(x, y - h/2 + offset, z);
    this.scene.add(floorStrip);

    // Side wall strips (running length of corridor)
    const sideStripGeo = new THREE.PlaneGeometry(0.15, dir === "north" || dir === "south" ? d * 0.9 : w * 0.9);
    
    if (dir === "north" || dir === "south") {
      // East wall strip
      const eastStrip = new THREE.Mesh(sideStripGeo, this.greenStrip);
      eastStrip.rotation.y = -Math.PI / 2;
      eastStrip.position.set(x + w/2 - offset, y, z);
      this.scene.add(eastStrip);
      // West wall strip
      const westStrip = new THREE.Mesh(sideStripGeo, this.greenStrip);
      westStrip.rotation.y = Math.PI / 2;
      westStrip.position.set(x - w/2 + offset, y, z);
      this.scene.add(westStrip);
    } else {
      // North wall strip
      const northStrip = new THREE.Mesh(sideStripGeo, this.greenStrip);
      northStrip.position.set(x, y, z - d/2 + offset);
      this.scene.add(northStrip);
      // South wall strip
      const southStrip = new THREE.Mesh(sideStripGeo, this.greenStrip);
      southStrip.rotation.y = Math.PI;
      southStrip.position.set(x, y, z + d/2 - offset);
      this.scene.add(southStrip);
    }
  }

  addLights() {
    // Global ambient for base visibility
    const globalAmbient = new THREE.AmbientLight(0x334455, 0.4);
    this.scene.add(globalAmbient);

    this.rooms.forEach((room) => {
      const color = room.color === "red" ? 0xff3366 : 0x00ffaa;
      const range = Math.max(room.w, room.d) * 2.5;
      
      // Main colored ceiling light
      const mainLight = new THREE.PointLight(color, 4, range);
      mainLight.position.set(room.x, room.y + room.h * 0.4, room.z);
      this.scene.add(mainLight);

      // White fill light at center
      const fillLight = new THREE.PointLight(0xffffff, 2, range);
      fillLight.position.set(room.x, room.y, room.z);
      this.scene.add(fillLight);

      // Corner accent lights for larger rooms
      if (room.w > 20 || room.d > 20) {
        const cornerOffset = Math.min(room.w, room.d) * 0.35;
        const corners = [
          [room.x - cornerOffset, room.z - cornerOffset],
          [room.x + cornerOffset, room.z - cornerOffset],
          [room.x - cornerOffset, room.z + cornerOffset],
          [room.x + cornerOffset, room.z + cornerOffset],
        ];
        corners.forEach(([cx, cz]) => {
          const cornerLight = new THREE.PointLight(color, 1.5, range * 0.6);
          cornerLight.position.set(cx, room.y - room.h * 0.3, cz);
          this.scene.add(cornerLight);
        });
      }
    });

    this.corridors.forEach((cor) => {
      const range = Math.max(cor.w, cor.d) * 2;
      
      // Main corridor light
      const mainLight = new THREE.PointLight(0x00ffaa, 3, range);
      mainLight.position.set(cor.x, cor.y + cor.h * 0.3, cor.z);
      this.scene.add(mainLight);

      // Fill light
      const fillLight = new THREE.PointLight(0xffffff, 1.5, range);
      fillLight.position.set(cor.x, cor.y, cor.z);
      this.scene.add(fillLight);

      // Add lights along longer corridors
      const length = cor.dir === "north" || cor.dir === "south" ? cor.d : cor.w;
      if (length > 25) {
        const offset = length * 0.3;
        if (cor.dir === "north" || cor.dir === "south") {
          const light1 = new THREE.PointLight(0x00ffaa, 2, range * 0.7);
          light1.position.set(cor.x, cor.y, cor.z - offset);
          this.scene.add(light1);
          const light2 = new THREE.PointLight(0x00ffaa, 2, range * 0.7);
          light2.position.set(cor.x, cor.y, cor.z + offset);
          this.scene.add(light2);
        } else {
          const light1 = new THREE.PointLight(0x00ffaa, 2, range * 0.7);
          light1.position.set(cor.x - offset, cor.y, cor.z);
          this.scene.add(light1);
          const light2 = new THREE.PointLight(0x00ffaa, 2, range * 0.7);
          light2.position.set(cor.x + offset, cor.y, cor.z);
          this.scene.add(light2);
        }
      }
    });
  }

  getEnemySpawnPoints() {
    const points = [];
    this.rooms.forEach((room, i) => {
      if (i === 0) return;
      points.push(new THREE.Vector3(
        room.x + (Math.random() - 0.5) * room.w * 0.5,
        room.y,
        room.z + (Math.random() - 0.5) * room.d * 0.5
      ));
    });
    return points;
  }

  checkWallCollision(position, radius) {
    return false; 
  }
}
