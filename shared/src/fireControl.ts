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
  return currentTick >= runtime.nextFireTick;
}

export function advanceFireCooldown(
  runtime: WeaponRuntime,
  weaponDef: WeaponDef,
  currentTick: number,
  burstShotCount: number = 1
): void {
  const schedule = getFireSchedule(weaponDef);
  
  // 如果是连发武器，计算总冷却时间（包括连发间隔）
  if (schedule.burstCount > 1 && burstShotCount > 1) {
    const burstTotalMs = (burstShotCount - 1) * schedule.burstIntervalMs + schedule.fireIntervalMs;
    runtime.nextFireTick = currentTick + msToTicks(burstTotalMs);
  } else {
    runtime.nextFireTick = currentTick + msToTicks(schedule.fireIntervalMs);
  }
}
