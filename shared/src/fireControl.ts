import type { WeaponDef } from './equipment.js';
import type { WeaponRuntime } from './types.js';
import { msToTicks } from './constants.js';

export type FireSchedule = {
  fireIntervalMs: number;
  burstCount: number;
  burstIntervalMs: number;
};

export function getFireSchedule(weaponDef: WeaponDef): FireSchedule {
  return {
    fireIntervalMs: weaponDef.fireIntervalMs,
    burstCount: weaponDef.burstCount ?? 1,
    burstIntervalMs: weaponDef.burstIntervalMs ?? weaponDef.fireIntervalMs,
  };
}

export function isBurstWeapon(weaponDef: WeaponDef): boolean {
  return getFireSchedule(weaponDef).burstCount > 1;
}

export function shouldStartBurst(
  weaponDef: WeaponDef,
  shootNow: boolean,
  wasShooting: boolean
): boolean {
  if (!shootNow) return false;
  return isBurstWeapon(weaponDef) ? !wasShooting : true;
}

export function canFireTick(runtime: WeaponRuntime, currentTick: number): boolean {
  const burstRemaining = runtime.burstRemaining ?? 0;
  if (burstRemaining > 0) {
    return currentTick >= (runtime.burstNextTick ?? 0);
  }
  return currentTick >= runtime.nextFireTick;
}

export function advanceBurstAfterShot(
  runtime: WeaponRuntime,
  weaponDef: WeaponDef,
  currentTick: number
): void {
  const schedule = getFireSchedule(weaponDef);
  const burstRemaining = runtime.burstRemaining ?? 0;

  if (burstRemaining > 0) {
    runtime.burstRemaining = burstRemaining - 1;
    if ((runtime.burstRemaining ?? 0) > 0) {
      runtime.burstNextTick = currentTick + msToTicks(schedule.burstIntervalMs);
    } else {
      runtime.nextFireTick = currentTick + msToTicks(schedule.fireIntervalMs);
      runtime.burstRemaining = undefined;
      runtime.burstNextTick = undefined;
    }
    return;
  }

  if (schedule.burstCount > 1) {
    runtime.burstRemaining = schedule.burstCount - 1;
    runtime.burstNextTick = currentTick + msToTicks(schedule.burstIntervalMs);
    return;
  }

  runtime.nextFireTick = currentTick + msToTicks(schedule.fireIntervalMs);
}
