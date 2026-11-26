import test from "node:test";
import assert from "node:assert/strict";
import {
  appearanceVariables,
  contrastRatio,
  effectiveAppearance,
  fontFamilyCss,
  normalizePreferences,
  resolveAccent,
  themePalettes,
  uiFontFallback,
} from "../src/appearance.ts";
import { createLibrary } from "../src/data.ts";
import { isLibrary } from "../src/model.ts";

const preferences = { fontSize: 16, font: "sans", theme: "paper" };

test("font size bounds apply independently and survive a library round trip", () => {
  for (const [uiFontSize, fontSize] of [[10, 20], [20, 10]]) {
    const library = createLibrary();
    library.preferences = normalizePreferences({ ...preferences, uiFontSize, fontSize });
    const restored = JSON.parse(JSON.stringify(library));
    assert.ok(isLibrary(restored));
    const css = appearanceVariables(restored.preferences);
    assert.equal(css["--ui-font-size"], `${uiFontSize}px`);
    assert.equal(css["--reading-size"], `${fontSize}px`);
  }
  const library = createLibrary();
  library.preferences.fontSize = 36;
  library.preferences.uiFontSize = 24;
  assert.ok(isLibrary(library));
  assert.equal(normalizePreferences(library.preferences).fontSize, 20);
  assert.equal(normalizePreferences(library.preferences).uiFontSize, 20);
  library.preferences.fontSize = 37;
  assert.equal(isLibrary(library), false);
});

test("legacy appearance settings gain optional fields without resetting existing choices", () => {
  const previous = { fontSize: 26, font: "sans", theme: "night" };
  const result = normalizePreferences(previous);
  assert.deepEqual(result, {
    ...previous,
    fontSize: 20,
    locale: "zh-CN",
    accentColor: "",
    followSystemTheme: false,
    uiFontSize: undefined,
    narrowReading: false,
    markReadOnOpen: true,
    codeFontFamily: "",
    singleKeyShortcuts: true,
    uiFontFamily: "",
    readingFontFamily: "",
    sidebarWidth: undefined,
    articleListWidth: undefined,
  });
  assert.deepEqual(normalizePreferences(result), result);
});

test("column widths accept valid pixels and drop out-of-range values", () => {
  const base = { fontSize: 20, font: "sans", theme: "paper" };
  const valid = normalizePreferences({
    ...base, sidebarWidth: 240.6, articleListWidth: 380,
  });
  assert.equal(valid.sidebarWidth, 241);
  assert.equal(valid.articleListWidth, 380);
  const invalid = normalizePreferences({
    ...base, sidebarWidth: 9999, articleListWidth: -5,
  });
  assert.equal(invalid.sidebarWidth, undefined);
  assert.equal(invalid.articleListWidth, undefined);
});

test("interface starts at 14 px and reading at 16 px with the same system font", () => {
  const values = createLibrary().preferences;
  const css = appearanceVariables(values);
  assert.equal(css["--ui-font-size"], "14px");
  assert.equal(css["--ui-size-offset"], "-2px");
  assert.equal(css["--reading-size"], "16px");
  assert.equal(css["--ui-font"], uiFontFallback);
  assert.equal(css["--reading-font"], uiFontFallback);
  assert.equal(
    appearanceVariables({ ...values, uiFontFamily: "Avenir Next" })["--reading-font"],
    uiFontFallback,
  );
});

test("default accent and selection match the user-provided Mozi reference", () => {
  const night = appearanceVariables({ ...preferences, theme: "night" });
  assert.equal(themePalettes.night.canvas, "#24272c");
  assert.equal(themePalettes.paper.canvas, "#faf8f4");
  assert.equal(night["--accent"], "#d49b7e");
  assert.equal(night["--selected"], "#353d45");
  assert.equal(appearanceVariables(preferences)["--accent"], "#a65f44");
});

test("custom colors remain readable as text and as filled controls in either mode", () => {
  for (const theme of ["paper", "night"]) {
    for (const accentColor of [
      "#ffffff",
      "#000000",
      "#ffff00",
      "#3f7654",
      "#4f7cac",
      "#926486",
      "#ff0000",
    ]) {
      const appearance = appearanceVariables({
        ...preferences,
        theme,
        accentColor,
      });
      assert.ok(
        contrastRatio(appearance["--accent"], themePalettes[theme].canvas) >=
          4.5,
      );
      assert.ok(
        contrastRatio(
          appearance["--accent"],
          appearance["--accent-foreground"],
        ) >= 4.5,
      );
    }
  }
  assert.equal(resolveAccent("not-a-color", "night"), "#d49b7e");
});

test("custom font names are quoted and keep system fallback rather than injecting CSS", () => {
  const result = appearanceVariables({
    ...preferences,
    uiFontFamily: "Avenir Next",
    readingFontFamily: "Kaiti SC",
  });
  assert.ok(result["--ui-font"].startsWith('"Avenir Next",'));
  assert.ok(result["--reading-font"].startsWith('"Kaiti SC",'));
  assert.equal(fontFamilyCss("", uiFontFallback), uiFontFallback);
  assert.equal(fontFamilyCss("bad\nname", uiFontFallback), uiFontFallback);
  assert.ok(
    fontFamilyCss('A "quoted" name', uiFontFallback).startsWith(
      '"A \\"quoted\\" name",',
    ),
  );
});

test("system appearance resolves its palette without overwriting a manual choice", () => {
  const values = normalizePreferences({
    ...preferences,
    followSystemTheme: true,
  });
  assert.equal(effectiveAppearance(values, false), "paper");
  assert.equal(effectiveAppearance(values, true), "night");
  assert.equal(
    appearanceVariables(values, effectiveAppearance(values, true))["--accent"],
    "#d49b7e",
  );
  assert.equal(values.theme, "paper");
  assert.equal(
    effectiveAppearance({ ...values, followSystemTheme: false }, true),
    "paper",
  );
});

test("reading and interface settings retain their own values and reject invalid presentation input", () => {
  const values = normalizePreferences({
    ...preferences,
    locale: "en",
    uiFontSize: 19,
    narrowReading: true,
    codeFontFamily: " Menlo ",
    markReadOnOpen: false,
    singleKeyShortcuts: false,
  });
  const css = appearanceVariables(values);
  assert.equal(css["--ui-size-offset"], "3px");
  assert.equal(values.locale, "en");
  assert.equal(css["--reading-width"], "740px");
  assert.match(css["--code-font"], /^"Menlo",/);
  assert.equal(values.fontSize, preferences.fontSize);
  assert.equal(values.markReadOnOpen, false);
  assert.equal(values.singleKeyShortcuts, false);
  const bad = appearanceVariables({
    ...preferences,
    uiFontSize: 200,
    codeFontFamily: "bad\nname",
  });
  assert.equal(bad["--ui-font-size"], "14px");
  assert.match(bad["--code-font"], /^"SFMono-Regular",/);
});

test("named reading fonts use local family aliases and keep the system fallback", () => {
  const jinkai = appearanceVariables({
    ...preferences,
    uiFontFamily: "PingFang SC",
    readingFontFamily: "TsangerJinKai02 W04",
  });
  assert.match(jinkai["--reading-font"], /"TsangerJinKai02"/);
  assert.ok(jinkai["--reading-font"].endsWith(uiFontFallback));
  assert.match(jinkai["--ui-font"], /^"PingFang SC",/);
  const oldSong = appearanceVariables({
    ...preferences,
    readingFontFamily: "KingHwa OldSong",
  });
  assert.match(oldSong["--reading-font"], /"京華老宋体"/);
});
