import { expect, test, type Page } from '@playwright/test';

async function activeElement(page: Page) {
  return page.evaluate(() => {
    const active = document.activeElement;
    return {
      tag: active?.tagName,
      text: active?.tagName === 'BODY' ? '(body)' : active?.textContent?.trim().slice(0, 80),
      ariaLabel: active?.getAttribute('aria-label'),
    };
  });
}

test.beforeEach(async ({ page, baseURL }) => {
  const origin = new URL(baseURL!).origin;
  // Opening and cancelling this dialog must never mutate workspace data.
  await page.route('**/*', async route => {
    const request = route.request();
    const url = new URL(request.url());
    if (['http:', 'https:'].includes(url.protocol) &&
        (url.origin !== origin || !['GET', 'HEAD'].includes(request.method()))) {
      throw new Error(`Unexpected non-read-only request: ${request.method()} ${url.origin}${url.pathname}`);
    }
    await route.continue();
  });
  await page.goto('/');
  await expect(page.getByRole('button', { name: '새 프로젝트', exact: true })).toBeVisible();
});

test('A11Y01: closing the auto-focused project dialog restores its mouse trigger', async ({ page }, info) => {
  const trigger = page.getByRole('button', { name: '새 프로젝트', exact: true });
  await trigger.click();
  const dialog = page.getByRole('dialog', { name: '새 프로젝트 만들기', exact: true });
  await expect(dialog).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(dialog).toHaveCount(0);
  await info.attach('focus-after-escape', {
    body: JSON.stringify(await activeElement(page), null, 2),
    contentType: 'application/json',
  });
  await expect(trigger).toBeFocused();
});

test('A11Y02: real keyboard navigation traps modal focus and restores the opening button', async ({ page }, info) => {
  const trigger = page.getByRole('button', { name: '새 프로젝트', exact: true });
  let reachedTrigger = false;
  for (let index = 0; index < 40; index += 1) {
    await page.keyboard.press('Tab');
    reachedTrigger = await trigger.evaluate(element => element === document.activeElement);
    if (reachedTrigger) break;
  }
  expect(reachedTrigger, 'Tab reaches the new-project button without programmatic focus').toBe(true);
  await expect(trigger).toBeFocused();
  await page.keyboard.press('Enter');
  const dialog = page.getByRole('dialog', { name: '새 프로젝트 만들기', exact: true });
  await expect(dialog).toBeVisible();
  const first = dialog.getByRole('button', { name: '닫기', exact: true });
  const last = dialog.getByRole('button', { name: '취소', exact: true });
  // The dialog or its intentionally auto-focused name field may receive initial focus.
  // Walk the real tab sequence while asserting it never escapes the modal.
  let reachedFirst = false;
  for (let index = 0; index < 8; index += 1) {
    await page.keyboard.press('Tab');
    expect(await dialog.evaluate(element => element.contains(document.activeElement)), 'Tab remains inside the dialog').toBe(true);
    reachedFirst = await first.evaluate(element => element === document.activeElement);
    if (reachedFirst) break;
  }
  expect(reachedFirst, 'Tab reaches the first modal control').toBe(true);
  await expect(first).toBeFocused();
  await page.keyboard.press('Shift+Tab');
  await expect(last).toBeFocused();
  await page.keyboard.press('Tab');
  await expect(first).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(dialog).toHaveCount(0);
  await info.attach('focus-after-escape', {
    body: JSON.stringify(await activeElement(page), null, 2),
    contentType: 'application/json',
  });
  await expect(trigger).toBeFocused();
});
