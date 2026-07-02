const STORAGE_KEY = "starspeed_weapon_unlocks";

export const PRIMARY_WEAPONS = Object.freeze({
  LASER: "laser",
  CHARGING_LASER: "chargingLaser",
  GATLING: "gatling",
});

export const PRIMARY_WEAPON_LABELS = Object.freeze({
  [PRIMARY_WEAPONS.LASER]: "LASER",
  [PRIMARY_WEAPONS.CHARGING_LASER]: "CHARGE",
  [PRIMARY_WEAPONS.GATLING]: "GATLING",
});

const DEFAULT_UNLOCKS = Object.freeze({
  [PRIMARY_WEAPONS.LASER]: true,
  [PRIMARY_WEAPONS.CHARGING_LASER]: false,
  [PRIMARY_WEAPONS.GATLING]: false,
});

function readUnlocks() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
}

function writeUnlocks(unlocks) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(unlocks));
  } catch {
    /* localStorage can be unavailable in private or embedded contexts. */
  }
}

export function getPrimaryWeaponUnlocks() {
  return {
    ...DEFAULT_UNLOCKS,
    ...readUnlocks(),
    [PRIMARY_WEAPONS.LASER]: true,
  };
}

export function isPrimaryWeaponUnlocked(weapon) {
  return getPrimaryWeaponUnlocks()[weapon] === true;
}

export function unlockPrimaryWeapon(weapon) {
  if (!Object.values(PRIMARY_WEAPONS).includes(weapon)) return false;
  const unlocks = getPrimaryWeaponUnlocks();
  const changed = unlocks[weapon] !== true;
  unlocks[weapon] = true;
  writeUnlocks(unlocks);
  return changed;
}

export function getUnlockedPrimaryWeaponList() {
  const unlocks = getPrimaryWeaponUnlocks();
  return [
    PRIMARY_WEAPONS.LASER,
    PRIMARY_WEAPONS.CHARGING_LASER,
    PRIMARY_WEAPONS.GATLING,
  ].filter((weapon) => unlocks[weapon] === true);
}
