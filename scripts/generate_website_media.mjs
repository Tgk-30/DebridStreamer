#!/usr/bin/env node
import { mkdirSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const { PNG } = require("../web/node_modules/pngjs");

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const outDir = join(root, "website", "media");
mkdirSync(outDir, { recursive: true });

function rgba(hex, alpha = 255) {
  const value = hex.replace("#", "");
  return [
    Number.parseInt(value.slice(0, 2), 16),
    Number.parseInt(value.slice(2, 4), 16),
    Number.parseInt(value.slice(4, 6), 16),
    alpha,
  ];
}

function mix(a, b, t) {
  return [
    Math.round(a[0] + (b[0] - a[0]) * t),
    Math.round(a[1] + (b[1] - a[1]) * t),
    Math.round(a[2] + (b[2] - a[2]) * t),
    Math.round(a[3] + (b[3] - a[3]) * t),
  ];
}

function blendPixel(png, x, y, color) {
  if (x < 0 || y < 0 || x >= png.width || y >= png.height) return;
  const index = (Math.floor(y) * png.width + Math.floor(x)) * 4;
  const alpha = color[3] / 255;
  png.data[index] = Math.round(color[0] * alpha + png.data[index] * (1 - alpha));
  png.data[index + 1] = Math.round(color[1] * alpha + png.data[index + 1] * (1 - alpha));
  png.data[index + 2] = Math.round(color[2] * alpha + png.data[index + 2] * (1 - alpha));
  png.data[index + 3] = 255;
}

function rect(png, x, y, w, h, color) {
  for (let py = Math.max(0, y); py < Math.min(png.height, y + h); py += 1) {
    for (let px = Math.max(0, x); px < Math.min(png.width, x + w); px += 1) {
      blendPixel(png, px, py, color);
    }
  }
}

function gradientRect(png, x, y, w, h, top, bottom) {
  for (let py = Math.max(0, y); py < Math.min(png.height, y + h); py += 1) {
    const t = h <= 1 ? 0 : (py - y) / (h - 1);
    const color = mix(top, bottom, t);
    for (let px = Math.max(0, x); px < Math.min(png.width, x + w); px += 1) {
      blendPixel(png, px, py, color);
    }
  }
}

function roundRect(png, x, y, w, h, radius, color) {
  const r = Math.max(0, radius);
  for (let py = Math.max(0, y); py < Math.min(png.height, y + h); py += 1) {
    for (let px = Math.max(0, x); px < Math.min(png.width, x + w); px += 1) {
      const dx = px < x + r ? x + r - px : px > x + w - r ? px - (x + w - r) : 0;
      const dy = py < y + r ? y + r - py : py > y + h - r ? py - (y + h - r) : 0;
      if (dx * dx + dy * dy <= r * r) blendPixel(png, px, py, color);
    }
  }
}

function circle(png, cx, cy, radius, color) {
  const r2 = radius * radius;
  for (let py = Math.max(0, cy - radius); py < Math.min(png.height, cy + radius); py += 1) {
    for (let px = Math.max(0, cx - radius); px < Math.min(png.width, cx + radius); px += 1) {
      const dx = px - cx;
      const dy = py - cy;
      if (dx * dx + dy * dy <= r2) blendPixel(png, px, py, color);
    }
  }
}

function line(png, x1, y1, x2, y2, color, width = 1) {
  const steps = Math.max(Math.abs(x2 - x1), Math.abs(y2 - y1));
  for (let i = 0; i <= steps; i += 1) {
    const t = steps === 0 ? 0 : i / steps;
    const x = Math.round(x1 + (x2 - x1) * t);
    const y = Math.round(y1 + (y2 - y1) * t);
    rect(png, x - Math.floor(width / 2), y - Math.floor(width / 2), width, width, color);
  }
}

function noise(png, opacity = 10) {
  for (let y = 0; y < png.height; y += 2) {
    for (let x = 0; x < png.width; x += 2) {
      const value = (x * 31 + y * 17) % 255;
      blendPixel(png, x, y, [value, value, value, opacity]);
    }
  }
}

function makePng(width, height, bg = "#111426") {
  const png = new PNG({ width, height });
  rect(png, 0, 0, width, height, rgba(bg));
  noise(png, 7);
  return png;
}

function fakeText(png, x, y, widths, color = rgba("#ffffff", 180), h = 10, gap = 12) {
  widths.forEach((w, i) => roundRect(png, x, y + i * gap, w, h, Math.ceil(h / 2), color));
}

function sparkle(png, x, y, size, color = rgba("#ffffff", 150)) {
  line(png, x - size, y, x + size, y, color, 2);
  line(png, x, y - size, x, y + size, color, 2);
}

function playTriangle(png, x, y, size, color = rgba("#ffffff", 220)) {
  for (let row = 0; row < size; row += 1) {
    const width = Math.round((row / size) * size);
    rect(png, x + row, y - width, 2, width * 2 + 1, color);
  }
}

function abstractBackdrop(png, x, y, w, h, variant = 0) {
  roundRect(png, x, y, w, h, 20, rgba("#05070d", 255));
  gradientRect(png, x, y, w, h, rgba("#10213f", 230), rgba("#05070d", 255));
  const sunX = x + Math.round(w * (variant % 2 === 0 ? 0.7 : 0.34));
  const sunY = y + Math.round(h * 0.22);
  for (let r = Math.round(h * 0.22); r > 0; r -= 10) {
    circle(png, sunX, sunY, r, rgba(variant % 2 === 0 ? "#5cbdfa" : "#62d98c", Math.max(4, 38 - r / 5)));
  }
  circle(png, sunX, sunY, Math.round(h * 0.075), rgba(variant % 2 === 0 ? "#8c85fa" : "#5cbdfa", 118));
  for (let i = 0; i < 32; i += 1) {
    const sx = x + ((i * 97 + variant * 53) % Math.max(1, w));
    const sy = y + 20 + ((i * 43 + variant * 29) % Math.max(1, Math.round(h * 0.48)));
    sparkle(png, sx, sy, i % 3 === 0 ? 3 : 2, rgba("#ffffff", i % 4 === 0 ? 150 : 80));
  }
  const base = y + Math.round(h * 0.7);
  for (let i = 0; i < 9; i += 1) {
    const mx = x + Math.round((i / 8) * w);
    const peak = base - Math.round(h * (0.14 + ((i + variant) % 4) * 0.035));
    line(png, mx - Math.round(w * 0.18), base, mx, peak, rgba("#03050b", 210), 10);
    line(png, mx, peak, mx + Math.round(w * 0.2), base, rgba("#03050b", 210), 10);
  }
  gradientRect(png, x, y + Math.round(h * 0.54), w, Math.round(h * 0.46), rgba("#05070d", 20), rgba("#05070d", 220));
}

function poster(png, x, y, w, h, variant) {
  roundRect(png, x, y, w, h, 14, rgba("#ffffff", 30));
  gradientRect(
    png,
    x,
    y,
    w,
    h,
    rgba(["#203f73", "#49316f", "#314d3d", "#64442a"][variant % 4], 235),
    rgba("#05070d", 250),
  );
  circle(png, x + Math.round(w * 0.68), y + Math.round(h * 0.24), Math.round(w * 0.22), rgba("#ffffff", 26));
  for (let i = 0; i < 4; i += 1) {
    rect(
      png,
      x + Math.round(w * (0.16 + i * 0.16)),
      y + Math.round(h * 0.44),
      Math.round(w * 0.1),
      Math.round(h * (0.38 - i * 0.035)),
      rgba(i % 2 ? "#5cbdfa" : "#8c85fa", 90),
    );
  }
}

function sidebar(png, width) {
  gradientRect(png, 0, 0, width, png.height, rgba("#111324", 245), rgba("#070914", 255));
  rect(png, width - 1, 0, 1, png.height, rgba("#ffffff", 28));
  const labels = [78, 68, 82, 86, 62, 76];
  for (let i = 0; i < labels.length; i += 1) {
    const y = 54 + i * 66;
    circle(png, 38, y, 12, rgba("#ffffff", i === 0 ? 210 : 105));
    fakeText(png, 65, y - 6, [labels[i]], rgba("#ffffff", i === 0 ? 210 : 110), 9, 10);
  }
  roundRect(png, 10, 34, width - 22, 50, 10, rgba("#8c85fa", 60));
  rect(png, 0, 48, 4, 26, rgba("#5cbdfa", 250));
  fakeText(png, 24, png.height - 66, [80], rgba("#ffffff", 130), 10, 10);
}

function appShell(width, height) {
  const png = makePng(width, height, "#111426");
  gradientRect(png, 0, 0, width, height, rgba("#171932", 255), rgba("#081020", 255));
  sidebar(png, Math.round(width * 0.145));
  const mainX = Math.round(width * 0.165);
  const mainW = width - mainX - 24;
  roundRect(png, width - Math.round(width * 0.255), 20, Math.round(width * 0.24), 52, 26, rgba("#ffffff", 30));
  fakeText(png, width - Math.round(width * 0.226), 41, [Math.round(width * 0.14)], rgba("#ffffff", 110), 8, 10);
  return { png, mainX, mainW };
}

function discover(width, height, mobileScale = false) {
  const { png, mainX, mainW } = appShell(width, height);
  const heroY = mobileScale ? 92 : 88;
  const heroH = Math.round(height * (mobileScale ? 0.42 : 0.47));
  abstractBackdrop(png, mainX, heroY, mainW, heroH, mobileScale ? 1 : 0);
  roundRect(png, mainX + Math.round(mainW * 0.72), heroY + 28, Math.round(mainW * 0.22), 54, 27, rgba("#05070d", 190));
  fakeText(png, mainX + Math.round(mainW * 0.735), heroY + 50, [38, 120], rgba("#ffffff", 170), 8, 14);
  roundRect(png, mainX + 52, heroY + Math.round(heroH * 0.55), 104, 38, 19, rgba("#ffffff", 38));
  fakeText(png, mainX + 175, heroY + Math.round(heroH * 0.565), [72, 48], rgba("#ffffff", 150), 10, 18);
  fakeText(png, mainX + 52, heroY + Math.round(heroH * 0.66), [310], rgba("#ffffff", 230), mobileScale ? 28 : 38, mobileScale ? 36 : 46);
  const buttonY = heroY + Math.round(heroH * 0.82);
  roundRect(png, mainX + 52, buttonY, 132, 46, 23, rgba("#8c85fa", 230));
  playTriangle(png, mainX + 82, buttonY + 23, 10, rgba("#ffffff", 235));
  fakeText(png, mainX + 108, buttonY + 18, [46], rgba("#ffffff", 220), 10, 10);
  roundRect(png, mainX + 204, buttonY, 154, 46, 23, rgba("#ffffff", 48));
  circle(png, mainX + 232, buttonY + 23, 11, rgba("#ffffff", 120));
  fakeText(png, mainX + 254, buttonY + 18, [76], rgba("#ffffff", 190), 10, 10);

  const vibeW = Math.round(mainW * (mobileScale ? 0.9 : 0.78));
  const vibeX = mainX + Math.round(mainW * (mobileScale ? 0.05 : 0.1));
  const vibeY = heroY + heroH + 32;
  const vibeH = Math.round(height * (mobileScale ? 0.2 : 0.21));
  roundRect(png, vibeX, vibeY, vibeW, vibeH, 22, rgba("#ffffff", 42));
  gradientRect(png, vibeX, vibeY, vibeW, vibeH, rgba("#343757", 215), rgba("#1c2948", 225));
  sparkle(png, vibeX + 38, vibeY + 40, 13, rgba("#8c85fa", 220));
  fakeText(png, vibeX + 66, vibeY + 28, [190, 300], rgba("#ffffff", 165), 14, 23);
  roundRect(png, vibeX + 28, vibeY + 72, vibeW - 56, 54, 14, rgba("#ffffff", 42));
  fakeText(png, vibeX + 74, vibeY + 93, [Math.round(vibeW * 0.34)], rgba("#ffffff", 120), 11, 10);
  roundRect(png, vibeX + vibeW - 152, vibeY + 81, 118, 36, 18, rgba("#ffffff", 56));
  const chipY = vibeY + 142;
  for (let i = 0; i < 4; i += 1) {
    const chipW = Math.round((vibeW - 86) / 4);
    roundRect(png, vibeX + 28 + i * (chipW + 10), chipY, chipW, 38, 19, rgba("#ffffff", 42));
  }

  const rowY = vibeY + vibeH + 44;
  fakeText(png, mainX, rowY, [170], rgba("#ffffff", 180), 18, 20);
  for (let i = 0; i < 6; i += 1) {
    const cardW = Math.round(mainW * 0.13);
    const x = mainX + i * (cardW + 30);
    poster(png, x, rowY + 46, cardW, Math.round(height * 0.2), i);
  }
  return png;
}

function settingsMobile() {
  const png = makePng(390, 792, "#111426");
  gradientRect(png, 0, 0, 390, 792, rgba("#171932", 255), rgba("#081020", 255));
  roundRect(png, 18, 22, 354, 64, 28, rgba("#ffffff", 28));
  fakeText(png, 62, 49, [188], rgba("#ffffff", 120), 9, 10);
  roundRect(png, 18, 108, 354, 246, 20, rgba("#ffffff", 38));
  gradientRect(png, 18, 108, 354, 246, rgba("#333654", 215), rgba("#181d37", 230));
  fakeText(png, 40, 136, [178, 124], rgba("#ffffff", 210), 22, 32);
  for (let i = 0; i < 4; i += 1) {
    const x = 40 + (i % 2) * 162;
    const y = 206 + Math.floor(i / 2) * 64;
    roundRect(png, x, y, 146, 52, 12, rgba("#ffffff", 34));
    fakeText(png, x + 14, y + 17, [84, 62], rgba("#ffffff", 132), 9, 18);
  }
  roundRect(png, 18, 378, 354, 294, 20, rgba("#ffffff", 34));
  gradientRect(png, 18, 378, 354, 294, rgba("#2b3356", 205), rgba("#12182f", 225));
  fakeText(png, 40, 404, [210, 276], rgba("#ffffff", 142), 13, 24);
  for (let i = 0; i < 4; i += 1) {
    const y = 474 + i * 42;
    roundRect(png, 40, y, 310, 34, 17, rgba("#ffffff", 28));
    fakeText(png, 58, y + 12, [120 + i * 18], rgba("#ffffff", 120), 8, 10);
    roundRect(png, 292, y + 6, 40, 22, 11, rgba(i % 2 ? "#ffffff" : "#8c85fa", i % 2 ? 44 : 140));
    circle(png, 292 + (i % 2 ? 12 : 28), y + 17, 8, rgba("#ffffff", 190));
  }
  for (let i = 0; i < 2; i += 1) {
    const x = 40 + i * 156;
    roundRect(png, x, 642, 140, 32, 16, rgba(i === 0 ? "#8c85fa" : "#ffffff", i === 0 ? 130 : 38));
  }
  roundRect(png, 18, 706, 354, 58, 26, rgba("#060912", 245));
  for (let i = 0; i < 4; i += 1) {
    const x = 62 + i * 88;
    circle(png, x, 744, 9, rgba(i === 0 ? "#8c85fa" : "#ffffff", 190));
    fakeText(png, x - 18, 764, [36], rgba("#ffffff", 110), 6, 8);
  }
  return png;
}

function writePng(file, png) {
  writeFileSync(join(outDir, file), PNG.sync.write(png));
  console.log(`wrote website/media/${file}`);
}

writePng("discover-desktop.png", discover(1440, 848));
writePng("discover-tablet.png", discover(768, 1196, true));
writePng("settings-mobile.png", settingsMobile());
