import * as THREE from "three";

const CENTERLINE_BIN_SIZE = 0.75;
const _tmp = new THREE.Vector3();
const _tmp2 = new THREE.Vector3();

function pointFromAttribute(attribute, index, matrixWorld) {
  return new THREE.Vector3()
    .fromBufferAttribute(attribute, index)
    .applyMatrix4(matrixWorld);
}

export function findByPrefix(root, prefix) {
  let found = null;
  root?.traverse?.((object) => {
    if (!found && object.name?.startsWith(prefix)) found = object;
  });
  return found;
}

export function extractPathPoints(pathObject) {
  if (!pathObject?.geometry?.attributes?.position) return [];
  pathObject.updateWorldMatrix(true, false);
  const pos = pathObject.geometry.attributes.position;
  const index = pathObject.geometry.index;

  if (index && index.count >= 2) {
    const points = [];
    const first = index.getX(0);
    points.push(pointFromAttribute(pos, first, pathObject.matrixWorld));

    for (let i = 1; i < index.count; i += 2) {
      const next = index.getX(i);
      const point = pointFromAttribute(pos, next, pathObject.matrixWorld);
      if (point.distanceToSquared(points[points.length - 1]) > 0.01) {
        points.push(point);
      }
    }

    if (points.length >= 2) return points;
  }

  const rawPoints = [];
  for (let i = 0; i < pos.count; i++) {
    rawPoints.push(pointFromAttribute(pos, i, pathObject.matrixWorld));
  }
  if (rawPoints.length < 3) return rawPoints;

  const localBox = new THREE.Box3().setFromPoints(rawPoints);
  const size = localBox.getSize(new THREE.Vector3());
  const axis =
    size.x >= size.y && size.x >= size.z ? "x" : size.y >= size.z ? "y" : "z";
  const minAxis = localBox.min[axis];
  const bins = new Map();

  for (const point of rawPoints) {
    const key = Math.round((point[axis] - minAxis) / CENTERLINE_BIN_SIZE);
    let bin = bins.get(key);
    if (!bin) {
      bin = { sum: new THREE.Vector3(), count: 0, axisValue: 0 };
      bins.set(key, bin);
    }
    bin.sum.add(point);
    bin.axisValue += point[axis];
    bin.count += 1;
  }

  const points = [...bins.values()]
    .filter((bin) => bin.count > 0)
    .map((bin) => {
      const center = bin.sum.multiplyScalar(1 / bin.count);
      center.userData = { axisValue: bin.axisValue / bin.count };
      return center;
    })
    .sort((a, b) => a.userData.axisValue - b.userData.axisValue);

  const deduped = [];
  for (const point of points) {
    if (
      deduped.length === 0 ||
      point.distanceToSquared(deduped[deduped.length - 1]) > 0.25
    ) {
      deduped.push(point);
    }
  }
  return deduped;
}

export function buildPath(points) {
  const distances = [0];
  let total = 0;
  for (let i = 1; i < points.length; i++) {
    total += points[i - 1].distanceTo(points[i]);
    distances.push(total);
  }
  return { points, distances, total };
}

export function orientPathFromStart(points, startPoint) {
  if (points.length < 2 || !startPoint) return points;
  const firstDist = points[0].distanceToSquared(startPoint);
  const lastDist = points[points.length - 1].distanceToSquared(startPoint);
  if (lastDist < firstDist) points.reverse();
  return points;
}

export function samplePath(path, distance, out, tangentOut = null) {
  const d = THREE.MathUtils.clamp(distance, 0, path.total);
  const points = path.points;
  const distances = path.distances;
  if (points.length === 1) {
    out.copy(points[0]);
    tangentOut?.set(0, 0, -1);
    return out;
  }

  let i = 1;
  while (i < distances.length - 1 && distances[i] < d) i++;
  const a = points[i - 1];
  const b = points[i];
  const segLen = Math.max(0.0001, distances[i] - distances[i - 1]);
  const t = (d - distances[i - 1]) / segLen;
  out.copy(a).lerp(b, t);
  tangentOut?.subVectors(b, a).normalize();
  return out;
}

export function closestDistanceOnPath(path, point) {
  let bestDistSq = Infinity;
  let bestAlong = 0;
  for (let i = 1; i < path.points.length; i++) {
    const a = path.points[i - 1];
    const b = path.points[i];
    _tmp.subVectors(b, a);
    const lenSq = Math.max(0.0001, _tmp.lengthSq());
    const t = THREE.MathUtils.clamp(
      _tmp2.subVectors(point, a).dot(_tmp) / lenSq,
      0,
      1,
    );
    _tmp2.copy(a).addScaledVector(_tmp, t);
    const distSq = _tmp2.distanceToSquared(point);
    if (distSq < bestDistSq) {
      bestDistSq = distSq;
      bestAlong = path.distances[i - 1] + Math.sqrt(lenSq) * t;
    }
  }
  return bestAlong;
}

export function createPathRailFromScene(root, options = {}) {
  const pathObject = findByPrefix(root, options.pathName ?? "ChasePath");
  const marker = findByPrefix(root, options.markerName ?? "ChaseEnemy");
  const points = extractPathPoints(pathObject);
  if (!pathObject || points.length < 2) return null;

  if (marker) {
    marker.updateWorldMatrix(true, false);
    marker.getWorldPosition(_tmp);
    orientPathFromStart(points, _tmp);
    marker.visible = false;
  }
  pathObject.visible = false;

  return buildPath(points);
}
