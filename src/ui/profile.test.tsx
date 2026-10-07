import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { expect, it } from "vitest";
import { AccountIdentity } from "./profile";
import { BottomNavigation, ProfileLink } from "./navigation";

it("renders existing account name and identifier as escaped text", () => {
  const html = renderToStaticMarkup(
    createElement(AccountIdentity, {
      account: { name: "Alex <test>", email: "alex@example.test" },
    }),
  );
  expect(html).toContain("Alex &lt;test&gt;");
  expect(html).toContain("alex@example.test");
});
it("uses the identifier without requiring a display name", () => {
  const html = renderToStaticMarkup(
    createElement(AccountIdentity, {
      account: { email: "alex@example.test" },
    }),
  );
  expect(html).toContain("alex@example.test");
  expect(html).not.toContain("account-name");
});
it("uses a neutral signed-in label if no identifier is available", () => {
  expect(
    renderToStaticMarkup(createElement(AccountIdentity, { account: {} })),
  ).toContain("Signed in");
});
it("keeps Profile out of core navigation and exposes a labelled neutral icon", () => {
  const nav = renderToStaticMarkup(
    createElement(BottomNavigation, { screen: "profile" }),
  );
  expect(nav).not.toContain("/profile");
  expect(nav).toContain("/character");
  const entry = renderToStaticMarkup(createElement(ProfileLink));
  expect(entry).toContain('href="/profile"');
  expect(entry).toContain('aria-label="Profile"');
  expect(entry).toContain('aria-hidden="true"');
});
