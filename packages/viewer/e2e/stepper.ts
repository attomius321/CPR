import type { Locator, Page } from '@playwright/test';

/** An effort stepper's stop words under its track, in order (fix/scout-effort-level). */
export const stops = (slider: Locator): Locator =>
  slider.locator('xpath=..').locator('.effort-stops > *');

/**
 * Drags an effort stepper's handle from where it is to its `stop`th stop (0: the agent's own
 * default) with the mouse, and lets go. The handle is 16 px wide: its centre runs 8 px in from
 * either end of the track.
 */
export async function dragTo(page: Page, slider: Locator, stop: number): Promise<void> {
  const box = await slider.boundingBox();
  if (!box) throw new Error('the stepper is not drawn');
  const last = Number(await slider.getAttribute('max'));
  const at = (i: number) => box.x + 8 + ((box.width - 16) * i) / last;
  const y = box.y + box.height / 2;
  await page.mouse.move(at(Number(await slider.inputValue())), y);
  await page.mouse.down();
  await page.mouse.move(at(stop), y, { steps: 8 });
  await page.mouse.up();
}
