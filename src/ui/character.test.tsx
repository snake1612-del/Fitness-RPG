import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { expect, it } from "vitest";
import { CharacterView } from "./character";

it("renders API values directly rather than deriving Level from Total XP", () => {
  const html = renderToStaticMarkup(
    createElement(CharacterView, {
      data: {
        totalXp: 987,
        level: 21,
        xpIntoLevel: 123,
        xpForNextLevel: 500,
        xpRemaining: 377,
      },
    }),
  );
  expect(html).toContain('data-stage="20"');
  expect(html).toContain("Level 21");
  expect(html).toContain("987");
  expect(html).toContain("123 / 500 XP");
  expect(html).toContain("377 XP remaining");
  expect(html).toContain('value="123" max="500"');
  expect(html).toContain("Final visual stage reached");
  expect(html).not.toContain("Level 22 ·");
});
it("all five current milestone emblems have distinct geometry", () => {
  const visuals = [1, 3, 5, 10, 20].map((level) => {
    const html = renderToStaticMarkup(
      createElement(CharacterView, {
        data: {
          totalXp: 1,
          level,
          xpIntoLevel: 1,
          xpForNextLevel: 100,
          xpRemaining: 99,
        },
      }),
    );
    return html.match(/<svg[\s\S]*?<\/svg>/)?.[0];
  });
  expect(visuals.every(Boolean)).toBe(true);
  expect(new Set(visuals).size).toBe(5);
});
