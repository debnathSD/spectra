// Real rigid-body physics (cannon-es), simulated once from the first frame and
// replayed: transformsAt(frame) gives every body's position and rotation, so
// any frame renders the same on any render worker.
import * as CANNON from 'cannon-es';

const cache = new Map();

/**
 * key: a stable name for the simulation. setup(world, CANNON) adds bodies and
 * returns them (in order). frames: how many frames to record, at `fps`.
 * Returns frame => [{ p: [x, y, z], q: [x, y, z, w] }, …].
 */
export function simulate(key, setup, frames, { substeps = 4, gravity = -9.82, fps = 60 } = {}) {
  key = `${key}@${fps}`;
  if (cache.has(key)) return cache.get(key);
  const world = new CANNON.World({ gravity: new CANNON.Vec3(0, gravity, 0) });
  world.allowSleep = true;
  world.defaultContactMaterial.friction = 0.35;
  world.defaultContactMaterial.restitution = 0.32;
  const bodies = setup(world, CANNON);
  const record = [];
  const dt = 1 / fps;
  for (let f = 0; f < frames; f++) {
    record.push(bodies.map(b => ({ p: [b.position.x, b.position.y, b.position.z], q: [b.quaternion.x, b.quaternion.y, b.quaternion.z, b.quaternion.w] })));
    // a body can wait, frozen, and drop in later: b.dropAt (frame) with b.dropMass
    for (const b of bodies)
      if (b.dropAt === f) {
        b.type = CANNON.Body.DYNAMIC;
        b.mass = b.dropMass ?? 1;
        b.updateMassProperties();
        b.wakeUp();
      }
    for (const b of bodies) b.onFrame?.(f, b);
    for (let i = 0; i < substeps; i++) world.step(dt / substeps);
  }
  const at = frame => record[Math.max(0, Math.min(record.length - 1, Math.round(frame)))];
  cache.set(key, at);
  return at;
}

/** A static ground plane at y = 0. */
export const ground = (world, C) => {
  const g = new C.Body({ type: C.Body.STATIC, shape: new C.Plane() });
  g.quaternion.setFromEuler(-Math.PI / 2, 0, 0);
  world.addBody(g);
  return g;
};
